/**
 * Resumable prediction migration to Convex
 * Saves progress to data/migration-checkpoint.json
 * Can be re-run safely — skips already-migrated records
 * 
 * Usage: node worker/migrate-preds-resumable.js [batch_size] [concurrency]
 */

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env
const env = {};
for (const l of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const CONVEX_URL = 'https://limitless-mole-387.convex.cloud';
const CHECKPOINT_FILE = path.join(__dirname, '../data/migration-checkpoint.json');

const BATCH_SIZE = parseInt(process.argv[2]) || 25;
const CONCURRENCY = parseInt(process.argv[3]) || 1;
const DELAY_MS = parseInt(process.argv[4]) || 100; // ms between batches

function loadCheckpoint() {
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
  } catch {
    return { offset: 0, migrated: 0, failed: 0, errors: [] };
  }
}

function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

function convexMut(mutationPath, args) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ path: mutationPath, args });
    const req = https.request(`${CONVEX_URL}/api/mutation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ status: 'parse_error' }); } });
    });
    req.on('error', () => resolve({ status: 'network_error' }));
    req.write(body);
    req.end();
  });
}

async function main() {
  const cp = loadCheckpoint();
  console.log(`Checkpoint: offset=${cp.offset}, migrated=${cp.migrated}, failed=${cp.failed}`);

  // Count total
  const { count } = await sb
    .from('predictions')
    .select('id', { count: 'exact', head: true })
    .not('result', 'is', null);
  console.log(`Total settled predictions: ${count}`);

  // Load from checkpoint offset
  let all = [];
  let off = cp.offset;
  const MAX_BATCH = 5000; // Load 5K at a time to avoid memory issues

  const { data } = await sb
    .from('predictions')
    .select('fixture_id,market,selection,model_probability,model_version,result,settled_at,created_at')
    .not('result', 'is', null)
    .order('created_at')
    .range(off, off + MAX_BATCH - 1);

  if (!data || data.length === 0) {
    console.log('No more data to migrate!');
    return;
  }
  all = data;
  console.log(`Loaded ${all.length} predictions from offset ${off}`);

  // Migrate in batches with parallelism
  let idx = 0;
  let ok = 0, fail = 0;
  const total = all.length;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function worker() {
    while (idx < total) {
      const i = idx++;
      const batch = all.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      if (batch.length === 0) break;

      const r = await convexMut('predictions:archiveBatch', {
        predictions: batch.map(p => ({
          fixtureId: p.fixture_id || '',
          market: p.market,
          selection: p.selection,
          modelProbability: p.model_probability || 0,
          modelVersion: p.model_version || 'v4.0-settle',
          result: p.result,
          settledAt: p.settled_at,
        })),
      });

      if (r && r.status !== 'error' && r.value) {
        ok += batch.length;
      } else {
        fail++;
        // Retry once after delay
        await sleep(500);
        const r2 = await convexMut('predictions:archiveBatch', {
          predictions: batch.map(p => ({
            fixtureId: p.fixture_id || '',
            market: p.market,
            selection: p.selection,
            modelProbability: p.model_probability || 0,
            modelVersion: p.model_version || 'v4.0-settle',
            result: p.result,
            settledAt: p.settled_at,
          })),
        });
        if (r2 && r2.status !== 'error' && r2.value) {
          ok += batch.length;
        } else {
          fail += batch.length;
          cp.errors.push({ offset: off + i * BATCH_SIZE, error: JSON.stringify(r2).slice(0, 100) });
        }
      }

      await sleep(DELAY_MS);

      // Save checkpoint every 250 records
      if ((ok + fail) % 250 < BATCH_SIZE * CONCURRENCY) {
        cp.offset = off + (i + 1) * BATCH_SIZE;
        cp.migrated += batch.length;
        cp.failed = fail;
        saveCheckpoint(cp);
        process.stdout.write(`  ${ok + fail}/${total} ok:${ok} fail:${fail} offset:${cp.offset}\r`);
      }
    }
  }

  const start = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // Final checkpoint
  cp.offset = off + total;
  cp.migrated = ok;
  cp.failed = fail;
  saveCheckpoint(cp);

  console.log(`\nBatch done: ${ok} ok, ${fail} fail in ${elapsed}s`);
  console.log(`Total migrated: ${cp.migrated}, Total failed: ${cp.failed}`);
  console.log(`Run again to continue from offset ${cp.offset}`);
}

main().catch(console.error);
