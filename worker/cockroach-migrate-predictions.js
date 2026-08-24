#!/usr/bin/env node
/**
 * CockroachDB Prediction Migration Worker
 * 
 * Resume-safe: skips IDs already in CockroachDB.
 * Runs in batches to avoid timeouts.
 * 
 * Usage: node worker/cockroach-migrate-predictions.js [batch_size]
 * Default batch: 500 rows per request
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i===-1) continue;
    const k = t.slice(0,i).trim(); let v = t.slice(i+1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1,-1);
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
const BATCH = parseInt(process.argv[2]) || 500;
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const cockroach = new Pool({
  connectionString: env.COCKROACHDB_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  CockroachDB Prediction Migration');
  console.log('═══════════════════════════════════════');

  // Get existing IDs from CockroachDB
  const { rows: existing } = await cockroach.query('SELECT id FROM cockroach_predictions');
  const existingIds = new Set(existing.map(r => r.id));
  console.log('Already in CockroachDB: ' + existingIds.size.toLocaleString());

  // Get total from Supabase
  const { count } = await supabase.from('predictions').select('*', { count: 'exact', head: true });
  console.log('Total in Supabase:      ' + count.toLocaleString());
  console.log('Remaining:              ' + (count - existingIds.size).toLocaleString());
  console.log('Batch size:             ' + BATCH);
  console.log('');

  if (existingIds.size >= count) {
    console.log('✅ Migration already complete!');
    await cockroach.end();
    return;
  }

  let migrated = 0;
  let errors = 0;
  const startTime = Date.now();

  for (let offset = 0; offset < count; offset += BATCH) {
    const { data, error } = await supabase.from('predictions')
      .select('id,fixture_id,market,selection,model_probability,confidence_lower,confidence_upper,model_version,result,settled_at,created_at')
      .range(offset, offset + BATCH - 1);

    if (error || !data || data.length === 0) break;

    // Filter out already-migrated
    const newRows = data.filter(p => !existingIds.has(p.id));
    if (newRows.length === 0) continue;

    const values = newRows.map(p => '(' + [
      esc(p.id), esc(p.fixture_id), esc(p.market), esc(p.selection),
      p.model_probability || 0, p.confidence_lower || 0, p.confidence_upper || 0,
      esc(p.model_version || 'v5.1'), esc(p.result), esc(p.settled_at), esc(p.created_at)
    ].join(',') + ')').join(',');

    try {
      await cockroach.query(
        'INSERT INTO cockroach_predictions (id,fixture_id,market,selection,model_probability,confidence_lower,confidence_upper,model_version,result,settled_at,created_at) VALUES ' + values
      );
      migrated += newRows.length;
      for (const r of newRows) existingIds.add(r.id);
    } catch (e) {
      errors++;
      if (errors <= 5) console.error('  Error at offset', offset, ':', e.message.slice(0, 100));
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const rate = migrated / Math.max(elapsed, 0.1);
    const total = existingIds.size;
    const pct = ((total / count) * 100).toFixed(1);
    process.stdout.write(`  ${total.toLocaleString()}/${count.toLocaleString()} (${pct}%) | ${migrated.toLocaleString()} new | ${errors} err | ${rate.toFixed(0)} rows/s  \r`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const { rows } = await cockroach.query('SELECT COUNT(*) as n FROM cockroach_predictions');
  console.log(`\n\n✅ Migration complete in ${elapsed}s`);
  console.log(`   CockroachDB: ${Number(rows[0].n).toLocaleString()} predictions`);
  console.log(`   Migrated this run: ${migrated.toLocaleString()}`);
  console.log(`   Errors: ${errors}`);

  await cockroach.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
