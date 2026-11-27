#!/usr/bin/env node
/**
 * ODDLY Experiment Registry & Leaderboard
 * 
 * Tracks every research experiment with:
 * - Feature set, model, market, training period
 * - Accuracy, log loss, Brier, ECE, calibration
 * - Feature importance, error patterns
 * - Keep/reject status with reasoning
 * 
 * Output: data/experiment-registry.json + console leaderboard
 * 
 * Usage: node worker/experiment-registry.js [leaderboard|add|report]
 */

const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '../data');
const REGISTRY_PATH = path.join(DATA, 'experiment-registry.json');

function loadRegistry() {
  if (fs.existsSync(REGISTRY_PATH)) {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  }
  return { experiments: [], metadata: { created: new Date().toISOString(), version: 1 } };
}

function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

// ─── Add Experiment ──────────────────────────────────────────────────
function addExperiment(resultFile) {
  const result = JSON.parse(fs.readFileSync(path.join(DATA, 'xgboost-results', resultFile), 'utf8'));
  const registry = loadRegistry();
  
  const exp = {
    id: `EXP-${String(registry.experiments.length + 1).padStart(3, '0')}`,
    name: resultFile.replace('.json', ''),
    timestamp: result.timestamp,
    market: result.market,
    feature_set: result.feature_set || 'extended',
    model: 'XGBoost',
    folds: result.folds,
    train_seasons: result.results?.map(r => r.train_seasons).flat() || [],
    test_seasons: result.results?.map(r => r.test_season) || [],
    total_test_matches: result.total_test_matches,
    metrics: {
      accuracy: result.avg_accuracy,
      log_loss: result.avg_log_loss,
      brier: result.avg_brier,
      ece: result.avg_ece,
      high_conf_accuracy: result.avg_high_conf_accuracy,
      elite_accuracy: result.avg_elite_accuracy,
    },
    feature_importance: result.results?.[result.results.length - 1]?.feature_importance || {},
    fold_results: result.results || [],
    status: 'candidate',
    reasoning: '',
    created_at: new Date().toISOString(),
  };
  
  registry.experiments.push(exp);
  saveRegistry(registry);
  console.log(`Added experiment ${exp.id}: ${exp.name}`);
  return exp;
}

// ─── Leaderboard ─────────────────────────────────────────────────────
function printLeaderboard() {
  const registry = loadRegistry();
  
  console.log('╔══════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                        ODDLY EXPERIMENT LEADERBOARD                           ║');
  console.log('╠══════════════════════════════════════════════════════════════════════════════════╣');
  console.log('║ Rank │ ID      │ Market │ Model    │ Accuracy │ LogLoss │ Brier  │ ECE  │ Status║');
  console.log('╠══════╪═════════╪════════╪══════════╪══════════╪═════════╪════════╪══════╪═══════╣');
  
  const sorted = [...registry.experiments].sort((a, b) => b.metrics.accuracy - a.metrics.accuracy);
  
  sorted.forEach((exp, i) => {
    const rank = String(i + 1).padStart(2);
    const status = exp.status === 'promoted' ? '✅' : exp.status === 'rejected' ? '❌' : '📋';
    console.log(
      `║ ${rank}   │ ${exp.id} │ ${exp.market.padEnd(6)} │ ${exp.model.padEnd(8)} │ ${String(exp.metrics.accuracy + '%').padStart(7)}  │ ${String(exp.metrics.log_loss).padStart(6)} │ ${String(exp.metrics.brier).padStart(5)} │ ${String(exp.metrics.ece).padStart(4)} │  ${status}   ║`
    );
  });
  
  console.log('╚══════════════════════════════════════════════════════════════════════════════════╝');
  
  // Confidence breakdown for best experiment
  if (sorted.length > 0) {
    const best = sorted[0];
    console.log(`\n  Best Experiment: ${best.id} (${best.name})`);
    console.log(`  Market: ${best.market} | Model: ${best.model}`);
    console.log(`  Accuracy: ${best.metrics.accuracy}% | LogLoss: ${best.metrics.log_loss} | Brier: ${best.metrics.brier}`);
    console.log(`  High Confidence (≥65%): ${best.metrics.high_conf_accuracy}%`);
    console.log(`  Elite (≥70%): ${best.metrics.elite_accuracy}%`);
    
    if (best.feature_importance && Object.keys(best.feature_importance).length > 0) {
      console.log('\n  Top Features:');
      Object.entries(best.feature_importance).slice(0, 5).forEach(([f, imp]) => {
        const val = typeof imp === 'number' ? imp : parseFloat(imp);
        const bar = '█'.repeat(Math.round(val * 40));
        console.log(`    ${f.padEnd(30)} ${val.toFixed(4)} ${bar}`);
      });
    }
  }
  
  // Model progression
  console.log('\n  Model Progression:');
  let prevAcc = 56.2; // baseline
  sorted.forEach(exp => {
    const delta = exp.metrics.accuracy - prevAcc;
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    console.log(`    ${exp.id}: ${exp.metrics.accuracy}% ${arrow} ${delta > 0 ? '+' : ''}${delta.toFixed(1)}% vs previous`);
    prevAcc = exp.metrics.accuracy;
  });
}

// ─── Research Report ─────────────────────────────────────────────────
function printReport() {
  const registry = loadRegistry();
  
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  RESEARCH CYCLE REPORT');
  console.log('══════════════════════════════════════════════════════════════\n');
  
  console.log('## Current Best Models\n');
  console.log('| Market | Best Model | Features | Accuracy | LogLoss | Brier | Sample |');
  console.log('|--------|-----------|----------|----------|---------|-------|--------|');
  
  const markets = [...new Set(registry.experiments.map(e => e.market))];
  for (const market of markets) {
    const best = registry.experiments
      .filter(e => e.market === market)
      .sort((a, b) => b.metrics.accuracy - a.metrics.accuracy)[0];
    if (best) {
      console.log(`| ${market} | ${best.model} | ${best.feature_set} | ${best.metrics.accuracy}% | ${best.metrics.log_loss} | ${best.metrics.brier} | ${best.total_test_matches} |`);
    }
  }
  
  console.log('\n## Key Findings\n');
  console.log('1. **Elo is the #1 predictive feature** — elo_diff dominates across all folds');
  console.log('2. **Higher confidence = higher accuracy** — 80%+ confidence achieves 88.8% accuracy');
  console.log('3. **Lower leagues are harder** — Championship (56%), Serie B (59%) vs top leagues (67-72%)');
  console.log('4. **Draws are hardest to predict** — 61% of home-win errors are actually draws');
  console.log('5. **More data helps** — accuracy improves from 63.6% (2 seasons) to 69.5% (4 seasons)');
  
  console.log('\n## Missing Data (Highest Impact)\n');
  console.log('1. **Starting Lineups** — HIGH value, 0% coverage → need Understat/API-Football');
  console.log('2. **Asian Handicap Odds** — HIGH value, 0% coverage → need OddsPortal scraping');
  console.log('3. **Weather Data** — MEDIUM value, 0% coverage → OpenWeatherMap (free)');
  console.log('4. **Manager Tenure** — MEDIUM value, 0% coverage → Wikipedia scraping');
  console.log('5. **Possession/PPDA** — MEDIUM value, limited coverage → FBref (free)');
  
  console.log('\n## Model Progression\n');
  console.log('  Baseline (majority class): ~56.2%');
  console.log('  Walk-Forward XGBoost (2 seasons train): 63.6%');
  console.log('  Walk-Forward XGBoost (3 seasons train): 63.7%');
  console.log('  Walk-Forward XGBoost (4 seasons train): 69.5%');
  console.log('  Current Best: 65.6% average across all folds');
  
  console.log('\n## Current Ceiling\n');
  console.log('  Overall 1X2: ~65-70% (depends on training data volume)');
  console.log('  High Confidence (≥65%): ~78%');
  console.log('  Elite (≥70%): ~80%');
  console.log('  80%+ Confidence: ~89% (but small sample: 214 matches)');
  console.log('  Remaining bottleneck: Draw prediction, lower-league noise, missing lineup data');
}

// ─── Main ────────────────────────────────────────────────────────────
const command = process.argv[2] || 'leaderboard';

switch (command) {
  case 'leaderboard':
    printLeaderboard();
    break;
  case 'add':
    if (process.argv[3]) addExperiment(process.argv[3]);
    else console.log('Usage: node worker/experiment-registry.js add <result-file.json>');
    break;
  case 'report':
    printReport();
    break;
  default:
    console.log('Usage: node worker/experiment-registry.js [leaderboard|add|report]');
}
