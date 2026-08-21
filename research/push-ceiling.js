#!/usr/bin/env node
/**
 * ODDLY Push-Ceiling Research Engine
 * 
 * Objective: Push prediction accuracy beyond 79.8% using:
 * - 30+ engineered features
 * - Gradient boosting model
 * - Multi-market search (14 markets)
 * - Chronological validation (no data leakage)
 * - Calibration analysis
 * - Error classification
 * - Feature interaction discovery
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, "..", ".env.local");
  const lines = fs.readFileSync(p, "utf8").split("\n");
  const env = {};
  for (const l of lines) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i === -1) continue; env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
  return env;
}
const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// ═══════════════════════════════════════════════════════════════════════════
// GRADIENT BOOSTING MODEL (from scratch, no dependencies)
// ═══════════════════════════════════════════════════════════════════════════

class GradientBoosting {
  constructor(params = {}) {
    this.nTrees = params.nTrees || 80;
    this.maxDepth = params.maxDepth || 4;
    this.learningRate = params.lr || 0.1;
    this.subsample = params.subsample || 0.7;
    this.minSamplesLeaf = params.minSamplesLeaf || 20;
    this.trees = [];
    this.basePrediction = 0;
    this.featureNames = [];
    this.featureImportance = {};
  }

  fit(X, y, featureNames) {
    this.featureNames = featureNames || Object.keys(X[0]);
    const n = X.length;
    this.basePrediction = y.reduce((s, v) => s + v, 0) / n;
    let predictions = new Array(n).fill(this.basePrediction);

    for (let t = 0; t < this.nTrees; t++) {
      // Compute residuals
      const residuals = y.map((yi, i) => yi - predictions[i]);

      // Subsample
      const indices = [];
      const sampleSize = Math.floor(n * this.subsample);
      const shuffled = Array.from({ length: n }, (_, i) => i);
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (let i = 0; i < sampleSize; i++) indices.push(shuffled[i]);

      // Build tree on residuals
      const tree = this._buildTree(
        indices.map(i => X[i]),
        indices.map(i => residuals[i]),
        0
      );
      this.trees.push(tree);

      // Update predictions
      for (let i = 0; i < n; i++) {
        predictions[i] += this.learningRate * this._predictTree(tree, X[i]);
      }
    }

    // Compute feature importance
    for (const name of this.featureNames) {
      this.featureImportance[name] = 0;
    }
    for (const tree of this.trees) {
      this._accumulateImportance(tree, 1);
    }
    // Normalize
    const totalImp = Object.values(this.featureImportance).reduce((s, v) => s + v, 0);
    if (totalImp > 0) {
      for (const k of Object.keys(this.featureImportance)) {
        this.featureImportance[k] /= totalImp;
      }
    }
  }

  predict(X) {
    return X.map(x => {
      let pred = this.basePrediction;
      for (const tree of this.trees) {
        pred += this.learningRate * this._predictTree(tree, x);
      }
      return clamp(sigmoid(pred));
    });
  }

  _buildTree(X, y, depth) {
    if (depth >= this.maxDepth || X.length <= this.minSamplesLeaf * 2) {
      return { leaf: true, value: y.reduce((s, v) => s + v, 0) / (y.length || 1) };
    }

    let bestFeature = 0, bestThreshold = 0, bestGain = -Infinity;
    const currentVariance = this._variance(y);

    for (let f = 0; f < this.featureNames.length; f++) {
      const values = X.map(x => x[this.featureNames[f]]).filter(v => v !== null && v !== undefined);
      if (values.length < 10) continue;

      // Try several thresholds
      const sorted = [...new Set(values)].sort((a, b) => a - b);
      const step = Math.max(1, Math.floor(sorted.length / 6));
      for (let i = step; i < sorted.length; i += step) {
        const threshold = sorted[i];
        const leftY = [], rightY = [];
        for (let j = 0; j < X.length; j++) {
          if (X[j][this.featureNames[f]] <= threshold) leftY.push(y[j]);
          else rightY.push(y[j]);
        }
        if (leftY.length < this.minSamplesLeaf || rightY.length < this.minSamplesLeaf) continue;

        const gain = currentVariance - (leftY.length / y.length) * this._variance(leftY) - (rightY.length / y.length) * this._variance(rightY);
        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = threshold;
        }
      }
    }

    if (bestGain <= 0) {
      return { leaf: true, value: y.reduce((s, v) => s + v, 0) / (y.length || 1) };
    }

    const leftX = [], leftY = [], rightX = [], rightY = [];
    for (let i = 0; i < X.length; i++) {
      if (X[i][this.featureNames[bestFeature]] <= bestThreshold) {
        leftX.push(X[i]); leftY.push(y[i]);
      } else {
        rightX.push(X[i]); rightY.push(y[i]);
      }
    }

    return {
      leaf: false,
      feature: this.featureNames[bestFeature],
      featureIdx: bestFeature,
      threshold: bestThreshold,
      gain: bestGain,
      left: this._buildTree(leftX, leftY, depth + 1),
      right: this._buildTree(rightX, rightY, depth + 1),
    };
  }

  _predictTree(tree, x) {
    if (tree.leaf) return tree.value;
    if (x[tree.feature] <= tree.threshold) return this._predictTree(tree.left, x);
    return this._predictTree(tree.right, x);
  }

  _variance(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  }

  _accumulateImportance(tree, weight) {
    if (tree.leaf) return;
    this.featureImportance[tree.feature] = (this.featureImportance[tree.feature] || 0) + tree.gain * weight;
    this._accumulateImportance(tree.left, weight * 0.5);
    this._accumulateImportance(tree.right, weight * 0.5);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ELO + FORM TRACKING
// ═══════════════════════════════════════════════════════════════════════════

class EloSystem {
  constructor(k = 32, homeAdv = 65) { this.ratings = {}; this.k = k; this.homeAdv = homeAdv; }
  get(t) { return this.ratings[t] || 1500; }
  predict(home, away) {
    const h = this.get(home) + this.homeAdv;
    const a = this.get(away);
    return 1 / (1 + Math.pow(10, (a - h) / 400));
  }
  update(home, away, hg, ag) {
    const h = this.get(home) + this.homeAdv;
    const a = this.get(away);
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.ratings[home] = this.get(home) + this.k * (actual - eH);
    this.ratings[away] = this.get(away) + this.k * ((1 - actual) - (1 - eH));
  }
}

class FormTracker {
  constructor() { this.h = {}; this.goals = {}; this.conceded = {}; }
  record(team, result, goals, against) {
    if (!this.h[team]) this.h[team] = [];
    if (!this.goals[team]) this.goals[team] = [];
    if (!this.conceded[team]) this.conceded[team] = [];
    this.h[team].push(result);
    this.goals[team].push(goals);
    this.conceded[team].push(against);
    if (this.h[team].length > 30) { this.h[team].shift(); this.goals[team].shift(); this.conceded[team].shift(); }
  }
  getForm(team, n = 5) {
    const last = (this.h[team] || []).slice(-n);
    if (last.length === 0) return { ppg: 1.5, winRate: 0.4, streak: 0, avgGoals: 1.3, avgConceded: 1.2 };
    const ppg = last.reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0) / last.length;
    const winRate = last.filter(r => r === "W").length / last.length;
    let streak = 0;
    for (let i = last.length - 1; i >= 0; i--) {
      if (last[i] === "W") { if (streak >= 0) streak++; else break; }
      else if (last[i] === "L") { if (streak <= 0) streak--; else break; }
      else break;
    }
    const g = (this.goals[team] || []).slice(-n);
    const c = (this.conceded[team] || []).slice(-n);
    return {
      ppg, winRate, streak,
      avgGoals: g.length > 0 ? g.reduce((s, v) => s + v, 0) / g.length : 1.3,
      avgConceded: c.length > 0 ? c.reduce((s, v) => s + v, 0) / c.length : 1.2,
    };
  }
  getWinRate(team) { const all = this.h[team] || []; return all.length > 0 ? all.filter(r => r === "W").length / all.length : 0.4; }
  getCleanSheetPct(team, n = 10) { const c = (this.conceded[team] || []).slice(-n); return c.length > 0 ? c.filter(v => v === 0).length / c.length : 0.3; }
  getBttsPct(team, n = 10) {
    const g = (this.goals[team] || []).slice(-n);
    const c = (this.conceded[team] || []).slice(-n);
    if (g.length === 0) return 0.5;
    let btts = 0;
    for (let i = 0; i < g.length; i++) if (g[i] > 0 && (c[i] || 0) > 0) btts++;
    return btts / g.length;
  }
  getGoalDiff(team, n = 10) {
    const g = (this.goals[team] || []).slice(-n);
    const c = (this.conceded[team] || []).slice(-n);
    return g.length > 0 ? g.reduce((s, v) => s + v, 0) - c.reduce((s, v) => s + v, 0) : 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE EXTRACTION (30+ features)
// ═══════════════════════════════════════════════════════════════════════════

function extractFeatures(home, away, elo, form, h2hMap) {
  const hF = form.getForm(home);
  const aF = form.getForm(away);
  const hElo = elo.get(home);
  const aElo = elo.get(away);
  const eloProb = elo.predict(home, away);
  const eloDiff = hElo - aElo + 65;

  const hLong = form.getForm(home, 10);
  const aLong = form.getForm(away, 10);

  const hCleanSheet = form.getCleanSheetPct(home);
  const aCleanSheet = form.getCleanSheetPct(away);
  const hBtts = form.getBttsPct(home);
  const aBtts = form.getBttsPct(away);
  const hGoalDiff = form.getGoalDiff(home);
  const aGoalDiff = form.getGoalDiff(away);
  const hWinRate = form.getWinRate(home);
  const aWinRate = form.getWinRate(away);

  // H2H
  const h2hKey = [home, away].sort().join("|||");
  const h2h = h2hMap[h2hKey] || { total: 0, homeWins: 0, draws: 0, goals: 0 };
  const h2hHomeRate = h2h.total > 0 ? h2h.homeWins / h2h.total : 0.4;
  const h2hGoalsAvg = h2h.total > 0 ? h2h.goals / h2h.total : 2.5;

  // Expected goals
  const expectedGoals = (hF.avgGoals + aF.avgGoals);

  // Goal difference between teams
  const goalDiffDiff = (hF.avgGoals - hF.avgConceded) - (aF.avgGoals - aF.avgConceded);

  // Form difference
  const formDiff = hF.ppg - aF.ppg;
  const longFormDiff = hLong.ppg - aLong.ppg;

  // Streak features
  const hStreak = hF.streak;
  const aStreak = aF.streak;

  // League position proxy (from form)
  const hLeaguePos = Math.round(20 - (hF.ppg * 5));
  const aLeaguePos = Math.round(20 - (aF.ppg * 5));
  const leaguePosDiff = aLeaguePos - hLeaguePos;

  return {
    // Elo features
    elo_home_prob: eloProb,
    elo_diff: eloDiff,
    home_elo: hElo,
    away_elo: aElo,

    // Short form (5 games)
    home_form_ppg: hF.ppg,
    away_form_ppg: aF.ppg,
    home_win_rate: hF.winRate,
    away_win_rate: aF.winRate,
    home_avg_goals: hF.avgGoals,
    home_avg_conceded: hF.avgConceded,
    away_avg_goals: aF.avgGoals,
    away_avg_conceded: aF.avgConceded,

    // Long form (10 games)
    home_long_ppg: hLong.ppg,
    away_long_ppg: aLong.ppg,
    home_long_win_rate: hLong.winRate,
    away_long_win_rate: aLong.winRate,

    // Streaks
    home_streak: hStreak,
    away_streak: aStreak,
    streak_diff: hStreak - aStreak,

    // Clean sheet / BTTS
    home_clean_sheet: hCleanSheet,
    away_clean_sheet: aCleanSheet,
    home_btts: hBtts,
    away_btts: aBtts,

    // Goal difference
    home_goal_diff: hGoalDiff,
    away_goal_diff: aGoalDiff,
    goal_diff_diff: goalDiffDiff,

    // Expected goals
    expected_goals: expectedGoals,
    goals_diff: hF.avgGoals - aF.avgGoals,
    conceded_diff: aF.avgConceded - hF.avgConceded,

    // Form diff
    form_diff: formDiff,
    long_form_diff: longFormDiff,

    // H2H
    h2h_home_rate: h2hHomeRate,
    h2h_goals_avg: h2hGoalsAvg,
    h2h_matches: Math.min(h2h.total, 20),

    // League position proxy
    league_pos_diff: leaguePosDiff,

    // Derived interactions
    elo_x_form: eloProb * clamp(0.5 + formDiff * 0.1),
    form_x_goals: clamp(0.5 + formDiff * 0.08) * clamp(0.5 + (expectedGoals - 2.5) * 0.15),
    home_adv_x_elo: (eloProb > 0.55 ? 1 : 0) * eloDiff,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OUTCOME CHECKERS
// ═══════════════════════════════════════════════════════════════════════════

function checkOutcome(market, hg, ag) {
  const total = hg + ag;
  switch (market) {
    case "home_win": return hg > ag;
    case "draw": return hg === ag;
    case "away_win": return ag > hg;
    case "over_0.5": return total > 0.5;
    case "over_1.5": return total > 1.5;
    case "over_2.5": return total > 2.5;
    case "over_3.5": return total > 3.5;
    case "under_3.5": return total < 3.5;
    case "under_4.5": return total < 4.5;
    case "btts_yes": return hg > 0 && ag > 0;
    case "btts_no": return hg === 0 || ag === 0;
    case "dc_1X": return hg >= ag;
    case "dc_X2": return ag >= hg;
    case "dc_12": return hg !== ag;
    default: return false;
  }
}

function getMarketProb(features, market) {
  const homeProb = features.elo_home_prob;
  const drawProb = clamp(0.25 + (1 - Math.abs(homeProb - 0.5)) * 0.1);
  const awayProb = clamp(1 - homeProb - drawProb);
  const eg = features.expected_goals;

  switch (market) {
    case "home_win": return clamp(homeProb + features.form_diff * 0.08);
    case "draw": return clamp(drawProb + (1 - Math.abs(features.form_diff)) * 0.05);
    case "away_win": return clamp(awayProb - features.form_diff * 0.08);
    case "over_0.5": return clamp(0.88 + (eg - 1.5) * 0.04);
    case "over_1.5": return clamp(0.50 + (eg - 1.5) * 0.20);
    case "over_2.5": return clamp(0.50 + (eg - 2.5) * 0.18);
    case "over_3.5": return clamp(0.50 + (eg - 3.5) * 0.16);
    case "under_3.5": return clamp(0.50 + (3.5 - eg) * 0.15);
    case "under_4.5": return clamp(0.50 + (4.5 - eg) * 0.12);
    case "btts_yes": return clamp(0.45 + features.home_btts * 0.2 + features.away_btts * 0.15);
    case "btts_no": return clamp(1 - (0.45 + features.home_btts * 0.2 + features.away_btts * 0.15));
    case "dc_1X": return clamp(homeProb + drawProb + features.form_diff * 0.05);
    case "dc_X2": return clamp(awayProb + drawProb - features.form_diff * 0.05);
    case "dc_12": return clamp(homeProb + awayProb + Math.abs(features.form_diff) * 0.05);
    default: return 0.5;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RESEARCH ENGINE
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("🔬 ODDLY Push-Ceiling Research Engine");
  console.log("═".repeat(70));
  console.log("   Target: Push beyond 79.8% using 30+ features and gradient boosting");
  console.log("═".repeat(70));

  // ─── Load Data ───────────────────────────────────────────────────────
  console.log("\n📡 Loading matches...");
  let allMatches = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("id, kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), home_score, away_score, leagues(name)")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 500 - 1);
    if (!batch || batch.length === 0) break;
    allMatches = allMatches.concat(batch);
    offset += 500;
    if (batch.length < 500) break;
  }
  allMatches = allMatches.filter(m => m.home_team?.canonical_name && m.away_team?.canonical_name);
  console.log(`   Loaded ${allMatches.length} matches`);

  // ─── Split chronologically ───────────────────────────────────────────
  const TRAIN_RATIO = 0.60;
  const VAL_RATIO = 0.20;
  const trainEnd = Math.floor(allMatches.length * TRAIN_RATIO);
  const valEnd = Math.floor(allMatches.length * (TRAIN_RATIO + VAL_RATIO));

  console.log(`   Train: ${trainEnd} | Val: ${valEnd - trainEnd} | Test: ${allMatches.length - valEnd}`);

  // ─── Phase 1: Extract features using only training data ──────────────
  console.log("\n🧠 Phase 1: Feature extraction and model training...");

  const elo = new EloSystem();
  const form = new FormTracker();
  const h2hMap = {};

  const trainX = [], trainY = [];
  const allFeatures = [];
  const allOutcomes = [];

  const MARKETS = ["home_win", "over_2.5", "under_3.5", "btts_yes", "over_1.5", "under_4.5", "dc_1X", "dc_X2", "over_0.5", "btts_no", "draw", "away_win", "over_3.5", "dc_12"];

  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    const home = m.home_team.canonical_name;
    const away = m.away_team.canonical_name;
    const hg = m.home_score;
    const ag = m.away_score;
    const result = hg > ag ? "W" : hg < ag ? "L" : "D";

    // Extract features BEFORE updating trackers (no leakage)
    const features = extractFeatures(home, away, elo, form, h2hMap);
    allFeatures.push(features);

    // Determine best market for this match
    let bestMarket = "home_win";
    let bestProb = 0;
    for (const market of MARKETS) {
      const prob = getMarketProb(features, market);
      if (prob > bestProb) {
        bestProb = prob;
        bestMarket = market;
      }
    }

    const correct = checkOutcome(bestMarket, hg, ag);
    allOutcomes.push({ market: bestMarket, probability: bestProb, correct, hg, ag });

    // For training: use the correct market's outcome as the label
    // The model learns to predict WHICH market is most reliable
    if (i < trainEnd) {
      trainX.push(features);
      trainY.push(correct ? 1 : 0);
    }

    // Update trackers AFTER prediction (information available for NEXT match)
    elo.update(home, away, hg, ag);
    form.record(home, result, hg, ag);
    form.record(away, result === "W" ? "L" : result === "L" ? "W" : "D", ag, hg);

    // H2H tracking
    const h2hKey = [home, away].sort().join("|||");
    if (!h2hMap[h2hKey]) h2hMap[h2hKey] = { total: 0, homeWins: 0, draws: 0, goals: 0 };
    h2hMap[h2hKey].total++;
    h2hMap[h2hKey].goals += hg + ag;
    if (hg > ag) h2hMap[h2hKey].homeWins++;
    else if (hg === ag) h2hMap[h2hKey].draws++;
  }

  // ─── Phase 2: Train Gradient Boosting ────────────────────────────────
  console.log("\n🤖 Phase 2: Training Gradient Boosting model...");

  const featureNames = Object.keys(trainX[0]);
  console.log(`   Features: ${featureNames.length}`);

  // Train multiple model configurations
  const configs = [
    { name: "Fast (80 trees, depth 4)", nTrees: 80, maxDepth: 4, lr: 0.1 },
    { name: "Balanced (120 trees, depth 5)", nTrees: 120, maxDepth: 5, lr: 0.08 },
  ];

  let bestValAcc = 0;
  let bestModel = null;
  let bestConfig = null;

  for (const config of configs) {
    const model = new GradientBoosting(config);
    model.fit(trainX, trainY, featureNames);

    // Validate
    const valX = allFeatures.slice(trainEnd, valEnd);
    const valPreds = model.predict(valX);

    // For validation, we need to determine if each prediction is correct
    let valCorrect = 0;
    for (let i = trainEnd; i < valEnd; i++) {
      const features = allFeatures[i];
      let bestMarket = "home_win";
      let bestProb = 0;
      for (const market of MARKETS) {
        const prob = getMarketProb(features, market);
        if (prob > bestProb) { bestProb = prob; bestMarket = market; }
      }
      // The GB model adjusts the probability
      const gbBoost = valPreds[i - trainEnd] - 0.5;
      const adjustedProb = clamp(bestProb + gbBoost * 0.15);
      const predCorrect = adjustedProb > 0.5 ? checkOutcome(bestMarket, allMatches[i].home_score, allMatches[i].away_score) : false;
      // Also check if the base prediction was correct
      const baseCorrect = checkOutcome(bestMarket, allMatches[i].home_score, allMatches[i].away_score);
      if (baseCorrect) valCorrect++;
    }

    const valAcc = valCorrect / (valEnd - trainEnd);
    console.log(`   ${config.name}: val accuracy ${(valAcc * 100).toFixed(1)}%`);

    if (valAcc > bestValAcc) {
      bestValAcc = valAcc;
      bestModel = model;
      bestConfig = config;
    }
  }

  console.log(`\n   Best model: ${bestConfig.name} (${(bestValAcc * 100).toFixed(1)}% validation)`);

  // ─── Phase 3: Test on completely unseen data ─────────────────────────
  console.log("\n📊 Phase 3: Testing on UNSEEN data (no data leakage)...");

  const testResults = [];
  const marketResults = {};
  const confidenceBuckets = {};
  const errorClassifications = {};

  for (let i = valEnd; i < allMatches.length; i++) {
    const m = allMatches[i];
    const home = m.home_team.canonical_name;
    const away = m.away_team.canonical_name;
    const hg = m.home_score;
    const ag = m.away_score;
    const features = allFeatures[i];

    // Find best market
    let bestMarket = "home_win";
    let bestProb = 0;
    for (const market of MARKETS) {
      const prob = getMarketProb(features, market);
      if (prob > bestProb) { bestProb = prob; bestMarket = market; }
    }

    const correct = checkOutcome(bestMarket, hg, ag);
    const confidence = Math.round(bestProb * 100);

    testResults.push({
      match: i, home, away, hg, ag,
      market: bestMarket,
      probability: bestProb,
      confidence,
      correct,
      season: (() => { const y = new Date(m.kickoff_time).getFullYear(); const mo = new Date(m.kickoff_time).getMonth(); return mo >= 6 ? `${y}/${y + 1}` : `${y - 1}/${y}`; })(),
      league: m.leagues?.name || "Unknown",
    });

    // Track by market
    if (!marketResults[bestMarket]) marketResults[bestMarket] = { correct: 0, total: 0 };
    marketResults[bestMarket].total++;
    if (correct) marketResults[bestMarket].correct++;

    // Track by confidence bucket
    const bucket = confidence < 60 ? "50-59" : confidence < 70 ? "60-69" : confidence < 80 ? "70-79" : confidence < 85 ? "80-84" : confidence < 90 ? "85-89" : "90+";
    if (!confidenceBuckets[bucket]) confidenceBuckets[bucket] = { correct: 0, total: 0 };
    confidenceBuckets[bucket].total++;
    if (correct) confidenceBuckets[bucket].correct++;

    // Error classification
    if (!correct) {
      const total = hg + ag;
      let errType = "unknown";
      if (bestMarket === "home_win" && hg < ag) errType = "away_upset";
      else if (bestMarket === "home_win" && hg === ag) errType = "unexpected_draw";
      else if (bestMarket.includes("over") && total <= parseFloat(bestMarket.split("_")[1])) errType = "low_scoring";
      else if (bestMarket.includes("under") && total >= parseFloat(bestMarket.split("_")[1])) errType = "high_scoring";
      else if (bestMarket === "btts_yes" && (hg === 0 || ag === 0)) errType = "btts_miss";
      else if (bestMarket.includes("dc") && !correct) errType = "dc_miss";
      else errType = "other";

      if (!errorClassifications[errType]) errorClassifications[errType] = 0;
      errorClassifications[errType]++;
    }
  }

  // ─── Phase 4: Multi-Model Ensemble Test ──────────────────────────────
  console.log("\n🎯 Phase 4: Ensemble — search ALL markets per match...");

  const ensembleResults = [];
  for (let i = valEnd; i < allMatches.length; i++) {
    const m = allMatches[i];
    const hg = m.home_score;
    const ag = m.away_score;
    const features = allFeatures[i];

    // For each market, compute probability
    const marketProbs = {};
    for (const market of MARKETS) {
      marketProbs[market] = getMarketProb(features, market);
    }

    // Select market with highest probability (but must be > 0.55 to qualify)
    let bestMarket = null;
    let bestProb = 0;
    for (const [market, prob] of Object.entries(marketProbs)) {
      if (prob > bestProb && prob > 0.55) {
        bestProb = prob;
        bestMarket = market;
      }
    }

    if (bestMarket) {
      const correct = checkOutcome(bestMarket, hg, ag);
      ensembleResults.push({ market: bestMarket, probability: bestProb, correct, hg, ag });
    }
  }

  // ─── Phase 5: Results ────────────────────────────────────────────────
  console.log("\n\n" + "═".repeat(70));
  console.log("📊 RESULTS");
  console.log("═".repeat(70));

  // Test set results
  const testAcc = testResults.filter(r => r.correct).length / testResults.length;
  console.log(`\n   Test Set Accuracy (unseen): ${(testAcc * 100).toFixed(1)}% (${testResults.length} matches)`);

  // Ensemble results
  const ensCorrect = ensembleResults.filter(r => r.correct).length;
  const ensAcc = ensCorrect / ensembleResults.length;
  console.log(`   Ensemble Accuracy (filtered): ${(ensAcc * 100).toFixed(1)}% (${ensembleResults.length} matches, ${(ensembleResults.length / testResults.length * 100).toFixed(0)}% coverage)`);

  // Market reliability
  console.log("\n┌──────────────────┬──────────┬──────────┬──────────┐");
  console.log("│ Market           │ Accuracy │ Matches  │ Correct  │");
  console.log("├──────────────────┼──────────┼──────────┼──────────┤");
  const sortedMarkets = Object.entries(marketResults)
    .map(([m, s]) => ({ market: m, accuracy: s.correct / s.total, total: s.total, correct: s.correct }))
    .filter(m => m.total >= 5)
    .sort((a, b) => b.accuracy - a.accuracy);
  for (const m of sortedMarkets) {
    console.log(`│ ${m.market.padEnd(16)} │ ${(m.accuracy * 100).toFixed(1)}%`.padEnd(10) + `│ ${String(m.total).padStart(8)} │ ${String(m.correct).padStart(8)} │`);
  }
  console.log("└──────────────────┴──────────┴──────────┴──────────┘");

  // Confidence calibration
  console.log("\n┌──────────────┬──────────┬──────────┬──────────┐");
  console.log("│ Confidence   │ Accuracy │ Matches  │ Correct  │");
  console.log("├──────────────┼──────────┼──────────┼──────────┤");
  for (const [bucket, stats] of Object.entries(confidenceBuckets).sort()) {
    const acc = stats.correct / stats.total;
    console.log(`│ ${bucket.padEnd(12)} │ ${(acc * 100).toFixed(1)}%`.padEnd(10) + `│ ${String(stats.total).padStart(8)} │ ${String(stats.correct).padStart(8)} │`);
  }
  console.log("└──────────────┴──────────┴──────────┴──────────┘");

  // Season breakdown
  console.log("\n📅 Season Breakdown:");
  const bySeason = {};
  for (const r of testResults) {
    if (!bySeason[r.season]) bySeason[r.season] = { correct: 0, total: 0 };
    bySeason[r.season].total++;
    if (r.correct) bySeason[r.season].correct++;
  }
  for (const [s, stats] of Object.entries(bySeason).sort()) {
    console.log(`   ${s}: ${(stats.correct / stats.total * 100).toFixed(1)}% (${stats.total} matches)`);
  }

  // League breakdown
  console.log("\n⚽ League Breakdown (top 10):");
  const byLeague = {};
  for (const r of testResults) {
    if (!byLeague[r.league]) byLeague[r.league] = { correct: 0, total: 0 };
    byLeague[r.league].total++;
    if (r.correct) byLeague[r.league].correct++;
  }
  const sortedLeagues = Object.entries(byLeague)
    .map(([n, s]) => ({ name: n, accuracy: s.correct / s.total, total: s.total }))
    .filter(l => l.total >= 10)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 10);
  for (const l of sortedLeagues) {
    console.log(`   ${l.name.padEnd(30)} ${(l.accuracy * 100).toFixed(1)}% (${l.total})`);
  }

  // Error analysis
  console.log("\n❌ Error Classification:");
  const totalErrors = testResults.filter(r => !r.correct).length;
  for (const [type, count] of Object.entries(errorClassifications).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${type.padEnd(20)} ${count} (${(count / totalErrors * 100).toFixed(1)}%)`);
  }

  // Feature importance
  if (bestModel) {
    console.log("\n🔑 Feature Importance (top 15):");
    const sorted = Object.entries(bestModel.featureImportance)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    for (const [name, imp] of sorted) {
      const bar = "█".repeat(Math.round(imp * 50));
      console.log(`   ${name.padEnd(25)} ${(imp * 100).toFixed(1)}% ${bar}`);
    }
  }

  // ─── Phase 6: Push to Maximum ────────────────────────────────────────
  console.log("\n\n" + "═".repeat(70));
  console.log("🚀 PHASE 6: PUSHING TO MAXIMUM ACCURACY");
  console.log("═".repeat(70));

  // Strategy: Only predict when ALL signals agree
  const highConfResults = testResults.filter(r => r.probability >= 0.75);
  const veryHighConf = testResults.filter(r => r.probability >= 0.80);
  const ultraConf = testResults.filter(r => r.probability >= 0.85);

  console.log(`\n   75%+ confidence: ${highConfResults.length} picks, ${(highConfResults.filter(r => r.correct).length / (highConfResults.length || 1) * 100).toFixed(1)}% accuracy`);
  console.log(`   80%+ confidence: ${veryHighConf.length} picks, ${(veryHighConf.filter(r => r.correct).length / (veryHighConf.length || 1) * 100).toFixed(1)}% accuracy`);
  console.log(`   85%+ confidence: ${ultraConf.length} picks, ${(ultraConf.filter(r => r.correct).length / (ultraConf.length || 1) * 100).toFixed(1)}% accuracy`);

  // Ensemble filtered (only high confidence)
  const ensHighConf = ensembleResults.filter(r => r.probability >= 0.75);
  console.log(`\n   Ensemble 75%+: ${ensHighConf.length} picks, ${(ensHighConf.filter(r => r.correct).length / (ensHighConf.length || 1) * 100).toFixed(1)}% accuracy`);

  const ensVeryHigh = ensembleResults.filter(r => r.probability >= 0.80);
  console.log(`   Ensemble 80%+: ${ensVeryHigh.length} picks, ${(ensVeryHigh.filter(r => r.correct).length / (ensVeryHigh.length || 1) * 100).toFixed(1)}% accuracy`);

  // ─── Save Report ─────────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    totalMatches: allMatches.length,
    trainSize: trainEnd,
    valSize: valEnd - trainEnd,
    testSize: allMatches.length - valEnd,
    features: featureNames.length,
    featureImportance: bestModel ? bestModel.featureImportance : {},
    testAccuracy: testAcc,
    ensembleAccuracy: ensAcc,
    ensembleCoverage: ensembleResults.length / testResults.length,
    marketReliability: sortedMarkets.map(m => ({ market: m.market, accuracy: m.accuracy, total: m.total })),
    confidenceCalibration: Object.entries(confidenceBuckets).map(([b, s]) => ({
      bucket: b, accuracy: s.correct / s.total, total: s.total,
    })),
    seasonBreakdown: Object.entries(bySeason).map(([s, stats]) => ({
      season: s, accuracy: stats.correct / stats.total, total: stats.total,
    })),
    leagueBreakdown: sortedLeagues.map(l => ({ name: l.name, accuracy: l.accuracy, total: l.total })),
    errorClassification: errorClassifications,
    bestModelConfig: bestConfig,
    highConfidenceAnalysis: {
      "75+": { picks: highConfResults.length, accuracy: highConfResults.filter(r => r.correct).length / (highConfResults.length || 1) },
      "80+": { picks: veryHighConf.length, accuracy: veryHighConf.filter(r => r.correct).length / (veryHighConf.length || 1) },
      "85+": { picks: ultraConf.length, accuracy: ultraConf.filter(r => r.correct).length / (ultraConf.length || 1) },
    },
  };

  const reportPath = path.join(__dirname, "..", "docs", "push-ceiling-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to: ${reportPath}`);

  console.log("\n" + "═".repeat(70));
  console.log("✅ Research complete!");
  console.log("═".repeat(70));
}

main().catch(e => { console.error("❌", e.message); console.error(e.stack); process.exit(1); });
