#!/usr/bin/env node
/**
 * CockroachDB Settlement Archive Worker
 * 
 * After predictions are settled in Supabase, archives them to CockroachDB.
 * Idempotent: skips IDs already in CockroachDB.
 * 
 * Flow: Prediction → Settlement → Validation → Archive → CockroachDB
 * 
 * Usage: node worker/cockroach-settle-archive.js [--limit N]
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
  const limit = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || 1000;
  
  console.log('═══════════════════════════════════════');
  console.log('  CockroachDB Settlement Archive');
  console.log('═══════════════════════════════════════');
  
  // Step 1: Get IDs already in CockroachDB
  const { rows: existing } = await cockroach.query('SELECT id FROM cockroach_predictions');
  const existingIds = new Set(existing.map(r => r.id));
  console.log('Already archived: ' + existingIds.size.toLocaleString());
  
  // Step 2: Get unsettled predictions from Supabase (newest first)
  const { data: unsettled } = await supabase
    .from('predictions')
    .select('id,fixture_id,market,selection,model_probability,confidence_lower,confidence_upper,model_version,result,settled_at,created_at')
    .not('result', 'is', null)
    .order('settled_at', { ascending: false })
    .limit(limit * 2); // Get more to account for already-archived
  
  if (!unsettled || unsettled.length === 0) {
    console.log('No settled predictions to archive.');
    await cockroach.end();
    return;
  }
  
  // Step 3: Filter out already archived
  const newRows = unsettled.filter(p => !existingIds.has(p.id));
  console.log('New to archive: ' + newRows.length);
  
  if (newRows.length === 0) {
    console.log('All settled predictions already archived.');
    await cockroach.end();
    return;
  }
  
  // Step 4: Archive in batches
  const BATCH = 200;
  let archived = 0;
  let errors = 0;
  
  for (let i = 0; i < newRows.length; i += BATCH) {
    const batch = newRows.slice(i, i + BATCH);
    const values = batch.map(p => '(' + [
      esc(p.id), esc(p.fixture_id), esc(p.market), esc(p.selection),
      p.model_probability || 0, p.confidence_lower || 0, p.confidence_upper || 0,
      esc(p.model_version || 'v5.1'), esc(p.result), esc(p.settled_at), esc(p.created_at)
    ].join(',') + ')').join(',');
    
    try {
      await cockroach.query(
        'INSERT INTO cockroach_predictions (id,fixture_id,market,selection,model_probability,confidence_lower,confidence_upper,model_version,result,settled_at,created_at) VALUES ' + values
      );
      archived += batch.length;
    } catch (e) {
      errors++;
      console.error('  Archive error:', e.message.slice(0, 80));
    }
  }
  
  console.log('\n✅ Archived: ' + archived + ' predictions');
  console.log('   Errors: ' + errors);
  
  const { rows } = await cockroach.query('SELECT COUNT(*) as n FROM cockroach_predictions');
  console.log('   CockroachDB total: ' + Number(rows[0].n).toLocaleString());
  
  await cockroach.end();
}

main().catch(err => {
  console.error('Archive failed:', err);
  process.exit(1);
});
