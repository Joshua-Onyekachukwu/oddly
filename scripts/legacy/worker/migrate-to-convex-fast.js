/**
 * Fast Convex Migration - Batches records to minimize API calls
 * 
 * Usage: node worker/migrate-to-convex-fast.js [--type=teams|leagues|referees|xg|predictions|all]
 */

const { convexMutation, convexQuery } = require('../lib/convex/connection');
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
const TYPE = process.argv.find(a => a.startsWith('--type='))?.split('=')[1] || 'all';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Leagues ────────────────────────────────────────────────
async function migrateLeagues() {
  console.log('\nMigrating leagues...');
  const { data } = await supabase.from('leagues').select('id,name,country,logo,is_active,priority,external_id').limit(200);
  if (!data) return console.log('  No leagues found');
  
  let ok = 0, fail = 0;
  for (const l of data) {
    const r = await convexMutation('predictions:upsertLeague', {
      externalId: l.external_id || 0,
      name: l.name,
      country: l.country,
      logo: l.logo,
      isActive: l.is_active !== false,
      priority: l.priority || 0,
    });
    if (r) ok++; else fail++;
    if ((ok + fail) % 20 === 0) process.stdout.write(`  ${ok + fail}/${data.length}\r`);
  }
  console.log(`  Done: ${ok} ok, ${fail} fail`);
}

// ─── Teams ──────────────────────────────────────────────────
async function migrateTeams() {
  console.log('\nMigrating teams...');
  let all = [];
  let off = 0;
  while (true) {
    const { data } = await supabase.from('teams').select('id,canonical_name,country,league_id,logo').range(off, off + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    off += data.length;
    if (data.length < 1000) break;
  }
  console.log(`  Found ${all.length} teams`);

  let ok = 0, fail = 0;
  for (const t of all) {
    const r = await convexMutation('predictions:upsertTeam', {
      canonicalName: t.canonical_name,
      country: t.country,
      logo: t.logo,
      eloRating: 1500,
    });
    if (r) ok++; else fail++;
    if ((ok + fail) % 50 === 0) process.stdout.write(`  ${ok + fail}/${all.length}\r`);
  }
  console.log(`  Done: ${ok} ok, ${fail} fail`);
}

// ─── Referees ───────────────────────────────────────────────
async function migrateReferees() {
  console.log('\nMigrating referee profiles...');
  const profilesPath = path.join(__dirname, '../data/referee-profiles.json');
  if (!fs.existsSync(profilesPath)) return console.log('  No referee profiles file');
  
  const raw = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  const refs = Array.isArray(raw) ? raw : Object.values(raw.profiles || {});
  console.log(`  Found ${refs.length} profiles`);

  let ok = 0, fail = 0;
  for (const r of refs) {
    const res = await convexMutation('predictions:insertRefereeProfile', {
      name: r.name,
      matchesOfficiated: r.matches || r.matches_officiated || 0,
      avgGoals: r.avg_goals,
      homeWinPct: r.home_win_pct,
      drawPct: r.draw_pct,
      awayWinPct: r.away_win_pct,
      avgYellow: r.avg_yellow,
      avgRed: r.avg_red,
      avgFouls: r.avg_fouls,
      homeBias: r.home_bias || r.homeBias,
    });
    if (res) ok++; else fail++;
    if ((ok + fail) % 20 === 0) process.stdout.write(`  ${ok + fail}/${refs.length}\r`);
  }
  console.log(`  Done: ${ok} ok, ${fail} fail`);

  // Referee matches
  const matchesPath = path.join(__dirname, '../data/referee-matches.json');
  if (!fs.existsSync(matchesPath)) return;
  
  const mData = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  const matches = (mData.matches || []).slice(0, 3000);
  console.log(`  Migrating ${matches.length} referee matches...`);

  ok = 0; fail = 0;
  for (const m of matches) {
    const res = await convexMutation('predictions:insertRefereeMatch', {
      refereeName: m.referee_name || m.referee || '',
      matchDate: m.date || m.match_date || '',
      homeTeam: m.home_team || '',
      awayTeam: m.away_team || '',
      homeGoals: m.home_goals || 0,
      awayGoals: m.away_goals || 0,
      yellowCards: m.yellow_cards || m.yellows,
      redCards: m.red_cards || m.reds,
      league: m.league,
      season: m.season,
    });
    if (res) ok++; else fail++;
    if ((ok + fail) % 200 === 0) process.stdout.write(`  ${ok + fail}/${matches.length}\r`);
  }
  console.log(`  Done: ${ok} ok, ${fail} fail`);
}

// ─── xG Features ────────────────────────────────────────────
async function migrateXg() {
  console.log('\nMigrating xG features...');
  let count = 0;

  // Understat
  const usPath = path.join(__dirname, '../data/understat-xg.json');
  if (fs.existsSync(usPath)) {
    const data = JSON.parse(fs.readFileSync(usPath, 'utf8'));
    const teams = Object.entries(data.teams || {});
    console.log(`  Understat: ${teams.length} teams`);
    
    for (const [key, feat] of teams) {
      const teamName = feat.team || key.split('_EPL_')[0].split('_La_liga_')[0].split('_Bundesliga_')[0].split('_Serie_A_')[0].split('_Ligue_1_')[0].split('_Eredivisie_')[0].split('_Primeira_Liga_')[0].split('_Championship_')[0];
      await convexMutation('predictions:upsertXgFeature', {
        teamName,
        source: 'understat',
        avgXg: feat.avg_xg || feat.xg_per_game,
        avgXga: feat.avg_xga || feat.xga_per_game,
        homeXg: feat.home_xg,
        homeXga: feat.home_xga,
        awayXg: feat.away_xg,
        awayXga: feat.away_xga,
        xgLast5: feat.xg_last5,
        xgaLast5: feat.xga_last5,
        avgPpda: feat.avg_ppda,
        avgDeep: feat.avg_deep,
      });
      count++;
      if (count % 50 === 0) process.stdout.write(`  ${count}\r`);
    }
  }

  // StatsBomb
  const sbPath = path.join(__dirname, '../data/statsbomb-xg.json');
  if (fs.existsSync(sbPath)) {
    const data = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
    const teams = Object.entries(data.features || {});
    console.log(`  StatsBomb: ${teams.length} teams`);
    
    for (const [name, feat] of teams) {
      await convexMutation('predictions:upsertXgFeature', {
        teamName: name,
        source: 'statsbomb',
        avgXg: feat.avg_xg,
        avgXga: feat.avg_xga,
        matchesPlayed: feat.matches_played,
      });
      count++;
      if (count % 50 === 0) process.stdout.write(`  ${count}\r`);
    }
  }
  
  console.log(`  Done: ${count} xG features`);
}

// ─── Predictions (batched) ──────────────────────────────────
async function migratePredictions() {
  console.log('\nMigrating settled predictions...');
  
  let all = [];
  let off = 0;
  while (true) {
    const { data } = await supabase.from('predictions')
      .select('id,fixture_id,market,selection,model_probability,model_version,result,settled_at,created_at')
      .neq('result', 'pending')
      .order('created_at')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    off += data.length;
    if (data.length < 1000) break;
    if (all.length >= 50000) { console.log('  Capping at 50K for speed'); break; }
  }
  console.log(`  Found ${all.length} settled predictions`);

  // Batch into groups of 50
  const BATCH = 50;
  let ok = 0, fail = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const r = await convexMutation('predictions:archiveBatch', {
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
    if (r) ok += batch.length; else fail += batch.length;
    process.stdout.write(`  ${Math.min(i + BATCH, all.length)}/${all.length} (${ok} ok)\r`);
  }
  console.log(`\n  Done: ${ok} ok, ${fail} fail`);
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  console.log('=== Convex Fast Migration ===');
  console.log(`Type: ${TYPE}`);

  // Test connection
  const stats = await convexQuery('predictions:getStats');
  if (!stats || stats.status === 'error') {
    console.error('Cannot connect to Convex:', stats?.errorMessage || 'unknown');
    process.exit(1);
  }
  console.log('Connected to Convex');
  console.log('Current:', JSON.stringify(stats));

  const start = Date.now();

  if (TYPE === 'all' || TYPE === 'leagues') await migrateLeagues();
  if (TYPE === 'all' || TYPE === 'teams') await migrateTeams();
  if (TYPE === 'all' || TYPE === 'referees') await migrateReferees();
  if (TYPE === 'all' || TYPE === 'xg') await migrateXg();
  if (TYPE === 'all' || TYPE === 'predictions') await migratePredictions();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  
  const finalStats = await convexQuery('predictions:getStats');
  console.log('\nFinal:', JSON.stringify(finalStats));
  console.log(`Completed in ${elapsed}s`);
}

main().catch(console.error);
