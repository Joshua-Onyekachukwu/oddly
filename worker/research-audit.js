#!/usr/bin/env node
/**
 * ODDLY Research Data Audit
 * 
 * Produces a formal audit of every available dataset:
 * - Raw records, valid records, removed records
 * - Coverage, null rates, quality issues
 * - Gap analysis: what we have vs what we need
 * 
 * Output: data/research-audit-report.json + console report
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

function loadJSON(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
  catch { return null; }
}

async function audit() {
  const report = { timestamp: new Date().toISOString(), datasets: {}, gaps: {}, summary: {} };

  // ─── 1. Football-Data.org Historical Matches ────────────────────
  console.log('=== AUDIT: Football-Data.org Historical Matches ===');
  const fd = loadJSON('football-data-referee-stats.json') || [];
  const fdFull = loadJSON('football-data-referee-stats-full.json') || [];
  
  const fdAudit = {
    rawRecords: fd.length,
    dateRange: { from: fd.map(m => m.date).sort()[0], to: fd.map(m => m.date).sort().pop() },
    leagues: {},
    seasons: {},
    fields: Object.keys(fd[0] || {}),
    nullRates: {},
    qualityIssues: [],
  };
  
  // Count by league and season
  fd.forEach(m => {
    fdAudit.leagues[m.league] = (fdAudit.leagues[m.league] || 0) + 1;
    fdAudit.seasons[m.season] = (fdAudit.seasons[m.season] || 0) + 1;
  });
  
  // Null rates
  const fields = Object.keys(fd[0] || {});
  for (const f of fields) {
    const nullCount = fd.filter(m => m[f] === null || m[f] === undefined || m[f] === '').length;
    fdAudit.nullRates[f] = { count: nullCount, pct: ((nullCount / fd.length) * 100).toFixed(1) };
  }
  
  // Quality issues
  const noGoals = fd.filter(m => m.home_goals === null || m.away_goals === null);
  if (noGoals.length > 0) fdAudit.qualityIssues.push({ type: 'missing_score', count: noGoals.length });
  
  const impossibleScores = fd.filter(m => m.home_goals < 0 || m.away_goals < 0);
  if (impossibleScores.length > 0) fdAudit.qualityIssues.push({ type: 'impossible_score', count: impossibleScores.length });
  
  const duplicates = fd.filter((m, i, arr) => arr.findIndex(x => x.date === m.date && x.home_team === m.home_team && x.away_team === m.away_team) !== i);
  if (duplicates.length > 0) fdAudit.qualityIssues.push({ type: 'duplicate_fixture', count: duplicates.length });
  
  // Valid records (must have scores)
  fdAudit.validRecords = fd.filter(m => m.home_goals !== null && m.away_goals !== null).length;
  fdAudit.invalidRecords = fd.length - fdAudit.validRecords;
  
  report.datasets['football_data'] = fdAudit;
  
  console.log(`  Records: ${fd.length}`);
  console.log(`  Valid: ${fdAudit.validRecords}`);
  console.log(`  Date range: ${fdAudit.dateRange.from} to ${fdAudit.dateRange.to}`);
  console.log(`  Leagues: ${Object.keys(fdAudit.leagues).length}`);
  console.log(`  Seasons: ${Object.keys(fdAudit.seasons).length}`);
  console.log(`  With referee: ${fd.filter(m => m.referee).length} (${((fd.filter(m => m.referee).length / fd.length) * 100).toFixed(1)}%)`);
  console.log(`  Quality issues: ${fdAudit.qualityIssues.length}`);
  
  // ─── 2. Supabase Fixtures ───────────────────────────────────────
  console.log('\n=== AUDIT: Supabase Fixtures ===');
  const { count: fixCount } = await sb.from('fixtures').select('*', { count: 'exact', head: true });
  const { data: fixSample } = await sb.from('fixtures').select('*').limit(5);
  
  report.datasets['supabase_fixtures'] = {
    rawRecords: fixCount,
    fields: fixSample ? Object.keys(fixSample[0]) : [],
    columns_with_nulls: fixSample ? Object.keys(fixSample[0]).filter(k => fixSample.some(r => r[k] === null)) : [],
  };
  console.log(`  Records: ${fixCount}`);
  
  // ─── 3. Supabase Predictions ────────────────────────────────────
  console.log('\n=== AUDIT: Supabase Predictions ===');
  const { count: predCount } = await sb.from('predictions').select('*', { count: 'exact', head: true });
  
  // Sample to check fields
  const { data: predSample } = await sb.from('predictions').select('*').limit(5);
  const predFields = predSample ? Object.keys(predSample[0]) : [];
  
  report.datasets['supabase_predictions'] = {
    rawRecords: predCount,
    fields: predFields,
  };
  console.log(`  Records: ${predCount}`);
  console.log(`  Fields: ${predFields.length}`);
  
  // ─── 4. Team Composite Ratings ──────────────────────────────────
  console.log('\n=== AUDIT: Team Composite Ratings ===');
  const tcr = loadJSON('team-composite-ratings.json') || {};
  const tcrTeams = Object.keys(tcr);
  const tcrFields = tcrTeams.length > 0 ? Object.keys(tcr[tcrTeams[0]]) : [];
  
  report.datasets['team_composite_ratings'] = {
    rawRecords: tcrTeams.length,
    fields: tcrFields,
    coverage: `${tcrTeams.length} teams with composite ratings`,
  };
  console.log(`  Teams: ${tcrTeams.length}`);
  console.log(`  Fields: ${tcrFields.join(', ')}`);
  
  // ─── 5. Team Injury Impact ──────────────────────────────────────
  console.log('\n=== AUDIT: Team Injury Impact ===');
  const tii = loadJSON('team-injury-impact.json') || {};
  const tiiTeams = Object.keys(tii);
  
  report.datasets['team_injury_impact'] = {
    rawRecords: tiiTeams.length,
    coverage: `${tiiTeams.length} teams with injury data`,
  };
  console.log(`  Teams: ${tiiTeams.length}`);
  
  // ─── 6. Player Stats ────────────────────────────────────────────
  console.log('\n=== AUDIT: Player Stats ===');
  const ps = loadJSON('player-stats.json') || [];
  
  report.datasets['player_stats'] = {
    rawRecords: ps.length,
    fields: ps.length > 0 ? Object.keys(ps[0]) : [],
    teamsRepresented: ps.length > 0 ? new Set(ps.map(p => p.team_name)).size : 0,
    leaguesRepresented: ps.length > 0 ? new Set(ps.map(p => p.league)).size : 0,
  };
  console.log(`  Players: ${ps.length}`);
  console.log(`  Teams: ${report.datasets.player_stats.teamsRepresented}`);
  console.log(`  Leagues: ${report.datasets.player_stats.leaguesRepresented}`);
  
  // ─── 7. Referee Data ────────────────────────────────────────────
  console.log('\n=== AUDIT: Referee Data ===');
  const refProfiles = loadJSON('referee-profiles.json') || [];
  const refFeatures = loadJSON('referee-features-built.json') || {};
  
  report.datasets['referee_profiles'] = {
    rawRecords: refProfiles.length,
    fields: refProfiles.length > 0 ? Object.keys(refProfiles[0]) : [],
  };
  report.datasets['referee_features'] = {
    built_at: refFeatures.built_at,
    total_matches: refFeatures.total_matches,
    matches_with_ref_stats: refFeatures.matches_with_ref_stats,
  };
  console.log(`  Profiles: ${refProfiles.length}`);
  console.log(`  Feature matches: ${refFeatures.total_matches || 0}`);
  
  // ─── 8. xG Data ─────────────────────────────────────────────────
  console.log('\n=== AUDIT: xG Data ===');
  const sbxg = loadJSON('statsbomb-xg.json') || {};
  const uxg = loadJSON('understat-xg.json') || {};
  
  report.datasets['statsbomb_xg'] = {
    matches_processed: sbxg.matches_processed || 0,
    competitions: Object.keys(sbxg.competitions || {}).length,
  };
  report.datasets['understat_xg'] = {
    leagues: Object.keys(uxg.leagues || {}).length,
    total_teams: Object.values(uxg.leagues || {}).reduce((s, l) => s + Object.keys(l.teams || {}).length, 0),
  };
  console.log(`  StatsBomb: ${sbxg.matches_processed || 0} matches`);
  console.log(`  Understat: ${Object.values(uxg.leagues || {}).reduce((s, l) => s + Object.keys(l.teams || {}).length, 0)} teams`);
  
  // ─── 9. Odds Data ───────────────────────────────────────────────
  console.log('\n=== AUDIT: Odds Data ===');
  const { count: oddsCount } = await sb.from('odds_snapshots').select('*', { count: 'exact', head: true });
  const oddsFeatures = loadJSON('odds-features.json') || {};
  const marketConsensus = loadJSON('market-consensus.json') || {};
  
  report.datasets['odds_snapshots'] = {
    rawRecords: oddsCount,
    fixtures_with_features: oddsFeatures.fixtures_with_odds || 0,
    market_consensus_fixtures: marketConsensus.total_fixtures || 0,
  };
  console.log(`  Snapshots: ${oddsCount}`);
  console.log(`  With features: ${oddsFeatures.fixtures_with_odds || 0}`);
  
  // ─── 10. Standings ──────────────────────────────────────────────
  console.log('\n=== AUDIT: Standings ===');
  const standings = loadJSON('standings.json') || {};
  
  report.datasets['standings'] = {
    leagues: Object.keys(standings).length,
    total_teams: Object.values(standings).reduce((s, l) => {
      const teams = Array.isArray(l) ? l : (l.standings || l.teams || []);
      return s + (Array.isArray(teams) ? teams.length : 0);
    }, 0),
  };
  console.log(`  Leagues: ${Object.keys(standings).length}`);
  
  // ─── GAP ANALYSIS ───────────────────────────────────────────────
  console.log('\n=== PREDICTIVE DATA GAP ANALYSIS ===\n');
  
  const gaps = [
    {
      feature: 'Starting Lineups',
      why: 'Knowing the actual starting XI allows precise player-impact modeling, formation analysis, and tactical matchup prediction',
      historicalAvailability: '0% — never collected',
      source: 'Understat (free, post-match), API-Football (free tier, pre-match)',
      cost: 'Free (Understat), Free tier 100 req/day (API-Football)',
      reliability: 'High (Understat) / Medium (API-Football predicted lineups)',
      coverage: 'Top 5 leagues, 2017+',
      integrationDifficulty: 'Medium — need per-match lookup',
      expectedValue: 'HIGH — formation matchup + player availability is strong signal',
    },
    {
      feature: 'Weather / Pitch Conditions',
      why: 'Rain, wind, cold affect playing style, goals, cards',
      historicalAvailability: '0% — never collected',
      source: 'OpenWeatherMap (free 1000 req/day), Visual Crossing (free historical)',
      cost: 'Free',
      reliability: 'High',
      coverage: 'All matches with venue coordinates',
      integrationDifficulty: 'Medium — need venue geocoding',
      expectedValue: 'LOW-MEDIUM — marginal but real effect on totals',
    },
    {
      feature: 'Travel Distance',
      why: 'Long travel → fatigue → performance drop',
      historicalAvailability: '0% — never collected',
      source: 'Can compute from team home cities',
      cost: 'Free (geocoding)',
      reliability: 'High',
      coverage: 'All matches',
      integrationDifficulty: 'Low',
      expectedValue: 'LOW-MEDIUM — mainly for midweek/international',
    },
    {
      feature: 'Manager Tenure / Changes',
      why: 'New manager bounce, long-tenure stability',
      historicalAvailability: '0%',
      source: 'Wikipedia scraping, Transfermarkt',
      cost: 'Free',
      reliability: 'Medium',
      coverage: 'Top leagues',
      integrationDifficulty: 'High',
      expectedValue: 'MEDIUM — known real effect',
    },
    {
      feature: 'Asian Handicap Odds',
      why: 'Most efficient market, sharp money indicator',
      historicalAvailability: '0% — only 1X2 odds collected',
      source: 'The Odds API (exhausted), OddsPortal (free scraping)',
      cost: 'Free (scraping) or paid API',
      reliability: 'High',
      coverage: 'Most bookmakers',
      integrationDifficulty: 'Medium',
      expectedValue: 'HIGH — AH is the sharpest market',
    },
    {
      feature: 'Expected Assists (xA)',
      why: 'Shot quality + creation quality combination',
      historicalAvailability: 'Limited (StatsBomb 2,183 matches)',
      source: 'StatsBomb open data (free), FBref (free)',
      cost: 'Free',
      reliability: 'High',
      coverage: 'Top 5 leagues, 2017+',
      integrationDifficulty: 'Low',
      expectedValue: 'MEDIUM',
    },
    {
      feature: 'Possession / PPDA',
      why: 'Tactical style indicator, pressing intensity',
      historicalAvailability: 'Limited (StatsBomb for xG matches)',
      source: 'Understat (free), FBref (free)',
      cost: 'Free',
      reliability: 'High',
      coverage: 'Top 5 leagues',
      integrationDifficulty: 'Low',
      expectedValue: 'MEDIUM',
    },
    {
      feature: 'Promotion/Relegation Effects',
      why: 'Teams newly promoted/relegated behave differently',
      historicalAvailability: 'Can derive from standings history',
      source: 'Computed from our own data',
      cost: 'Free',
      reliability: 'High',
      coverage: 'All leagues with standings',
      integrationDifficulty: 'Low',
      expectedValue: 'MEDIUM',
    },
  ];
  
  report.gaps = gaps;
  
  for (const gap of gaps) {
    console.log(`  ${gap.feature}`);
    console.log(`    Why: ${gap.why}`);
    console.log(`    Coverage: ${gap.coverage}`);
    console.log(`    Source: ${gap.source}`);
    console.log(`    Expected Value: ${gap.expectedValue}`);
    console.log('');
  }
  
  // ─── SUMMARY ────────────────────────────────────────────────────
  report.summary = {
    totalDatasets: Object.keys(report.datasets).length,
    primaryDataset: 'football_data (30,340 matches, 17 leagues, 2021-2026)',
    totalHistoricalMatches: fd.length,
    totalPredictions: predCount,
    totalOdds: oddsCount,
    totalTeams: tcrTeams.length,
    totalPlayers: ps.length,
    totalReferees: refProfiles.length,
    totalLeagues: Object.keys(fdAudit.leagues).length,
    keyGaps: gaps.filter(g => g.expectedValue === 'HIGH' || g.expectedValue === 'MEDIUM').map(g => g.feature),
    recommendedNextSteps: [
      'Build clean historical research dataset from football_data (30,340 matches)',
      'Add weather data for all fixtures (OpenWeatherMap free tier)',
      'Collect Asian Handicap odds from OddsPortal',
      'Build walk-forward prediction simulator',
      'Run feature discovery engine',
    ],
  };
  
  // Save report
  const reportPath = path.join(DATA, 'research-audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n=== REPORT SAVED: ${reportPath} ===`);
  
  return report;
}

audit().catch(console.error);
