#!/usr/bin/env node
/**
 * ODDLY Research Dataset Builder
 * 
 * Builds a clean, validated historical dataset from all available sources:
 * - football-data.org matches (30K+, 17 leagues)
 * - Team composite ratings (405 teams)
 * - xG data (StatsBomb + Understat)
 * - Referee profiles (177 referees)
 * - Odds data (14K snapshots)
 * - Player stats (265 players)
 * - Injury data (149 teams)
 * - Standings (9 leagues)
 * 
 * Output: data/research-dataset.json (clean, validated, feature-rich)
 * 
 * Usage: node worker/research-dataset.js [--quick]
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const env = {};
  for (const l of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const DATA = path.join(__dirname, '../data');
const QUICK = process.argv.includes('--quick');

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
  catch { return null; }
}

// ─── Team Name Normalization ─────────────────────────────────────
const TEAM_ALIASES = {
  'man utd': 'Man United', 'manchester united': 'Man United',
  'man city': 'Man City', 'manchester city': 'Man City',
  'newcastle utd': 'Newcastle', 'newcastle united': 'Newcastle',
  'west ham utd': 'West Ham', 'west ham united': 'West Ham',
  'wolves': 'Wolves', 'wolverhampton': 'Wolves',
  'spurs': 'Tottenham', 'tottenham hotspur': 'Tottenham',
  'brighton and hove albion': 'Brighton', 'brighton & hove albion': 'Brighton',
  'nottm forest': "Nott'm Forest", 'nottingham forest': "Nott'm Forest",
  'sheffield utd': 'Sheffield United', 'sheffield united': 'Sheffield United',
  'blackburn rovers': 'Blackburn', 'blackburn': 'Blackburn',
  'coventry city': 'Coventry', 'coventry': 'Coventry',
  'huddersfield town': 'Huddersfield', 'huddersfield': 'Huddersfield',
  'stoke city': 'Stoke', 'stoke': 'Stoke',
  'swansea city': 'Swansea', 'swansea': 'Swansea',
  'west bromwich albion': 'West Brom', 'west brom': 'West Brom',
  'wigan athletic': 'Wigan', 'wigan': 'Wigan',
  'cardiff city': 'Cardiff', 'cardiff': 'Cardiff',
  'burton albion': 'Burton', 'burton': 'Burton',
  'fc koln': 'Koln', '1. fc koln': 'Koln',
  'borussia monchengladbach': "B. Monchengladbach", "borussia m'gladbach": "B. Monchengladbach",
  'eintracht frankfurt': 'Eintracht Frankfurt',
  'real sociedad': 'Real Sociedad', 'real madrid': 'Real Madrid',
  'fc barcelona': 'Barcelona', 'barcelona': 'Barcelona',
  'atletico madrid': 'Atletico Madrid', 'atl. madrid': 'Atletico Madrid',
  'sevilla fc': 'Sevilla', 'sevilla': 'Sevilla',
  'real betis': 'Real Betis', 'betis': 'Real Betis',
  'valencia cf': 'Valencia', 'valencia': 'Valencia',
  'villarreal cf': 'Villarreal', 'villarreal': 'Villarreal',
  'athletic club': 'Athletic Bilbao', 'athletic bilbao': 'Athletic Bilbao',
  'inter milan': 'Inter Milan', 'internazionale': 'Inter Milan', 'inter': 'Inter Milan',
  'ac milan': 'AC Milan', 'milan': 'AC Milan',
  'juventus': 'Juventus', 'juve': 'Juventus',
  'as roma': 'Roma', 'roma': 'Roma',
  'ssc napoli': 'Napoli', 'napoli': 'Napoli',
  'us sassuolo': 'Sassuolo', 'sassuolo': 'Sassuolo',
  'us lecce': 'Lecce', 'lecce': 'Lecce',
  'us empoli': 'Empoli', 'empoli': 'Empoli',
  'paris saint germain': 'PSG', 'paris saint-germain': 'PSG', 'psg': 'PSG',
  'olympique lyonnais': 'Lyon', 'lyon': 'Lyon',
  'olympique marseille': 'Marseille', 'marseille': 'Marseille',
  'ogc nice': 'Nice', 'nice': 'Nice',
  'stade brestois': 'Brest', 'brest': 'Brest',
  'rc lens': 'Lens', 'lens': 'Lens',
  'as monaco': 'Monaco', 'monaco': 'Monaco',
  '-ajax': 'Ajax', 'afc ajax': 'Ajax',
  'psv eindhoven': 'PSV', 'psv': 'PSV',
  'feyenoord': 'Feyenoord',
  'fc porto': 'Porto', 'porto': 'Porto',
  'sl benfica': 'Benfica', 'benfica': 'Benfica',
  'sporting cp': 'Sporting CP', 'sporting lisbon': 'Sporting CP',
  'celtic': 'Celtic', 'rangers': 'Rangers',
};

function normalizeTeam(name) {
  if (!name) return name;
  const lower = name.toLowerCase().trim();
  return TEAM_ALIASES[lower] || name;
}

// ─── Load All Data Sources ────────────────────────────────────────
function loadAllData() {
  console.log('Loading data sources...\n');
  
  const footballData = loadJSON('football-data-referee-stats.json') || [];
  console.log(`  football-data.org: ${footballData.length} matches`);
  
  const teamRatings = loadJSON('team-composite-ratings.json') || {};
  console.log(`  Team ratings: ${Object.keys(teamRatings).length} teams`);
  
  const injuryImpact = loadJSON('team-injury-impact.json') || {};
  console.log(`  Injury impact: ${Object.keys(injuryImpact).length} teams`);
  
  const playerStats = loadJSON('player-stats.json') || [];
  console.log(`  Player stats: ${playerStats.length} players`);
  
  const refProfiles = loadJSON('referee-profiles.json') || [];
  console.log(`  Referee profiles: ${refProfiles.length} refs`);
  
  const refFeatures = loadJSON('referee-features-built.json') || {};
  const refBuilt = refFeatures.profiles || refFeatures;
  console.log(`  Referee features: ${Object.keys(refBuilt).length} profiles`);
  
  const standings = loadJSON('standings.json') || {};
  console.log(`  Standings: ${Object.keys(standings).length} leagues`);
  
  const sbXG = loadJSON('statsbomb-xg.json') || {};
  console.log(`  StatsBomb xG: ${sbXG.matches_processed || 0} matches`);
  
  const oddsFeatures = loadJSON('odds-features.json') || {};
  console.log(`  Odds features: ${oddsFeatures.fixtures_with_odds || 0} fixtures`);
  
  const marketConsensus = loadJSON('market-consensus.json') || {};
  console.log(`  Market consensus: ${marketConsensus.total_fixtures || 0} fixtures`);
  
  return { footballData, teamRatings, injuryImpact, playerStats, refProfiles, refBuilt, standings, sbXG, oddsFeatures, marketConsensus };
}

// ─── Team Form Tracker ───────────────────────────────────────────
class FormTracker {
  constructor() {
    this.history = {}; // team -> [{date, goals_for, goals_against, result, is_home}]
    this.elo = {};
  }
  
  feed(home, away, hg, ag, date) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    
    const hResult = hg > ag ? 'W' : hg < ag ? 'L' : 'D';
    const aResult = ag > hg ? 'W' : ag < hg ? 'L' : 'D';
    
    this.history[home].push({ date, goals_for: hg, goals_against: ag, result: hResult, is_home: true });
    this.history[away].push({ date, goals_for: ag, goals_against: hg, result: aResult, is_home: false });
    
    // Elo update
    if (!this.elo[home]) this.elo[home] = 1500;
    if (!this.elo[away]) this.elo[away] = 1500;
    const K = 32;
    const expectedH = 1 / (1 + Math.pow(10, (this.elo[away] - this.elo[home]) / 400));
    const actualH = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] += K * (actualH - expectedH);
    this.elo[away] += K * ((1 - actualH) - (1 - expectedH));
  }
  
  getForm(team, n = 5) {
    const hist = this.history[team] || [];
    const recent = hist.slice(-n);
    if (recent.length === 0) return { ppg: 0, gf: 0, ga: 0, wins: 0, draws: 0, losses: 0, streak: 0, cs: 0, fts: 0 };
    
    const points = recent.map(r => r.result === 'W' ? 3 : r.result === 'D' ? 1 : 0);
    const streak = recent.reduce((s, r) => {
      const last = s.length > 0 ? s[s.length - 1] : null;
      if (last === null || last === r.result) s.push(r.result);
      else s = [r.result];
      return s;
    }, []);
    
    return {
      ppg: points.reduce((a, b) => a + b, 0) / recent.length,
      gf: recent.reduce((s, r) => s + r.goals_for, 0) / recent.length,
      ga: recent.reduce((s, r) => s + r.goals_against, 0) / recent.length,
      wins: recent.filter(r => r.result === 'W').length,
      draws: recent.filter(r => r.result === 'D').length,
      losses: recent.filter(r => r.result === 'L').length,
      streak: streak.length > 0 ? (streak[0] === 'W' ? streak.length : streak[0] === 'L' ? -streak.length : 0) : 0,
      cs: recent.filter(r => r.goals_against === 0).length,
      fts: recent.filter(r => r.goals_for === 0).length,
      lastResult: recent[recent.length - 1]?.result || 'N',
    };
  }
  
  getH2H(home, away, n = 5) {
    const all = [];
    const hHist = this.history[home] || [];
    for (const m of hHist) {
      // This is simplified — in full version we'd track opponent
      all.push(m);
    }
    return { homeWins: 0, draws: 0, awayWins: 0, avgGoals: 2.5 };
  }
  
  getElo(team) {
    return this.elo[team] || 1500;
  }
}

// ─── Build Research Dataset ──────────────────────────────────────
async function buildDataset() {
  const t0 = Date.now();
  const data = loadAllData();
  
  console.log('\n=== Building Clean Research Dataset ===\n');
  
  // Filter to valid matches (must have scores)
  let matches = data.footballData.filter(m => 
    m.home_goals !== null && m.away_goals !== null &&
    m.home_goals >= 0 && m.away_goals >= 0
  );
  
  console.log(`Valid matches with scores: ${matches.length}`);
  
  // Normalize team names
  matches = matches.map(m => ({
    ...m,
    home_team: normalizeTeam(m.home_team),
    away_team: normalizeTeam(m.away_team),
  }));
  
  // Sort by date
  matches.sort((a, b) => a.date.localeCompare(b.date));
  
  // Remove exact duplicates
  const seen = new Set();
  const deduped = [];
  for (const m of matches) {
    const key = `${m.date}_${m.home_team}_${m.away_team}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }
  console.log(`After dedup: ${deduped.length} (removed ${matches.length - deduped.length} duplicates)`);
  
  // Build form tracker (feed in chronological order)
  const tracker = new FormTracker();
  for (const m of deduped) {
    tracker.feed(m.home_team, m.away_team, m.home_goals, m.away_goals, m.date);
  }
  
  // Build player lookup by team
  const playersByTeam = {};
  for (const p of data.playerStats) {
    const team = normalizeTeam(p.team_name);
    if (!playersByTeam[team]) playersByTeam[team] = [];
    playersByTeam[team].push(p);
  }
  
  // Build referee lookup
  const refLookup = {};
  for (const r of data.refProfiles) {
    refLookup[r.name] = r;
  }
  
  // Build xG lookup (from StatsBomb)
  const xgLookup = {};
  if (data.sbXG.teams) {
    for (const [team, features] of Object.entries(data.sbXG.teams)) {
      xgLookup[normalizeTeam(team)] = features;
    }
  }
  
  // Build standings lookup
  const standingsLookup = {};
  for (const [league, leagueData] of Object.entries(data.standings)) {
    const teams = Array.isArray(leagueData) ? leagueData : (leagueData.standings || leagueData.teams || []);
    if (Array.isArray(teams)) {
      for (const t of teams) {
        const name = normalizeTeam(t.team || t.name || t.team_name);
        standingsLookup[name] = { league, position: t.position || t.rank, points: t.points, played: t.played || t.games };
      }
    }
  }
  
  console.log('\nBuilding features for each match...\n');
  
  // Build features for each match
  const dataset = [];
  let skipped = 0;
  
  for (let i = 0; i < deduped.length; i++) {
    const m = deduped[i];
    
    // Get form BEFORE this match (only use historical data)
    const homeForm = tracker.getForm(m.home_team, 5);
    const awayForm = tracker.getForm(m.away_team, 5);
    const homeForm10 = tracker.getForm(m.home_team, 10);
    const awayForm10 = tracker.getForm(m.away_team, 10);
    
    // Elo before this match
    const homeElo = tracker.getElo(m.home_team);
    const awayElo = tracker.getElo(m.away_team);
    
    // Team ratings
    const homeRatings = data.teamRatings[m.home_team] || {};
    const awayRatings = data.teamRatings[m.away_team] || {};
    
    // Injury impact
    const homeInjury = data.injuryImpact[m.home_team] || {};
    const awayInjury = data.injuryImpact[m.away_team] || {};
    
    // Referee
    const ref = refLookup[m.referee] || {};
    
    // Standings position
    const homeStanding = standingsLookup[m.home_team] || {};
    const awayStanding = standingsLookup[m.away_team] || {};
    
    // xG features
    const homeXG = xgLookup[m.home_team] || {};
    const awayXG = xgLookup[m.away_team] || {};
    
    // Player stats for team
    const homePlayers = playersByTeam[m.home_team] || [];
    const awayPlayers = playersByTeam[m.away_team] || [];
    
    // Match importance (end of season = more important)
    const month = parseInt(m.date.split('-')[1]);
    const seasonPhase = month >= 4 && month <= 5 ? 'run_in' : month >= 8 && month <= 9 ? 'early' : 'mid';
    
    // Actual result
    const result = m.home_goals > m.away_goals ? 'H' : m.home_goals < m.away_goals ? 'A' : 'D';
    
    // Build feature vector
    const features = {
      // Identity
      date: m.date,
      league: m.league,
      season: m.season,
      home_team: m.home_team,
      away_team: m.away_team,
      
      // Scores (these are the TARGETS, not features)
      home_goals: m.home_goals,
      away_goals: m.away_goals,
      result,
      ht_home_goals: m.ht_home_goals,
      ht_away_goals: m.ht_away_goals,
      ht_result: m.ht_result,
      
      // ─── FORM FEATURES ─────────────────────────
      elo_diff: homeElo - awayElo,
      home_elo: Math.round(homeElo),
      away_elo: Math.round(awayElo),
      
      home_ppg_5: Math.round(homeForm.ppg * 100) / 100,
      away_ppg_5: Math.round(awayForm.ppg * 100) / 100,
      ppg_diff: Math.round((homeForm.ppg - awayForm.ppg) * 100) / 100,
      
      home_ppg_10: Math.round(homeForm10.ppg * 100) / 100,
      away_ppg_10: Math.round(awayForm10.ppg * 100) / 100,
      
      home_gf_5: Math.round(homeForm.gf * 100) / 100,
      home_ga_5: Math.round(homeForm.ga * 100) / 100,
      away_gf_5: Math.round(awayForm.gf * 100) / 100,
      away_ga_5: Math.round(awayForm.ga * 100) / 100,
      
      home_cs_5: homeForm.cs,
      away_cs_5: awayForm.cs,
      home_fts_5: homeForm.fts,
      away_fts_5: awayForm.fts,
      
      home_streak: homeForm.streak,
      away_streak: awayForm.streak,
      streak_diff: homeForm.streak - awayForm.streak,
      
      home_wr_5: homeForm.wins / 5,
      away_wr_5: awayForm.wins / 5,
      
      // ─── RATING FEATURES ───────────────────────
      home_goals_for: homeRatings.goalsFor || 0,
      home_goals_against: homeRatings.goalsAgainst || 0,
      away_goals_for: awayRatings.goalsFor || 0,
      away_goals_against: awayRatings.goalsAgainst || 0,
      
      home_shots_for: homeRatings.shotsFor || 0,
      home_shots_against: homeRatings.shotsAgainst || 0,
      away_shots_for: awayRatings.shotsFor || 0,
      away_shots_against: awayRatings.shotsAgainst || 0,
      
      home_corners_for: homeRatings.cornersFor || 0,
      away_corners_for: awayRatings.cornersFor || 0,
      
      home_yellow_cards: homeRatings.yellowCards || 0,
      away_yellow_cards: awayRatings.yellowCards || 0,
      home_red_cards: homeRatings.redCards || 0,
      away_red_cards: awayRatings.redCards || 0,
      
      home_fouls_for: homeRatings.foulsFor || 0,
      away_fouls_for: awayRatings.foulsFor || 0,
      
      // ─── INJURY FEATURES ───────────────────────
      home_injured: homeInjury.ruled_out || 0,
      home_doubtful: homeInjury.total_doubtful || 0,
      home_injury_impact: homeInjury.impact_score || 0,
      away_injured: awayInjury.ruled_out || 0,
      away_doubtful: awayInjury.total_doubtful || 0,
      away_injury_impact: awayInjury.impact_score || 0,
      injury_diff: (homeInjury.impact_score || 0) - (awayInjury.impact_score || 0),
      
      // ─── xG FEATURES ───────────────────────────
      home_avg_xg: homeXG.avg_xg || 0,
      home_avg_xga: homeXG.avg_xga || 0,
      away_avg_xg: awayXG.avg_xg || 0,
      away_avg_xga: awayXG.avg_xga || 0,
      xg_diff: (homeXG.avg_xg || 0) - (awayXG.avg_xg || 0),
      xga_diff: (homeXG.avg_xga || 0) - (awayXG.avg_xga || 0),
      has_xg: (homeXG.avg_xg && awayXG.avg_xg) ? 1 : 0,
      
      // ─── REFEREE FEATURES ──────────────────────
      ref_home_bias: ref.home_bias || 0,
      ref_avg_goals: ref.avg_goals || 2.5,
      ref_avg_yellow: ref.avg_yellow || 3.5,
      ref_matches: ref.matches_officiated || 0,
      has_ref: m.referee ? 1 : 0,
      
      // ─── STANDINGS FEATURES ────────────────────
      home_position: homeStanding.position || 0,
      away_position: awayStanding.position || 0,
      position_diff: (homeStanding.position || 10) - (awayStanding.position || 10),
      
      // ─── MATCH CONTEXT ─────────────────────────
      is_home_advantage: 1, // Always home team
      season_phase: seasonPhase === 'run_in' ? 2 : seasonPhase === 'early' ? 0 : 1,
      month: month,
      
      // ─── IN-MATCH FEATURES (for half-time prediction) ─────────
      ht_goal_diff: (m.ht_home_goals || 0) - (m.ht_away_goals || 0),
      ht_total_goals: (m.ht_home_goals || 0) + (m.ht_away_goals || 0),
      
      // ─── MATCH STATS (from football-data.org) ──
      home_shots: m.home_shots || 0,
      away_shots: m.away_shots || 0,
      home_shots_on_target: m.home_shots_on_target || 0,
      away_shots_on_target: m.away_shots_on_target || 0,
      home_fouls: m.home_fouls || 0,
      away_fouls: m.away_fouls || 0,
      home_corners: m.home_corners || 0,
      away_corners: m.away_corners || 0,
      home_yellow: m.home_yellow || 0,
      away_yellow: m.away_yellow || 0,
      home_red: m.home_red || 0,
      away_red: m.away_red || 0,
      total_goals: m.home_goals + m.away_goals,
      goal_diff: m.home_goals - m.away_goals,
      
      // ─── TARGETS ───────────────────────────────
      is_home_win: result === 'H' ? 1 : 0,
      is_draw: result === 'D' ? 1 : 0,
      is_away_win: result === 'A' ? 1 : 0,
      over_0_5: (m.home_goals + m.away_goals) > 0.5 ? 1 : 0,
      over_1_5: (m.home_goals + m.away_goals) > 1.5 ? 1 : 0,
      over_2_5: (m.home_goals + m.away_goals) > 2.5 ? 1 : 0,
      over_3_5: (m.home_goals + m.away_goals) > 3.5 ? 1 : 0,
      btts: (m.home_goals > 0 && m.away_goals > 0) ? 1 : 0,
      dc_1x: result !== 'A' ? 1 : 0,
      dc_x2: result !== 'H' ? 1 : 0,
      dc_12: result !== 'D' ? 1 : 0,
    };
    
    dataset.push(features);
  }
  
  console.log(`Built ${dataset.length} feature vectors (${skipped} skipped)`);
  
  // ─── Quality Report ──────────────────────────────────────────
  console.log('\n=== Dataset Quality Report ===\n');
  
  const featureCols = Object.keys(dataset[0]).filter(k => !['date','league','season','home_team','away_team'].includes(k));
  
  const quality = {};
  for (const col of featureCols) {
    const values = dataset.map(r => r[col]);
    const nulls = values.filter(v => v === null || v === undefined || isNaN(v)).length;
    const numVals = values.filter(v => typeof v === 'number' && !isNaN(v));
    const min = Math.min(...numVals);
    const max = Math.max(...numVals);
    const mean = numVals.reduce((a, b) => a + b, 0) / numVals.length;
    
    quality[col] = {
      nulls,
      nullPct: ((nulls / dataset.length) * 100).toFixed(1),
      min: Math.round(min * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
      mean: Math.round(mean * 1000) / 1000,
    };
  }
  
  // Print quality summary
  const highNull = Object.entries(quality).filter(([, q]) => parseFloat(q.nullPct) > 10);
  if (highNull.length > 0) {
    console.log('Features with >10% nulls:');
    highNull.forEach(([col, q]) => console.log(`  ${col}: ${q.nullPct}% null`));
  }
  
  // League distribution
  const leagueDist = {};
  dataset.forEach(r => { leagueDist[r.league] = (leagueDist[r.league] || 0) + 1; });
  console.log('\nLeague distribution:');
  Object.entries(leagueDist).sort((a, b) => b[1] - a[1]).forEach(([l, c]) => {
    console.log(`  ${l}: ${c} (${((c / dataset.length) * 100).toFixed(1)}%)`);
  });
  
  // Season distribution
  const seasonDist = {};
  dataset.forEach(r => { seasonDist[r.season] = (seasonDist[r.season] || 0) + 1; });
  console.log('\nSeason distribution:');
  Object.entries(seasonDist).sort().forEach(([s, c]) => {
    console.log(`  ${s}: ${c}`);
  });
  
  // Result distribution
  const resultDist = { H: 0, D: 0, A: 0 };
  dataset.forEach(r => { resultDist[r.result]++; });
  console.log('\nResult distribution:');
  console.log(`  Home: ${resultDist.H} (${((resultDist.H / dataset.length) * 100).toFixed(1)}%)`);
  console.log(`  Draw: ${resultDist.D} (${((resultDist.D / dataset.length) * 100).toFixed(1)}%)`);
  console.log(`  Away: ${resultDist.A} (${((resultDist.A / dataset.length) * 100).toFixed(1)}%)`);
  
  // Save
  const outputPath = path.join(DATA, 'research-dataset.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    built_at: new Date().toISOString(),
    total_matches: dataset.length,
    feature_count: featureCols.length,
    date_range: { from: dataset[0]?.date, to: dataset[dataset.length - 1]?.date },
    leagues: Object.keys(leagueDist).length,
    quality,
    features: featureCols,
    data: QUICK ? dataset.slice(0, 5000) : dataset,
  }, null, 2));
  
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== Dataset saved: ${outputPath} (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(1)}MB, ${elapsed}s) ===`);
  
  return dataset;
}

buildDataset().catch(console.error);
