/**
 * Fast prediction migration to Convex
 * Loads from Supabase, batches into Convex using HTTP API
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const CONVEX_URL = env.CONVEX_URL || 'https://limitless-mole-387.convex.cloud';

async function convexMutation(path, args) {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.value ?? data;
}

async function main() {
  const LIMIT = parseInt(process.argv[2]) || 50000;
  console.log(`Loading up to ${LIMIT} settled predictions from Supabase...`);

  // Load all settled predictions
  let all = [];
  let off = 0;
  while (all.length < LIMIT) {
    const { data } = await supabase.from('predictions')
      .select('fixture_id,market,selection,model_probability,model_version,result,settled_at')
      .neq('result', 'pending')
      .order('created_at')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    off += data.length;
    if (data.length < 1000) break;
    process.stdout.write(`  Loaded ${all.length}\r`);
  }
  console.log(`\n  Total: ${all.length} predictions`);

  // Send in batches of 100 via Convex archiveBatch
  const BATCH = 100;
  let ok = 0;
  let fail = 0;
  
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH).map(p => ({
      fixtureId: p.fixture_id || '',
      market: p.market,
      selection: p.selection,
      modelProbability: p.model_probability || 0,
      modelVersion: p.model_version || 'v4.0-settle',
      result: p.result,
      settledAt: p.settled_at,
    }));

    const r = await convexMutation('predictions:archiveBatch', { predictions: batch });
    if (r) ok += batch.length;
    else fail += batch.length;

    if ((i + BATCH) % 1000 === 0 || i + BATCH >= all.length) {
      process.stdout.write(`  ${Math.min(i + BATCH, all.length)}/${all.length} (ok:${ok} fail:${fail})\r`);
    }
  }

  console.log(`\n\nDone: ${ok} ok, ${fail} fail`);
}

main().catch(console.error);
