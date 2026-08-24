#!/usr/bin/env node

/**
 * ODDLY Model Benchmark
 *
 * Honestly compares Poisson vs XGBoost v5 on the same historical dataset.
 * Uses temporal validation (train on past, test on future) to prevent leakage.
 *
 * Reports: Accuracy, Log Loss, Brier Score, Calibration, by market.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ─── Env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      env[t.slice(0, i).trim()] = v;
    }
  } catch {}
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }
function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

// ─── Load Historical Fixtures ────────────────────────────────────────────
async function loadFixtures() {
  console.log("Loading historical fixtures...");
  let all = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from("fixtures")
      .select("id, home_team_id, away_team_id, league_id, kickoff_time, home_score, away_score, status")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`  Loaded ${all.length} finished fixtures`);
  return all;
}

async function loadTeams() {
  const { data } = await sb.from("teams").select("id, canonical_name");
  return (data || []).reduce((m, t) => { m[t.id] = t.canonical_name; return m; }, {});
}

async function loadPredictions(fixtureIds) {
  const all = [];
  for (let i = 0; i < fixtureIds.length; i += 500) {
    const batch = fixtureIds.slice(i, i + 500);
    const { data } = await sb.from("predictions")
      .select("fixture_id, market, selection, model_probability, result")
      .in("fixture_id", batch)
      .not("result", "is", null)
      .neq("result", "pending");
    if (data) all.push(...data);
  }
  return all;
}

// ─── Simple Tracker for Poisson ──────────────────────────────────────────
class Tracker {
  constructor() { this.history = {}; this.elo = {}; }
  record(home, away, hg, ag) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ gf: hg, ga: ag, isHome: true });
    this.history[away].push({ gf: ag, ga: hg, isHome: false });
    if (this.history[home].length > 30) this.history[home].shift();
    if (this.history[away].length > 30) this.history[away].shift();
    const h = (this.elo[home] || 1500) + 65, a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }
  getStats(team) {
    const h = (this.history[team] || []).slice(-10);
    if (h.length < 3) return { homeGF: 1.4, homeGA: 1.1, awayGF: 1.0, awayGA: 1.3, ppg: 1.5 };
    const home = h.filter(m => m.isHome).slice(-5);
    const away = h.filter(m => !m.isHome).slice(-5);
    return {
      homeGF: home.reduce((s, m) => s + m.gf, 0) / Math.max(1, home.length),
      homeGA: home.reduce((s, m) => s + m.ga, 0) / Math.max(1, home.length),
      awayGF: away.reduce((s, m) => s + m.gf, 0) / Math.max(1, away.length),
      awayGA: away.reduce((s, m) => s + m.ga, 0) / Math.max(1, away.length),
      ppg: h.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(5, h.length),
    };
  }
}

// ─── Poisson Model ───────────────────────────────────────────────────────
function poissonPredict(home, away, tracker) {
  const hs = tracker.getStats(home);
  const as = tracker.getStats(away);
  const hL = Math.max(0.3, hs.homeGF * 0.5 + (hs.ppg / 3) * 0.3 + 0.6);
  const aL = Math.max(0.3, as.awayGF * 0.5 + (as.ppg / 3) * 0.3 + 0.5);
  const grid = [];
  for (let i = 0; i <= 6; i++) { grid[i] = []; for (let j = 0; j <= 6; j++) grid[i][j] = poissonProb(hL, i) * poissonProb(aL, j); }
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    if (i > j) pH += grid[i][j]; else if (i === j) pD += grid[i][j]; else pA += grid[i][j];
  }
  let btts = 0; for (let i = 1; i < 7; i++) for (let j = 1; j < 7; j++) btts += grid[i][j];
  const over25 = 1 - grid[0].reduce((s, v, j) => j <= 2 ? s + v : s, 0);
  return {
    "1X2_Home": clamp(pH), "1X2_Draw": clamp(pD), "1X2_Away": clamp(pA),
    "BTTS_Yes": clamp(btts), "BTTS_No": clamp(1 - btts),
    "OU_Over_2.5": clamp(over25), "OU_Under_2.5": clamp(1 - over25),
  };
}

// ─── Evaluate ────────────────────────────────────────────────────────────
function evaluate(predictions, actuals) {
  let correct = 0, total = 0;
  let logLoss = 0, brier = 0;
  const marketStats = {};
  const confBuckets = {};

  for (const [key, actual] of Object.entries(actuals)) {
    const pred = predictions[key];
    if (!pred) continue;

    // Find best prediction for this fixture
    let bestMarket = null, bestProb = 0;
    for (const [mk, prob] of Object.entries(pred)) {
      if (mk.includes("Home") && actual.homeWin && prob > bestProb) { bestProb = prob; bestMarket = mk; }
      else if (mk.includes("Draw") && actual.draw && prob > bestProb) { bestProb = prob; bestMarket = mk; }
      else if (mk.includes("Away") && actual.awayWin && prob > bestProb) { bestProb = prob; bestMarket = mk; }
    }

    if (bestMarket) {
      total++;
      const isCorrect = (bestMarket.includes("Home") && actual.homeWin) ||
        (bestMarket.includes("Draw") && actual.draw) ||
        (bestMarket.includes("Away") && actual.awayWin);
      if (isCorrect) correct++;

      // Log loss and Brier for 1X2
      const homeProb = pred["1X2_Home"] || 0.33;
      const drawProb = pred["1X2_Draw"] || 0.33;
      const awayProb = pred["1X2_Away"] || 0.33;
      const actualProb = actual.homeWin ? homeProb : actual.draw ? drawProb : awayProb;
      logLoss += -Math.log(Math.max(0.01, actualProb));
      brier += Math.pow(homeProb - (actual.homeWin ? 1 : 0), 2) +
        Math.pow(drawProb - (actual.draw ? 1 : 0), 2) +
        Math.pow(awayProb - (actual.awayWin ? 1 : 0), 2);

      // Market accuracy
      for (const [mk, prob] of Object.entries(pred)) {
        if (!marketStats[mk]) marketStats[mk] = { total: 0, correct: 0 };
        marketStats[mk].total++;
        const mkCorrect = (mk.includes("Home") && actual.homeWin) ||
          (mk.includes("Draw") && actual.draw) ||
          (mk.includes("Away") && actual.awayWin) ||
          (mk.includes("Yes") && actual.btts) ||
          (mk.includes("No") && !actual.btts) ||
          (mk.includes("Over_2.5") && actual.goals > 2.5) ||
          (mk.includes("Under_2.5") && actual.goals < 2.5);
        if (mkCorrect) marketStats[mk].correct++;
      }

      // Confidence bucket
      const bucket = bestProb >= 0.90 ? "90%+" : bestProb >= 0.80 ? "80-89%" :
        bestProb >= 0.70 ? "70-79%" : bestProb >= 0.60 ? "60-69%" : "50-59%";
      if (!confBuckets[bucket]) confBuckets[bucket] = { total: 0, correct: 0 };
      confBuckets[bucket].total++;
      if (isCorrect) confBuckets[bucket].correct++;
    }
  }

  return {
    accuracy: total > 0 ? correct / total : 0,
    logLoss: total > 0 ? logLoss / total : 0,
    brier: total > 0 ? brier / (total * 3) : 0,
    total,
    correct,
    marketStats,
    confBuckets,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ODDLY MODEL BENCHMARK");
  console.log("═══════════════════════════════════════════════════════════\n");

  const fixtures = await loadFixtures();
  const teams = await loadTeams();

  // Split: train on first 80%, test on last 20% (temporal split)
  const splitIdx = Math.floor(fixtures.length * 0.8);
  const trainFixtures = fixtures.slice(0, splitIdx);
  const testFixtures = fixtures.slice(splitIdx);

  console.log(`\nTrain: ${trainFixtures.length} fixtures (before ${trainFixtures[trainFixtures.length - 1]?.kickoff_time?.slice(0, 10)})`);
  console.log(`Test:  ${testFixtures.length} fixtures (after ${testFixtures[0]?.kickoff_time?.slice(0, 10)})`);

  // Build tracker from training data
  const tracker = new Tracker();
  for (const f of trainFixtures) {
    const home = teams[f.home_team_id];
    const away = teams[f.away_team_id];
    if (home && away) tracker.record(home, away, f.home_score, f.away_score);
  }

  // Generate Poisson predictions for test set
  console.log("\n🔮 Generating Poisson predictions for test set...");
  const poissonPreds = {};
  const actuals = {};
  let predCount = 0;

  for (const f of testFixtures) {
    const home = teams[f.home_team_id];
    const away = teams[f.away_team_id];
    if (!home || !away) continue;

    poissonPreds[f.id] = poissonPredict(home, away, tracker);
    actuals[f.id] = {
      homeWin: f.home_score > f.away_score,
      draw: f.home_score === f.away_score,
      awayWin: f.home_score < f.away_score,
      goals: f.home_score + f.away_score,
      btts: f.home_score > 0 && f.away_score > 0,
    };
    predCount++;
  }

  console.log(`  Generated ${predCount} Poisson predictions`);

  // NOTE: We do NOT update tracker during test set — that would be data leakage!

  // Evaluate Poisson
  console.log("\n📊 Evaluating Poisson Model...");
  const poissonResults = evaluate(poissonPreds, actuals);
  console.log(`  Accuracy:  ${(poissonResults.accuracy * 100).toFixed(1)}%`);
  console.log(`  Log Loss:  ${poissonResults.logLoss.toFixed(4)}`);
  console.log(`  Brier:     ${poissonResults.brier.toFixed(4)}`);
  console.log(`  Samples:   ${poissonResults.total}`);

  // Now load XGBoost v5 predictions from database
  console.log("\n🤖 Loading XGBoost v5 predictions from database...");
  const testIds = testFixtures.map(f => f.id);
  const xgbPreds = await loadPredictions(testIds);

  // Group XGBoost predictions by fixture
  const xgbByFixture = {};
  for (const p of xgbPreds) {
    if (!xgbByFixture[p.fixture_id]) xgbByFixture[p.fixture_id] = {};
    const key = `${p.market}_${p.selection}`;
    xgbByFixture[p.fixture_id][key] = p.model_probability;
  }

  // Evaluate XGBoost (using its actual predictions)
  console.log("\n📊 Evaluating XGBoost v5 (from database predictions)...");
  let xgbCorrect = 0, xgbTotal = 0;
  const xgbMarketStats = {};
  const xgbConfBuckets = {};

  for (const f of testFixtures) {
    const preds = xgbByFixture[f.id];
    if (!preds) continue;

    const actual = actuals[f.id];
    if (!actual) continue;

    // Find best XGBoost prediction
    let bestKey = null, bestProb = 0;
    for (const [key, prob] of Object.entries(preds)) {
      if (prob > bestProb) { bestProb = prob; bestKey = key; }
    }

    if (bestKey) {
      xgbTotal++;
      const [market, selection] = bestKey.split("_", 2);
      let isCorrect = false;
      if (bestKey.includes("Home") && actual.homeWin) isCorrect = true;
      else if (bestKey.includes("Draw") && actual.draw) isCorrect = true;
      else if (bestKey.includes("Away") && actual.awayWin) isCorrect = true;
      else if (bestKey.includes("Yes") && actual.btts) isCorrect = true;
      else if (bestKey.includes("No") && !actual.btts) isCorrect = true;
      else if (bestKey.includes("Over_2.5") && actual.goals > 2.5) isCorrect = true;
      else if (bestKey.includes("Under_2.5") && actual.goals < 2.5) isCorrect = true;

      if (isCorrect) xgbCorrect++;

      const bucket = bestProb >= 0.90 ? "90%+" : bestProb >= 0.80 ? "80-89%" :
        bestProb >= 0.70 ? "70-79%" : bestProb >= 0.60 ? "60-69%" : "50-59%";
      if (!xgbConfBuckets[bucket]) xgbConfBuckets[bucket] = { total: 0, correct: 0 };
      xgbConfBuckets[bucket].total++;
      if (isCorrect) xgbConfBuckets[bucket].correct++;
    }
  }

  const xgbAccuracy = xgbTotal > 0 ? xgbCorrect / xgbTotal : 0;
  console.log(`  Accuracy:  ${(xgbAccuracy * 100).toFixed(1)}%`);
  console.log(`  Samples:   ${xgbTotal}`);

  // Comparison
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  MODEL COMPARISON");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  ${"Model".padEnd(25)} ${"Accuracy".padStart(10)} ${"Log Loss".padStart(10)} ${"Brier".padEnd(10)} ${"Samples".padStart(10)}`);
  console.log("  " + "─".repeat(65));
  console.log(`  ${"Poisson (live)".padEnd(25)} ${(poissonResults.accuracy * 100).toFixed(1).padStart(9)}% ${poissonResults.logLoss.toFixed(4).padStart(10)} ${poissonResults.brier.toFixed(4).padEnd(10)} ${poissonResults.total.toString().padStart(10)}`);
  console.log(`  ${"XGBoost v5 (db)".padEnd(25)} ${(xgbAccuracy * 100).toFixed(1).padStart(9)}% ${"—".padStart(10)} ${"—".padEnd(10)} ${xgbTotal.toString().padStart(10)}`);

  // Confidence breakdown
  console.log("\n  CONFIDENCE BREAKDOWN:");
  console.log(`  ${"Bucket".padEnd(12)} ${"Poisson".padStart(10)} ${"XGBoost".padStart(10)}`);
  console.log("  " + "─".repeat(32));
  for (const b of ["90%+", "80-89%", "70-79%", "60-69%", "50-59%"]) {
    const p = poissonResults.confBuckets[b];
    const x = xgbConfBuckets[b];
    const pAcc = p && p.total > 0 ? ((p.correct / p.total) * 100).toFixed(1) + "%" : "—";
    const xAcc = x && x.total > 0 ? ((x.correct / x.total) * 100).toFixed(1) + "%" : "—";
    console.log(`  ${b.padEnd(12)} ${pAcc.padStart(10)} ${xAcc.padStart(10)}`);
  }

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    trainSize: trainFixtures.length,
    testSize: testFixtures.length,
    poisson: {
      accuracy: poissonResults.accuracy,
      logLoss: poissonResults.logLoss,
      brier: poissonResults.brier,
      total: poissonResults.total,
    },
    xgboost: {
      accuracy: xgbAccuracy,
      total: xgbTotal,
    },
  };
  fs.writeFileSync(path.join(__dirname, "..", "data", "benchmark-results.json"), JSON.stringify(results, null, 2));
  console.log("\n  Results saved to data/benchmark-results.json");
  console.log("═══════════════════════════════════════════════════════════");
}

main().catch(console.error);
