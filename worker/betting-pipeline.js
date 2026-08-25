#!/usr/bin/env node
/**
 * ODDLY Betting Pipeline Orchestrator
 * 
 * Master pipeline that runs all phases at the right time:
 * 
 * - 24h before: Generate predicted lineups + initial odds snapshot
 * - 1h before:  CLV snapshot + pre-match update (Phase 2)
 * - 15min before: Final pick — one game decision (Phase 3)
 * - Post-match: Settlement
 * 
 * Usage:
 *   node worker/betting-pipeline.js run          # Auto-detect what needs to run
 *   node worker/betting-pipeline.js predict      # Run ensemble prediction for upcoming
 *   node worker/betting-pipeline.js update       # Run Phase 2 (1hr update)
 *   node worker/betting-pipeline.js pick         # Run Phase 3 (final pick)
 *   node worker/betting-pipeline.js settle       # Run settlement
 *   node worker/betting-pipeline.js full         # Run all phases manually
 *   node worker/betting-pipeline.js status       # Show pipeline status
 */

const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
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

const WORKER_DIR = __dirname;
const STATE_PATH = path.join(__dirname, '../data/pipeline-state.json');

function loadPipelineState() {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  }
  return { phases: {}, picks: [], lastRun: null };
}

function runScript(name, args = '') {
  const scriptPath = path.join(WORKER_DIR, name);
  console.log(`\n>>> Running ${name} ${args}...`);
  try {
    const output = execSync(`node "${scriptPath}" ${args}`, {
      cwd: path.join(WORKER_DIR, '..'),
      timeout: 300000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(output);
    return { success: true, output };
  } catch (e) {
    console.error(`  Error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ─── Auto-detect what to run ─────────────────────────────────────────
async function autoDetect() {
  console.log('=== ODDLY Betting Pipeline — Auto Mode ===\n');
  
  const now = new Date();
  const state = loadPipelineState();
  
  // Get upcoming fixtures grouped by time window
  const windows = {
    predict: { from: new Date(now.getTime() + 12 * 60 * 60 * 1000), to: new Date(now.getTime() + 48 * 60 * 60 * 1000) },
    update:  { from: new Date(now.getTime() + 30 * 60 * 1000), to: new Date(now.getTime() + 2 * 60 * 60 * 1000) },
    pick:    { from: new Date(now.getTime() + 5 * 60 * 1000), to: new Date(now.getTime() + 45 * 60 * 1000) },
    settle:  { from: new Date(now.getTime() - 2 * 60 * 60 * 1000), to: now },
  };
  
  for (const [phase, window] of Object.entries(windows)) {
    const { count } = await sb
      .from('fixtures')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'scheduled')
      .gte('kickoff_time', window.from.toISOString())
      .lte('kickoff_time', window.to.toISOString());
    
    console.log(`  ${phase}: ${count} fixtures in window`);
  }
  
  // Run appropriate phases
  const results = {};
  
  // Always try settlement first
  const { count: toSettle } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'finished')
    .gte('updated_at', new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString());
  
  if (toSettle > 0) {
    console.log(`\n${toSettle} recently finished fixtures — running settlement`);
    results.settle = runScript('settle-predictions.js');
  }
  
  // Check for predictions needed (12-48h out)
  const { count: needPred } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gte('kickoff_time', windows.predict.from.toISOString())
    .lte('kickoff_time', windows.predict.to.toISOString());
  
  if (needPred > 0) {
    console.log(`\n${needPred} fixtures need predictions — running ensemble`);
    results.predict = runScript('ensemble-model.js');
  }
  
  // Check for CLV snapshots
  const { count: needCLV } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gte('kickoff_time', windows.update.from.toISOString())
    .lte('kickoff_time', windows.update.to.toISOString());
  
  if (needCLV > 0) {
    console.log(`\n${needCLV} fixtures need CLV snapshot`);
    results.clv = runScript('clv-tracker.js', 'snapshot');
    results.clvFeatures = runScript('clv-tracker.js', 'compute');
  }
  
  // Check for pre-match updates (30min-2h out)
  const { count: needUpdate } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gte('kickoff_time', windows.update.from.toISOString())
    .lte('kickoff_time', windows.update.to.toISOString());
  
  if (needUpdate > 0) {
    console.log(`\n${needUpdate} fixtures need pre-match update — Phase 2`);
    results.phase2 = runScript('pre-match-update.js', 'phase2');
  }
  
  // Check for final picks (5-45min out)
  const { count: needPick } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .gte('kickoff_time', windows.pick.from.toISOString())
    .lte('kickoff_time', windows.pick.to.toISOString());
  
  if (needPick > 0) {
    console.log(`\n${needPick} fixtures in pick window — Phase 3`);
    results.phase3 = runScript('pre-match-update.js', 'phase3');
  }
  
  // Update state
  state.lastRun = now.toISOString();
  state.lastResults = results;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  
  console.log('\n=== Pipeline Complete ===');
  return results;
}

// ─── Status ──────────────────────────────────────────────────────────
async function showStatus() {
  console.log('=== ODDLY Betting Pipeline Status ===\n');
  
  const now = new Date();
  
  // Fixture counts
  const { count: scheduled } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'scheduled');
  
  const { count: finished } = await sb
    .from('fixtures')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'finished');
  
  const { count: predictions } = await sb
    .from('predictions')
    .select('*', { count: 'exact', head: true });
  
  const { count: odds } = await sb
    .from('odds_snapshots')
    .select('*', { count: 'exact', head: true });
  
  console.log('Database:');
  console.log(`  Scheduled fixtures: ${scheduled}`);
  console.log(`  Finished fixtures: ${finished}`);
  console.log(`  Total predictions: ${predictions}`);
  console.log(`  Odds snapshots: ${odds}`);
  
  // Pipeline state
  if (fs.existsSync(STATE_PATH)) {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    console.log(`\nPipeline:`);
    console.log(`  Last run: ${state.lastRun || 'never'}`);
    console.log(`  Phases completed: ${Object.keys(state.phases).length}`);
    console.log(`  Picks made: ${state.picks.length}`);
  }
  
  // Upcoming windows
  const windows = [
    { name: '15-45min (Pick)', from: new Date(now.getTime() + 15 * 60000), to: new Date(now.getTime() + 45 * 60000) },
    { name: '30min-2h (Update)', from: new Date(now.getTime() + 30 * 60000), to: new Date(now.getTime() + 2 * 3600000) },
    { name: '12-48h (Predict)', from: new Date(now.getTime() + 12 * 3600000), to: new Date(now.getTime() + 48 * 3600000) },
  ];
  
  console.log(`\nUpcoming windows:`);
  for (const w of windows) {
    const { count } = await sb
      .from('fixtures')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'scheduled')
      .gte('kickoff_time', w.from.toISOString())
      .lte('kickoff_time', w.to.toISOString());
    console.log(`  ${w.name}: ${count} fixtures`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────
const command = process.argv[2] || 'status';

switch (command) {
  case 'run':
  case 'auto':
    autoDetect().catch(console.error);
    break;
  case 'predict':
    runScript('ensemble-model.js');
    break;
  case 'update':
    runScript('pre-match-update.js', 'phase2');
    break;
  case 'pick':
    runScript('pre-match-update.js', 'phase3');
    break;
  case 'settle':
    runScript('settle-predictions.js');
    break;
  case 'full':
    console.log('Running full pipeline...\n');
    runScript('ensemble-model.js');
    runScript('clv-tracker.js', 'snapshot');
    runScript('clv-tracker.js', 'compute');
    runScript('predicted-lineups.js');
    runScript('pre-match-update.js', 'phase2');
    runScript('pre-match-update.js', 'phase3');
    runScript('settle-predictions.js');
    break;
  case 'status':
    showStatus().catch(console.error);
    break;
  default:
    console.log('Usage: node worker/betting-pipeline.js [run|predict|update|pick|settle|full|status]');
}
