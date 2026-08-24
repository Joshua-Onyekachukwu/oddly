#!/usr/bin/env node
/**
 * Migration Script: Supabase → CockroachDB
 * 
 * Moves historical/cold data to CockroachDB for:
 * - Better capacity (10GB vs 500MB)
 * - Complex analytics queries
 * - Historical training data storage
 * - Separation of concerns (hot vs cold)
 * 
 * Usage: node worker/migrate-to-cockroach.js [--dry-run] [--table TABLE]
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ─── Load Environment ──────────────────────────────────────

function loadEnv() {
  const env = {};
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
  return env;
}

const env = loadEnv();
const COCKROACH_URL = env.COCKROACHDB_URL;
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!COCKROACH_URL) {
  console.error('❌ COCKROACHDB_URL not found in .env.local');
  console.error('   Add: COCKROACHDB_URL="postgresql://..."');
  process.exit(1);
}

// ─── CockroachDB Pool ─────────────────────────────────────

const cockroach = new Pool({
  connectionString: COCKROACH_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// ─── Supabase REST Client ─────────────────────────────────

async function supabaseQuery(table, { select = '*', filters = {}, limit = 1000, offset = 0, order = null } = {}) {
  const params = new URLSearchParams();
  params.set('select', select);
  params.set('limit', limit);
  params.set('offset', offset);
  if (order) params.set('order', order);
  
  for (const [key, val] of Object.entries(filters)) {
    if (typeof val === 'object' && val.neq) params.set(key, `neq.${val.neq}`);
    else if (typeof val === 'object' && val.gt) params.set(key, `gt.${val.gt}`);
    else if (typeof val === 'object' && val.lt) params.set(key, `lt.${val.lt}`);
    else params.set(key, `eq.${val}`);
  }
  
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'count=exact',
    },
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${table}: ${res.status} - ${text.slice(0, 200)}`);
  }
  
  return await res.json();
}

async function supabaseCount(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=count`;
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'count=exact',
    },
  });
  const count = res.headers.get('content-range')?.split('/')[1];
  return parseInt(count || '0');
}

// ─── Migration Functions ──────────────────────────────────

async function migrateLeagues() {
  console.log('\n📋 Migrating leagues...');
  const data = await supabaseQuery('leagues');
  
  if (data.length === 0) {
    console.log('   No leagues to migrate');
    return 0;
  }
  
  const values = data.map(l => 
    `('${l.id}', ${l.external_id || 'NULL'}, '${(l.name || '').replace(/'/g, "''")}', '${(l.country || '').replace(/'/g, "''")}', '${l.logo || ''}', ${l.is_active}, ${l.priority || 0})`
  );
  
  await cockroach.query(`INSERT INTO cockroach_leagues (id, external_id, name, country, logo, is_active, priority) VALUES ${values.join(',\n')} ON CONFLICT (id) DO NOTHING`);
  console.log(`   ✅ ${data.length} leagues migrated`);
  return data.length;
}

async function migrateTeams() {
  console.log('\n⚽ Migrating teams...');
  const data = await supabaseQuery('teams', { limit: 5000 });
  
  if (data.length === 0) {
    console.log('   No teams to migrate');
    return 0;
  }
  
  const values = data.map(t => {
    const name = (t.canonical_name || '').replace(/'/g, "''");
    const country = (t.country || '').replace(/'/g, "''");
    const league = t.league_id ? `'${t.league_id}'` : 'NULL';
    const logo = (t.logo || '').replace(/'/g, "''");
    return `('${t.id}', '${name}', '${country}', ${league}, '${logo}', ${t.elo_rating || 1500})`;
  });
  
  // Batch insert (500 at a time)
  for (let i = 0; i < values.length; i += 500) {
    const batch = values.slice(i, i + 500);
    await cockroach.query(`INSERT INTO cockroach_teams (id, canonical_name, country, league_id, logo, elo_rating) VALUES ${batch.join(',\n')} ON CONFLICT (id) DO NOTHING`);
  }
  
  console.log(`   ✅ ${data.length} teams migrated`);
  return data.length;
}

async function migrateFixtures() {
  console.log('\n📅 Migrating fixtures...');
  
  // Count first
  const count = await supabaseCount('fixtures');
  console.log(`   Total fixtures: ${count}`);
  
  let migrated = 0;
  const batchSize = 1000;
  
  for (let offset = 0; offset < count; offset += batchSize) {
    const data = await supabaseQuery('fixtures', {
      select: '*, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), leagues!fixtures_league_id_fkey(external_id)',
      limit: batchSize,
      offset,
      order: 'kickoff_time.asc',
    });
    
    if (data.length === 0) break;
    
    const values = data.map(f => {
      const homeId = f.home_team_id ? `'${f.home_team_id}'` : 'NULL';
      const awayId = f.away_team_id ? `'${f.away_team_id}'` : 'NULL';
      const leagueId = f.league_id ? `'${f.league_id}'` : 'NULL';
      const kickoff = f.kickoff_time || new Date().toISOString();
      const homeScore = f.home_score !== null ? f.home_score : 'NULL';
      const awayScore = f.away_score !== null ? f.away_score : 'NULL';
      return `('${f.id}', '${f.external_id || ''}', ${homeId}, ${awayId}, ${leagueId}, '${kickoff}', '${f.status}', ${homeScore}, ${awayScore})`;
    });
    
    await cockroach.query(`INSERT INTO cockroach_fixtures (id, external_id, home_team_id, away_team_id, league_id, kickoff_time, status, home_score, away_score) VALUES ${values.join(',\n')} ON CONFLICT (id) DO NOTHING`);
    
    migrated += data.length;
    process.stdout.write(`   Migrated ${migrated}/${count} fixtures\r`);
  }
  
  console.log(`\n   ✅ ${migrated} fixtures migrated`);
  return migrated;
}

async function migratePredictions() {
  console.log('\n🎯 Migrating predictions...');
  
  const count = await supabaseCount('predictions');
  console.log(`   Total predictions: ${count.toLocaleString()}`);
  
  let migrated = 0;
  const batchSize = 2000;
  
  for (let offset = 0; offset < count; offset += batchSize) {
    const data = await supabaseQuery('predictions', {
      select: 'id, fixture_id, market, selection, model_probability, confidence_lower, confidence_upper, model_version, result, actual_outcome, settled_at, created_at',
      limit: batchSize,
      offset,
      order: 'created_at.asc',
    });
    
    if (data.length === 0) break;
    
    const values = data.map(p => {
      const fixture = p.fixture_id ? `'${p.fixture_id}'` : 'NULL';
      const market = (p.market || '').replace(/'/g, "''");
      const selection = (p.selection || '').replace(/'/g, "''");
      const prob = p.model_probability || 0;
      const confLow = p.confidence_lower || prob - 0.05;
      const confHigh = p.confidence_upper || prob + 0.05;
      const version = (p.model_version || 'v5.1').replace(/'/g, "''");
      const result = p.result ? `'${p.result}'` : 'NULL';
      const actual = p.actual_outcome ? `'${p.actual_outcome}'` : 'NULL';
      const settled = p.settled_at ? `'${p.settled_at}'` : 'NULL';
      const created = p.created_at || new Date().toISOString();
      
      return `('${p.id}', ${fixture}, '${market}', '${selection}', ${prob}, ${confLow}, ${confHigh}, '${version}', ${result}, ${actual}, ${settled}, '${created}')`;
    });
    
    await cockroach.query(`INSERT INTO cockroach_predictions (id, fixture_id, market, selection, model_probability, confidence_lower, confidence_upper, model_version, result, actual_outcome, settled_at, created_at) VALUES ${values.join(',\n')} ON CONFLICT (id) DO NOTHING`);
    
    migrated += data.length;
    process.stdout.write(`   Migrated ${migrated.toLocaleString()}/${count.toLocaleString()} predictions\r`);
  }
  
  console.log(`\n   ✅ ${migrated.toLocaleString()} predictions migrated`);
  return migrated;
}

async function migrateOdds() {
  console.log('\n📊 Migrating odds...');
  const data = await supabaseQuery('odds_snapshots', { limit: 5000 });
  
  if (data.length === 0) {
    console.log('   No odds to migrate');
    return 0;
  }
  
  const values = data.map(o => {
    const fixture = o.fixture_id ? `'${o.fixture_id}'` : 'NULL';
    const bookmaker = (o.bookmaker || '').replace(/'/g, "''");
    const market = (o.market || '').replace(/'/g, "''");
    const selection = (o.selection || '').replace(/'/g, "''");
    const odds = o.odds || 0;
    const implied = o.odds ? (1 / o.odds).toFixed(4) : 0;
    return `('${o.id}', ${fixture}, '${bookmaker}', '${market}', '${selection}', ${odds}, ${implied})`;
  });
  
  await cockroach.query(`INSERT INTO cockroach_odds (id, fixture_id, bookmaker, market, selection, odds, implied_prob) VALUES ${values.join(',\n')} ON CONFLICT (id) DO NOTHING`);
  console.log(`   ✅ ${data.length} odds migrated`);
  return data.length;
}

async function migrateLocalData() {
  console.log('\n📁 Migrating local JSON/CSV data...');
  const dataDir = path.join(__dirname, '../data');
  
  // Understat xG
  const xgFile = path.join(dataDir, 'understat-xg.json');
  if (fs.existsSync(xgFile)) {
    console.log('   Migrating Understat xG features...');
    const xgData = JSON.parse(fs.readFileSync(xgFile, 'utf8'));
    let migrated = 0;
    
    for (const [key, team] of Object.entries(xgData.teams || {})) {
      const name = key.split('_EPL_')[0].split('_La_liga_')[0].split('_Bundesliga_')[0].split('_Serie_A_')[0].split('_Ligue_1_')[0];
      const league = key.includes('EPL') ? 'Premier League' : key.includes('La_liga') ? 'La Liga' : key.includes('Bundesliga') ? 'Bundesliga' : key.includes('Serie_A') ? 'Serie A' : 'Ligue 1';
      
      await cockroach.query(`INSERT INTO cockroach_xg_features (team_name, league, source, avg_xg, avg_xga, avg_npxg, avg_npxga, home_xg, home_xga, away_xg, away_xga, xg_last5, xga_last5, avg_ppda, avg_deep, avg_deep_allowed, xg_diff)
        VALUES ($1, $2, 'understat', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (team_name, league, source) DO UPDATE SET
          avg_xg = EXCLUDED.avg_xg, avg_xga = EXCLUDED.avg_xga,
          home_xg = EXCLUDED.home_xg, away_xg = EXCLUDED.away_xg`,
        [name, league, team.avg_xg, team.avg_xga, team.avg_npxg, team.avg_npxga,
         team.home_xg, team.home_xga, team.away_xg, team.away_xga,
         team.xg_last5, team.xga_last5, team.avg_ppda, team.avg_deep, team.avg_deep_allowed, team.xg_diff]
      );
      migrated++;
    }
    console.log(`   ✅ ${migrated} Understat team xG features migrated`);
  }
  
  // Referee profiles
  const refFile = path.join(dataDir, 'referee-profiles.json');
  if (fs.existsSync(refFile)) {
    console.log('   Migrating referee profiles...');
    const refs = JSON.parse(fs.readFileSync(refFile, 'utf8'));
    let migrated = 0;
    
    for (const ref of refs) {
      await cockroach.query(`INSERT INTO cockroach_referee_profiles (name, matches_officiated, avg_goals, home_win_pct, draw_pct, away_win_pct, avg_yellow, avg_red, avg_fouls, home_bias)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (name) DO UPDATE SET
          matches_officiated = EXCLUDED.matches_officiated, avg_goals = EXCLUDED.avg_goals`,
        [ref.name, ref.matches || 0, ref.avgGoals || 2.5, ref.homeWinPct || 0.45,
         ref.drawPct || 0.25, ref.awayWinPct || 0.30, ref.avgYellow || 3,
         ref.avgRed || 0.15, ref.avgFouls || 20, ref.homeBias || 0.46]
      );
      migrated++;
    }
    console.log(`   ✅ ${migrated} referee profiles migrated`);
  }
  
  // Injuries
  const injuryFile = path.join(dataDir, 'injuries-suspensions.json');
  if (fs.existsSync(injuryFile)) {
    console.log('   Migrating injury data...');
    const injuries = JSON.parse(fs.readFileSync(injuryFile, 'utf8'));
    let migrated = 0;
    const data = injuries.injuries || injuries;
    
    if (Array.isArray(data)) {
      for (const inj of data.slice(0, 5000)) { // Limit to prevent huge insert
        await cockroach.query(`INSERT INTO cockroach_injuries (player_name, team_name, injury_type, detail, return_date, status)
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [inj.player_name || inj.player, inj.team_name || inj.team, inj.injury_type || inj.reason,
           inj.detail || '', inj.return_date || '', inj.status || 'Unknown']
        );
        migrated++;
      }
    }
    console.log(`   ✅ ${migrated} injuries migrated`);
  }
  
  // Per-league models
  const modelFile = path.join(dataDir, 'per-league-models.json');
  if (fs.existsSync(modelFile)) {
    console.log('   Migrating per-league models...');
    const models = JSON.parse(fs.readFileSync(modelFile, 'utf8'));
    let migrated = 0;
    
    for (const [name, league] of Object.entries(models.leagues || {})) {
      if (league.weights) {
        await cockroach.query(`INSERT INTO cockroach_league_models (league_name, model_version, intercept, weights, accuracy, sample_size)
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [name, 'v5.1', league.intercept || 0, JSON.stringify(league.weights),
           league.accuracy || 0, league.sample_size || 0]
        );
        migrated++;
      }
    }
    console.log(`   ✅ ${migrated} league models migrated`);
  }
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const specificTable = args.find(a => !a.startsWith('--'));
  
  console.log('🚀 CockroachDB Migration Tool');
  console.log('==============================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Target: ${COCKROACH_URL.replace(/:[^@]+@/, ':***@')}`);
  
  if (dryRun) {
    console.log('\n⚠️  Dry run — no data will be written');
  }
  
  // Test connection
  const connected = await cockroach.query('SELECT NOW() as time');
  if (connected.error) {
    console.error('❌ Cannot connect to CockroachDB:', connected.error.message);
    process.exit(1);
  }
  console.log('✅ Connected to CockroachDB');
  
  // Create schema
  console.log('\n📋 Creating schema...');
  const schema = fs.readFileSync(path.join(__dirname, '../lib/cockroach/schema.sql'), 'utf8');
  
  // Execute schema in blocks (CockroachDB doesn't like multiple statements in one query)
  const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    try {
      await cockroach.query(stmt);
    } catch (e) {
      if (e.message.includes('already exists')) continue;
      console.error('Schema error:', e.message.slice(0, 100));
    }
  }
  console.log('✅ Schema ready');
  
  if (!dryRun) {
    // Run migrations
    let totalRows = 0;
    
    if (!specificTable || specificTable === 'leagues') totalRows += await migrateLeagues();
    if (!specificTable || specificTable === 'teams') totalRows += await migrateTeams();
    if (!specificTable || specificTable === 'fixtures') totalRows += await migrateFixtures();
    if (!specificTable || specificTable === 'predictions') totalRows += await migratePredictions();
    if (!specificTable || specificTable === 'odds') totalRows += await migrateOdds();
    if (!specificTable || specificTable === 'local') await migrateLocalData();
    
    console.log(`\n🎉 Migration complete!`);
    console.log(`   Total rows migrated: ${totalRows.toLocaleString()}`);
  }
  
  // Show final stats
  console.log('\n📊 CockroachDB Stats:');
  const stats = await cockroach.query(`
    SELECT 'leagues' as t, COUNT(*) as n FROM cockroach_leagues
    UNION ALL SELECT 'teams', COUNT(*) FROM cockroach_teams
    UNION ALL SELECT 'fixtures', COUNT(*) FROM cockroach_fixtures
    UNION ALL SELECT 'predictions', COUNT(*) FROM cockroach_predictions
    UNION ALL SELECT 'odds', COUNT(*) FROM cockroach_odds
    UNION ALL SELECT 'xg_features', COUNT(*) FROM cockroach_xg_features
    UNION ALL SELECT 'referee_profiles', COUNT(*) FROM cockroach_referee_profiles
    UNION ALL SELECT 'injuries', COUNT(*) FROM cockroach_injuries
    UNION ALL SELECT 'league_models', COUNT(*) FROM cockroach_league_models
  `);
  
  if (stats.rows) {
    for (const row of stats.rows) {
      console.log(`   ${row.t}: ${row.n} rows`);
    }
  }
  
  await cockroach.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
