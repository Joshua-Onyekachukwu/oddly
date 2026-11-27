/**
 * Predictions migration to Convex — continues from checkpoint
 * Key fix: null → undefined for Convex optional fields
 */
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const env = {};
for (const l of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const CP_FILE = path.join(__dirname, '../data/migration-checkpoint.json');

function convexMut(mPath, args) {
  return new Promise(resolve => {
    const body = JSON.stringify({ path: mPath, args });
    const req = https.request('https://limitless-mole-387.convex.cloud/api/mutation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ status: 'parse_error' }); } });
    });
    req.on('error', () => resolve({ status: 'network_error' }));
    req.write(body);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = v => v === null ? undefined : v;

async function main() {
  let cp = { offset: 0 };
  try { cp = JSON.parse(fs.readFileSync(CP_FILE, 'utf8')); } catch { /* first run */ }

  const BATCH = 25;
  const CONC = 4;
  let totalOk = 0, totalFail = 0, round = 0;

  console.log(`Resuming from offset ${cp.offset} (total settled: ~599K)`);

  while (true) {
    const { data } = await sb.from('predictions')
      .select('fixture_id,market,selection,model_probability,model_version,result,settled_at')
      .not('result', 'is', null)
      .order('created_at')
      .range(cp.offset, cp.offset + 999);

    if (!data || data.length === 0) break;

    let idx = 0, ok = 0, fail = 0;

    async function worker() {
      while (idx < data.length) {
        const i = idx++;
        const batch = data.slice(i * BATCH, (i + 1) * BATCH);
        if (!batch.length) break;
        const r = await convexMut('predictions:archiveBatch', {
          predictions: batch.map(p => ({
            fixtureId: p.fixture_id || '',
            market: p.market,
            selection: p.selection,
            modelProbability: p.model_probability || 0,
            modelVersion: p.model_version || 'v4.0-settle',
            result: p.result,
            settledAt: clean(p.settled_at),
          })),
        });
        if (r && r.status !== 'error' && r.value) ok += batch.length;
        else fail++;
        await sleep(80);
      }
    }

    await Promise.all(Array.from({ length: CONC }, () => worker()));
    totalOk += ok;
    totalFail += fail;
    cp.offset += data.length;
    round++;

    if (round % 5 === 0) {
      console.log(`  Round ${round}: ok=${totalOk} fail=${totalFail} offset=${cp.offset}`);
    }
    if (round % 10 === 0) {
      fs.writeFileSync(CP_FILE, JSON.stringify(cp));
    }
  }

  fs.writeFileSync(CP_FILE, JSON.stringify(cp));
  console.log(`\nDone: ok=${totalOk} fail=${totalFail} finalOffset=${cp.offset}`);
}

main().catch(console.error);
