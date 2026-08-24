/**
 * Migrate Data to Convex
 * 
 * Populates Convex tables from:
 * 1. Local JSON files (xG, referee, team features)
 * 2. Supabase (historical predictions, fixtures, teams)
 * 
 * Usage: node worker/migrate-to-convex.js [--dry-run] [--type=teams|fixtures|predictions|all]
 */

const { convexMutation, convexQuery } = require('../lib/convex/connection');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ─── Configuration ─────────────────────────────────────────

function loadEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      env[key] = val;
    }
  } catch (e) { /* ignore */ }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const DRY_RUN = process.argv.includes('--dry-run');
const MIGRATE_TYPE = process.argv.find(a => a.startsWith('--type='))?.split('=')[1] || 'all';

// ─── Helpers ───────────────────────────────────────────────

async function convexInsert(table, record) {
  if (DRY_RUN) return 'dry-run';
  try {
    const fnName = `predictions:${table}`;
    const result = await convexMutation(fnName, record);
    return result;
  } catch (err) {
    console.error(`  [ERROR] ${table}:`, err.message?.slice(0, 80));
    return null;
  }
}

async function batchInsert(table, records, transform) {
  console.log(`\n📦 Migrating ${records.length} ${table}...`);
  
  const BATCH = 50; // Convex mutations have size limits
  let success = 0;
  let failed = 0;
  
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    
    for (const record of batch) {
      const transformed = transform(record);
      const result = await convexInsert(table, transformed);
      if (result) success++;
      else failed++;
    }
    
    process.stdout.write(`  Progress: ${Math.min(i + BATCH, records.length)}/${records.length}\r`);
  }
  
  console.log(`  ✅ ${success} success, ❌ ${failed} failed`);
  return { success, failed };
}

// ─── Migration Functions ───────────────────────────────────

async function migrateTeams() {
  console.log('\n🏆 Migrating Teams...');
  
  // From local JSON
  const teamFeaturesPath = path.join(__dirname, '../data/team-feature-profiles.json');
  if (fs.existsSync(teamFeaturesPath)) {
    const data = JSON.parse(fs.readFileSync(teamFeaturesPath, 'utf8'));
    const teams = Object.entries(data.teams || data || {}).map(([name, features]) => ({
      canonicalName: name,
      eloRating: features.elo_rating || 1500,
      avgXg: features.avg_xg,
      avgXga: features.avg_xga,
      homeXg: features.home_xg,
      homeXga: features.home_xga,
      awayXg: features.away_xg,
      awayXga: features.away_xga,
    }));
    
    await batchInsert('upsertTeam', teams, (t) => ({
      canonicalName: t.canonicalName,
      eloRating: t.eloRating,
      avgXg: t.avgXg,
      avgXga: t.avgXga,
      homeXg: t.homeXg,
      homeXga: t.homeXga,
      awayXg: t.awayXg,
      awayXga: t.awayXga,
    }));
  } else {
    console.log('  ⚠️  team-feature-profiles.json not found');
  }
  
  // From Supabase
  const { data: supaTeams } = await supabase.from('teams').select('*').limit(5000);
  if (supaTeams && supaTeams.length > 0) {
    console.log(`\n  📦 Migrating ${supaTeams.length} teams from Supabase...`);
    await batchInsert('upsertTeam', supaTeams, (t) => ({
      canonicalName: t.canonical_name,
      country: t.country,
      leagueExternalId: t.league_id ? parseInt(t.league_id) : undefined,
      logo: t.logo,
      eloRating: t.elo_rating || 1500,
    }));
  }
}

async function migrateLeagues() {
  console.log('\n🏟️  Migrating Leagues...');
  
  const { data: leagues } = await supabase.from('leagues').select('*');
  if (!leagues || leagues.length === 0) {
    console.log('  ⚠️  No leagues in Supabase');
    return;
  }
  
  console.log(`  📦 Migrating ${leagues.length} leagues...`);
  await batchInsert('upsertLeague', leagues, (l) => ({
    externalId: l.external_id || 0,
    name: l.name,
    country: l.country,
    logo: l.logo,
    isActive: l.is_active !== false,
    priority: l.priority || 0,
  }));
}

async function migrateReferees() {
  console.log('\n👨‍⚖️ Migrating Referee Profiles...');
  
  const profilesPath = path.join(__dirname, '../data/referee-profiles.json');
  if (fs.existsSync(profilesPath)) {
    const data = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
    const referees = Object.values(data.profiles || data || {});
    
    console.log(`  📦 Migrating ${referees.length} referee profiles...`);
    await batchInsert('insertRefereeProfile', referees, (r) => ({
      name: r.name,
      matchesOfficiated: r.matches_officiated || 0,
      avgGoals: r.avg_goals,
      homeWinPct: r.home_win_pct,
      drawPct: r.draw_pct,
      awayWinPct: r.away_win_pct,
      avgYellow: r.avg_yellow,
      avgRed: r.avg_red,
      avgFouls: r.avg_fouls,
      homeBias: r.home_bias,
    }));
  } else {
    console.log('  ⚠️  referee-profiles.json not found');
  }
  
  // Also migrate referee match history
  const matchesPath = path.join(__dirname, '../data/referee-matches.json');
  if (fs.existsSync(matchesPath)) {
    const data = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
    const matches = data.matches || data || [];
    
    console.log(`  📦 Migrating ${matches.length} referee matches...`);
    await batchInsert('insertRefereeMatch', matches.slice(0, 5000), (m) => ({
      refereeName: m.referee_name || m.referee,
      matchDate: m.date || m.match_date,
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      homeGoals: m.home_goals,
      awayGoals: m.away_goals,
      yellowCards: m.yellow_cards || m.yellows,
      redCards: m.red_cards || m.reds,
      fouls: m.fouls,
      league: m.league,
      season: m.season,
    }));
  }
}

async function migrateXgFeatures() {
  console.log('\n📊 Migrating xG Features...');
  
  const understatPath = path.join(__dirname, '../data/understat-xg.json');
  if (fs.existsSync(understatPath)) {
    const data = JSON.parse(fs.readFileSync(understatPath, 'utf8'));
    const teams = Object.entries(data.teams || {}).map(([key, features]) => ({
      teamName: features.team || key,
      league: features.league,
      season: features.season,
      source: 'understat',
      matchesPlayed: features.matches_played || features.games,
      totalXg: features.total_xg || features.xg,
      totalXga: features.total_xga || features.xga,
      avgXg: features.avg_xg || features.xg_per_game,
      avgXga: features.avg_xga || features.xga_per_game,
      homeXg: features.home_xg,
      homeXga: features.home_xga,
      awayXg: features.away_xg,
      awayXga: features.away_xga,
      xgLast5: features.xg_last5,
      xgaLast5: features.xga_last5,
    }));
    
    console.log(`  📦 Migrating ${teams.length} xG feature profiles...`);
    await batchInsert('upsertXgFeature', teams, (x) => x);
  } else {
    console.log('  ⚠️  understat-xg.json not found');
  }
  
  // StatsBomb xG
  const statsbombPath = path.join(__dirname, '../data/statsbomb-xg.json');
  if (fs.existsSync(statsbombPath)) {
    const data = JSON.parse(fs.readFileSync(statsbombPath, 'utf8'));
    const teams = Object.entries(data.teams || {}).map(([name, features]) => ({
      teamName: name,
      source: 'statsbomb',
      avgXg: features.avg_xg,
      avgXga: features.avg_xga,
      matchesPlayed: features.matches_played,
    }));
    
    console.log(`  📦 Migrating ${teams.length} StatsBomb xG profiles...`);
    await batchInsert('upsertXgFeature', teams, (x) => x);
  }
}

async function migratePredictions() {
  console.log('\n🎯 Migrating Historical Predictions...');
  
  // From Supabase - settled predictions (cold data)
  const { count } = await supabase.from('predictions').select('id', { count: 'exact', head: true }).not('result', 'is', null);
  console.log(`  Found ${count} settled predictions in Supabase`);
  
  if (!count || count === 0) {
    console.log('  ⚠️  No settled predictions to migrate');
    return;
  }
  
  // Batch migrate
  const BATCH_SIZE = 100;
  let offset = 0;
  let migrated = 0;
  
  while (offset < count) {
    const { data: batch } = await supabase
      .from('predictions')
      .select('id,fixture_id,market,selection,model_probability,confidence_lower,confidence_upper,model_version,result,settled_at,created_at')
      .not('result', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);
    
    if (!batch || batch.length === 0) break;
    
    const result = await convexMutation('predictions:archiveBatch', {
      predictions: batch.map((p) => ({
        fixtureId: p.fixture_id || '',
        market: p.market,
        selection: p.selection,
        modelProbability: p.model_probability || 0,
        modelVersion: p.model_version || 'v4.0-settle',
        result: p.result,
        settledAt: p.settled_at,
      })),
    });
    
    if (result) migrated += batch.length;
    offset += BATCH_SIZE;
    process.stdout.write(`  Progress: ${offset}/${count} (${migrated} migrated)\r`);
  }
  
  console.log(`\n  ✅ Migrated ${migrated} predictions`);
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log('🚀 Convex Migration Starting...');
  console.log(`   Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`   Type: ${MIGRATE_TYPE}`);
  console.log('');
  
  // Test connection first
  const stats = await convexQuery('predictions:getStats');
  if (!stats) {
    console.error('❌ Cannot connect to Convex. Check your configuration.');
    process.exit(1);
  }
  console.log('✅ Connected to Convex');
  
  const start = Date.now();
  
  if (MIGRATE_TYPE === 'all' || MIGRATE_TYPE === 'leagues') {
    await migrateLeagues();
  }
  
  if (MIGRATE_TYPE === 'all' || MIGRATE_TYPE === 'teams') {
    await migrateTeams();
  }
  
  if (MIGRATE_TYPE === 'all' || MIGRATE_TYPE === 'referees') {
    await migrateReferees();
  }
  
  if (MIGRATE_TYPE === 'all' || MIGRATE_TYPE === 'xg') {
    await migrateXgFeatures();
  }
  
  if (MIGRATE_TYPE === 'all' || MIGRATE_TYPE === 'predictions') {
    await migratePredictions();
  }
  
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  
  // Final stats
  const finalStats = await convexQuery('predictions:getStats');
  console.log('\n📊 Final Convex Stats:');
  console.log(JSON.stringify(finalStats, null, 2));
  console.log(`\n⏱️  Completed in ${elapsed}s`);
}

main().catch(console.error);
