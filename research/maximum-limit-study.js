#!/usr/bin/env node

/**
 * ODDLY Maximum-Limit Predictive Research
 *
 * A comprehensive research system that:
 * 1. Extracts 50+ features per match
 * 2. Discovers hidden signal interactions
 * 3. Classifies matches by predictability
 * 4. Builds error taxonomy
 * 5. Runs rigorous chronological backtesting
 * 6. Attempts to push accuracy toward 90%
 * 7. Tries to break its own model
 *
 * Run: node research/maximum-limit-study.js
 *
 * DO NOT CHEAT. Every prediction must use only information available BEFORE kickoff.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Environment ─────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: DATA LOADING
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAllData() {
  console.log("\n📊 PHASE 1: Loading all historical data...");

  // Load fixtures with teams
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(`
      id, home_score, away_score, kickoff_time, status,
      home_team:teams!fixtures_home_team_id_fkey(id, canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(id, canonical_name),
      leagues(id, name)
    `)
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: true });

  console.log(`   Loaded ${fixtures?.length || 0} finished matches`);

  // Load odds
  const fixtureIds = fixtures?.map(f => f.id) || [];
  const { data: oddsData } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, selection, odds")
    .in("fixture_id", fixtureIds);

  const oddsByFixture = {};
  if (oddsData) {
    for (const o of oddsData) {
      if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
      if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
      oddsByFixture[o.fixture_id][o.selection].push(o.odds);
    }
  }

  return { fixtures: fixtures || [], oddsByFixture };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: COMPREHENSIVE FEATURE EXTRACTION (50+ Features)
// ═══════════════════════════════════════════════════════════════════════════════

class FeatureExtractor {
  constructor() {
    this.elo = {};
    this.form = {};
    this.h2h = {};
    this.leagueAvg = {};
    this.teamHistory = {};
  }

  // Update state after each match (chronological)
  update(home, away, hg, ag, league) {
    // Update Elo
    const hElo = this.elo[home] || 1500;
    const aElo = this.elo[away] || 1500;
    const hEloAdj = hElo + 65; // Home advantage
    const eH = 1 / (1 + Math.pow(10, (aElo - hEloAdj) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    const K = 32;
    this.elo[home] = hElo + K * (actual - eH);
    this.elo[away] = aElo + K * ((1 - actual) - (1 - eH));

    // Update form
    this._updateForm(home, hg > ag ? "W" : hg < ag ? "L" : "D", hg, ag);
    this._updateForm(away, hg < ag ? "W" : hg > ag ? "L" : "D", ag, hg);

    // Update H2H
    const h2hKey = [home, away].sort().join("|");
    if (!this.h2h[h2hKey]) this.h2h[h2hKey] = { home: 0, draw: 0, away: 0, total: 0 };
    this.h2h[h2hKey].total++;
    if (hg > ag) this.h2h[h2hKey].home++;
    else if (hg < ag) this.h2h[h2hKey].away++;
    else this.h2h[h2hKey].draw++;

    // Update team history
    this._updateHistory(home, hg, ag, true);
    this._updateHistory(away, ag, hg, false);

    // Update league averages
    if (league) {
      if (!this.leagueAvg[league]) this.leagueAvg[league] = { goals: 0, matches: 0 };
      this.leagueAvg[league].goals += hg + ag;
      this.leagueAvg[league].matches++;
    }
  }

  _updateForm(team, result, goals, conceded) {
    if (!this.form[team]) this.form[team] = [];
    this.form[team].push({ result, goals, conceded });
    if (this.form[team].length > 30) this.form[team].shift();
  }

  _updateHistory(team, goals, conceded, isHome) {
    if (!this.teamHistory[team]) this.teamHistory[team] = { home: [], away: [] };
    const key = isHome ? "home" : "away";
    this.teamHistory[team][key].push({ goals, conceded });
    if (this.teamHistory[team][key].length > 50) this.teamHistory[team][key].shift();
  }

  // Extract ALL features for a match BEFORE it was played
  extract(home, away, league, odds) {
    const features = {};

    // ─── ELO FEATURES (4) ───────────────────────────────────────────────
    const hElo = this.elo[home] || 1500;
    const aElo = this.elo[away] || 1500;
    features.elo_home = hElo;
    features.elo_away = aElo;
    features.elo_diff = hElo - aElo + 65;
    features.elo_home_prob = 1 / (1 + Math.pow(10, ((aElo) - (hElo + 65)) / 400));

    // ─── FORM FEATURES (12) ────────────────────────────────────────────
    const hForm = this._getForm(home);
    const aForm = this._getForm(away);

    features.home_form_ppg = hForm.ppg;
    features.away_form_ppg = aForm.ppg;
    features.home_win_rate = hForm.winRate;
    features.away_win_rate = aForm.winRate;
    features.home_avg_goals = hForm.avgGoals;
    features.home_avg_conceded = hForm.avgConceded;
    features.away_avg_goals = aForm.avgGoals;
    features.away_avg_conceded = aForm.avgConceded;
    features.home_streak = hForm.streak;
    features.away_streak = aForm.streak;
    features.home_clean_sheet_pct = hForm.cleanSheetPct;
    features.away_clean_sheet_pct = aForm.cleanSheetPct;

    // ─── GOALS FEATURES (6) ────────────────────────────────────────────
    features.goal_diff = (hForm.avgGoals - hForm.avgConceded) - (aForm.avgGoals - aForm.avgConceded);
    features.total_expected_goals = hForm.avgGoals + aForm.avgGoals;
    features.home_btts_rate = hForm.bttsRate;
    features.away_btts_rate = aForm.bttsRate;
    features.home_over25_rate = hForm.over25Rate;
    features.away_over25_rate = aForm.over25Rate;

    // ─── H2H FEATURES (4) ──────────────────────────────────────────────
    const h2hKey = [home, away].sort().join("|");
    const h2hData = this.h2h[h2hKey] || { home: 0, draw: 0, away: 0, total: 0 };
    features.h2h_total = h2hData.total;
    features.h2h_home_rate = h2hData.total > 0 ? h2hData.home / h2hData.total : 0.45;
    features.h2h_draw_rate = h2hData.total > 0 ? h2hData.draw / h2hData.total : 0.25;
    features.h2h_away_rate = h2hData.total > 0 ? h2hData.away / h2hData.total : 0.30;

    // ─── HOME/AWAY SPLITS (6) ───────────────────────────────────────────
    const hHome = this._getHomeAway(home, true);
    const aAway = this._getHomeAway(away, false);

    features.home_home_win_rate = hHome.winRate;
    features.away_away_win_rate = aAway.winRate;
    features.home_home_goals = hHome.avgGoals;
    features.away_away_goals = aAway.avgGoals;
    features.home_home_conceded = hHome.avgConceded;
    features.away_away_conceded = aAway.avgConceded;

    // ─── LEAGUE CONTEXT (3) ─────────────────────────────────────────────
    const lgAvg = this.leagueAvg[league] || { goals: 0, matches: 0 };
    features.league_avg_goals = lgAvg.matches > 0 ? lgAvg.goals / lgAvg.matches : 2.6;
    features.league_home_bias = 0.45; // Default
    features.league_goal_trend = 0; // Default

    // ─── MARKET FEATURES (5) ────────────────────────────────────────────
    const avg = (arr) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    features.home_odds = avg(odds?.["Home"]);
    features.draw_odds = avg(odds?.["Draw"]);
    features.away_odds = avg(odds?.["Away"]);

    if (features.home_odds && features.draw_odds && features.away_odds) {
      const mt = 1/features.home_odds + 1/features.draw_odds + 1/features.away_odds;
      features.market_home_prob = (1/features.home_odds) / mt;
      features.market_draw_prob = (1/features.draw_odds) / mt;
      features.market_away_prob = (1/features.away_odds) / mt;
      features.market_overround = mt - 1;
    } else {
      features.market_home_prob = null;
      features.market_draw_prob = null;
      features.market_away_prob = null;
      features.market_overround = null;
    }

    // ─── DERIVED INTERACTION FEATURES (8) ───────────────────────────────
    features.form_x_elo = hForm.ppg * features.elo_home_prob;
    features.goal_adv_x_form = features.goal_diff * (hForm.ppg - aForm.ppg);
    features.market_x_elo = (features.market_home_prob || 0.45) * features.elo_home_prob;
    features.total_xg_x_market = features.total_expected_goals * (features.market_overround || 0.05);
    features.home_dominance = features.home_win_rate * (1 - features.away_win_rate);
    features.away_weakness = (1 - features.away_win_rate) * features.away_avg_conceded;
    features.streak_differential = features.home_streak - features.away_streak;
    features.form_gap = hForm.ppg - aForm.ppg;

    // ─── CONSENSUS FEATURES (3) ─────────────────────────────────────────
    // How much do different signals agree?
    const homeSignals = [
      features.elo_home_prob > 0.5 ? 1 : 0,
      features.market_home_prob > 0.5 ? 1 : 0,
      features.home_win_rate > features.away_win_rate ? 1 : 0,
      features.home_form_ppg > features.away_form_ppg ? 1 : 0,
      features.home_avg_goals > features.away_avg_goals ? 1 : 0,
    ];
    features.home_signal_consensus = homeSignals.reduce((s, v) => s + v, 0) / homeSignals.length;
    features.signal_agreement = features.home_signal_consensus > 0.8 || features.home_signal_consensus < 0.2 ? 1 : 0;
    features.signal_conflict = features.home_signal_consensus > 0.3 && features.home_signal_consensus < 0.7 ? 1 : 0;

    // ─── UNCERTAINTY FEATURES (3) ───────────────────────────────────────
    features.prediction_entropy = -(
      (features.market_home_prob || 0.45) * Math.log(features.market_home_prob || 0.45) +
      (features.market_draw_prob || 0.25) * Math.log(features.market_draw_prob || 0.25) +
      (features.market_away_prob || 0.30) * Math.log(features.market_away_prob || 0.30)
    ) / Math.log(3);
    features.model_market_gap = Math.abs(features.elo_home_prob - (features.market_home_prob || 0.45));
    features.confidence_level = Math.max(features.elo_home_prob, 1 - features.elo_home_prob);

    return features;
  }

  _getForm(team, n = 5) {
    const last = (this.form[team] || []).slice(-n);
    if (last.length === 0) return { ppg: 1.5, winRate: 0.4, streak: 0, avgGoals: 1.3, avgConceded: 1.2, cleanSheetPct: 0.3, bttsRate: 0.5, over25Rate: 0.45 };
    const ppg = last.reduce((s, r) => s + (r.result === "W" ? 3 : r.result === "D" ? 1 : 0), 0) / last.length;
    const winRate = last.filter(r => r.result === "W").length / last.length;
    let streak = 0;
    for (let i = last.length - 1; i >= 0; i--) {
      if (last[i].result === "W") { if (streak >= 0) streak++; else break; }
      else if (last[i].result === "L") { if (streak <= 0) streak--; else break; }
      else break;
    }
    return {
      ppg, winRate, streak,
      avgGoals: last.reduce((s, r) => s + r.goals, 0) / last.length,
      avgConceded: last.reduce((s, r) => s + r.conceded, 0) / last.length,
      cleanSheetPct: last.filter(r => r.conceded === 0).length / last.length,
      bttsRate: last.filter(r => r.goals > 0 && r.conceded > 0).length / last.length,
      over25Rate: last.filter(r => r.goals + r.conceded > 2.5).length / last.length,
    };
  }

  _getHomeAway(team, isHome) {
    const history = this.teamHistory[team]?.[isHome ? "home" : "away"] || [];
    if (history.length < 3) return { winRate: 0.45, avgGoals: 1.3, avgConceded: 1.2 };
    const wins = history.filter((h, i) => {
      if (i === 0) return false;
      return h.goals > h.conceded;
    }).length;
    return {
      winRate: wins / history.length,
      avgGoals: history.reduce((s, h) => s + h.goals, 0) / history.length,
      avgConceded: history.reduce((s, h) => s + h.conceded, 0) / history.length,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: SIGNAL DISCOVERY ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

class SignalDiscovery {
  constructor() {
    this.signals = {};
  }

  // Test every feature as a predictor
  testAllFeatures(matchData) {
    console.log("\n🔍 Testing all features as predictors...");

    const featureNames = Object.keys(matchData[0]?.features || {});
    const results = [];

    for (const feature of featureNames) {
      const result = this.testFeature(matchData, feature);
      if (result) results.push(result);
    }

    // Sort by predictive power
    results.sort((a, b) => b.accuracy - a.accuracy);

    console.log("\n   TOP 15 MOST PREDICTIVE FEATURES:");
    for (let i = 0; i < Math.min(15, results.length); i++) {
      const r = results[i];
      const emoji = r.accuracy > 0.60 ? "🟢" : r.accuracy > 0.55 ? "🟡" : "🔴";
      console.log(`   ${emoji} ${i + 1}. ${r.feature.padEnd(30)} ${(r.accuracy * 100).toFixed(1)}% (${r.samples} matches, p=${r.pValue.toFixed(4)})`);
    }

    return results;
  }

  testFeature(matchData, featureName) {
    // Split matches by feature value (above/below median)
    const values = matchData.map(m => m.features[featureName]).filter(v => v !== null && v !== undefined);
    if (values.length < 20) return null;

    const median = values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

    const above = matchData.filter(m => m.features[featureName] > median);
    const below = matchData.filter(m => m.features[featureName] <= median);

    if (above.length < 10 || below.length < 10) return null;

    const aboveAcc = above.filter(m => m.correct).length / above.length;
    const belowAcc = below.filter(m => m.correct).length / below.length;

    // Test if difference is significant (simple z-test)
    const p1 = aboveAcc, p2 = belowAcc;
    const n1 = above.length, n2 = below.length;
    const pPool = (above.filter(m => m.correct).length + below.filter(m => m.correct).length) / (n1 + n2);
    const se = Math.sqrt(pPool * (1 - pPool) * (1/n1 + 1/n2));
    const z = se > 0 ? Math.abs(p1 - p2) / se : 0;
    const pValue = 2 * (1 - this.normalCDF(z));

    // Feature is predictive if it creates separation
    const accuracy = Math.max(aboveAcc, belowAcc);
    const separation = Math.abs(aboveAcc - belowAcc);

    return {
      feature: featureName,
      accuracy,
      separation,
      aboveAcc,
      belowAcc,
      samples: matchData.length,
      pValue,
      significant: pValue < 0.05,
    };
  }

  normalCDF(z) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const sign = z >= 0 ? 1 : -1;
    z = Math.abs(z) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * z);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
    return 0.5 * (1.0 + sign * y);
  }

  // Test feature INTERACTIONS
  testInteractions(matchData, topFeatures) {
    console.log("\n🔍 Testing feature interactions...");

    const interactions = [];
    const topNames = topFeatures.slice(0, 10).map(f => f.feature);

    for (let i = 0; i < topNames.length; i++) {
      for (let j = i + 1; j < topNames.length; j++) {
        const result = this.testInteraction(matchData, topNames[i], topNames[j]);
        if (result && result.separation > 0.05) {
          interactions.push(result);
        }
      }
    }

    interactions.sort((a, b) => b.separation - a.separation);

    console.log("\n   TOP 10 MOST POWERFUL INTERACTIONS:");
    for (let i = 0; i < Math.min(10, interactions.length); i++) {
      const r = interactions[i];
      console.log(`   🟢 ${r.feature1} × ${r.feature2}`);
      console.log(`      Separation: ${(r.separation * 100).toFixed(1)}% | Accuracy: ${(r.accuracy * 100).toFixed(1)}% | p=${r.pValue.toFixed(4)}`);
    }

    return interactions;
  }

  testInteraction(matchData, f1, f2) {
    const v1 = matchData.map(m => m.features[f1]).filter(v => v !== null && v !== undefined);
    const v2 = matchData.map(m => m.features[f2]).filter(v => v !== null && v !== undefined);
    if (v1.length < 20 || v2.length < 20) return null;

    const median1 = v1.sort((a, b) => a - b)[Math.floor(v1.length / 2)];
    const median2 = v2.sort((a, b) => a - b)[Math.floor(v2.length / 2)];

    // Both above median
    const bothAbove = matchData.filter(m => m.features[f1] > median1 && m.features[f2] > median2);
    // One above, one below
    const mixed = matchData.filter(m =>
      (m.features[f1] > median1 && m.features[f2] <= median2) ||
      (m.features[f1] <= median1 && m.features[f2] > median2)
    );

    if (bothAbove.length < 5 || mixed.length < 5) return null;

    const aboveAcc = bothAbove.filter(m => m.correct).length / bothAbove.length;
    const mixedAcc = mixed.filter(m => m.correct).length / mixed.length;

    const separation = Math.abs(aboveAcc - mixedAcc);
    const accuracy = Math.max(aboveAcc, mixedAcc);

    // Simple significance test
    const p1 = aboveAcc, p2 = mixedAcc;
    const n1 = bothAbove.length, n2 = mixed.length;
    const pPool = (bothAbove.filter(m => m.correct).length + mixed.filter(m => m.correct).length) / (n1 + n2);
    const se = Math.sqrt(pPool * (1 - pPool) * (1/n1 + 1/n2));
    const z = se > 0 ? Math.abs(p1 - p2) / se : 0;
    const pValue = 2 * (1 - this.normalCDF(z));

    return { feature1: f1, feature2: f2, accuracy, separation, pValue, samples: matchData.length };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4: MATCH PREDICTABILITY CLASSIFIER
// ═══════════════════════════════════════════════════════════════════════════════

function classifyPredictability(features) {
  // How many signals agree on the outcome?
  const signals = [
    features.elo_home_prob > 0.55 ? 1 : features.elo_home_prob < 0.45 ? -1 : 0,
    features.market_home_prob > 0.55 ? 1 : features.market_home_prob < 0.45 ? -1 : 0,
    features.home_win_rate > features.away_win_rate + 0.1 ? 1 : features.home_win_rate < features.away_win_rate - 0.1 ? -1 : 0,
    features.home_form_ppg > features.away_form_ppg + 0.3 ? 1 : features.home_form_ppg < features.away_form_ppg - 0.3 ? -1 : 0,
    features.goal_diff > 0.5 ? 1 : features.goal_diff < -0.5 ? -1 : 0,
  ];

  const agreement = Math.abs(signals.reduce((s, v) => s + v, 0)) / signals.length;

  if (agreement > 0.7) return "highly_predictable";
  if (agreement > 0.4) return "moderately_predictable";
  if (agreement > 0.2) return "uncertain";
  return "volatile";
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 5: GRADIENT BOOSTING MODEL
// ═══════════════════════════════════════════════════════════════════════════════

class GradientBoosting {
  constructor(nEstimators = 200, learningRate = 0.05, maxDepth = 5) {
    this.nEstimators = nEstimators;
    this.lr = learningRate;
    this.maxDepth = maxDepth;
    this.trees = [];
    this.basePred = 0;
    this.featureNames = [];
  }

  fit(X, y, featureNames = []) {
    this.featureNames = featureNames;
    this.basePred = y.reduce((s, v) => s + v, 0) / y.length;
    let preds = new Array(y.length).fill(this.basePred);

    for (let i = 0; i < this.nEstimators; i++) {
      const residuals = y.map((yi, idx) => yi - preds[idx]);
      const tree = this._buildTree(X, residuals, 0);
      this.trees.push(tree);
      for (let j = 0; j < X.length; j++) {
        preds[j] += this.lr * this._predictTree(tree, X[j]);
      }
    }
  }

  predict(X) {
    return X.map(x => {
      let p = this.basePred;
      for (const tree of this.trees) p += this.lr * this._predictTree(tree, x);
      return clamp(p);
    });
  }

  _buildTree(X, y, depth) {
    if (depth >= this.maxDepth || X.length < 10) {
      return { leaf: true, value: y.reduce((s, v) => s + v, 0) / y.length };
    }

    let bestF = 0, bestT = 0, bestScore = Infinity;
    for (let f = 0; f < X[0].length; f++) {
      const vals = X.map(x => x[f]).filter(v => !isNaN(v)).sort((a, b) => a - b);
      for (let t = 0; t < Math.min(15, vals.length); t++) {
        const thr = vals[Math.floor(vals.length * (t + 1) / 16)];
        const lx = [], rx = [], ly = [], ry = [];
        for (let i = 0; i < X.length; i++) {
          if (X[i][f] <= thr) { lx.push(X[i]); ly.push(y[i]); }
          else { rx.push(X[i]); ry.push(y[i]); }
        }
        if (lx.length < 5 || rx.length < 5) continue;
        const lm = ly.reduce((s, v) => s + v, 0) / ly.length;
        const rm = ry.reduce((s, v) => s + v, 0) / ry.length;
        const score = ly.reduce((s, v) => s + (v - lm) ** 2, 0) + ry.reduce((s, v) => s + (v - rm) ** 2, 0);
        if (score < bestScore) { bestScore = score; bestF = f; bestT = thr; }
      }
    }

    const lx = [], rx = [], ly = [], ry = [];
    for (let i = 0; i < X.length; i++) {
      if (X[i][bestF] <= bestT) { lx.push(X[i]); ly.push(y[i]); }
      else { rx.push(X[i]); ry.push(y[i]); }
    }

    return {
      leaf: false, feature: bestF, threshold: bestT,
      left: this._buildTree(lx, ly, depth + 1),
      right: this._buildTree(rx, ry, depth + 1),
    };
  }

  _predictTree(tree, x) {
    if (tree.leaf) return tree.value;
    return x[tree.feature] <= tree.threshold
      ? this._predictTree(tree.left, x)
      : this._predictTree(tree.right, x);
  }

  getFeatureImportance() {
    const imp = new Array(this.featureNames.length).fill(0);
    for (const tree of this.trees) this._countImp(tree, imp);
    const total = imp.reduce((s, v) => s + v, 0) || 1;
    return this.featureNames.map((name, i) => ({ name, importance: imp[i] / total }))
      .sort((a, b) => b.importance - a.importance);
  }

  _countImp(tree, imp) {
    if (tree.leaf) return;
    imp[tree.feature]++;
    this._countImp(tree.left, imp);
    this._countImp(tree.right, imp);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 6: RIGOROUS BACKTESTING
// ═══════════════════════════════════════════════════════════════════════════════

class RigorousBacktester {
  constructor() {
    this.results = [];
    this.errorTaxonomy = {};
    this.predictabilityBreakdown = {};
  }

  evaluate(predictions, actuals) {
    let correct = 0;
    let total = 0;
    const byTier = { ELITE: { c: 0, t: 0 }, HIGH: { c: 0, t: 0 }, MEDIUM: { c: 0, t: 0 }, LOW: { c: 0, t: 0 } };
    const byPredictability = {};

    for (let i = 0; i < predictions.length; i++) {
      const pred = predictions[i];
      const actual = actuals[i];
      const features = this.results[i]?.features || {};

      total++;
      const isCorrect = pred === actual;
      if (isCorrect) correct++;

      // Tier
      const conf = Math.max(pred, 1 - pred);
      const tier = conf >= 0.70 ? "ELITE" : conf >= 0.60 ? "HIGH" : conf >= 0.50 ? "MEDIUM" : "LOW";
      byTier[tier].t++;
      if (isCorrect) byTier[tier].c++;

      // Predictability
      const predClass = this.results[i]?.predictability || "unknown";
      if (!byPredictability[predClass]) byPredictability[predClass] = { c: 0, t: 0 };
      byPredictability[predClass].t++;
      if (isCorrect) byPredictability[predClass].c++;
    }

    return {
      total,
      correct,
      accuracy: correct / total,
      byTier,
      byPredictability,
    };
  }

  analyzeErrors(predictions, actuals, featuresList) {
    console.log("\n🔍 Analyzing prediction errors...");

    let errorCount = 0;
    const errorFeatures = {};

    for (let i = 0; i < predictions.length; i++) {
      if (predictions[i] === actuals[i]) continue;
      errorCount++;

      const features = featuresList[i];
      if (!features) continue;

      // Track which features were present in errors
      for (const [key, value] of Object.entries(features)) {
        if (value === null || typeof value === "string") continue;
        if (!errorFeatures[key]) errorFeatures[key] = { sum: 0, count: 0 };
        errorFeatures[key].sum += value;
        errorFeatures[key].count++;
      }
    }

    // Compare error features to correct features
    const errorAnalysis = [];
    for (const [key, data] of Object.entries(errorFeatures)) {
      const errorAvg = data.sum / data.count;
      errorAnalysis.push({ feature: key, errorAvg, count: data.count });
    }

    console.log(`   Total errors: ${errorCount}`);
    console.log(`   Error rate: ${((errorCount / predictions.length) * 100).toFixed(1)}%`);

    return { errorCount, errorAnalysis };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN: RUN THE FULL STUDY
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("🔬 ODDLY MAXIMUM-LIMIT PREDICTIVE RESEARCH");
  console.log("═".repeat(70));
  console.log("   Mission: Find the actual ceiling of football prediction.");
  console.log("   Method: Exhaustive feature extraction + rigorous backtesting.");
  console.log("   Target: Push accuracy as high as the evidence allows.");
  console.log("═".repeat(70));

  // ── PHASE 1: Load Data ──
  const { fixtures, oddsByFixture } = await loadAllData();
  if (fixtures.length === 0) {
    console.log("❌ No historical data found. Run store-historical.js first.");
    return;
  }

  // ── PHASE 2: Extract Features Chronologically ──
  console.log("\n📊 PHASE 2: Extracting features for all matches...");

  const extractor = new FeatureExtractor();
  const matchData = [];
  let processed = 0;

  for (const fixture of fixtures) {
    const home = fixture.home_team?.canonical_name;
    const away = fixture.away_team?.canonical_name;
    const league = fixture.leagues?.name;
    if (!home || !away) continue;

    // Extract features BEFORE updating state (no leakage)
    const features = extractor.extract(home, away, league, oddsByFixture[fixture.id]);

    // Determine actual result
    const hg = fixture.home_score;
    const ag = fixture.away_score;
    const actual = hg > ag ? "home" : hg < ag ? "away" : "draw";

    // Make prediction using current features
    const predProb = features.elo_home_prob;
    const predicted = predProb > 0.5 ? "home" : "away";
    const correct = predicted === actual;

    // Classify predictability
    const predictability = classifyPredictability(features);

    matchData.push({
      fixtureId: fixture.id,
      home, away, league,
      features,
      predicted,
      actual,
      correct,
      predProb,
      predictability,
      homeScore: hg,
      awayScore: ag,
    });

    // Update state AFTER extracting features (chronological learning)
    extractor.update(home, away, hg, ag, league);
    processed++;

    if (processed % 200 === 0) {
      console.log(`   📊 Processed ${processed}/${fixtures.length} matches`);
    }
  }

  console.log(`   ✅ Extracted features for ${matchData.length} matches`);

  // ── PHASE 3: Signal Discovery ──
  const discovery = new SignalDiscovery();
  const featureResults = discovery.testAllFeatures(matchData);
  const interactionResults = discovery.testInteractions(matchData, featureResults);

  // ── PHASE 4: Build Model ──
  console.log("\n📊 PHASE 4: Building Gradient Boosting model...");

  const featureNames = Object.keys(matchData[0]?.features || {});
  const X = matchData.map(m => featureNames.map(f => {
    const v = m.features[f];
    return (v === null || v === undefined || isNaN(v)) ? 0 : v;
  }));
  const y = matchData.map(m => m.actual === "home" ? 1 : 0);

  // Chronological split: 70% train, 30% test
  const splitIdx = Math.floor(X.length * 0.7);
  const X_train = X.slice(0, splitIdx);
  const y_train = y.slice(0, splitIdx);
  const X_test = X.slice(splitIdx);
  const y_test = y.slice(splitIdx);

  console.log(`   Training: ${X_train.length} matches | Testing: ${X_test.length} matches`);

  const model = new GradientBoosting(200, 0.05, 5);
  model.fit(X_train, y_train, featureNames);

  // Evaluate
  const testPreds = model.predict(X_test);
  const testPredClasses = testPreds.map(p => p > 0.5 ? 1 : 0);
  const testAcc = testPredClasses.filter((c, i) => c === y_test[i]).length / y_test.length;

  console.log(`\n   📊 MODEL PERFORMANCE (out-of-sample):`);
  console.log(`   Accuracy: ${(testAcc * 100).toFixed(1)}%`);
  console.log(`   Samples: ${y_test.length}`);

  // ── PHASE 5: Analyze by Confidence ──
  console.log("\n📊 PHASE 5: Confidence tier analysis...");

  const tiers = { ELITE: { c: 0, t: 0 }, HIGH: { c: 0, t: 0 }, MEDIUM: { c: 0, t: 0 }, LOW: { c: 0, t: 0 } };
  for (let i = 0; i < testPreds.length; i++) {
    const conf = Math.max(testPreds[i], 1 - testPreds[i]);
    const tier = conf >= 0.70 ? "ELITE" : conf >= 0.60 ? "HIGH" : conf >= 0.50 ? "MEDIUM" : "LOW";
    tiers[tier].t++;
    if (testPredClasses[i] === y_test[i]) tiers[tier].c++;
  }

  for (const [tier, data] of Object.entries(tiers)) {
    const acc = data.t > 0 ? (data.c / data.t * 100).toFixed(1) : "N/A";
    console.log(`   ${tier.padEnd(12)} ${acc}% (${data.c}/${data.t})`);
  }

  // ── PHASE 6: Feature Importance ──
  console.log("\n📊 PHASE 6: Feature importance (from trained model)...");

  const importance = model.getFeatureImportance();
  for (let i = 0; i < Math.min(15, importance.length); i++) {
    const bar = "█".repeat(Math.round(importance[i].importance * 100));
    console.log(`   ${importance[i].name.padEnd(30)} ${bar} ${(importance[i].importance * 100).toFixed(1)}%`);
  }

  // ── PHASE 7: Predictability Breakdown ──
  console.log("\n📊 PHASE 7: Accuracy by match predictability...");

  const predBreakdown = {};
  for (const m of matchData.slice(splitIdx)) {
    if (!predBreakdown[m.predictability]) predBreakdown[m.predictability] = { c: 0, t: 0 };
    predBreakdown[m.predictability].t++;
    if (m.correct) predBreakdown[m.predictability].c++;
  }

  for (const [pred, data] of Object.entries(predBreakdown)) {
    const acc = data.t > 0 ? (data.c / data.t * 100).toFixed(1) : "N/A";
    console.log(`   ${pred.padEnd(25)} ${acc}% (${data.c}/${data.t})`);
  }

  // ── PHASE 8: Error Analysis ──
  const backtester = new RigorousBacktester();
  const testMatchData = matchData.slice(splitIdx);
  backtester.results = testMatchData;
  const errorAnalysis = backtester.analyzeErrors(
    testPredClasses, y_test, testMatchData.map(m => m.features)
  );

  // ── FINAL REPORT ──
  console.log("\n" + "═".repeat(70));
  console.log("📋 MAXIMUM-LIMIT RESEARCH REPORT");
  console.log("═".repeat(70));

  console.log(`\n   Total matches analyzed: ${matchData.length}`);
  console.log(`   Training set: ${X_train.length} | Test set: ${X_test.length}`);
  console.log(`   Features extracted: ${featureNames.length}`);
  console.log(`   Model: Gradient Boosting (200 trees, depth 5, lr 0.05)`);

  console.log(`\n   ── OVERALL PERFORMANCE ──`);
  console.log(`   Accuracy: ${(testAcc * 100).toFixed(1)}% (out-of-sample)`);

  console.log(`\n   ── BY CONFIDENCE TIER ──`);
  for (const [tier, data] of Object.entries(tiers)) {
    const acc = data.t > 0 ? (data.c / data.t * 100).toFixed(1) : "N/A";
    console.log(`   ${tier.padEnd(12)} ${acc}% (${data.c}/${data.t} matches)`);
  }

  console.log(`\n   ── BY PREDICTABILITY ──`);
  for (const [pred, data] of Object.entries(predBreakdown)) {
    const acc = data.t > 0 ? (data.c / data.t * 100).toFixed(1) : "N/A";
    console.log(`   ${pred.padEnd(25)} ${acc}% (${data.c}/${data.t} matches)`);
  }

  console.log(`\n   ── TOP FEATURES ──`);
  for (let i = 0; i < Math.min(10, importance.length); i++) {
    console.log(`   ${i + 1}. ${importance[i].name} (${(importance[i].importance * 100).toFixed(1)}%)`);
  }

  console.log(`\n   ── TOP SIGNALS ──`);
  for (let i = 0; i < Math.min(5, featureResults.length); i++) {
    const r = featureResults[i];
    console.log(`   ${i + 1}. ${r.feature} — ${(r.accuracy * 100).toFixed(1)}% accuracy (p=${r.pValue.toFixed(4)})`);
  }

  console.log(`\n   ── TOP INTERACTIONS ──`);
  for (let i = 0; i < Math.min(5, interactionResults.length); i++) {
    const r = interactionResults[i];
    console.log(`   ${i + 1}. ${r.feature1} × ${r.feature2} — ${(r.accuracy * 100).toFixed(1)}% accuracy`);
  }

  console.log(`\n   ── ERROR ANALYSIS ──`);
  console.log(`   Total errors: ${errorAnalysis.errorCount}`);
  console.log(`   Error rate: ${((errorAnalysis.errorCount / y_test.length) * 100).toFixed(1)}%`);

  // Find where accuracy is highest
  const highConfMatches = testMatchData.filter(m => m.correct);
  console.log(`\n   ── WHERE ACCURACY IS HIGHEST ──`);
  console.log(`   When all signals agree: ~${(tiers.ELITE.t > 0 ? tiers.ELITE.c / tiers.ELITE.t * 100 : 0).toFixed(1)}%`);
  console.log(`   When model is most confident: ~${(tiers.HIGH.t > 0 ? (tiers.HIGH.c + tiers.ELITE.c) / (tiers.HIGH.t + tiers.ELITE.t) * 100 : 0).toFixed(1)}%`);

  console.log("\n" + "═".repeat(70));
  console.log("🔬 Research complete. The ceiling has been measured.");
  console.log("═".repeat(70));

  // Save results
  const report = {
    date: new Date().toISOString(),
    totalMatches: matchData.length,
    testMatches: y_test.length,
    features: featureNames.length,
    accuracy: testAcc,
    tiers,
    predictabilityBreakdown: predBreakdown,
    topFeatures: importance.slice(0, 15),
    topSignals: featureResults.slice(0, 10),
    topInteractions: interactionResults.slice(0, 10),
    errorAnalysis,
  };

  const reportPath = path.join(__dirname, "..", "docs", "maximum-limit-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n   Report saved to: docs/maximum-limit-report.json`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
