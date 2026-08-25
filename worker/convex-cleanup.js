#!/usr/bin/env node
/**
 * ODDLY Convex Cleanup Script
 *
 * The old schema had 17 tables with 599K+ predictions.
 * The new schema has 7 lightweight tables.
 * Old data still exists in Convex but can't be queried via the new schema.
 *
 * Two cleanup options:
 *   1. Convex Dashboard: Delete old tables manually (recommended)
 *   2. Schema migration: Drop old tables via convex dev
 *
 * Usage:
 *   node worker/convex-cleanup.js status    # Show current state
 *   node worker/convex-cleanup.js guide     # Show cleanup instructions
 */

const https = require('https');
const CONVEX_URL = 'https://limitless-mole-387.convex.cloud';

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

async function showStatus() {
  console.log('=== Convex Cleanup Status ===\n');

  const stats = await convexQuery('predictions:getStats');
  const value = stats?.value || {};

  console.log('Current Convex tables (new slim schema):');
  for (const [key, val] of Object.entries(value)) {
    console.log(`  ${key.padEnd(25)} ${val}`);
  }

  console.log('\nOld tables still in Convex (need manual cleanup):');
  console.log('  predictions          ~599K rows  → DELETE');
  console.log('  odds                 ~15K rows   → DELETE');
  console.log('  refereeMatches       ~10K rows   → DELETE');
  console.log('  xgFeatures           ~1K rows    → DELETE');
  console.log('  injuries             ~100 rows   → DELETE');
  console.log('  matchXg              ~500 rows   → DELETE');
  console.log('  trainingData         ~0 rows     → DELETE');
  console.log('  leagueModels         ~0 rows     → DELETE');
  console.log('  teamFeatureProfiles  ~0 rows     → DELETE');
  console.log('  refereeFeatureProfiles ~200 rows → DELETE');
  console.log('  auditLog             ~0 rows     → DELETE');
}

function showGuide() {
  console.log('=== Convex Cleanup Guide ===\n');
  console.log('The old tables still contain data but the new schema no longer defines them.');
  console.log('To free up storage on the Convex free tier:\n');
  console.log('Option 1: Convex Dashboard (Recommended)');
  console.log('  1. Go to https://dashboard.convex.dev');
  console.log('  2. Select project: limitless-mole-387');
  console.log('  3. Go to Data tab');
  console.log('  4. For each old table (predictions, odds, refereeMatches, etc.):');
  console.log('     a. Click the table name');
  console.log('     b. Select all documents (Ctrl+A or checkbox)');
  console.log('     c. Click Delete');
  console.log('  5. After deleting all data, the table will auto-remove\n');
  console.log('Option 2: Schema Migration');
  console.log('  The old tables will be garbage-collected once the schema');
  console.log('  no longer references them. Convex may auto-clean after');
  console.log('  the next deployment with the new schema.\n');
  console.log('What to KEEP (new slim schema):');
  console.log('  leagues, teams, livePick, valuePicks, settlementFeed, liveStats\n');
  console.log('What to DELETE (old heavy tables):');
  console.log('  predictions, odds, refereeMatches, xgFeatures, injuries,');
  console.log('  matchXg, trainingData, leagueModels, teamFeatureProfiles,');
  console.log('  refereeFeatureProfiles, auditLog');
}

const command = process.argv[2] || 'status';

switch (command) {
  case 'status':
    showStatus().catch(console.error);
    break;
  case 'guide':
    showGuide();
    break;
  default:
    console.log('Usage: node worker/convex-cleanup.js [status|guide]');
}
