#!/usr/bin/env node
/**
 * Migrate referee match history from football-data-referee-stats.json to Convex
 * Also builds and migrates referee feature profiles.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const CONVEX_URL = 'https://limitless-mole-387.convex.cloud';
const ACCESS_TOKEN = process.env.CONVEX_ACCESS_TOKEN || 'eyJ2MiI6ImM3MGRjYjUwMWU2MjRjMjY5Y2E0MzQ1NmIxYTgzOGViIn0=';

function convexMutate(mutationPath, args) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ path: mutationPath, args });
    const req = https.request(`${CONVEX_URL}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.errorMessage) reject(new Error(json.errorMessage));
          else resolve(json);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

async function main() {
  console.log('=== Referee Match History Migration to Convex ===\n');

  // Load data
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'football-data-referee-stats.json'), 'utf8'));
  console.log(`Total matches: ${raw.length}`);

  // Filter to matches with named referees
  const withRef = raw.filter(m => m.referee && m.referee.trim() !== '');
  console.log(`With named referee: ${withRef.length}`);
  console.log(`Unique referees: ${new Set(withRef.map(m => m.referee)).size}\n`);

  // ─── Migrate referee matches in batches ─────────────────
  const BATCH_SIZE = 50;
  let totalOk = 0;
  let totalFail = 0;
  let offset = 0;

  // Check checkpoint
  const checkpointPath = path.join(__dirname, '..', 'data', 'referee-match-migration-checkpoint.json');
  if (fs.existsSync(checkpointPath)) {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    offset = cp.offset || 0;
    totalOk = cp.totalOk || 0;
    console.log(`Resuming from offset ${offset} (${totalOk} already migrated)\n`);
  }

  console.log(`Migrating ${withRef.length - offset} matches in batches of ${BATCH_SIZE}...\n`);
  const t0 = Date.now();

  while (offset < withRef.length) {
    const batch = withRef.slice(offset, offset + BATCH_SIZE).map(m => clean({
      refereeName: m.referee,
      matchDate: m.date,
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      homeGoals: m.home_goals,
      awayGoals: m.away_goals,
      yellowCards: (m.home_yellow || 0) + (m.away_yellow || 0),
      redCards: (m.home_red || 0) + (m.away_red || 0),
      fouls: (m.home_fouls || 0) + (m.away_fouls || 0),
      league: m.league,
      season: m.season,
    }));

    try {
      const result = await convexMutate('predictions:bulkInsertRefereeMatches', { matches: batch });
      const r = result.value || result.output || {};
      totalOk += r.ok || 0;
      totalFail += r.fail || 0;
    } catch (e) {
      totalFail += batch.length;
      console.error(`  Batch error at offset ${offset}: ${e.message}`);
    }

    offset += BATCH_SIZE;

    // Progress every 500
    if (offset % 500 === 0 || offset >= withRef.length) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const pct = ((offset / withRef.length) * 100).toFixed(1);
      console.log(`  ${offset}/${withRef.length} (${pct}%) — ${totalOk} ok, ${totalFail} fail — ${elapsed}s`);

      // Save checkpoint
      fs.writeFileSync(checkpointPath, JSON.stringify({ offset, totalOk, totalFail }));
    }

    // Rate limit: 50ms between batches
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Inserted: ${totalOk}`);
  console.log(`Failed: ${totalFail}`);
  console.log(`Time: ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

  // ─── Build and migrate referee feature profiles ──────────
  console.log('=== Building Referee Feature Profiles ===\n');

  // Group matches by referee
  const byRef = {};
  for (const m of withRef) {
    if (!byRef[m.referee]) byRef[m.referee] = [];
    byRef[m.referee].push(m);
  }

  const profiles = [];
  for (const [ref, matches] of Object.entries(byRef)) {
    if (matches.length < 3) continue; // Need at least 3 matches

    const totalMatches = matches.length;
    const homeWins = matches.filter(m => m.ft_result === 'H').length;
    const draws = matches.filter(m => m.ft_result === 'D').length;
    const awayWins = matches.filter(m => m.ft_result === 'A').length;
    const totalGoals = matches.reduce((s, m) => s + m.home_goals + m.away_goals, 0);
    const totalYellow = matches.reduce((s, m) => s + (m.home_yellow || 0) + (m.away_yellow || 0), 0);
    const totalRed = matches.reduce((s, m) => s + (m.home_red || 0) + (m.away_red || 0), 0);
    const totalFouls = matches.reduce((s, m) => s + (m.home_fouls || 0) + (m.away_fouls || 0), 0);

    // Home bias: how much more often home wins vs expected (46%)
    const homeBias = (homeWins / totalMatches) - 0.46;

    profiles.push(clean({
      refereeName: ref,
      matchesOfficiated: totalMatches,
      homeWinRate: Math.round((homeWins / totalMatches) * 10000) / 10000,
      avgGoals: Math.round((totalGoals / totalMatches) * 100) / 100,
      avgCards: Math.round(((totalYellow + totalRed) / totalMatches) * 100) / 100,
      homeBias: Math.round(homeBias * 10000) / 10000,
      features: {
        avgFoulsPerMatch: Math.round((totalFouls / totalMatches) * 100) / 100,
        avgYellowPerMatch: Math.round((totalYellow / totalMatches) * 100) / 100,
        avgRedPerMatch: Math.round((totalRed / totalMatches) * 100) / 100,
        drawRate: Math.round((draws / totalMatches) * 10000) / 10000,
        awayWinRate: Math.round((awayWins / totalMatches) * 10000) / 10000,
        homeGoalsAvg: Math.round((matches.reduce((s, m) => s + m.home_goals, 0) / totalMatches) * 100) / 100,
        awayGoalsAvg: Math.round((matches.reduce((s, m) => s + m.away_goals, 0) / totalMatches) * 100) / 100,
        bttsRate: Math.round((matches.filter(m => m.home_goals > 0 && m.away_goals > 0).length / totalMatches) * 10000) / 10000,
        over25Rate: Math.round((matches.filter(m => m.home_goals + m.away_goals > 2.5).length / totalMatches) * 10000) / 10000,
        leagues: [...new Set(matches.map(m => m.league))],
      },
    }));
  }

  console.log(`Built ${profiles.length} referee profiles\n`);

  // Migrate profiles in batches
  const PROFILE_BATCH = 20;
  let pOk = 0, pFail = 0;
  for (let i = 0; i < profiles.length; i += PROFILE_BATCH) {
    const batch = profiles.slice(i, i + PROFILE_BATCH);
    try {
      const result = await convexMutate('predictions:bulkInsertRefFeatureProfiles', { profiles: batch });
      const r = result.value || result.output || {};
      pOk += r.ok || 0;
      pFail += r.fail || 0;
    } catch (e) {
      pFail += batch.length;
      console.error(`  Profile batch error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`Referee profiles: ${pOk} inserted, ${pFail} failed\n`);

  // Save summary
  const summary = {
    migratedAt: new Date().toISOString(),
    totalMatches: raw.length,
    withReferee: withRef.length,
    uniqueReferees: Object.keys(byRef).length,
    matchesInserted: totalOk,
    matchesFailed: totalFail,
    profilesBuilt: profiles.length,
    profilesInserted: pOk,
    topReferees: Object.entries(byRef)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([name, ms]) => ({ name, matches: ms.length })),
  };

  const summaryPath = path.join(__dirname, '..', 'data', 'referee-migration-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Summary saved to ${summaryPath}`);

  // Clean up checkpoint
  if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
}

main().catch(console.error);
