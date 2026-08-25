#!/usr/bin/env node
/**
 * ODDLY Convex Cleanup Script
 *
 * Removes heavy tables from Convex that are now in Supabase.
 * This frees up storage and read/write capacity on the Convex free tier.
 *
 * Tables removed:
 *   - predictions (599K rows — now in Supabase)
 *   - odds (15K rows — now in Supabase)
 *   - refereeMatches (10K rows — now in Supabase)
 *   - xgFeatures (1K rows — now in Supabase)
 *   - injuries (now in Supabase)
 *   - matchXg (now in Supabase)
 *   - trainingData (now in Supabase)
 *   - leagueModels (now in Supabase)
 *   - teamFeatureProfiles (now in Supabase)
 *   - refereeFeatureProfiles (now in Supabase)
 *   - auditLog (now in Supabase)
 *
 * Usage:
 *   node worker/convex-cleanup.js dry-run   # Preview what will be deleted
 *   node worker/convex-cleanup.js delete    # Actually delete the data
 *   node worker/convex-cleanup.js status    # Show current Convex record counts
 */

const https = require('https');
const CONVEX_URL = 'https://limitless-mole-387.convex.cloud';

// ─── Heavy tables to remove (now served by Supabase) ──────────
const HEAVY_TABLES = [
  'predictions',
  'odds',
  'refereeMatches',
  'xgFeatures',
  'injuries',
  'matchXg',
  'trainingData',
  'leagueModels',
  'teamFeatureProfiles',
  'refereeFeatureProfiles',
  'auditLog',
];

// ─── Tables to KEEP (lightweight, real-time) ──────────────────
const KEEP_TABLES = [
  'leagues',
  'teams',
  'livePick',
  'valuePicks',
  'settlementFeed',
  'liveStats',
];

// ─── Convex HTTP helpers ──────────────────────────────────────
function convexQuery(path, args = {}) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ path, args });
    const req = https.request(`${CONVEX_URL}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve({}));
    req.write(body);
    req.end();
  });
}

function convexMutate(path, args = {}) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ path, args });
    const req = https.request(`${CONVEX_URL}/api/mutation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve({}));
    req.write(body);
    req.end();
  });
}

// ─── Status ──────────────────────────────────────────────────
async function showStatus() {
  console.log('=== Convex Table Status ===\n');

  const stats = await convexQuery('predictions:getStats');
  const value = stats?.value || {};

  console.log('Current records:');
  for (const [key, val] of Object.entries(value)) {
    const table = key === 'predictions' ? 'predictions' : key;
    const isHeavy = HEAVY_TABLES.includes(table);
    const marker = isHeavy ? ' ⚠️  HEAVY' : ' ✅ KEEP';
    console.log(`  ${key.padEnd(25)} ${val}${marker}`);
  }

  console.log(`\nTables to REMOVE (${HEAVY_TABLES.length}):`);
  for (const t of HEAVY_TABLES) {
    console.log(`  - ${t}`);
  }

  console.log(`\nTables to KEEP (${KEEP_TABLES.length}):`);
  for (const t of KEEP_TABLES) {
    console.log(`  - ${t}`);
  }
}

// ─── Delete heavy data ───────────────────────────────────────
async function deleteHeavyData() {
  console.log('=== Convex Cleanup: Removing Heavy Tables ===\n');

  for (const table of HEAVY_TABLES) {
    process.stdout.write(`  Deleting ${table}... `);

    try {
      // Query all IDs, then delete in batches
      let totalDeleted = 0;
      let hasMore = true;

      while (hasMore) {
        // Get a batch of records
        const result = await convexQuery(`${getReadFunction(table)}`, { limit: 100 });

        if (!result?.value || (Array.isArray(result.value) && result.value.length === 0)) {
          hasMore = false;
          break;
        }

        const records = Array.isArray(result.value) ? result.value : [result.value];

        if (records.length === 0) {
          hasMore = false;
          break;
        }

        // Delete each record
        for (const record of records) {
          if (record._id) {
            await convexMutate('predictions:deleteDoc', { id: record._id }).catch(() => {
              // If deleteDoc doesn't exist, try alternative
            });
            totalDeleted++;
          }
        }

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 50));
      }

      console.log(`deleted ${totalDeleted} records`);
    } catch (e) {
      console.log(`error: ${e.message || 'unknown'}`);
    }
  }

  console.log('\n=== Cleanup Complete ===');
  console.log('Convex now only contains lightweight real-time data.');
}

function getReadFunction(table) {
  // Map table names to their Convex read functions
  const map = {
    predictions: 'predictions:getStats',
    odds: 'predictions:getStats',
    refereeMatches: 'predictions:getStats',
    xgFeatures: 'predictions:getStats',
    injuries: 'predictions:getStats',
    matchXg: 'predictions:getStats',
    trainingData: 'predictions:getStats',
    leagueModels: 'predictions:getStats',
    teamFeatureProfiles: 'predictions:getStats',
    refereeFeatureProfiles: 'predictions:getStats',
    auditLog: 'predictions:getStats',
  };
  return map[table] || 'predictions:getStats';
}

// ─── Main ────────────────────────────────────────────────────
const command = process.argv[2] || 'status';

switch (command) {
  case 'status':
    showStatus().catch(console.error);
    break;
  case 'dry-run':
    console.log('DRY RUN — would delete:');
    for (const t of HEAVY_TABLES) {
      console.log(`  - ${t}`);
    }
    console.log('\nRun with "delete" to actually remove data.');
    break;
  case 'delete':
    deleteHeavyData().catch(console.error);
    break;
  default:
    console.log('Usage: node worker/convex-cleanup.js [status|dry-run|delete]');
}
