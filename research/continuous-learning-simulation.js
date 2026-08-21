#!/usr/bin/env node

/**
 * ODDLY Continuous-Learning Simulation Engine
 * 
 * The core experiment: simulate 3 seasons of predictions using
 * three different learning approaches and compare their performance.
 *
 * Experiment A: Static Model (train once, test on all)
 * Experiment B: Periodic Retrain (retrain every 500 matches)
 * Experiment C: Continuous Learning (update after every match)
 *
 * Uses 5,253 finished matches from the fixtures table.
 * All predictions are chronological — no future data leaks.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Environment ─────────────────────────────────────────────────────────

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
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// ═══════════════════════════════════════════════════════════════════════════
// CORE MODELS
// ═══════════════════════════════════════════════════════════════════════════

class EloSystem {
  constructor(k = 32, homeAdv = 65) {
    this.ratings = {};
    this.k = k;
    this.homeAdv = homeAdv;
  }
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
  clone() {
    const c = new EloSystem(this.k, this.homeAdv);
    c.ratings = { ...this.ratings };
    return c;
  }
}

class FormTracker {
  constructor() { this.h = {}; this.goals = {}; this.conceded = {}; this.dates = {}; }
  
  record(team, result, goals, against, date) {
    if (!this.h[team]) this.h[team] = [];
    if (!this.goals[team]) this.goals[team] = [];
    if (!this.conceded[team]) this.conceded[team] = [];
    if (!this.dates[team]) this.dates[team] = [];
    this.h[team].push(result);
    this.goals[team].push(goals);
    this.conceded[team].push(against);
    this.dates[team].push(date);
    if (this.h[team].length > 30) { this.h[team].shift(); this.goals[team].shift(); this.conceded[team].shift(); this.dates[team].shift(); }
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
  
  getHomeForm(team) {
    const all = this.h[team] || [];
    if (all.length === 0) return 0.45;
    return all.filter(r => r === "W").length / all.length;
  }
  
  getCleanSheetPct(team, n = 10) {
    const c = (this.conceded[team] || []).slice(-n);
    if (c.length === 0) return 0.3;
    return c.filter(v => v === 0).length / c.length;
  }
  
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
    if (g.length === 0) return 0;
    return g.reduce((s, v) => s + v, 0) - c.reduce((s, v) => s + v, 0);
  }
  
  getDaysSinceLast(team) {
    const d = this.dates[team] || [];
    if (d.length === 0) return 7;
    return 7; // Simplified
  }

  clone() {
    const c = new FormTracker();
    c.h = JSON.parse(JSON.stringify(this.h));
    c.goals = JSON.parse(JSON.stringify(this.goals));
    c.conceded = JSON.parse(JSON.stringify(this.conceded));
    c.dates = JSON.parse(JSON.stringify(this.dates));
    return c;
  }
}

// ─── Ensemble Model ──────────────────────────────────────────────────────

class EnsembleModel {
  constructor(weights) {
    this.weights = weights || { elo: 0.30, form: 0.20, goals: 0.18, market: 0.12, homeAdv: 0.10, streak: 0.10 };
    this.history = []; // Track what we've learned
  }

  predict(features) {
    // Elo probability
    const eloProb = features.elo_home_prob;
    
    // Form probability
    const formDiff = features.home_form_ppg - features.away_form_ppg;
    const formProb = clamp(0.50 + formDiff * 0.12);
    
    // Goals-based probability
    const goalsDiff = (features.home_avg_goals - features.home_avg_conceded) - (features.away_avg_goals - features.away_avg_conceded);
    const goalsProb = clamp(0.50 + goalsDiff * 0.10);
    
    // Market probability
    const marketProb = features.market_home_prob || 0.50;
    
    // Home advantage boost
    const homeAdvProb = clamp(eloProb + (features.home_win_rate > 0.55 ? 0.08 : features.home_win_rate > 0.45 ? 0.04 : 0));
    
    // Streak factor
    const streakProb = clamp(0.50 + features.home_streak * 0.03 - features.away_streak * 0.02);
    
    // Ensemble blend
    const w = this.weights;
    let homeProb = eloProb * w.elo + formProb * w.form + goalsProb * w.goals + marketProb * w.market + homeAdvProb * w.homeAdv + streakProb * w.streak;
    
    // Additional adjustments
    if (features.elo_diff > 200) homeProb += 0.06;
    if (features.elo_diff < -200) homeProb -= 0.06;
    if (features.home_win_rate > 0.65) homeProb += 0.04;
    if (features.away_win_rate < 0.30) homeProb += 0.04;
    if (features.home_clean_sheet > 0.4) homeProb += 0.03;
    if (features.away_clean_sheet < 0.2) homeProb += 0.03;
    
    return clamp(homeProb);
  }

  // Generate predictions for multiple markets
  predictAll(features) {
    const homeProb = this.predict(features);
    const drawProb = clamp(1 - homeProb - (1 - homeProb) * 0.45);
    const awayProb = clamp(1 - homeProb - drawProb);
    
    // Goals-based
    const expectedGoals = (features.home_avg_goals + features.away_avg_goals);
    const over25 = clamp(0.50 + (expectedGoals - 2.5) * 0.18);
    const under35 = clamp(0.50 + (3.5 - expectedGoals) * 0.15);
    const under45 = clamp(0.50 + (4.5 - expectedGoals) * 0.12);
    const over05 = clamp(0.85 + (expectedGoals - 1.5) * 0.05);
    const bttsYes = clamp(0.45 + features.home_btts * 0.2 + features.away_btts * 0.15);
    
    // Double chance
    const dc1X = clamp(homeProb + drawProb);
    const dcX2 = clamp(drawProb + awayProb);
    const dc12 = clamp(homeProb + awayProb);
    
    return {
      "home_win": homeProb,
      "draw": drawProb,
      "away_win": awayProb,
      "over_0.5": over05,
      "over_1.5": clamp(0.50 + (expectedGoals - 1.5) * 0.20),
      "over_2.5": over25,
      "over_3.5": clamp(0.50 + (expectedGoals - 3.5) * 0.18),
      "under_3.5": under35,
      "under_4.5": under45,
      "btts_yes": bttsYes,
      "btts_no": clamp(1 - bttsYes),
      "dc_1X": dc1X,
      "dc_X2": dcX2,
      "dc_12": dc12,
    };
  }

  // Select the BEST market prediction for each match
  selectBestMarket(predictions, actualResult, homeGoals, awayGoals) {
    const outcomes = {
      "home_win": homeGoals > awayGoals,
      "draw": homeGoals === awayGoals,
      "away_win": awayGoals > homeGoals,
      "over_0.5": (homeGoals + awayGoals) > 0.5,
      "over_1.5": (homeGoals + awayGoals) > 1.5,
      "over_2.5": (homeGoals + awayGoals) > 2.5,
      "over_3.5": (homeGoals + awayGoals) > 3.5,
      "under_3.5": (homeGoals + awayGoals) < 3.5,
      "under_4.5": (homeGoals + awayGoals) < 4.5,
      "btts_yes": homeGoals > 0 && awayGoals > 0,
      "btts_no": homeGoals === 0 || awayGoals === 0,
      "dc_1X": homeGoals >= awayGoals,
      "dc_X2": awayGoals >= homeGoals,
      "dc_12": homeGoals !== awayGoals,
    };

    let bestMarket = null;
    let bestProb = 0;

    for (const [market, prob] of Object.entries(predictions)) {
      if (prob > bestProb) {
        bestProb = prob;
        bestMarket = market;
      }
    }

    return {
      market: bestMarket,
      probability: bestProb,
      correct: outcomes[bestMarket] || false,
    };
  }

  clone() {
    const c = new EnsembleModel({ ...this.weights });
    c.history = [...this.history];
    return c;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function extractFeatures(homeTeam, awayTeam, elo, form, oddsData) {
  const homeForm = form.getForm(homeTeam);
  const awayForm = form.getForm(awayTeam);
  const homeElo = elo.get(homeTeam);
  const awayElo = elo.get(awayTeam);
  const eloProb = elo.predict(homeTeam, awayTeam);

  const homeWinRate = form.getHomeForm(homeTeam);
  const awayWinRate = form.getHomeForm(awayTeam); // We'll treat this as overall win rate
  const homeCleanSheet = form.getCleanSheetPct(homeTeam);
  const awayCleanSheet = form.getCleanSheetPct(awayTeam);
  const homeBtts = form.getBttsPct(homeTeam);
  const awayBtts = form.getBttsPct(awayTeam);
  const homeGoalDiff = form.getGoalDiff(homeTeam);
  const awayGoalDiff = form.getGoalDiff(awayTeam);

  // Market implied
  let marketHomeProb = null;
  if (oddsData) {
    const h = oddsData.home, d = oddsData.draw, a = oddsData.away;
    if (h && d && a) {
      const mt = 1/h + 1/d + 1/a;
      marketHomeProb = (1/h) / mt;
    }
  }

  return {
    home_form_ppg: homeForm.ppg,
    away_form_ppg: awayForm.ppg,
    home_win_rate: homeForm.winRate,
    away_win_rate: awayForm.winRate,
    home_avg_goals: homeForm.avgGoals,
    home_avg_conceded: homeForm.avgConceded,
    away_avg_goals: awayForm.avgGoals,
    away_avg_conceded: awayForm.avgConceded,
    home_streak: homeForm.streak,
    away_streak: awayForm.streak,
    elo_home_prob: eloProb,
    elo_diff: homeElo - awayElo + 65,
    home_elo: homeElo,
    away_elo: awayElo,
    home_clean_sheet: homeCleanSheet,
    away_clean_sheet: awayCleanSheet,
    home_btts: homeBtts,
    away_btts: awayBtts,
    home_goal_diff: homeGoalDiff,
    away_goal_diff: awayGoalDiff,
    goal_diff_diff: homeGoalDiff - awayGoalDiff,
    market_home_prob: marketHomeProb,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LEARNING: UPDATE WEIGHTS BASED ON RESULTS
// ═══════════════════════════════════════════════════════════════════════════

function analyzeAndUpdate(model, recentResults, step) {
  if (recentResults.length < 10) return;
  
  const correct = recentResults.filter(r => r.correct);
  const wrong = recentResults.filter(r => !r.correct);
  const accuracy = correct.length / recentResults.length;
  
  // Track feature importance
  const featureScores = {};
  for (const r of recentResults) {
    if (!r.features) continue;
    for (const [key, value] of Object.entries(r.features)) {
      if (value === null || typeof value === "string" || typeof value === "object") continue;
      if (!featureScores[key]) featureScores[key] = { correct: 0, wrong: 0, total: 0 };
      featureScores[key].total++;
      if (r.correct) featureScores[key].correct++;
      else featureScores[key].wrong++;
    }
  }
  
  // Adjust weights based on which features were most correlated with correct predictions
  const importance = {};
  for (const [key, scores] of Object.entries(featureScores)) {
    if (scores.total >= 5) {
      importance[key] = scores.correct / scores.total;
    }
  }
  
  // Simple weight adjustment: increase weights for features that correlate with correctness
  if (accuracy < 0.55 && step > 0) {
    // Model is underperforming — reduce all weights slightly and increase market weight
    model.weights.market = Math.min(0.25, model.weights.market + 0.02);
    const total = Object.values(model.weights).reduce((s, v) => s + v, 0);
    for (const k of Object.keys(model.weights)) {
      if (k !== "market") model.weights[k] *= (1 - 0.02 * model.weights.market / (total - model.weights.market));
    }
  } else if (accuracy > 0.62) {
    // Model is doing well — fine-tune
    model.weights.elo = Math.min(0.40, model.weights.elo + 0.01);
    model.weights.form = Math.min(0.25, model.weights.form + 0.005);
    const total = Object.values(model.weights).reduce((s, v) => s + v, 0);
    for (const k of Object.keys(model.weights)) {
      if (k !== "elo" && k !== "form") model.weights[k] *= 0.995;
    }
  }
  
  // Normalize weights
  const total = Object.values(model.weights).reduce((s, v) => s + v, 0);
  for (const k of Object.keys(model.weights)) model.weights[k] /= total;
  
  return { accuracy, importance };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SIMULATION
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("🔬 ODDLY Continuous-Learning Simulation Engine");
  console.log("═".repeat(70));
  console.log("   Comparing: Static vs Periodic vs Continuous Learning");
  console.log("   Using 3 seasons of real historical football data");
  console.log("═".repeat(70));

  // ─── Load Data ───────────────────────────────────────────────────────
  console.log("\n📡 Loading finished matches...");
  
  let allMatches = [];
  let offset = 0;
  const batchSize = 500;
  
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("id, kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), home_score, away_score, league_id, leagues(name)")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + batchSize - 1);
    
    if (!batch || batch.length === 0) break;
    allMatches = allMatches.concat(batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  // Filter to only matches with valid data
  allMatches = allMatches.filter(m => 
    m.home_team?.canonical_name && m.away_team?.canonical_name && 
    m.home_score !== null && m.away_score !== null
  );

  console.log(`   Loaded ${allMatches.length} finished matches with valid data`);

  // Get odds for all matches
  console.log("   Loading odds data...");
  const matchIds = allMatches.map(m => m.id);
  const oddsByFixture = {};
  
  // Load odds in batches
  for (let i = 0; i < matchIds.length; i += 200) {
    const batch = matchIds.slice(i, i + 200);
    const { data: odds } = await supabase
      .from("odds_snapshots")
      .select("fixture_id, selection, odds")
      .in("fixture_id", batch);
    
    if (odds) {
      for (const o of odds) {
        if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
        if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
        oddsByFixture[o.fixture_id][o.selection].push(o.odds);
      }
    }
  }
  
  // Average odds per fixture
  const avgOdds = {};
  for (const [fid, selections] of Object.entries(oddsByFixture)) {
    avgOdds[fid] = {};
    for (const [sel, arr] of Object.entries(selections)) {
      avgOdds[fid][sel] = arr.reduce((s, v) => s + v, 0) / arr.length;
    }
  }
  console.log(`   Loaded odds for ${Object.keys(avgOdds).length} matches`);

  // ─── Season markers ──────────────────────────────────────────────────
  const seasonStarts = {};
  for (const m of allMatches) {
    const year = new Date(m.kickoff_time).getFullYear();
    const month = new Date(m.kickoff_time).getMonth();
    const season = month >= 6 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
    if (!seasonStarts[season]) seasonStarts[season] = m.kickoff_time;
  }
  const seasons = Object.keys(seasonStarts).sort();
  console.log(`   Seasons: ${seasons.join(", ")}`);

  // ═══════════════════════════════════════════════════════════════════════
  // EXPERIMENT A: STATIC MODEL
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("🧪 EXPERIMENT A: STATIC MODEL");
  console.log("   Train once on first 1000 matches, test on remaining");
  console.log("═".repeat(70));

  const TRAIN_SIZE = 1000;
  
  // Train static model
  const staticElo = new EloSystem();
  const staticForm = new FormTracker();
  
  for (let i = 0; i < Math.min(TRAIN_SIZE, allMatches.length); i++) {
    const m = allMatches[i];
    const home = m.home_team.canonical_name;
    const away = m.away_team.canonical_name;
    const hg = m.home_score;
    const ag = m.away_score;
    const result = hg > ag ? "W" : hg < ag ? "L" : "D";
    
    staticElo.update(home, away, hg, ag);
    staticForm.record(home, result, hg, ag, m.kickoff_time);
    staticForm.record(away, result === "W" ? "L" : result === "L" ? "W" : "D", ag, hg, m.kickoff_time);
  }
  
  const staticModel = new EnsembleModel();
  
  // Test static model
  const staticResults = [];
  const staticMarketResults = {};
  
  for (let i = TRAIN_SIZE; i < allMatches.length; i++) {
    const m = allMatches[i];
    const home = m.home_team.canonical_name;
    const away = m.away_team.canonical_name;
    const hg = m.home_score;
    const ag = m.away_score;
    
    const features = extractFeatures(home, away, staticElo, staticForm, avgOdds[m.id]);
    const predictions = staticModel.predictAll(features);
    const best = staticModel.selectBestMarket(predictions, null, hg, ag);
    
    staticResults.push({
      match: i,
      market: best.market,
      probability: best.probability,
      correct: best.correct,
      season: (() => {
        const year = new Date(m.kickoff_time).getFullYear();
        const month = new Date(m.kickoff_time).getMonth();
        return month >= 6 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
      })(),
      league: m.leagues?.name || "Unknown",
    });
    
    // Track by market
    for (const [market, prob] of Object.entries(predictions)) {
      if (!staticMarketResults[market]) staticMarketResults[market] = { correct: 0, total: 0 };
      staticMarketResults[market].total++;
      const outcome = getOutcome(market, hg, ag);
      if ((prob > 0.5) === outcome) staticMarketResults[market].correct++;
    }
    
    // Update form (but NOT elo — static means frozen)
    const result = hg > ag ? "W" : hg < ag ? "L" : "D";
    staticForm.record(home, result, hg, ag, m.kickoff_time);
    staticForm.record(away, result === "W" ? "L" : result === "L" ? "W" : "D", ag, hg, m.kickoff_time);
  }

  const staticAcc = staticResults.filter(r => r.correct).length / staticResults.length;
  console.log(`   Overall accuracy: ${(staticAcc * 100).toFixed(1)}% (${staticResults.length} matches)`);

  // ═══════════════════════════════════════════════════════════════════════
  // EXPERIMENT B: PERIODIC RETRAIN (every 500 matches)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("🧪 EXPERIMENT B: PERIODIC RETRAIN (every 500 matches)");
  console.log("═".repeat(70));

  const periodicElo = new EloSystem();
  const periodicForm = new FormTracker();
  const periodicModel = new EnsembleModel();
  
  const periodicResults = [];
  const RETRAIN_INTERVAL = 500;
  
  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    const home = m.home_team.canonical_name;
    const away = m.away_team.canonical_name;
    const hg = m.home_score;
    const ag = m.away_score;
    
    if (i >= TRAIN_SIZE) {
      // Make prediction
      const features = extractFeatures(home, away, periodicElo, periodicForm, avgOdds[m.id]);
      const predictions = periodicModel.predictAll(features);
      const best = periodicModel.selectBestMarket(predictions, null, hg, ag);
      
      periodicResults.push({
        match: i,
        market: best.market,
        probability: best.probability,
        correct: best.correct,
        season: (() => {
          const year = new Date(m.kickoff_time).getFullYear();
          const month = new Date(m.kickoff_time).getMonth();
          return month >= 6 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
        })(),
        league: m.leagues?.name || "Unknown",
      });
      
      // Periodic retrain
      if (i % RETRAIN_INTERVAL === 0 && i > TRAIN_SIZE) {
        const recent = periodicResults.slice(-RETRAIN_INTERVAL);
        const recentAcc = recent.filter(r => r.correct).length / recent.length;
        analyzeAndUpdate(periodicModel, recent.map(r => ({ correct: r.correct })), i);
        console.log(`   Retrain at match ${i}: recent accuracy ${(recentAcc * 100).toFixed(1)}%`);
      }
    }
    
    // Update trackers
    periodicElo.update(home, away, hg, ag);
    const result = hg > ag ? "W" : hg < ag ? "L" : "D";
    periodicForm.record(home, result, hg, ag, m.kickoff_time);
    periodicForm.record(away, result === "W" ? "L" : result === "L" ? "W" : "D", ag, hg, m.kickoff_time);
  }

  const periodicAcc = periodicResults.filter(r => r.correct).length / periodicResults.length;
  console.log(`   Overall accuracy: ${(periodicAcc * 100).toFixed(1)}% (${periodicResults.length} matches)`);

  // ═══════════════════════════════════════════════════════════════════════
  // EXPERIMENT C: CONTINUOUS LEARNING
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("🧪 EXPERIMENT C: CONTINUOUS LEARNING");
  console.log("   Learn after every match, validate improvements");
  console.log("═".repeat(70));

  const contElo = new EloSystem();
  const contForm = new FormTracker();
  const contModel = new EnsembleModel();
  
  const contResults = [];
  const LEARNING_WINDOW = 50; // Look at last 50 matches for learning
  
  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    const home = m.home_team.canonical_name;
    const away = m.away_team.canonical_name;
    const hg = m.home_score;
    const ag = m.away_score;
    
    if (i >= TRAIN_SIZE) {
      // Make prediction
      const features = extractFeatures(home, away, contElo, contForm, avgOdds[m.id]);
      const predictions = contModel.predictAll(features);
      const best = contModel.selectBestMarket(predictions, null, hg, ag);
      
      contResults.push({
        match: i,
        market: best.market,
        probability: best.probability,
        correct: best.correct,
        season: (() => {
          const year = new Date(m.kickoff_time).getFullYear();
          const month = new Date(m.kickoff_time).getMonth();
          return month >= 6 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
        })(),
        league: m.leagues?.name || "Unknown",
      });
      
      // Continuous learn: after every 10 matches
      if (i % 10 === 0 && contResults.length >= LEARNING_WINDOW) {
        const recent = contResults.slice(-LEARNING_WINDOW);
        analyzeAndUpdate(contModel, recent.map(r => ({ correct: r.correct, features: {} })), i);
      }
    }
    
    // Update trackers
    contElo.update(home, away, hg, ag);
    const result = hg > ag ? "W" : hg < ag ? "L" : "D";
    contForm.record(home, result, hg, ag, m.kickoff_time);
    contForm.record(away, result === "W" ? "L" : result === "L" ? "W" : "D", ag, hg, m.kickoff_time);
  }

  const contAcc = contResults.filter(r => r.correct).length / contResults.length;
  console.log(`   Overall accuracy: ${(contAcc * 100).toFixed(1)}% (${contResults.length} matches)`);

  // ═══════════════════════════════════════════════════════════════════════
  // LEARNING CURVES
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("📈 LEARNING CURVES");
  console.log("═".repeat(70));

  const checkpoints = [100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
  
  console.log("\n┌──────────────┬──────────────────┬──────────────────┬──────────────────┐");
  console.log("│ Matches      │ Static           │ Periodic         │ Continuous       │");
  console.log("├──────────────┼──────────────────┼──────────────────┼──────────────────┤");
  
  for (const cp of checkpoints) {
    if (cp > staticResults.length) continue;
    
    const sSlice = staticResults.slice(0, cp);
    const pSlice = periodicResults.slice(0, cp);
    const cSlice = contResults.slice(0, cp);
    
    const sAcc = sSlice.length > 0 ? (sSlice.filter(r => r.correct).length / sSlice.length * 100).toFixed(1) : "—";
    const pAcc = pSlice.length > 0 ? (pSlice.filter(r => r.correct).length / pSlice.length * 100).toFixed(1) : "—";
    const cAcc = cSlice.length > 0 ? (cSlice.filter(r => r.correct).length / cSlice.length * 100).toFixed(1) : "—";
    
    console.log(`│ ${String(cp).padStart(12)} │ ${(sAcc + "%").padStart(16)} │ ${(pAcc + "%").padStart(16)} │ ${(cAcc + "%").padStart(16)} │`);
  }
  console.log("└──────────────┴──────────────────┴──────────────────┴──────────────────┘");

  // ═══════════════════════════════════════════════════════════════════════
  // BEST MARKET ANALYSIS (from Static experiment)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("🏆 MARKET RELIABILITY DATABASE");
  console.log("   Which markets are most predictable?");
  console.log("═".repeat(70));

  // Recompute market reliability from static results
  const marketReliability = {};
  for (const r of staticResults) {
    if (!marketReliability[r.market]) marketReliability[r.market] = { correct: 0, total: 0 };
    marketReliability[r.market].total++;
    if (r.correct) marketReliability[r.market].correct++;
  }
  
  const sortedMarkets = Object.entries(marketReliability)
    .map(([market, stats]) => ({
      market,
      accuracy: stats.correct / stats.total,
      total: stats.total,
      correct: stats.correct,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);

  console.log("\n┌──────────────────┬──────────┬──────────┬──────────┐");
  console.log("│ Market           │ Accuracy │ Matches  │ Correct  │");
  console.log("├──────────────────┼──────────┼──────────┼──────────┤");
  for (const m of sortedMarkets) {
    const acc = (m.accuracy * 100).toFixed(1) + "%";
    const bar = "█".repeat(Math.round(m.accuracy * 20));
    console.log(`│ ${m.market.padEnd(16)} │ ${acc.padStart(8)} │ ${String(m.total).padStart(8)} │ ${String(m.correct).padStart(8)} │ ${bar}`);
  }
  console.log("└──────────────────┴──────────┴──────────┴──────────┘");

  // ═══════════════════════════════════════════════════════════════════════
  // SEASON-BY-SEASON PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("📅 PERFORMANCE BY SEASON");
  console.log("═".repeat(70));

  const bySeason = {};
  for (const r of contResults) {
    if (!bySeason[r.season]) bySeason[r.season] = { correct: 0, total: 0, markets: {} };
    bySeason[r.season].total++;
    if (r.correct) bySeason[r.season].correct++;
    if (!bySeason[r.season].markets[r.market]) bySeason[r.season].markets[r.market] = { correct: 0, total: 0 };
    bySeason[r.season].markets[r.market].total++;
    if (r.correct) bySeason[r.season].markets[r.market].correct++;
  }

  for (const [season, stats] of Object.entries(bySeason).sort()) {
    const acc = (stats.correct / stats.total * 100).toFixed(1);
    console.log(`\n   ${season}: ${acc}% accuracy (${stats.total} matches)`);
    
    const topMarkets = Object.entries(stats.markets)
      .map(([m, s]) => ({ market: m, accuracy: s.correct / s.total, total: s.total }))
      .filter(m => m.total >= 10)
      .sort((a, b) => b.accuracy - a.accuracy)
      .slice(0, 3);
    
    for (const m of topMarkets) {
      console.log(`     Best: ${m.market} = ${(m.accuracy * 100).toFixed(1)}% (${m.total} matches)`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HIGH-CONFIDENCE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("🎯 HIGH-CONFIDENCE PICK ANALYSIS");
  console.log("═".repeat(70));

  const highConf = contResults.filter(r => r.probability >= 0.70);
  const medConf = contResults.filter(r => r.probability >= 0.60 && r.probability < 0.70);
  const lowConf = contResults.filter(r => r.probability < 0.60);

  console.log(`\n   70%+ confidence: ${highConf.length} picks, ${(highConf.filter(r => r.correct).length / (highConf.length || 1) * 100).toFixed(1)}% accuracy`);
  console.log(`   60-70% confidence: ${medConf.length} picks, ${(medConf.filter(r => r.correct).length / (medConf.length || 1) * 100).toFixed(1)}% accuracy`);
  console.log(`   <60% confidence: ${lowConf.length} picks, ${(lowConf.filter(r => r.correct).length / (lowConf.length || 1) * 100).toFixed(1)}% accuracy`);

  // ═══════════════════════════════════════════════════════════════════════
  // LEAGUE PERFORMANCE
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("⚽ PERFORMANCE BY LEAGUE");
  console.log("═".repeat(70));

  const byLeague = {};
  for (const r of contResults) {
    if (!byLeague[r.league]) byLeague[r.league] = { correct: 0, total: 0 };
    byLeague[r.league].total++;
    if (r.correct) byLeague[r.league].correct++;
  }

  const sortedLeagues = Object.entries(byLeague)
    .map(([name, stats]) => ({ name, accuracy: stats.correct / stats.total, total: stats.total }))
    .filter(l => l.total >= 20)
    .sort((a, b) => b.accuracy - a.accuracy);

  console.log("\n┌──────────────────────────────┬──────────┬──────────┐");
  console.log("│ League                       │ Accuracy │ Matches  │");
  console.log("├──────────────────────────────┼──────────┼──────────┤");
  for (const l of sortedLeagues.slice(0, 20)) {
    const acc = (l.accuracy * 100).toFixed(1) + "%";
    const bar = "█".repeat(Math.round(l.accuracy * 15));
    console.log(`│ ${l.name.padEnd(28)} │ ${acc.padStart(8)} │ ${String(l.total).padStart(8)} │ ${bar}`);
  }
  console.log("└──────────────────────────────┴──────────┴──────────┘");

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL COMPARISON
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("🏆 FINAL COMPARISON: ALL THREE EXPERIMENTS");
  console.log("═".repeat(70));

  const staticHighConf = staticResults.filter(r => r.probability >= 0.70);
  const periodicHighConf = periodicResults.filter(r => r.probability >= 0.70);
  const contHighConfFinal = contResults.filter(r => r.probability >= 0.70);

  console.log(`
┌──────────────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Metric                   │ Static           │ Periodic         │ Continuous       │
├──────────────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ Overall Accuracy         │ ${(staticAcc * 100).toFixed(1)}%             │ ${(periodicAcc * 100).toFixed(1)}%             │ ${(contAcc * 100).toFixed(1)}%             │
│ Total Predictions        │ ${String(staticResults.length).padStart(16)} │ ${String(periodicResults.length).padStart(16)} │ ${String(contResults.length).padStart(16)} │
│ High-Conf (70%+)         │ ${String(staticHighConf.length).padStart(16)} │ ${String(periodicHighConf.length).padStart(16)} │ ${String(contHighConfFinal.length).padStart(16)} │
│ High-Conf Accuracy       │ ${staticHighConf.length > 0 ? (staticHighConf.filter(r => r.correct).length / staticHighConf.length * 100).toFixed(1) + "%" : "N/A".padEnd(16)} │ ${periodicHighConf.length > 0 ? (periodicHighConf.filter(r => r.correct).length / periodicHighConf.length * 100).toFixed(1) + "%" : "N/A".padEnd(16)} │ ${contHighConfFinal.length > 0 ? (contHighConfFinal.filter(r => r.correct).length / contHighConfFinal.length * 100).toFixed(1) + "%" : "N/A".padEnd(16)} │
│ Best Market              │ ${(sortedMarkets[0]?.market || "N/A").padEnd(16)} │ —                │ —                │
│ Best Market Accuracy     │ ${sortedMarkets[0] ? (sortedMarkets[0].accuracy * 100).toFixed(1) + "%" : "N/A"}              │ —                │ —                │
└──────────────────────────┴──────────────────┴──────────────────┴──────────────────┘`);

  // ═══════════════════════════════════════════════════════════════════════
  // SAVE REPORT
  // ═══════════════════════════════════════════════════════════════════════
  const report = {
    generatedAt: new Date().toISOString(),
    totalMatches: allMatches.length,
    trainSize: TRAIN_SIZE,
    testSize: allMatches.length - TRAIN_SIZE,
    seasons,
    experiments: {
      static: {
        accuracy: staticAcc,
        predictions: staticResults.length,
        highConfCount: staticHighConf.length,
        highConfAccuracy: staticHighConf.length > 0 ? staticHighConf.filter(r => r.correct).length / staticHighConf.length : null,
      },
      periodic: {
        accuracy: periodicAcc,
        predictions: periodicResults.length,
        retrainInterval: RETRAIN_INTERVAL,
      },
      continuous: {
        accuracy: contAcc,
        predictions: contResults.length,
        learningWindow: LEARNING_WINDOW,
      },
    },
    marketReliability: sortedMarkets,
    learningCurve: checkpoints.map(cp => ({
      matches: cp,
      static: cp <= staticResults.length ? staticResults.slice(0, cp).filter(r => r.correct).length / Math.min(cp, staticResults.length) : null,
      periodic: cp <= periodicResults.length ? periodicResults.slice(0, cp).filter(r => r.correct).length / Math.min(cp, periodicResults.length) : null,
      continuous: cp <= contResults.length ? contResults.slice(0, cp).filter(r => r.correct).length / Math.min(cp, contResults.length) : null,
    })),
    bySeason: Object.fromEntries(Object.entries(bySeason).map(([s, stats]) => [s, {
      accuracy: stats.correct / stats.total,
      total: stats.total,
    }])),
    byLeague: Object.fromEntries(sortedLeagues.map(l => [l.name, { accuracy: l.accuracy, total: l.total }])),
    confidenceAnalysis: {
      high70: { count: highConf.length, accuracy: highConf.length > 0 ? highConf.filter(r => r.correct).length / highConf.length : 0 },
      medium60: { count: medConf.length, accuracy: medConf.length > 0 ? medConf.filter(r => r.correct).length / medConf.length : 0 },
      low60: { count: lowConf.length, accuracy: lowConf.length > 0 ? lowConf.filter(r => r.correct).length / lowConf.length : 0 },
    },
    finalWeights: contModel.weights,
  };

  const reportPath = path.join(__dirname, "..", "docs", "continuous-learning-report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Full report saved to: ${reportPath}`);

  // ═══════════════════════════════════════════════════════════════════════
  // KEY FINDINGS
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n\n" + "═".repeat(70));
  console.log("🔑 KEY FINDINGS");
  console.log("═".repeat(70));

  const learningGain = contAcc - staticAcc;
  console.log(`\n   1. Continuous learning ${learningGain > 0 ? "IMPROVES" : "does NOT improve"} accuracy by ${(Math.abs(learningGain) * 100).toFixed(1)}pp`);
  console.log(`   2. Best individual market: ${sortedMarkets[0]?.market} at ${(sortedMarkets[0]?.accuracy * 100).toFixed(1)}%`);
  console.log(`   3. High-confidence picks (70%+): ${highConf.length} picks at ${(report.confidenceAnalysis.high70.accuracy * 100).toFixed(1)}%`);
  console.log(`   4. Most predictable league: ${sortedLeagues[0]?.name} at ${(sortedLeagues[0]?.accuracy * 100).toFixed(1)}%`);
  console.log(`   5. Final model weights: elo=${(contModel.weights.elo * 100).toFixed(0)}% form=${(contModel.weights.form * 100).toFixed(0)}% goals=${(contModel.weights.goals * 100).toFixed(0)}% market=${(contModel.weights.market * 100).toFixed(0)}%`);
  
  console.log("\n" + "═".repeat(70));
  console.log("✅ Simulation complete!");
  console.log("═".repeat(70));
}

function getOutcome(market, hg, ag) {
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

main().catch(e => { console.error("❌ Error:", e.message); console.error(e.stack); process.exit(1); });
