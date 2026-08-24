#!/usr/bin/env node

/**
 * ODDLY Weight Optimizer
 * 
 * Replays historical matches chronologically through the tracker,
 * collects feature vectors + outcomes, then optimizes the regression
 * and ensemble weights using coordinate descent on Brier score.
 * 
 * No data leakage: features are computed BEFORE the match result is known.
 * 
 * Run: node worker/optimize-weights.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// ═══════════════════════════════════════════════════════════════════════════
// TRACKER — Replays matches chronologically to build features
// ═══════════════════════════════════════════════════════════════════════════

class Tracker {
  constructor() {
    this.history = {};
    this.elo = {};
    this.h2h = {};
    this.leagueTable = {};
    this.leagueAvg = {};
    this.leagueCount = {};
  }

  recordMatch(home, away, hg, ag, leagueId) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ gf: hg, ga: ag, isHome: true });
    this.history[away].push({ gf: ag, ga: hg, isHome: false });
    if (this.history[home].length > 60) this.history[home].shift();
    if (this.history[away].length > 60) this.history[away].shift();

    const key = [home, away].sort().join(" vs ");
    if (!this.h2h[key]) this.h2h[key] = [];
    this.h2h[key].push({ home, away, hg, ag });

    if (leagueId) {
      if (!this.leagueAvg[leagueId]) { this.leagueAvg[leagueId] = 0; this.leagueCount[leagueId] = 0; }
      this.leagueAvg[leagueId] += hg + ag;
      this.leagueCount[leagueId]++;

      if (!this.leagueTable[leagueId]) this.leagueTable[leagueId] = {};
      const lt = this.leagueTable[leagueId];
      for (const [team, gf, ga] of [[home, hg, ag], [away, ag, hg]]) {
        if (!lt[team]) lt[team] = { played: 0, won: 0, drawn: 0, gf: 0, ga: 0, pts: 0 };
        lt[team].played++;
        lt[team].gf += gf;
        lt[team].ga += ga;
        if (gf > ga) { lt[team].won++; lt[team].pts += 3; }
        else if (gf === ga) { lt[team].drawn++; lt[team].pts += 1; }
      }
    }

    const h = (this.elo[home] || 1500) + 65;
    const a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }

  getTeamStats(team) {
    const hist = (this.history[team] || []).slice(-20);
    if (hist.length < 3) return this._defaultStats();

    const r5 = hist.slice(-5);
    const r10 = hist.slice(-10);
    const home = hist.filter(m => m.isHome).slice(-8);
    const away = hist.filter(m => !m.isHome).slice(-8);

    const ppgFn = (m) => m.reduce((s, x) => s + (x.gf > x.ga ? 3 : x.gf === x.ga ? 1 : 0), 0) / Math.max(1, m.length);
    const avgFn = (m, k) => m.reduce((s, x) => s + x[k], 0) / Math.max(1, m.length);
    const wrFn = (m) => m.filter(x => x.gf > x.ga).length / Math.max(1, m.length);

    return {
      ppg: ppgFn(r5),
      homePPG: ppgFn(home),
      awayPPG: ppgFn(away),
      homeGF: avgFn(home, "gf"),
      homeGA: avgFn(home, "ga"),
      awayGF: avgFn(away, "gf"),
      awayGA: avgFn(away, "ga"),
      homeWinRate: wrFn(home),
      awayWinRate: wrFn(away),
      cleanSheetRate: r10.filter(m => m.ga === 0).length / r10.length,
      scoresInR10: r10.filter(m => m.gf > 0).length / r10.length,
      concedesInR10: r10.filter(m => m.ga > 0).length / r10.length,
      bttsRate: r10.filter(m => m.gf > 0 && m.ga > 0).length / r10.length,
      streak: this.getStreak(hist),
      goalsFor: avgFn(r5, "gf"),
      goalsAgainst: avgFn(r5, "ga"),
    };
  }

  _defaultStats() {
    return {
      ppg: 1.5, homePPG: 1.6, awayPPG: 1.2, homeGF: 1.4, homeGA: 1.1,
      awayGF: 1.0, awayGA: 1.3, homeWinRate: 0.45, awayWinRate: 0.30,
      cleanSheetRate: 0.25, scoresInR10: 0.7, concedesInR10: 0.75,
      bttsRate: 0.50, streak: 0, goalsFor: 1.3, goalsAgainst: 1.2,
    };
  }

  getStreak(hist) {
    let s = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      const won = hist[i].gf > hist[i].ga;
      const lost = hist[i].gf < hist[i].ga;
      if (s >= 0 && won) s++;
      else if (s <= 0 && lost) s--;
      else break;
    }
    return s;
  }

  getH2H(home, away) {
    const m = (this.h2h[[home, away].sort().join(" vs ")] || []).slice(-10);
    if (m.length < 2) return { h2hHomeWins: 0.40, h2hDraws: 0.25, h2hBTTS: 0.50, h2hAvgGoals: 2.6 };
    let hW = 0, d = 0, btts = 0, total = 0;
    for (const x of m) {
      const hG = x.home === home ? x.hg : x.ag;
      const aG = x.home === home ? x.ag : x.hg;
      total += hG + aG;
      if (hG > aG) hW++;
      else if (hG === aG) d++;
      if (hG > 0 && aG > 0) btts++;
    }
    return { h2hHomeWins: hW / m.length, h2hDraws: d / m.length, h2hBTTS: btts / m.length, h2hAvgGoals: total / m.length };
  }

  getLeagueAvgGoals(lid) {
    return (this.leagueAvg[lid] || 0) / Math.max(1, this.leagueCount[lid] || 1) || 2.6;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POISSON MODEL — Used for totals and BTTS
// ═══════════════════════════════════════════════════════════════════════════

function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function poissonGoals(hLambda, aLambda, maxGoals = 8) {
  const grid = [];
  for (let i = 0; i <= maxGoals; i++) {
    grid[i] = [];
    for (let j = 0; j <= maxGoals; j++) {
      grid[i][j] = poissonProb(hLambda, i) * poissonProb(aLambda, j);
    }
  }
  return grid;
}

function computeMarkets(grid) {
  const m = {};
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = 0; j < grid[i].length; j++) {
      if (i > j) pH += grid[i][j];
      else if (i === j) pD += grid[i][j];
      else pA += grid[i][j];
    }
  m.poissonHome = pH;
  m.poissonDraw = pD;
  m.poissonAway = pA;

  // Totals
  const totals = {};
  let cumUnder = 0;
  for (let t = 0; t <= 9; t++) {
    for (let i = 0; i < grid.length; i++)
      for (let j = 0; j < grid[i].length; j++) if (i + j === t) cumUnder += grid[i][j];
    totals[t] = cumUnder;
  }
  m.ou05 = clamp(1 - (totals[0] || 0));
  m.ou15 = clamp(1 - (totals[1] || 0));
  m.ou25 = clamp(1 - (totals[2] || 0));
  m.ou35 = clamp(1 - (totals[3] || 0));
  m.ou45 = clamp(1 - (totals[4] || 0));
  m.un05 = clamp(totals[0] || 0);
  m.un15 = clamp(totals[1] || 0);
  m.un25 = clamp(totals[2] || 0);
  m.un35 = clamp(totals[3] || 0);
  m.un45 = clamp(totals[4] || 0);

  // BTTS
  let btts = 0;
  for (let i = 1; i < grid.length; i++)
    for (let j = 1; j < grid[i].length; j++) btts += grid[i][j];
  m.bttsYes = clamp(btts);
  m.bttsNo = clamp(1 - btts);

  return m;
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE EXTRACTION — Builds the feature vector for regression
// ═══════════════════════════════════════════════════════════════════════════

function extractFeatures(tracker, home, away, leagueId) {
  const hs = tracker.getTeamStats(home);
  const as = tracker.getTeamStats(away);
  const h2h = tracker.getH2H(home, away);
  const eloDiff = (tracker.elo[home] || 1500) - (tracker.elo[away] || 1500);
  const leagueAvg = tracker.getLeagueAvgGoals(leagueId);

  // Poisson lambdas
  const baseHomeLambda = hs.homeGF * (as.awayGA / 1.3);
  const baseAwayLambda = as.awayGF * (hs.homeGA / 1.3);
  const homeLambda = clamp(baseHomeLambda * (1 + eloDiff * 0.0003), 0.3, 4.5);
  const awayLambda = clamp(baseAwayLambda * (1 - eloDiff * 0.0003), 0.3, 4.5);

  const grid = poissonGoals(homeLambda, awayLambda);
  const poissonMarkets = computeMarkets(grid);

  // Elo win prob
  const eloProb = 1 / (1 + Math.pow(10, (-eloDiff - 65) / 400));

  // Regression feature vector (must match ensemble-model.js exactly)
  const regFeatures = {
    eloDiff,
    homePPG: hs.homePPG,
    awayPPG: as.awayPPG,
    homeGoalsFor: hs.homeGF,
    homeGoalsAgainst: hs.homeGA,
    awayGoalsFor: as.awayGF,
    awayGoalsAgainst: as.awayGA,
    cleanSheetRate: hs.cleanSheetRate - as.cleanSheetRate,
    homeWinRate: hs.homeWinRate,
    awayWinRate: as.awayWinRate,
    streak: hs.streak * 0.05 - as.streak * 0.03,
    fatigue: 0, // Default — we don't track match dates in this replay
    h2hHomeWins: h2h.h2hHomeWins - 0.4,
    homeXG: hs.homeGF,  // No StatsBomb data during replay
    awayXG: as.awayGF,
    homeXGDiff: 0,
    awayXGDiff: 0,
    shotsDiff: 0,
    bigChancesDiff: 0,
  };

  return { regFeatures, poissonMarkets, eloProb, hs, as, h2h, leagueAvg };
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL PROBABILITY COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════

function regressionHome(features, weights) {
  let z = weights.intercept;
  for (const key of Object.keys(weights)) {
    if (key === "intercept") continue;
    if (features[key] !== undefined) z += features[key] * weights[key];
  }
  return sigmoid(z);
}

function drawProb(features, h2hDraws) {
  let pD = 0.22 + h2hDraws * 0.15;
  if (Math.abs(features.homePPG - features.awayPPG) < 0.3) pD += 0.03;
  if (Math.abs(features.eloDiff) < 100) pD += 0.02;
  return clamp(pD, 0.12, 0.38);
}

function ensemblePredict(poissonMarkets, eloProb, regHomeProb, pD_reg, ew) {
  const pH_poisson = poissonMarkets.poissonHome;
  const pD_poisson = poissonMarkets.poissonDraw;
  const pA_poisson = poissonMarkets.poissonAway;

  const pA_elo = clamp(1 - eloProb - 0.25, 0.05, 0.85);
  const pA_reg = clamp(1 - regHomeProb - pD_reg, 0.05, 0.85);

  let eH = pH_poisson * ew.wPoisson + eloProb * ew.wElo + regHomeProb * ew.wReg;
  let eD = pD_poisson * ew.wPoisson + 0.25 * ew.wElo + pD_reg * ew.wReg;
  let eA = pA_poisson * ew.wPoisson + pA_elo * ew.wElo + pA_reg * ew.wReg;

  const total = eH + eD + eA;
  eH /= total; eD /= total; eA /= total;

  return { home: clamp(eH), draw: clamp(eD), away: clamp(eA) };
}

// ═══════════════════════════════════════════════════════════════════════════
// BRIER SCORE — The loss function we minimize
// ═══════════════════════════════════════════════════════════════════════════

function brierScore(predicted, actual) {
  return (predicted - actual) ** 2;
}

function avgBrier1X2(predictions, outcomes) {
  let total = 0;
  for (let i = 0; i < predictions.length; i++) {
    const p = predictions[i];
    const o = outcomes[i]; // {home: 1/0, draw: 1/0, away: 1/0}
    total += brierScore(p.home, o.home);
    total += brierScore(p.draw, o.draw);
    total += brierScore(p.away, o.away);
  }
  return total / (predictions.length * 3);
}

// ═══════════════════════════════════════════════════════════════════════════
// COORDINATE DESCENT OPTIMIZER
// ═══════════════════════════════════════════════════════════════════════════

function coordinateDescent(trainData, valData, initialRegWeights, initialEnsembleWeights) {
  const regWeights = { ...initialRegWeights };
  const ew = { ...initialEnsembleWeights };

  function evaluate(rw, ewt) {
    const preds = [];
    const outcomes = [];
    for (const d of trainData) {
      const rHome = regressionHome(d.features.regFeatures, rw);
      const pD = drawProb(d.features.regFeatures, d.features.h2h.h2hDraws);
      const pred = ensemblePredict(d.features.poissonMarkets, d.features.eloProb, rHome, pD, ewt);
      preds.push(pred);
      outcomes.push(d.outcome);
    }
    return avgBrier1X2(preds, outcomes);
  }

  function evaluateVal(rw, ewt) {
    const preds = [];
    const outcomes = [];
    for (const d of valData) {
      const rHome = regressionHome(d.features.regFeatures, rw);
      const pD = drawProb(d.features.regFeatures, d.features.h2h.h2hDraws);
      const pred = ensemblePredict(d.features.poissonMarkets, d.features.eloProb, rHome, pD, ewt);
      preds.push(pred);
      outcomes.push(d.outcome);
    }
    return avgBrier1X2(preds, outcomes);
  }

  let bestBrier = evaluate(regWeights, ew);
  let bestRegWeights = { ...regWeights };
  let bestEnsembleWeights = { ...ew };
  console.log(`   Initial train Brier: ${bestBrier.toFixed(6)}`);

  // Step sizes for regression weights
  const regSteps = {
    intercept: 0.05,
    eloDiff: 0.0002,
    homePPG: 0.02,
    awayPPG: 0.02,
    homeGoalsFor: 0.01,
    homeGoalsAgainst: 0.01,
    awayGoalsFor: 0.01,
    awayGoalsAgainst: 0.01,
    cleanSheetRate: 0.03,
    homeWinRate: 0.02,
    awayWinRate: 0.02,
    streak: 0.01,
    fatigue: 0.005,
    h2hHomeWins: 0.01,
    homeXG: 0.01,
    awayXG: 0.01,
    homeXGDiff: 0.005,
    awayXGDiff: 0.005,
    shotsDiff: 0.001,
    bigChancesDiff: 0.005,
  };

  // Phase 1: Optimize regression weights (ensemble weights fixed)
  console.log("\n   Phase 1: Optimizing regression weights...");
  for (let round = 0; round < 20; round++) {
    let improved = false;
    for (const key of Object.keys(regWeights)) {
      const step = regSteps[key] || 0.01;
      
      for (const delta of [-step, step]) {
        const testWeights = { ...regWeights };
        testWeights[key] += delta;
        const testBrier = evaluate(testWeights, ew);
        
        if (testBrier < bestBrier) {
          bestBrier = testBrier;
          Object.assign(regWeights, testWeights);
          bestRegWeights = { ...regWeights };
          improved = true;
        }
      }
    }
    
    // Halve step sizes every 5 rounds
    if ((round + 1) % 5 === 0) {
      for (const key of Object.keys(regSteps)) regSteps[key] *= 0.5;
      console.log(`   Round ${round + 1}: Brier = ${bestBrier.toFixed(6)}, steps halved`);
    }
    
    if (!improved) break;
  }
  
  console.log(`   After regression optimization: Brier = ${bestBrier.toFixed(6)}`);

  // Phase 2: Optimize ensemble weights (regression weights fixed)
  console.log("\n   Phase 2: Optimizing ensemble weights...");
  const ewSteps = { wPoisson: 0.02, wElo: 0.02, wReg: 0.02 };
  
  for (let round = 0; round < 15; round++) {
    let improved = false;
    for (const key of Object.keys(ew)) {
      const step = ewSteps[key] || 0.02;
      
      for (const delta of [-step, step]) {
        const testEW = { ...ew };
        testEW[key] += delta;
        
        // Must sum to 1
        const sum = testEW.wPoisson + testEW.wElo + testEW.wReg;
        if (sum <= 0) continue;
        testEW.wPoisson /= sum;
        testEW.wElo /= sum;
        testEW.wReg /= sum;
        
        const testBrier = evaluate(regWeights, testEW);
        
        if (testBrier < bestBrier) {
          bestBrier = testBrier;
          Object.assign(ew, testEW);
          bestEnsembleWeights = { ...ew };
          improved = true;
        }
      }
    }
    
    if ((round + 1) % 5 === 0) {
      for (const key of Object.keys(ewSteps)) ewSteps[key] *= 0.5;
      console.log(`   Round ${round + 1}: Brier = ${bestBrier.toFixed(6)}`);
    }
    
    if (!improved) break;
  }

  console.log(`   After ensemble optimization: Brier = ${bestBrier.toFixed(6)}`);

  return { regWeights: bestRegWeights, ensembleWeights: bestEnsembleWeights };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("🎯 ODDLY Weight Optimizer");
  console.log("━".repeat(60));
  console.log("   Replaying historical matches chronologically");
  console.log("   Optimizing regression + ensemble weights via coordinate descent\n");

  const tracker = new Tracker();

  // Load all finished matches chronologically
  console.log("   Loading historical matches...");
  const allMatches = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("home_score, away_score, kickoff_time, league_id, home_team_id, away_team_id")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    allMatches.push(...batch);
    offset += batch.length;
    if (batch.length < 1000) break;
  }

  // Load team names
  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;
  console.log(`   Loaded ${allMatches.length} finished matches, ${Object.keys(teamMap).length} teams\n`);

  // Replay matches chronologically, extracting features BEFORE recording result
  const minHistory = 50; // Skip first N matches (tracker needs warmup)
  const trainRatio = 0.8;
  const trainEnd = Math.floor((allMatches.length - minHistory) * trainRatio) + minHistory;

  const trainData = [];
  const valData = [];

  console.log("   Replaying matches and extracting features...");
  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    const home = teamMap[m.home_team_id];
    const away = teamMap[m.away_team_id];
    if (!home || !away) { tracker.recordMatch(home || "?", away || "?", m.home_score, m.away_score, m.league_id); continue; }

    // Extract features BEFORE recording the result (no data leakage)
    if (i >= minHistory) {
      const features = extractFeatures(tracker, home, away, m.league_id);

      // Determine actual outcome
      const outcome = {
        home: m.home_score > m.away_score ? 1 : 0,
        draw: m.home_score === m.away_score ? 1 : 0,
        away: m.home_score < m.away_score ? 1 : 0,
      };

      const dataPoint = { features, outcome, fixtureId: m.home_team_id + "-" + i };
      if (i < trainEnd) trainData.push(dataPoint);
      else valData.push(dataPoint);
    }

    // NOW record the match (so the next match's features include this result)
    tracker.recordMatch(home, away, m.home_score, m.away_score, m.league_id);

    if ((i + 1) % 1000 === 0) console.log(`   ${i + 1}/${allMatches.length} replayed...`);
  }

  console.log(`   Training set: ${trainData.length} matches`);
  console.log(`   Validation set: ${valData.length} matches\n`);

  // Current hand-tuned weights (from ensemble-model.js)
  const currentRegWeights = {
    intercept: -0.12,
    eloDiff: 0.0018,
    homePPG: 0.15,
    awayPPG: -0.15,
    homeGoalsFor: 0.08,
    homeGoalsAgainst: -0.1,
    awayGoalsFor: 0.06,
    awayGoalsAgainst: -0.08,
    cleanSheetRate: 0.2,
    homeWinRate: 0.18,
    awayWinRate: -0.15,
    streak: 0.04,
    fatigue: 0.02,
    h2hHomeWins: 0.08,
    homeXG: 0.12,
    awayXG: -0.1,
    homeXGDiff: 0.06,
    awayXGDiff: -0.05,
    shotsDiff: 0.003,
    bigChancesDiff: 0.02,
  };

  const currentEnsembleWeights = {
    wPoisson: 0.25,
    wElo: 0.35,
    wReg: 0.40,
  };

  // Evaluate CURRENT (hand-tuned) weights on both train and validation
  function evalWithWeights(rw, ew, data) {
    const preds = [];
    const outcomes = [];
    for (const d of data) {
      const rHome = regressionHome(d.features.regFeatures, rw);
      const pD = drawProb(d.features.regFeatures, d.features.h2h.h2hDraws);
      const pred = ensemblePredict(d.features.poissonMarkets, d.features.eloProb, rHome, pD, ew);
      preds.push(pred);
      outcomes.push(d.outcome);
    }
    
    const brier = avgBrier1X2(preds, outcomes);
    
    // Also compute accuracy (best prediction wins)
    let correct = 0;
    for (let i = 0; i < preds.length; i++) {
      const p = preds[i];
      const o = outcomes[i];
      const predicted = p.home >= p.draw && p.home >= p.away ? "home" :
                        p.draw >= p.home && p.draw >= p.away ? "draw" : "away";
      const actual = o.home === 1 ? "home" : o.draw === 1 ? "draw" : "away";
      if (predicted === actual) correct++;
    }
    
    return { brier, accuracy: correct / preds.length, count: preds.length };
  }

  console.log("━".repeat(60));
  console.log("📊 BASELINE (Hand-Tuned Weights)");
  console.log("━".repeat(60));
  const baseTrain = evalWithWeights(currentRegWeights, currentEnsembleWeights, trainData);
  const baseVal = evalWithWeights(currentRegWeights, currentEnsembleWeights, valData);
  console.log(`   Train:     Brier = ${baseTrain.brier.toFixed(6)}, Accuracy = ${(baseTrain.accuracy * 100).toFixed(1)}% (${baseTrain.count})`);
  console.log(`   Validation: Brier = ${baseVal.brier.toFixed(6)}, Accuracy = ${(baseVal.accuracy * 100).toFixed(1)}% (${baseVal.count})`);

  // Run optimizer
  console.log("\n━".repeat(60));
  console.log("🔧 OPTIMIZING WEIGHTS");
  console.log("━".repeat(60));
  const { regWeights: optRegWeights, ensembleWeights: optEnsembleWeights } =
    coordinateDescent(trainData, valData, currentRegWeights, currentEnsembleWeights);

  // Evaluate OPTIMIZED weights
  const optTrain = evalWithWeights(optRegWeights, optEnsembleWeights, trainData);
  const optVal = evalWithWeights(optRegWeights, optEnsembleWeights, valData);

  console.log("\n━".repeat(60));
  console.log("📊 OPTIMIZED Weights");
  console.log("━".repeat(60));
  console.log(`   Train:     Brier = ${optTrain.brier.toFixed(6)}, Accuracy = ${(optTrain.accuracy * 100).toFixed(1)}% (${optTrain.count})`);
  console.log(`   Validation: Brier = ${optVal.brier.toFixed(6)}, Accuracy = ${(optVal.accuracy * 100).toFixed(1)}% (${optVal.count})`);

  // Comparison
  console.log("\n━".repeat(60));
  console.log("📊 COMPARISON: Hand-Tuned vs Optimized");
  console.log("━".repeat(60));
  console.log(`   ${"Metric".padEnd(20)} ${"Hand-Tuned".padEnd(14)} ${"Optimized".padEnd(14)} ${"Delta".padEnd(10)}`);
  const trainBrierDelta = (optTrain.brier - baseTrain.brier).toFixed(6);
  console.log(`   ${"Train Brier".padEnd(20)} ${baseTrain.brier.toFixed(6).padEnd(14)} ${optTrain.brier.toFixed(6).padEnd(14)} ${(optTrain.brier > baseTrain.brier ? "+" : "") + trainBrierDelta}`);
  const valBrierDelta = (optVal.brier - baseVal.brier).toFixed(6);
  console.log(`   ${"Val Brier".padEnd(20)} ${baseVal.brier.toFixed(6).padEnd(14)} ${optVal.brier.toFixed(6).padEnd(14)} ${(optVal.brier > baseVal.brier ? "+" : "") + valBrierDelta}`);
  const trainAccDelta = ((optTrain.accuracy - baseTrain.accuracy) * 100).toFixed(1);
  console.log(`   ${"Train Accuracy".padEnd(20)} ${(baseTrain.accuracy * 100).toFixed(1).padEnd(13)}% ${(optTrain.accuracy * 100).toFixed(1).padEnd(13)}% +${trainAccDelta}%`);
  const valAccDelta = ((optVal.accuracy - baseVal.accuracy) * 100).toFixed(1);
  console.log(`   ${"Val Accuracy".padEnd(20)} ${(baseVal.accuracy * 100).toFixed(1).padEnd(13)}% ${(optVal.accuracy * 100).toFixed(1).padEnd(13)}% +${valAccDelta}%`);

  // Print optimized weights
  console.log("\n━".repeat(60));
  console.log("📋 OPTIMIZED REGRESSION WEIGHTS (copy into ensemble-model.js)");
  console.log("━".repeat(60));
  console.log("const REG_WEIGHTS = {");
  for (const [key, val] of Object.entries(optRegWeights)) {
    console.log(`  ${key}: ${Math.round(val * 10000) / 10000},`);
  }
  console.log("};");

  console.log("\n📋 OPTIMIZED ENSEMBLE WEIGHTS:");
  console.log("  1X2:    {", [
    `poisson: ${Math.round(optEnsembleWeights.wPoisson * 100) / 100}`,
    `elo: ${Math.round(optEnsembleWeights.wElo * 100) / 100}`,
    `regression: ${Math.round(optEnsembleWeights.wReg * 100) / 100}`,
  ].join(", "), "}");

  // Save results to file
  const output = {
    timestamp: new Date().toISOString(),
    matches_analyzed: allMatches.length,
    train_size: trainData.length,
    validation_size: valData.length,
    baseline: {
      train_brier: baseTrain.brier,
      val_brier: baseVal.brier,
      train_accuracy: baseTrain.accuracy,
      val_accuracy: baseVal.accuracy,
    },
    optimized: {
      train_brier: optTrain.brier,
      val_brier: optVal.brier,
      train_accuracy: optTrain.accuracy,
      val_accuracy: optVal.accuracy,
    },
    improvement: {
      brier_reduction: baseVal.brier - optVal.brier,
      accuracy_gain: optVal.accuracy - baseVal.accuracy,
    },
    optimized_reg_weights: optRegWeights,
    optimized_ensemble_weights: optEnsembleWeights,
  };

  const outputPath = path.join(__dirname, "..", "data", "optimized-weights.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 Saved to ${outputPath}`);

  // If optimized is better, auto-update the ensemble-model.js
  if (optVal.brier < baseVal.brier) {
    console.log("\n✅ Optimized weights are BETTER on validation set!");
    console.log("   To apply: run 'node worker/apply-optimized-weights.js'");
  } else {
    console.log("\n⚠️  Hand-tuned weights still perform better on validation.");
    console.log("   Consider collecting more data or trying different features.");
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
