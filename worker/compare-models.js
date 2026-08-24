#!/usr/bin/env node

/**
 * ODDLY Model Comparison: predict-enhanced.js (v3.0) vs ensemble-model.js (v5.1)
 * 
 * Replays historical matches chronologically through both engines,
 * then compares accuracy, Brier score, and calibration.
 * 
 * Run: node worker/compare-models.js
 */

const { createClient } = require("@supabase/supabase-js");
const { loadRefereeData, getRefereeFeatures } = require("./referee-features");
const fs = require("fs");
const path = require("path");

// Load referee data
const refStats = loadRefereeData();

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
// SHARED POISSON MODEL
// ═══════════════════════════════════════════════════════════════════════════

function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function poissonGoals(hL, aL, max = 8) {
  const grid = [];
  for (let i = 0; i <= max; i++) {
    grid[i] = [];
    for (let j = 0; j <= max; j++) grid[i][j] = poissonProb(hL, i) * poissonProb(aL, j);
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
  m["1X2_Home"] = clamp(pH); m["1X2_Draw"] = clamp(pD); m["1X2_Away"] = clamp(pA);
  m["DC_1X"] = clamp(pH + pD); m["DC_X2"] = clamp(pD + pA); m["DC_12"] = clamp(pH + pA);
  const dnb = pH + pA;
  m["DNB_Home"] = dnb > 0 ? clamp(pH / dnb) : 0.5;
  m["DNB_Away"] = dnb > 0 ? clamp(pA / dnb) : 0.5;
  const totals = {};
  let cum = 0;
  for (let t = 0; t <= 9; t++) {
    for (let i = 0; i < grid.length; i++)
      for (let j = 0; j < grid[i].length; j++) if (i + j === t) cum += grid[i][j];
    totals[t] = cum;
  }
  for (const l of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    m[`OU_Over_${l}`] = clamp(1 - (totals[Math.floor(l)] || 0));
    m[`OU_Under_${l}`] = clamp(totals[Math.floor(l)] || 0);
  }
  let btts = 0;
  for (let i = 1; i < grid.length; i++)
    for (let j = 1; j < grid[i].length; j++) btts += grid[i][j];
  m["BTTS_Yes"] = clamp(btts); m["BTTS_No"] = clamp(1 - btts);
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACKER A — Used by predict-enhanced.js (v3.0)
// ═══════════════════════════════════════════════════════════════════════════

class TrackerA {
  constructor() { this.history = {}; this.elo = {}; this.h2h = {}; }

  recordMatch(home, away, hg, ag) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ opp: away, gf: hg, ga: ag, isHome: true });
    this.history[away].push({ opp: home, gf: ag, ga: hg, isHome: false });
    if (this.history[home].length > 50) this.history[home].shift();
    if (this.history[away].length > 50) this.history[away].shift();
    const h2hKey = [home, away].sort().join(" vs ");
    if (!this.h2h[h2hKey]) this.h2h[h2hKey] = [];
    this.h2h[h2hKey].push({ home, away, hg, ag });
    // Elo
    const h = (this.elo[home] || 1500) + 65;
    const a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }

  getTeamStats(team) {
    const hist = (this.history[team] || []).slice(-20);
    if (hist.length < 3) return { ppg: 1.5, homePPG: 1.6, awayPPG: 1.2, homeGoalsFor: 1.4, homeGoalsAgainst: 1.1, awayGoalsFor: 1.0, awayGoalsAgainst: 1.3, homeWinRate: 0.45, awayWinRate: 0.30, cleanSheetRate: 0.25, streak: 0, lastMatchDaysAgo: 7 };
    const r5 = hist.slice(-5);
    const home = hist.filter(m => m.isHome).slice(-8);
    const away = hist.filter(m => !m.isHome).slice(-8);
    return {
      ppg: r5.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / r5.length,
      homePPG: home.length > 0 ? home.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / home.length : 1.6,
      awayPPG: away.length > 0 ? away.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / away.length : 1.2,
      homeGoalsFor: home.length > 0 ? home.reduce((s, m) => s + m.gf, 0) / home.length : 1.4,
      homeGoalsAgainst: home.length > 0 ? home.reduce((s, m) => s + m.ga, 0) / home.length : 1.1,
      awayGoalsFor: away.length > 0 ? away.reduce((s, m) => s + m.gf, 0) / away.length : 1.0,
      awayGoalsAgainst: away.length > 0 ? away.reduce((s, m) => s + m.ga, 0) / away.length : 1.3,
      homeWinRate: home.filter(m => m.gf > m.ga).length / Math.max(1, home.length),
      awayWinRate: away.filter(m => m.gf > m.ga).length / Math.max(1, away.length),
      cleanSheetRate: hist.slice(-10).filter(m => m.ga === 0).length / 10,
      streak: this.getStreak(hist),
      lastMatchDaysAgo: 7,
    };
  }

  getStreak(hist) {
    let s = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (s >= 0 && hist[i].gf > hist[i].ga) s++;
      else if (s <= 0 && hist[i].gf < hist[i].ga) s--;
      else break;
    }
    return s;
  }

  getH2H(home, away) {
    const m = (this.h2h[[home, away].sort().join(" vs ")] || []).slice(-10);
    if (m.length < 2) return { h2hHomeWins: 0.4 };
    let hW = 0;
    for (const x of m) { const hG = x.home === home ? x.hg : x.ag; const aG = x.home === home ? x.ag : x.hg; if (hG > aG) hW++; }
    return { h2hHomeWins: hW / m.length };
  }

  // v3.0 prediction (from predict-enhanced.js)
  predict(home, away) {
    const hf = this.getTeamStats(home);
    const af = this.getTeamStats(away);
    const h2h = this.getH2H(home, away);
    const eloDiff = (this.elo[home] || 1500) - (this.elo[away] || 1500);

    // v3.0 formula
    let prob = 0.5 + (eloDiff - 100) * 0.0018;
    prob += (hf.homePPG - 1.6) * 0.003;
    prob -= (af.awayPPG - 1.2) * 0.06;
    prob += (hf.homeGoalsFor - 1.4) * 0.03;
    prob -= (af.awayGoalsFor - 1.0) * 0.03;
    prob -= (hf.homeGoalsAgainst - 1.1) * 0.04;
    prob += (af.awayGoalsAgainst - 1.3) * 0.04;
    prob += (hf.cleanSheetRate - 0.25) * 0.48;
    prob -= (af.cleanSheetRate - 0.25) * 0.24;
    prob += (hf.homeWinRate - 0.45) * 0.02;
    prob -= (af.awayWinRate - 0.30) * 0.12;
    prob += (hf.streak > 2 ? 0.12 : hf.streak < -2 ? -0.12 : 0);
    prob -= (af.streak > 2 ? 0.08 : af.streak < -2 ? -0.08 : 0);
    prob += (h2h.h2hHomeWins - 0.4) * 0.17;
    prob = clamp(prob);

    const hL = clamp(hf.homeGoalsFor * (af.awayGoalsAgainst / 1.3) * (1 + eloDiff * 0.0003), 0.3, 4.5);
    const aL = clamp(af.awayGoalsFor * (hf.homeGoalsAgainst / 1.3) * (1 - eloDiff * 0.0003), 0.3, 4.5);
    const grid = poissonGoals(hL, aL);
    const markets = computeMarkets(grid);
    markets["_1x2Home"] = prob;
    return { markets, hL, aL };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACKER B — Used by ensemble-model.js (v5.1 with optimized weights)
// ═══════════════════════════════════════════════════════════════════════════

class TrackerB {
  constructor() { this.history = {}; this.elo = {}; this.h2h = {}; this.leagueTable = {}; }

  recordMatch(home, away, hg, ag) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ gf: hg, ga: ag, isHome: true });
    this.history[away].push({ gf: ag, ga: hg, isHome: false });
    if (this.history[home].length > 60) this.history[home].shift();
    if (this.history[away].length > 60) this.history[away].shift();
    const key = [home, away].sort().join(" vs ");
    if (!this.h2h[key]) this.h2h[key] = [];
    this.h2h[key].push({ home, away, hg, ag });
    // Elo
    const h = (this.elo[home] || 1500) + 65;
    const a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }

  getTeamStats(team) {
    const hist = (this.history[team] || []).slice(-20);
    if (hist.length < 3) return { ppg: 1.5, homePPG: 1.6, awayPPG: 1.2, homeGF: 1.4, homeGA: 1.1, awayGF: 1.0, awayGA: 1.3, homeWinRate: 0.45, awayWinRate: 0.30, cleanSheetRate: 0.25, scoresInR10: 0.7, concedesInR10: 0.75, bttsRate: 0.50, streak: 0 };
    const r5 = hist.slice(-5);
    const r10 = hist.slice(-10);
    const home = hist.filter(m => m.isHome).slice(-8);
    const away = hist.filter(m => !m.isHome).slice(-8);
    return {
      ppg: r5.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / r5.length,
      homePPG: home.length > 0 ? home.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / home.length : 1.6,
      awayPPG: away.length > 0 ? away.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / away.length : 1.2,
      homeGF: home.length > 0 ? home.reduce((s, m) => s + m.gf, 0) / home.length : 1.4,
      homeGA: home.length > 0 ? home.reduce((s, m) => s + m.ga, 0) / home.length : 1.1,
      awayGF: away.length > 0 ? away.reduce((s, m) => s + m.gf, 0) / away.length : 1.0,
      awayGA: away.length > 0 ? away.reduce((s, m) => s + m.ga, 0) / away.length : 1.3,
      homeWinRate: home.filter(m => m.gf > m.ga).length / Math.max(1, home.length),
      awayWinRate: away.filter(m => m.gf > m.ga).length / Math.max(1, away.length),
      cleanSheetRate: r10.filter(m => m.ga === 0).length / r10.length,
      scoresInR10: r10.filter(m => m.gf > 0).length / r10.length,
      concedesInR10: r10.filter(m => m.ga > 0).length / r10.length,
      bttsRate: r10.filter(m => m.gf > 0 && m.ga > 0).length / r10.length,
      streak: this.getStreak(hist),
    };
  }

  getStreak(hist) {
    let s = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (s >= 0 && hist[i].gf > hist[i].ga) s++;
      else if (s <= 0 && hist[i].gf < hist[i].ga) s--;
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
      if (hG > aG) hW++; else if (hG === aG) d++;
      if (hG > 0 && aG > 0) btts++;
    }
    return { h2hHomeWins: hW / m.length, h2hDraws: d / m.length, h2hBTTS: btts / m.length, h2hAvgGoals: total / m.length };
  }

  // v5.1 ensemble prediction (from ensemble-model.js with optimized weights)
  predict(home, away) {
    const hs = this.getTeamStats(home);
    const as = this.getTeamStats(away);
    const h2h = this.getH2H(home, away);
    const eloDiff = (this.elo[home] || 1500) - (this.elo[away] || 1500);

    // Get referee features
    const refFeatures = getRefereeFeatures(home, away);

    // Poisson lambdas (referee-adjusted)
    const refGoalAdj = refFeatures.avgGoals / 2.6;
    const baseHL = hs.homeGF * (as.awayGA / 1.3);
    const baseAL = as.awayGF * (hs.homeGA / 1.3);
    const hL = clamp(baseHL * refGoalAdj * (1 + eloDiff * 0.0003), 0.3, 4.5);
    const aL = clamp(baseAL * refGoalAdj * (1 - eloDiff * 0.0003), 0.3, 4.5);
    const grid = poissonGoals(hL, aL);
    const poissonMarkets = computeMarkets(grid);

    // Elo win prob
    const eloProb = 1 / (1 + Math.pow(10, (-eloDiff - 65) / 400));

    // Optimized regression weights
    const rw = {
      intercept: -0.5887, eloDiff: 0.0037, homePPG: 0.0025, awayPPG: -0.1225,
      homeGoalsFor: 0.0938, homeGoalsAgainst: -0.1713, awayGoalsFor: 0.0738, awayGoalsAgainst: -0.1738,
      cleanSheetRate: 0.4813, homeWinRate: 0.0225, awayWinRate: -0.1225, streak: 0.1338,
      fatigue: 0.02, h2hHomeWins: 0.1738,
    };

    let z = rw.intercept;
    z += eloDiff * rw.eloDiff;
    z += hs.homePPG * rw.homePPG;
    z += as.awayPPG * rw.awayPPG;
    z += hs.homeGF * rw.homeGoalsFor;
    z += hs.homeGA * rw.homeGoalsAgainst;
    z += as.awayGF * rw.awayGoalsFor;
    z += as.awayGA * rw.awayGoalsAgainst;
    z += (hs.cleanSheetRate - as.cleanSheetRate) * rw.cleanSheetRate;
    z += hs.homeWinRate * rw.homeWinRate;
    z += as.awayWinRate * rw.awayWinRate;
    z += (hs.streak * 0.05 - as.streak * 0.03) * (rw.streak / 0.05);
    z += (h2h.h2hHomeWins - 0.4) * rw.h2hHomeWins;

    // Referee features
    z += refFeatures.homeBias * 0.15;
    const yellowEffect = (refFeatures.yellowPerMatch - 3.5) * -0.02;
    z += yellowEffect * 0.3;
    if (refFeatures.homeTeamRef.matches >= 3) {
      z += (refFeatures.homeTeamRef.winRate - 0.46) * 0.08;
    }
    if (refFeatures.awayTeamRef.matches >= 3) {
      z += (0.30 - refFeatures.awayTeamRef.winRate) * 0.08;
    }

    const regHome = sigmoid(z);

    // Draw prob
    let pD = 0.22 + h2h.h2hDraws * 0.15;
    if (Math.abs(hs.ppg - as.ppg) < 0.3) pD += 0.03;
    if (Math.abs(eloDiff) < 100) pD += 0.02;
    pD = clamp(pD, 0.12, 0.38);

    // Optimized ensemble: Poisson 0.17, Elo 0.40, Regression 0.43
    const eH = clamp(poissonMarkets.poissonHome * 0.17 + eloProb * 0.40 + regHome * 0.43);
    const pA_poisson = clamp(1 - poissonMarkets.poissonHome - poissonMarkets.poissonDraw);
    const pA_elo = clamp(1 - eloProb - 0.25, 0.05, 0.85);
    const pA_reg = clamp(1 - regHome - pD, 0.05, 0.85);
    const eD = clamp(poissonMarkets.poissonDraw * 0.17 + 0.25 * 0.40 + pD * 0.43);
    let eA = clamp(pA_poisson * 0.17 + pA_elo * 0.40 + pA_reg * 0.43);
    const total = eH + eD + eA;
    const finalH = eH / total, finalD = eD / total, finalA = eA / total;

    const markets = { ...poissonMarkets };
    markets["1X2_Home"] = clamp(finalH);
    markets["1X2_Draw"] = clamp(finalD);
    markets["1X2_Away"] = clamp(finalA);
    markets["DC_1X"] = clamp(finalH + finalD);
    markets["DC_X2"] = clamp(finalD + finalA);
    markets["DC_12"] = clamp(finalH + finalA);
    const dnb = finalH + finalA;
    markets["DNB_Home"] = dnb > 0 ? clamp(finalH / dnb) : 0.5;
    markets["DNB_Away"] = dnb > 0 ? clamp(finalA / dnb) : 0.5;

    // BTTS from ensemble
    const bw_poisson = poissonMarkets["BTTS_Yes"];
    const bw_reg = clamp(sigmoid(-0.3 + hs.homeGF * 0.2 + as.awayGF * 0.15 + hs.homeGA * 0.1 + as.awayGA * 0.1));
    markets["BTTS_Yes"] = clamp(bw_poisson * 0.50 + bw_reg * 0.40);
    markets["BTTS_No"] = clamp(1 - markets["BTTS_Yes"]);

    markets["_1x2Home"] = clamp(finalH);
    return { markets, hL, aL };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("⚔️  MODEL COMPARISON: v3.0 (predict-enhanced) vs v5.1 (ensemble)");
  console.log("━".repeat(65));

  const trackerA = new TrackerA();
  const trackerB = new TrackerB();

  // Load all finished matches chronologically
  console.log("   Loading historical matches...");
  const allMatches = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("home_score, away_score, kickoff_time, home_team_id, away_team_id")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    allMatches.push(...batch);
    offset += batch.length;
    if (batch.length < 1000) break;
  }

  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;
  console.log(`   Loaded ${allMatches.length} finished matches, ${Object.keys(teamMap).length} teams\n`);

  // Replay and compare
  const minHistory = 50;
  const statsA = { correct: 0, wrong: 0, brier: 0, marketStats: {}, tierStats: {}, calibBuckets: {} };
  const statsB = { correct: 0, wrong: 0, brier: 0, marketStats: {}, tierStats: {}, calibBuckets: {} };
  let compared = 0;

  const matchResults = []; // For per-match analysis

  // Helper to check if a prediction is correct for its specific market
  const isCorrect = (mk, _pred, actual, totalGoals, scores) => {
    if (mk === "1X2_Home") return actual.home;
    if (mk === "1X2_Draw") return actual.draw;
    if (mk === "1X2_Away") return actual.away;
    if (mk === "OU_Over_0.5") return totalGoals > 0.5;
    if (mk === "OU_Under_0.5") return totalGoals <= 0.5;
    if (mk === "OU_Over_1.5") return totalGoals > 1.5;
    if (mk === "OU_Under_1.5") return totalGoals <= 1.5;
    if (mk === "OU_Over_2.5") return totalGoals > 2.5;
    if (mk === "OU_Under_2.5") return totalGoals <= 2.5;
    if (mk === "OU_Over_3.5") return totalGoals > 3.5;
    if (mk === "OU_Under_3.5") return totalGoals <= 3.5;
    if (mk === "OU_Over_4.5") return totalGoals > 4.5;
    if (mk === "OU_Under_4.5") return totalGoals <= 4.5;
    if (mk === "BTTS_Yes") return scores.home > 0 && scores.away > 0;
    if (mk === "BTTS_No") return scores.home === 0 || scores.away === 0;
    if (mk === "DC_1X") return actual.home || actual.draw;
    if (mk === "DC_X2") return actual.draw || actual.away;
    if (mk === "DC_12") return actual.home || actual.away;
    if (mk === "DNB_Home") return actual.home;
    if (mk === "DNB_Away") return actual.away;
    return false;
  };

  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    const home = teamMap[m.home_team_id];
    const away = teamMap[m.away_team_id];
    if (!home || !away) {
      trackerA.recordMatch(home || "?", away || "?", m.home_score, m.away_score);
      trackerB.recordMatch(home || "?", away || "?", m.home_score, m.away_score);
      continue;
    }

    if (i >= minHistory) {
      const predA = trackerA.predict(home, away);
      const predB = trackerB.predict(home, away);

      // Actual outcome
      const actual = {
        home: m.home_score > m.away_score ? 1 : 0,
        draw: m.home_score === m.away_score ? 1 : 0,
        away: m.home_score < m.away_score ? 1 : 0,
        totalGoals: m.home_score + m.away_score,
      };

      // Evaluate both models on 1X2
      for (const [label, pred, stats] of [["v3.0", predA, statsA], ["v5.1", predB, statsB]]) {
        // Find best market and check if it's correct
        let bestMk = null, bestPr = 0;
        for (const [mk, pr] of Object.entries(pred.markets)) {
          if (mk.startsWith("_")) continue;
          if (pr > bestPr) { bestPr = pr; bestMk = mk; }
        }
        const bestCorrect = bestMk ? isCorrect(bestMk, null, actual, m.home_score + m.away_score, {home: m.home_score, away: m.away_score}) : false;
        if (bestCorrect) stats.correct++;
        else stats.wrong++;

        // Brier score (all markets)
        for (const [mk, pr] of Object.entries(pred.markets)) {
          if (mk.startsWith("_")) continue;
          const act = isCorrect(mk, null, actual, m.home_score + m.away_score, {home: m.home_score, away: m.away_score}) ? 1 : 0;
          stats.brier += (pr - act) ** 2;
        }

        // Market accuracy
        const markets = [
          { mk: "1X2/Home", prob: pred.markets["1X2_Home"], correct: actual.home },
          { mk: "1X2/Draw", prob: pred.markets["1X2_Draw"], correct: actual.draw },
          { mk: "1X2/Away", prob: pred.markets["1X2_Away"], correct: actual.away },
          { mk: "OU/Over_2.5", prob: pred.markets["OU_Over_2.5"], correct: actual.totalGoals > 2.5 ? 1 : 0 },
          { mk: "OU/Under_2.5", prob: pred.markets["OU_Under_2.5"], correct: actual.totalGoals <= 2.5 ? 1 : 0 },
          { mk: "OU/Over_1.5", prob: pred.markets["OU_Over_1.5"], correct: actual.totalGoals > 1.5 ? 1 : 0 },
          { mk: "OU/Under_3.5", prob: pred.markets["OU_Under_3.5"], correct: actual.totalGoals <= 3.5 ? 1 : 0 },
          { mk: "OU/Over_0.5", prob: pred.markets["OU_Over_0.5"], correct: actual.totalGoals > 0.5 ? 1 : 0 },
          { mk: "OU/Under_4.5", prob: pred.markets["OU_Under_4.5"], correct: actual.totalGoals <= 4.5 ? 1 : 0 },
          { mk: "BTTS/Yes", prob: pred.markets["BTTS_Yes"], correct: (m.home_score > 0 && m.away_score > 0) ? 1 : 0 },
          { mk: "BTTS/No", prob: pred.markets["BTTS_No"], correct: (m.home_score === 0 || m.away_score === 0) ? 1 : 0 },
          { mk: "DC/1X", prob: pred.markets["DC_1X"], correct: actual.home || actual.draw },
          { mk: "DNB/Home", prob: pred.markets["DNB_Home"], correct: actual.totalGoals !== 0 ? (actual.home ? 1 : 0) : 0.5 },
        ];

        for (const c of markets) {
          if (!stats.marketStats[c.mk]) stats.marketStats[c.mk] = { correct: 0, total: 0, brier: 0 };
          stats.marketStats[c.mk].total++;
          if (c.correct) stats.marketStats[c.mk].correct++;
          stats.marketStats[c.mk].brier += (c.prob - c.correct) ** 2;
        }

        // Best pick accuracy
        let bestC = null, bestProb = 0;
        for (const c of markets) { if (c.prob > bestProb) { bestProb = c.prob; bestC = c; } }
        if (bestC) {
          const tier = bestProb >= 0.70 ? "ELITE" : bestProb >= 0.60 ? "HIGH" : bestProb >= 0.50 ? "MEDIUM" : "LOW";
          if (!stats.tierStats[tier]) stats.tierStats[tier] = { correct: 0, total: 0 };
          stats.tierStats[tier].total++;
          if (bestC.correct) stats.tierStats[tier].correct++;
        }
      }

      // Per-match comparison — evaluate best pick against ACTUAL outcome of that market
      // Find best pick for each model and check if it's correct
      let bestMkA = null, bestPrA = 0, bestMkB = null, bestPrB = 0;
      for (const [mk, pr] of Object.entries(predA.markets)) { if (mk.startsWith("_")) continue; if (pr > bestPrA) { bestPrA = pr; bestMkA = mk; } }
      for (const [mk, pr] of Object.entries(predB.markets)) { if (mk.startsWith("_")) continue; if (pr > bestPrB) { bestPrB = pr; bestMkB = mk; } }

      const bestCorrectA = bestMkA ? isCorrect(bestMkA, null, actual, m.home_score + m.away_score, {home: m.home_score, away: m.away_score}) : false;
      const bestCorrectB = bestMkB ? isCorrect(bestMkB, null, actual, m.home_score + m.away_score, {home: m.home_score, away: m.away_score}) : false;

      matchResults.push({ home, away, actual, bestA: bestMkA, bestPrA, bestCorrectA, bestB: bestMkB, bestPrB, bestCorrectB });

      compared++;
    }

    trackerA.recordMatch(home, away, m.home_score, m.away_score);
    trackerB.recordMatch(home, away, m.home_score, m.away_score);

    if ((i + 1) % 2000 === 0) console.log(`   ${i + 1}/${allMatches.length} replayed...`);
  }

  console.log(`\n   Compared ${compared} matches\n`);

  // ─── REPORT ──────────────────────────────────────────────────────────

  console.log("━".repeat(65));
  console.log("📊 HEAD-TO-HEAD: v3.0 (predict-enhanced) vs v5.1 (ensemble)");
  console.log("━".repeat(65));

  const totalA = statsA.correct + statsA.wrong;
  const totalB = statsB.correct + statsB.wrong;
  const accA = (statsA.correct / totalA * 100).toFixed(1);
  const accB = (statsB.correct / totalB * 100).toFixed(1);
  const brierA = (statsA.brier / (totalA * 3)).toFixed(6);
  const brierB = (statsB.brier / (totalB * 3)).toFixed(6);

  console.log(`\n   ${"Metric".padEnd(22)} ${"v3.0".padEnd(14)} ${"v5.1".padEnd(14)} ${"Winner".padEnd(10)}`);
  console.log(`   ${"─".repeat(60)}`);
  console.log(`   ${"1X2 Accuracy".padEnd(22)} ${(accA + "%").padEnd(14)} ${(accB + "%").padEnd(14)} ${parseFloat(accB) > parseFloat(accA) ? "✅ v5.1" : "✅ v3.0"}`);
  console.log(`   ${"Brier Score (lower=better)".padEnd(22)} ${brierA.padEnd(14)} ${brierB.padEnd(14)} ${parseFloat(brierB) < parseFloat(brierA) ? "✅ v5.1" : "✅ v3.0"}`);
  console.log(`   ${"Total Predictions".padEnd(22)} ${String(totalA).padEnd(14)} ${String(totalB).padEnd(14)}`);
  console.log(`   ${"Correct".padEnd(22)} ${String(statsA.correct).padEnd(14)} ${String(statsB.correct).padEnd(14)}`);
  console.log(`   ${"Wrong".padEnd(22)} ${String(statsA.wrong).padEnd(14)} ${String(statsB.wrong).padEnd(14)}`);

  // Accuracy by market
  console.log("\n━".repeat(65));
  console.log("📊 ACCURACY BY MARKET");
  console.log("━".repeat(65));
  console.log(`   ${"Market".padEnd(20)} ${"v3.0".padEnd(14)} ${"v5.1".padEnd(14)} ${"Δ".padEnd(10)}`);
  console.log(`   ${"─".repeat(58)}`);

  const allMarkets = [...new Set([...Object.keys(statsA.marketStats), ...Object.keys(statsB.marketStats)])].sort();
  for (const mk of allMarkets) {
    const sA = statsA.marketStats[mk];
    const sB = statsB.marketStats[mk];
    if (!sA || !sB || sA.total < 10) continue;
    const accMkA = (sA.correct / sA.total * 100).toFixed(1);
    const accMkB = (sB.correct / sB.total * 100).toFixed(1);
    const delta = (sB.correct / sB.total - sA.correct / sA.total) * 100;
    const winner = delta > 0.5 ? "✅" : delta < -0.5 ? "❌" : "≈";
    console.log(`   ${mk.padEnd(20)} ${(accMkA + "%").padEnd(14)} ${(accMkB + "%").padEnd(14)} ${winner} ${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`);
  }

  // Accuracy by confidence tier
  console.log("\n━".repeat(65));
  console.log("📊 ACCURACY BY CONFIDENCE TIER (Best pick per match)");
  console.log("━".repeat(65));
  console.log(`   ${"Tier".padEnd(10)} ${"v3.0".padEnd(20)} ${"v5.1".padEnd(20)}`);
  console.log(`   ${"─".repeat(50)}`);

  for (const tier of ["ELITE", "HIGH", "MEDIUM", "LOW"]) {
    const tA = statsA.tierStats[tier];
    const tB = statsB.tierStats[tier];
    if (!tA || !tB) continue;
    const accTA = (tA.correct / tA.total * 100).toFixed(1);
    const accTB = (tB.correct / tB.total * 100).toFixed(1);
    const barA = "█".repeat(Math.round(tA.correct / tA.total * 15)) + "░".repeat(15 - Math.round(tA.correct / tA.total * 15));
    const barB = "█".repeat(Math.round(tB.correct / tB.total * 15)) + "░".repeat(15 - Math.round(tB.correct / tB.total * 15));
    console.log(`   ${tier.padEnd(10)} ${barA} ${accTA}% (${tA.total}) ${barB} ${accTB}% (${tB.total})`);
  }

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    matches_compared: compared,
    v3_0: { accuracy: parseFloat(accA), brier: parseFloat(brierA), correct: statsA.correct, total: totalA },
    v5_1: { accuracy: parseFloat(accB), brier: parseFloat(brierB), correct: statsB.correct, total: totalB },
    market_comparison: allMarkets.map(mk => ({
      market: mk,
      v3_0_acc: statsA.marketStats[mk] ? (statsA.marketStats[mk].correct / statsA.marketStats[mk].total) : null,
      v5_1_acc: statsB.marketStats[mk] ? (statsB.marketStats[mk].correct / statsB.marketStats[mk].total) : null,
    })).filter(m => m.v3_0_acc !== null && m.v5_1_acc !== null),
  };

  const outputPath = path.join(__dirname, "..", "data", "model-comparison.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n💾 Results saved to ${outputPath}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
