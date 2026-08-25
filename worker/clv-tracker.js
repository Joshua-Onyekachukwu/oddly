#!/usr/bin/env node
/**
 * ODDLY CLV (Closing Line Value) Tracker
 * 
 * Tracks odds movement over time for upcoming fixtures:
 * - Opening snapshot (when prediction is first made, 24hrs before)
 * - Mid snapshot (12hrs before kickoff)
 * - Closing snapshot (1hr before kickoff)
 * 
 * CLV = closing odds - opening odds
 * Positive CLV = odds shortened (sharp money moved in our direction)
 * Negative CLV = odds drifted (public money moved against us)
 * 
 * Sharp money indicator: if closing odds < opening odds, sharps are on that side
 * 
 * Usage:
 *   node worker/clv-tracker.js snapshot   # Take odds snapshot for upcoming matches
 *   node worker/clv-tracker.js compute    # Compute CLV features from snapshots
 *   node worker/clv-tracker.js report     # Print CLV analysis report
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ─── Env ─────────────────────────────────────────────────────────────
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

// Also load from .env.local for The Odds API key
const ODDS_API_KEY = env.THE_ODDS_API_KEY || '';

const CLV_PATH = path.join(__dirname, '../data/clv-snapshots.json');
const CLV_FEATURES_PATH = path.join(__dirname, '../data/clv-features.json');

// ─── Convex HTTP helpers ─────────────────────────────────────────────
const https = require('https');
const CONVEX_URL = 'https://limitless-mole-387.convex.cloud';

function convexMutate(mutationPath, args) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ path: mutationPath, args });
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

function convexQuery(queryPath, args = {}) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ path: queryPath, args });
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

// ─── Load existing snapshots ─────────────────────────────────────────
function loadSnapshots() {
  if (fs.existsSync(CLV_PATH)) {
    return JSON.parse(fs.readFileSync(CLV_PATH, 'utf8'));
  }
  return { snapshots: {}, meta: {} };
}

function saveSnapshots(data) {
  fs.writeFileSync(CLV_PATH, JSON.stringify(data, null, 2));
}

// ─── Odds API Fetch ──────────────────────────────────────────────────
async function fetchOddsFromAPI(sport = 'soccer_epl') {
  if (!ODDS_API_KEY) {
    console.log('  No THE_ODDS_API_KEY set — using existing odds data');
    return null;
  }
  
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h,spreads,totals&bookmakers=pinnacle,bet365,betfair,betway,williamhill`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  Odds API error: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`  Odds API fetch error: ${e.message}`);
    return null;
  }
}

// ─── Snapshot Command ────────────────────────────────────────────────
async function takeSnapshot() {
  console.log('=== CLV Snapshot ===\n');
  
  const data = loadSnapshots();
  const now = new Date();
  
  // Get upcoming fixtures from Supabase
  const { data: fixtures } = await sb
    .from('fixtures')
    .select('*')
    .eq('status', 'scheduled')
    .gte('kickoff_time', now.toISOString())
    .lte('kickoff_time', new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString())
    .order('kickoff_time');
  
  if (!fixtures || fixtures.length === 0) {
    console.log('No upcoming fixtures in next 48h');
    return;
  }
  
  // Get team names
  const teamIds = [...new Set(fixtures.flatMap(f => [f.home_team_id, f.away_team_id]))];
  const { data: teams } = await sb.from('teams').select('id, canonical_name').in('id', teamIds);
  const teamMap = {};
  teams?.forEach(t => { teamMap[t.id] = t.canonical_name; });
  
  console.log(`Found ${fixtures.length} upcoming fixtures\n`);
  
  let snapshotCount = 0;
  
  for (const fixture of fixtures) {
    const home = teamMap[fixture.home_team_id] || 'Unknown';
    const away = teamMap[fixture.away_team_id] || 'Unknown';
    const fixtureKey = fixture.id;
    const kickoff = new Date(fixture.kickoff_time);
    const hoursUntil = (kickoff - now) / (1000 * 60 * 60);
    
    // Determine snapshot type based on time to kickoff
    let snapshotType;
    if (hoursUntil > 24) snapshotType = 'opening';
    else if (hoursUntil > 6) snapshotType = 'mid';
    else if (hoursUntil > 0.5) snapshotType = 'closing';
    else snapshotType = 'pre_match';
    
    // Get existing odds from Supabase
    const { data: odds } = await sb
      .from('odds_snapshots')
      .select('*')
      .eq('fixture_id', fixture.id);
    
    if (!odds || odds.length === 0) continue;
    
    // Group odds by bookmaker and selection
    const oddsByBookmaker = {};
    for (const o of odds) {
      if (!oddsByBookmaker[o.bookmaker]) oddsByBookmaker[o.bookmaker] = {};
      if (!oddsByBookmaker[o.bookmaker][o.selection]) oddsByBookmaker[o.bookmaker][o.selection] = [];
      oddsByBookmaker[o.bookmaker][o.selection].push(o.odds_value || o.odds);
    }
    
    // Calculate average odds across bookmakers
    const avgOdds = { home: [], draw: [], away: [] };
    for (const [bk, selections] of Object.entries(oddsByBookmaker)) {
      if (selections['Home'] || selections['home']) {
        avgOdds.home.push(selections['Home']?.[0] || selections['home']?.[0]);
      }
      if (selections['Draw'] || selections['draw']) {
        avgOdds.draw.push(selections['Draw']?.[0] || selections['draw']?.[0]);
      }
      if (selections['Away'] || selections['away']) {
        avgOdds.away.push(selections['Away']?.[0] || selections['away']?.[0]);
      }
    }
    
    const homeAvg = avgOdds.home.length > 0 ? avgOdds.home.reduce((a, b) => a + b, 0) / avgOdds.home.length : 0;
    const drawAvg = avgOdds.draw.length > 0 ? avgOdds.draw.reduce((a, b) => a + b, 0) / avgOdds.draw.length : 0;
    const awayAvg = avgOdds.away.length > 0 ? avgOdds.away.reduce((a, b) => a + b, 0) / avgOdds.away.length : 0;
    
    if (homeAvg === 0 && drawAvg === 0 && awayAvg === 0) continue;
    
    // Store snapshot
    if (!data.snapshots[fixtureKey]) {
      data.snapshots[fixtureKey] = [];
    }
    
    const snapshot = {
      timestamp: now.toISOString(),
      type: snapshotType,
      hoursUntilKickoff: Math.round(hoursUntil * 10) / 10,
      homeTeam: home,
      awayTeam: away,
      kickoffTime: fixture.kickoff_time,
      odds: {
        home: homeAvg,
        draw: drawAvg,
        away: awayAvg,
      },
      impliedProbs: {
        home: homeAvg > 0 ? Math.round((1 / homeAvg) * 10000) / 10000 : 0,
        draw: drawAvg > 0 ? Math.round((1 / drawAvg) * 10000) / 10000 : 0,
        away: awayAvg > 0 ? Math.round((1 / awayAvg) * 10000) / 10000 : 0,
      },
      bookmakerCount: Object.keys(oddsByBookmaker).length,
      overround: homeAvg > 0 && drawAvg > 0 && awayAvg > 0
        ? Math.round(((1/homeAvg + 1/drawAvg + 1/awayAvg) - 1) * 10000) / 10000
        : 0,
    };
    
    data.snapshots[fixtureKey].push(snapshot);
    snapshotCount++;
    
    console.log(`  [${snapshotType}] ${home} vs ${away} — H:${homeAvg.toFixed(2)} D:${drawAvg.toFixed(2)} A:${awayAvg.toFixed(2)} (${hoursUntil.toFixed(1)}h to kickoff)`);
  }
  
  // Update metadata
  data.meta = {
    lastSnapshot: now.toISOString(),
    snapshotCount,
    fixturesTracked: Object.keys(data.snapshots).length,
  };
  
  saveSnapshots(data);
  console.log(`\nSaved ${snapshotCount} snapshots for ${Object.keys(data.snapshots).length} fixtures`);
}

// ─── Compute CLV Features ────────────────────────────────────────────
async function computeCLVFeatures() {
  console.log('=== Computing CLV Features ===\n');
  
  const data = loadSnapshots();
  const features = {};
  let computed = 0;
  
  for (const [fixtureKey, snapshots] of Object.entries(data.snapshots)) {
    if (snapshots.length < 2) continue; // Need at least 2 snapshots for CLV
    
    // Sort by timestamp
    const sorted = snapshots.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const opening = sorted[0];
    const closing = sorted[sorted.length - 1];
    
    // CLV calculation
    const clvHome = opening.odds.home > 0 ? closing.odds.home - opening.odds.home : 0;
    const clvDraw = opening.odds.draw > 0 ? closing.odds.draw - opening.odds.draw : 0;
    const clvAway = opening.odds.away > 0 ? closing.odds.away - opening.odds.away : 0;
    
    // Sharp money indicator (negative CLV = odds shortened = smart money)
    const sharpHome = clvHome < 0 ? 1 : 0;
    const sharpDraw = clvDraw < 0 ? 1 : 0;
    const sharpAway = clvAway < 0 ? 1 : 0;
    
    // Odds movement magnitude (how much did odds move?)
    const movementHome = opening.odds.home > 0 ? Math.abs(clvHome / opening.odds.home) : 0;
    const movementDraw = opening.odds.draw > 0 ? Math.abs(clvDraw / opening.odds.draw) : 0;
    const movementAway = opening.odds.away > 0 ? Math.abs(clvAway / opening.odds.away) : 0;
    
    // Implied probability shift
    const impliedShiftHome = opening.impliedProbs.home - closing.impliedProbs.home;
    const impliedShiftDraw = opening.impliedProbs.draw - closing.impliedProbs.draw;
    const impliedShiftAway = opening.impliedProbs.away - closing.impliedProbs.away;
    
    // Market consensus strength (more bookmakers = more reliable)
    const consensusStrength = Math.min(closing.bookmakerCount / 5, 1);
    
    // Overround change (market efficiency indicator)
    const overroundChange = closing.overround - opening.overround;
    
    features[fixtureKey] = {
      homeTeam: closing.homeTeam,
      awayTeam: closing.awayTeam,
      kickoffTime: closing.kickoffTime,
      
      // Raw CLV
      clvHome: Math.round(clvHome * 10000) / 10000,
      clvDraw: Math.round(clvDraw * 10000) / 10000,
      clvAway: Math.round(clvAway * 10000) / 10000,
      
      // Sharp money
      sharpMoneyHome: sharpHome,
      sharpMoneyDraw: sharpDraw,
      sharpMoneyAway: sharpAway,
      
      // Movement magnitude
      movementHome: Math.round(movementHome * 10000) / 10000,
      movementDraw: Math.round(movementDraw * 10000) / 10000,
      movementAway: Math.round(movementAway * 10000) / 10000,
      
      // Implied probability shifts
      impliedShiftHome: Math.round(impliedShiftHome * 10000) / 10000,
      impliedShiftDraw: Math.round(impliedShiftDraw * 10000) / 10000,
      impliedShiftAway: Math.round(impliedShiftAway * 10000) / 10000,
      
      // Market metrics
      consensusStrength: Math.round(consensusStrength * 100) / 100,
      overroundChange: Math.round(overroundChange * 10000) / 10000,
      closingOverround: closing.overround,
      
      // Best indicator for model
      bestCLV: Math.max(clvHome, clvDraw, clvAway),
      sharpestSide: clvHome < clvDraw && clvHome < clvAway ? 'Home' 
                   : clvAway < clvDraw ? 'Away' : 'Draw',
      
      // Snapshot count
      snapshotCount: sorted.length,
      firstSnapshot: opening.timestamp,
      lastSnapshot: closing.timestamp,
    };
    
    computed++;
  }
  
  // Save features
  const outputPath = path.join(__dirname, '../data/clv-features.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    computed_at: new Date().toISOString(),
    count: computed,
    features,
  }, null, 2));
  
  console.log(`Computed CLV features for ${computed} fixtures\n`);
  
  // Also store in Convex for real-time access
  let convexOk = 0;
  for (const [fixtureKey, feat] of Object.entries(features)) {
    try {
      await convexMutate('predictions:bulkInsertOdds', {
        odds: [{
          fixtureId: fixtureKey,
          bookmaker: 'CLV_ANALYSIS',
          market: 'h2h',
          selection: `home_clv_${feat.clvHome}`,
          odds: feat.clvHome,
          impliedProb: feat.impliedShiftHome,
          timestamp: new Date().toISOString(),
        }],
      });
      convexOk++;
    } catch {}
  }
  
  if (convexOk > 0) console.log(`Stored ${convexOk} CLV features in Convex`);
  
  return features;
}

// ─── CLV Report ──────────────────────────────────────────────────────
function printReport() {
  console.log('=== CLV Analysis Report ===\n');
  
  const data = loadSnapshots();
  let totalWithCLV = 0;
  let positiveCLV = 0;
  let strongSignals = [];
  
  for (const [fixtureKey, snapshots] of Object.entries(data.snapshots)) {
    if (snapshots.length < 2) continue;
    totalWithCLV++;
    
    const sorted = snapshots.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const opening = sorted[0];
    const closing = sorted[sorted.length - 1];
    
    const clvHome = closing.odds.home - opening.odds.home;
    
    if (clvHome < -0.1) positiveCLV++;
    
    const movement = Math.abs(clvHome / opening.odds.home) * 100;
    
    if (movement > 5) {
      strongSignals.push({
        fixture: `${opening.homeTeam} vs ${opening.awayTeam}`,
        movement: movement.toFixed(1) + '%',
        direction: clvHome < 0 ? 'SHARP ON HOME' : 'PUBLIC ON HOME',
        openingH: opening.odds.home.toFixed(2),
        closingH: closing.odds.home.toFixed(2),
        hours: closing.hoursUntilKickoff,
      });
    }
  }
  
  console.log(`Fixtures with CLV data: ${totalWithCLV}`);
  console.log(`Fixtures with positive CLV (sharp money): ${positiveCLV}\n`);
  
  if (strongSignals.length > 0) {
    console.log('Strong CLV Signals (>5% movement):');
    strongSignals.forEach(s => {
      console.log(`  ${s.fixture}: ${s.direction} (${s.movement} movement, ${s.openingH} -> ${s.closingH}, ${s.hours}h to KO)`);
    });
  }
}

// ─── Main ────────────────────────────────────────────────────────────
const command = process.argv[2] || 'snapshot';

switch (command) {
  case 'snapshot':
    takeSnapshot().catch(console.error);
    break;
  case 'compute':
    computeCLVFeatures().catch(console.error);
    break;
  case 'report':
    printReport();
    break;
  default:
    console.log('Usage: node worker/clv-tracker.js [snapshot|compute|report]');
}
