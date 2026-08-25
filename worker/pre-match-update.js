#!/usr/bin/env node
/**
 * ODDLY Pre-Match Update Pipeline
 * 
 * Runs at specific intervals before kickoff to refine predictions:
 * 
 * Phase 1 (24h before):  Initial prediction with predicted lineups + opening odds
 * Phase 2 (1h before):   Update with actual/closing lineups + closing odds + CLV
 * Phase 3 (15min before): Final pick — one game decision engine
 * 
 * This script handles Phase 2 and Phase 3.
 * Phase 1 is handled by the existing ensemble-model.js.
 * 
 * Usage:
 *   node worker/pre-match-update.js phase2   # Run 1hr before kickoff updates
 *   node worker/pre-match-update.js phase3   # Run 15min before — final pick
 *   node worker/pre-match-update.js status   # Show pipeline status
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

const https = require('https');
const CONVEX_URL = 'https://limitless-mole-387.convex.cloud';

function convexMutate(mutationPath, args) {
  return new Promise((resolve) => {
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

const PIPELINE_PATH = path.join(__dirname, '../data/pipeline-state.json');
const PREDICTIONS_PATH = path.join(__dirname, '../data/predicted-lineups.json');
const CLV_PATH = path.join(__dirname, '../data/clv-features.json');

// ─── Pipeline State ──────────────────────────────────────────────────
function loadPipelineState() {
  if (fs.existsSync(PIPELINE_PATH)) {
    return JSON.parse(fs.readFileSync(PIPELINE_PATH, 'utf8'));
  }
  return { phases: {}, picks: [], lastRun: null };
}

function savePipelineState(state) {
  fs.writeFileSync(PIPELINE_PATH, JSON.stringify(state, null, 2));
}

// ─── Load CLV Features ──────────────────────────────────────────────
function loadCLVFeatures() {
  if (fs.existsSync(CLV_PATH)) {
    return JSON.parse(fs.readFileSync(CLV_PATH, 'utf8')).features || {};
  }
  return {};
}

// ─── Load Predicted Lineups ─────────────────────────────────────────
function loadPredictedLineups() {
  if (fs.existsSync(PREDICTIONS_PATH)) {
    const data = JSON.parse(fs.readFileSync(PREDICTIONS_PATH, 'utf8'));
    const map = {};
    for (const p of data.predictions || []) {
      map[p.fixture_id] = p;
    }
    return map;
  }
  return {};
}

// ─── Phase 2: Pre-Match Update (1hr before kickoff) ──────────────────
async function runPhase2() {
  console.log('=== Phase 2: Pre-Match Update (1hr before kickoff) ===\n');
  
  const now = new Date();
  const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const in30m = new Date(now.getTime() + 30 * 60 * 1000);
  
  // Get fixtures between 30min and 2h from now
  const { data: fixtures } = await sb
    .from('fixtures')
    .select('*')
    .eq('status', 'scheduled')
    .gte('kickoff_time', in30m.toISOString())
    .lte('kickoff_time', in2h.toISOString())
    .order('kickoff_time');
  
  if (!fixtures || fixtures.length === 0) {
    console.log('No fixtures in the 30min-2h window');
    return;
  }
  
  console.log(`Found ${fixtures.length} fixtures to update\n`);
  
  // Get team names
  const teamIds = [...new Set(fixtures.flatMap(f => [f.home_team_id, f.away_team_id]))];
  const { data: teams } = await sb.from('teams').select('id, canonical_name').in('id', teamIds);
  const teamMap = {};
  teams?.forEach(t => { teamMap[t.id] = t.canonical_name; });
  
  // Load existing data
  const clvFeatures = loadCLVFeatures();
  const lineups = loadPredictedLineups();
  const state = loadPipelineState();
  
  const updates = [];
  
  for (const fixture of fixtures) {
    const home = teamMap[fixture.home_team_id] || 'Unknown';
    const away = teamMap[fixture.away_team_id] || 'Unknown';
    const fixtureKey = fixture.id;
    const kickoff = new Date(fixture.kickoff_time);
    const hoursUntil = (kickoff - now) / (1000 * 60 * 60);
    
    console.log(`  ${home} vs ${away} (${hoursUntil.toFixed(1)}h to kickoff)`);
    
    // Get existing predictions for this fixture
    const { data: existingPreds } = await sb
      .from('predictions')
      .select('*')
      .eq('fixture_id', fixtureKey);
    
    if (!existingPreds || existingPreds.length === 0) {
      console.log('    No existing predictions — skip');
      continue;
    }
    
    // Get closing odds
    const { data: odds } = await sb
      .from('odds_snapshots')
      .select('*')
      .eq('fixture_id', fixtureKey);
    
    const closingOdds = calculateAverageOdds(odds || []);
    
    // Get CLV features
    const clv = clvFeatures[fixtureKey] || {};
    
    // Get predicted lineup
    const lineupData = lineups[fixtureKey];
    
    // Lineup adjustment factor
    let lineupAdjustment = 0;
    if (lineupData) {
      const homeImpact = lineupData.predicted_lineup.home.lineupImpact;
      const awayImpact = lineupData.predicted_lineup.away.lineupImpact;
      // Home team losing key players hurts home advantage
      lineupAdjustment = (homeImpact.keyPlayersMissing - awayImpact.keyPlayersMissing) * 0.03;
    }
    
    // CLV adjustment
    let clvAdjustment = 0;
    if (clv.clvHome !== undefined) {
      // If closing odds shortened for home (negative CLV), sharp money likes home
      clvAdjustment = clv.clvHome < -0.05 ? 0.02 : clv.clvHome > 0.05 ? -0.02 : 0;
    }
    
    // Update each prediction
    for (const pred of existingPreds) {
      const oldProb = pred.model_probability || 0.5;
      let newProb = oldProb;
      
      // Apply lineup adjustment
      if (pred.selection === 'Home') {
        newProb += lineupAdjustment;
        newProb += clvAdjustment;
      } else if (pred.selection === 'Away') {
        newProb -= lineupAdjustment;
        newProb -= clvAdjustment;
      } else if (pred.selection === 'Draw') {
        // Draw adjusts inversely to strength difference
        newProb -= Math.abs(lineupAdjustment) * 0.3;
      }
      
      // Clamp
      newProb = Math.max(0.05, Math.min(0.95, newProb));
      
      const probChanged = Math.abs(newProb - oldProb) > 0.005;
      
      updates.push({
        fixture_id: fixtureKey,
        home_team: home,
        away_team: away,
        market: pred.market,
        selection: pred.selection,
        old_probability: oldProb,
        new_probability: Math.round(newProb * 10000) / 10000,
        lineup_adjustment: Math.round(lineupAdjustment * 10000) / 10000,
        clv_adjustment: Math.round(clvAdjustment * 10000) / 10000,
        changed: probChanged,
        closing_odds: closingOdds[pred.selection?.toLowerCase()] || 0,
        hours_until_kickoff: Math.round(hoursUntil * 10) / 10,
      });
      
      if (probChanged) {
        // Update in Supabase
        await sb
          .from('predictions')
          .update({ 
            model_probability: Math.round(newProb * 10000) / 10000,
            model_version: 'v5.1-phase2',
          })
          .eq('id', pred.id);
      }
    }
    
    const updated = updates.filter(u => u.changed);
    console.log(`    Updated ${updated.length} predictions (lineup: ${lineupAdjustment > 0 ? '+' : ''}${lineupAdjustment.toFixed(3)}, CLV: ${clvAdjustment > 0 ? '+' : ''}${clvAdjustment.toFixed(3)})`);
    
    // Store phase2 result
    state.phases[`${fixtureKey}_phase2`] = {
      updated_at: now.toISOString(),
      hours_until_kickoff: hoursUntil,
      updates_count: updated.length,
      lineup_adjustment: lineupAdjustment,
      clv_adjustment: clvAdjustment,
    };
  }
  
  savePipelineState(state);
  
  const totalUpdated = updates.filter(u => u.changed).length;
  console.log(`\n=== Phase 2 Complete: ${totalUpdated} predictions updated across ${fixtures.length} fixtures ===`);
  
  return updates;
}

// ─── Phase 3: Final Pick (15min before kickoff) ──────────────────────
async function runPhase3() {
  console.log('=== Phase 3: Final Pick (One Game Decision Engine) ===\n');
  
  const now = new Date();
  const in45m = new Date(now.getTime() + 45 * 60 * 1000);
  const in5m = new Date(now.getTime() + 5 * 60 * 1000);
  
  // Get fixtures between 5min and 45min from now
  const { data: fixtures } = await sb
    .from('fixtures')
    .select('*')
    .eq('status', 'scheduled')
    .gte('kickoff_time', in5m.toISOString())
    .lte('kickoff_time', in45m.toISOString())
    .order('kickoff_time');
  
  if (!fixtures || fixtures.length === 0) {
    console.log('No fixtures in the 5-45min window');
    return;
  }
  
  console.log(`Found ${fixtures.length} candidates for final pick\n`);
  
  // Get team names
  const teamIds = [...new Set(fixtures.flatMap(f => [f.home_team_id, f.away_team_id]))];
  const { data: teams } = await sb.from('teams').select('id, canonical_name').in('id', teamIds);
  const teamMap = {};
  teams?.forEach(t => { teamMap[t.id] = t.canonical_name; });
  
  const clvFeatures = loadCLVFeatures();
  const state = loadPipelineState();
  
  // Score each fixture
  const candidates = [];
  
  for (const fixture of fixtures) {
    const home = teamMap[fixture.home_team_id] || 'Unknown';
    const away = teamMap[fixture.away_team_id] || 'Unknown';
    const fixtureKey = fixture.id;
    const kickoff = new Date(fixture.kickoff_time);
    const minutesUntil = (kickoff - now) / (1000 * 60);
    
    // Get latest predictions
    const { data: preds } = await sb
      .from('predictions')
      .select('*')
      .eq('fixture_id', fixtureKey)
      .order('model_probability', { ascending: false });
    
    if (!preds || preds.length === 0) continue;
    
    // Find best prediction
    const best = preds[0];
    const bestProb = best.model_probability || 0;
    
    // Get odds
    const { data: odds } = await sb
      .from('odds_snapshots')
      .select('*')
      .eq('fixture_id', fixtureKey);
    
    const avgOdds = calculateAverageOdds(odds || []);
    const selectionOdds = avgOdds[best.selection?.toLowerCase()] || 0;
    const impliedProb = selectionOdds > 0 ? 1 / selectionOdds : 0;
    
    // CLV features
    const clv = clvFeatures[fixtureKey] || {};
    
    // Edge calculation
    const edge = bestProb - impliedProb;
    const edgePct = impliedProb > 0 ? (edge / impliedProb * 100) : 0;
    
    // Composite score for ranking
    const compositeScore = 
      bestProb * 40 +                          // Model confidence (40%)
      Math.max(0, edge) * 100 * 30 +           // Edge (30%)
      (clv.consensusStrength || 0.5) * 15 +     // Market consensus (15%)
      (clv.sharpMoneyHome === 1 && best.selection === 'Home' ? 15 : 
       clv.sharpMoneyAway === 1 && best.selection === 'Away' ? 15 : 0);  // Sharp money (15%)
    
    candidates.push({
      fixture_id: fixtureKey,
      match: `${home} vs ${away}`,
      home,
      away,
      kickoff: fixture.kickoff_time,
      minutesUntil: Math.round(minutesUntil),
      bestPrediction: {
        market: best.market,
        selection: best.selection,
        probability: bestProb,
        modelVersion: best.model_version,
      },
      odds: {
        selection: selectionOdds,
        impliedProb: Math.round(impliedProb * 10000) / 10000,
        edge: Math.round(edge * 10000) / 10000,
        edgePct: Math.round(edgePct * 100) / 100,
      },
      clv: {
        sharpMoney: clv.sharpestSide || 'none',
        consensusStrength: clv.consensusStrength || 0,
        bestCLV: clv.bestCLV || 0,
      },
      compositeScore: Math.round(compositeScore * 100) / 100,
      confidenceTier: bestProb >= 0.70 ? 'ELITE' : bestProb >= 0.60 ? 'HIGH' : 'MEDIUM',
    });
  }
  
  // Sort by composite score
  candidates.sort((a, b) => b.compositeScore - a.compositeScore);
  
  console.log('=== Candidate Rankings ===\n');
  candidates.forEach((c, i) => {
    console.log(`  #${i+1} [${c.confidenceTier}] ${c.match}`);
    console.log(`     ${c.bestPrediction.selection} ${c.bestPrediction.market} @ ${c.bestPrediction.probability.toFixed(3)} | Odds: ${c.odds.selection.toFixed(2)} | Edge: ${(c.odds.edge * 100).toFixed(1)}% | CLV: ${c.clv.sharpMoney} | Score: ${c.compositeScore}`);
  });
  
  if (candidates.length === 0) {
    console.log('No candidates found');
    return;
  }
  
  // THE ONE GAME PICK
  const thePick = candidates[0];
  
  console.log('\n=== THE ONE GAME PICK ===');
  console.log(`  Match: ${thePick.match}`);
  console.log(`  Pick: ${thePick.bestPrediction.selection} ${thePick.bestPrediction.market}`);
  console.log(`  Model Confidence: ${(thePick.bestPrediction.probability * 100).toFixed(1)}%`);
  console.log(`  Bookmaker Odds: ${thePick.odds.selection.toFixed(2)}`);
  console.log(`  Implied Probability: ${(thePick.odds.impliedProb * 100).toFixed(1)}%`);
  console.log(`  Edge: ${(thePick.odds.edge * 100).toFixed(1)}%`);
  console.log(`  CLV Signal: ${thePick.clv.sharpMoney}`);
  console.log(`  Confidence Tier: ${thePick.confidenceTier}`);
  console.log(`  Minutes to Kickoff: ${thePick.minutesUntil}`);
  console.log(`  Decision: ${thePick.odds.edge > 0.02 && thePick.confidenceTier !== 'MEDIUM' ? 'BET' : 'WATCH'}`);
  
  // Save pick
  const pickRecord = {
    ...thePick,
    decided_at: now.toISOString(),
    decision: thePick.odds.edge > 0.02 && thePick.confidenceTier !== 'MEDIUM' ? 'BET' : 'WATCH',
    all_candidates: candidates,
  };
  
  state.picks.push(pickRecord);
  savePipelineState(state);
  
  // Store in Convex
  try {
    await convexMutate('predictions:bulkInsertOdds', {
      odds: [{
        fixtureId: thePick.fixture_id,
        bookmaker: 'PICK_ENGINE',
        market: 'h2h',
        selection: thePick.bestPrediction.selection,
        odds: thePick.odds.selection,
        impliedProb: thePick.odds.impliedProb,
        timestamp: now.toISOString(),
      }],
    });
  } catch {}
  
  return pickRecord;
}

// ─── Status Command ──────────────────────────────────────────────────
async function showStatus() {
  console.log('=== Pipeline Status ===\n');
  
  const state = loadPipelineState();
  const clv = loadCLVFeatures();
  const lineups = loadPredictedLineups();
  
  console.log(`Pipeline state:`);
  console.log(`  Last run: ${state.lastRun || 'never'}`);
  console.log(`  Phases completed: ${Object.keys(state.phases).length}`);
  console.log(`  Picks made: ${state.picks.length}`);
  
  console.log(`\nData:`);
  console.log(`  CLV features: ${Object.keys(clv).length} fixtures`);
  console.log(`  Predicted lineups: ${lineups ? Object.keys(lineups).length : 0} fixtures`);
  
  // Recent picks
  if (state.picks.length > 0) {
    console.log(`\nRecent picks:`);
    state.picks.slice(-5).forEach(p => {
      console.log(`  ${p.decided_at?.slice(0, 16)}: ${p.match} — ${p.bestPrediction.selection} (${p.decision})`);
    });
  }
  
  // Upcoming fixtures summary
  const now = new Date();
  const { count } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gte('kickoff_time', now.toISOString());
  
  console.log(`\nUpcoming fixtures: ${count}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────
function calculateAverageOdds(odds) {
  const result = { home: 0, draw: 0, away: 0 };
  const counts = { home: 0, draw: 0, away: 0 };
  
  for (const o of odds) {
    const sel = (o.selection || '').toLowerCase();
    if (sel === 'home' || sel === '1') {
      result.home += o.odds_value || o.odds || 0;
      counts.home++;
    } else if (sel === 'draw' || sel === 'x') {
      result.draw += o.odds_value || o.odds || 0;
      counts.draw++;
    } else if (sel === 'away' || sel === '2') {
      result.away += o.odds_value || o.odds || 0;
      counts.away++;
    }
  }
  
  if (counts.home > 0) result.home /= counts.home;
  if (counts.draw > 0) result.draw /= counts.draw;
  if (counts.away > 0) result.away /= counts.away;
  
  return result;
}

// ─── Main ────────────────────────────────────────────────────────────
const command = process.argv[2] || 'status';

switch (command) {
  case 'phase2':
    runPhase2().catch(console.error);
    break;
  case 'phase3':
    runPhase3().catch(console.error);
    break;
  case 'status':
    showStatus().catch(console.error);
    break;
  default:
    console.log('Usage: node worker/pre-match-update.js [phase2|phase3|status]');
}
