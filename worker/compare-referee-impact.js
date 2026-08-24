#!/usr/bin/env node
/**
 * Compare baseline model vs referee-enhanced model on the same fixtures.
 * Reads finished fixtures from Supabase, runs both models, compares accuracy.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const { loadRefereeData, getRefereeFeatures } = require("./referee-features");

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v[0] === '"' && v.slice(-1) === '"') || (v[0] === "'" && v.slice(-1) === "'")) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}
function poissonGoals(hL, aL, max = 8) {
  const grid = [];
  for (let i = 0; i <= max; i++) { grid[i] = []; for (let j = 0; j <= max; j++) grid[i][j] = poissonProb(hL, i) * poissonProb(aL, j); }
  return grid;
}
function computeMarkets(grid) {
  const m = {};
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) {
    if (i > j) pH += grid[i][j]; else if (i === j) pD += grid[i][j]; else pA += grid[i][j];
  }
  m["1X2_Home"] = clamp(pH); m["1X2_Draw"] = clamp(pD); m["1X2_Away"] = clamp(pA);
  m["DC_1X"] = clamp(pH + pD); m["DC_X2"] = clamp(pD + pA); m["DC_12"] = clamp(pH + pA);
  const dnb = pH + pA;
  m["DNB_Home"] = dnb > 0 ? clamp(pH / dnb) : 0.5;
  m["DNB_Away"] = dnb > 0 ? clamp(pA / dnb) : 0.5;
  let cumUnder = 0;
  for (let g = 0; g <= 10; g++) {
    for (let i = 0; i <= g; i++) cumUnder += (i <= g - i ? grid[i][g - i] : 0); // simplified
  }
  // Over/Under
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    let under = 0;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      if (i + j <= line) under += grid[i][j];
    }
    m[`OU_Over_${line}`] = clamp(1 - under);
    m[`OU_Under_${line}`] = clamp(under);
  }
  // BTTS
  let bttsYes = 0;
  for (let i = 1; i <= 8; i++) for (let j = 1; j <= 8; j++) bttsYes += grid[i][j];
  m["BTTS_Yes"] = clamp(bttsYes);
  m["BTTS_No"] = clamp(1 - bttsYes);
  return m;
}

function isCorrect(market, prob, homeScored, awayScored) {
  const actual = { home: homeScored, away: awayScored };
  const total = actual.home + actual.away;
  switch (market) {
    case "1X2_Home": return actual.home > actual.away;
    case "1X2_Draw": return actual.home === actual.away;
    case "1X2_Away": return actual.away > actual.home;
    case "DC_1X": return actual.home >= actual.away;
    case "DC_X2": return actual.away >= actual.home;
    case "DC_12": return actual.home !== actual.away;
    case "DNB_Home": return actual.home > actual.away;
    case "DNB_Away": return actual.away > actual.home;
    case "BTTS_Yes": return actual.home > 0 && actual.away > 0;
    case "BTTS_No": return actual.home === 0 || actual.away === 0;
    default:
      if (market.startsWith("OU_Over_")) { const line = parseFloat(market.split("_")[2]); return total > line; }
      if (market.startsWith("OU_Under_")) { const line = parseFloat(market.split("_")[2]); return total < line; }
  }
  return false;
}

// Simple Elo tracker
const DEFAULT_ELO = 1500;
function eloExpected(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }
function eloUpdate(rA, rB, sA, k = 20) { return rA + k * (sA - eloExpected(rA, rB)); }

async function main() {
  const MAX = parseInt(process.env.MAX_FIXTURES || "5000");
  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  console.log("🔄 Model Comparison: Baseline vs Referee-Enhanced");
  console.log("━".repeat(60));

  // Load referee data
  const refStats = loadRefereeData();
  console.log(`   👨‍⚖️ Referee data: ${refStats.profiles} profiles, ${refStats.matches} match mappings`);

  // Load finished fixtures
  const { data: fixtures } = await supabase
    .from("fixtures").select("id,home_team_id,away_team_id,home_score,away_score,kickoff_time,league_id,status")
    .eq("status", "finished").not("home_score", "is", null)
    .order("kickoff_time", { ascending: false }).limit(MAX);

  console.log(`   📋 Loaded ${fixtures.length} finished fixtures`);

  // Build team map
  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams) teamMap[t.id] = t.canonical_name;

  // Load league table stats per team
  const teamStats = {};
  for (const f of fixtures) {
    const h = teamMap[f.home_team_id], a = teamMap[f.away_team_id];
    if (!h || !a) continue;
    if (!teamStats[h]) teamStats[h] = { gf: 0, ga: 0, wins: 0, draws: 0, losses: 0, matches: 0, homeGoals: 0, homeMatches: 0 };
    if (!teamStats[a]) teamStats[a] = { gf: 0, ga: 0, wins: 0, draws: 0, losses: 0, matches: 0, homeGoals: 0, homeMatches: 0 };
  }

  // Simple tracker
  const elo = {};
  const stats = {};
  const statsBaseline = {};
  const statsReferee = {};

  function getStats(team) {
    if (!stats[team]) stats[team] = { gf: 0, ga: 0, hw: 0, hd: 0, hl: 0, aw: 0, ad: 0, al: 0, hg: 0, ag: 0, hm: 0, am: 0 };
    return stats[team];
  }

  let correctBaseline = 0, correctReferee = 0, total = 0;
  let correctBestBaseline = 0, correctBestReferee = 0;
  const marketCorrect = { baseline: {}, referee: {} };
  const tierCorrect = { baseline: { ELITE: [0,0], HIGH: [0,0], MEDIUM: [0,0], LOW: [0,0] }, referee: { ELITE: [0,0], HIGH: [0,0], MEDIUM: [0,0], LOW: [0,0] } };

  for (const f of fixtures) {
    const home = teamMap[f.home_team_id];
    const away = teamMap[f.away_team_id];
    if (!home || !away) continue;
    const hs = getStats(home);
    const as = getStats(away);
    const hElo = elo[home] || DEFAULT_ELO;
    const aElo = elo[away] || DEFAULT_ELO;
    const eloDiff = hElo - aElo;

    // Base lambdas from form
    const hGF = hs.hm > 0 ? hs.hg / hs.hm : 1.4;
    const hGA = hs.hm > 0 ? hs.ag / hs.hm : 1.1;
    const aGF = as.am > 0 ? as.ag / as.am : 1.1;
    const aDA = as.am > 0 ? hs.hg / hs.hm : 1.3;

    let baseHL = clamp(hGF * 1.1 * (1 + eloDiff * 0.0003), 0.3, 4.5);
    let baseAL = clamp(aGF * 0.9 * (1 - eloDiff * 0.0003), 0.3, 4.5);

    // ─── BASELINE MODEL (no referee) ────────────────
    const gridBase = poissonGoals(baseHL, baseAL);
    const marketsBase = computeMarkets(gridBase);

    // ─── REFEREE MODEL (with referee adjustments) ───
    const ref = getRefereeFeatures(home, away);
    
    // Start with same base lambdas
    let finalHL = baseHL;
    let finalAL = baseAL;
    
    if (ref.hasProfile && ref.referee) {
      // 1) League-wide goal tendency adjustment
      const refGoalAdj = ref.avgGoals / 2.6;
      finalHL = clamp(baseHL * refGoalAdj, 0.3, 4.5);
      finalAL = clamp(baseAL * refGoalAdj, 0.3, 4.5);
      
      // 2) Team-specific referee history (the big signal)
      const homeWinRate = ref.homeTeamRef?.winRate || 0.46;
      const awayWinRate = ref.awayTeamRef?.winRate || 0.30;
      const homeMatches = ref.homeTeamRef?.matches || 0;
      const awayMatches = ref.awayTeamRef?.matches || 0;
      
      // If we have enough team-referee history (3+ matches), use it to adjust
      if (homeMatches >= 3 && awayMatches >= 3) {
        // Team-specific win rate vs league average
        const homeRefStrength = (homeWinRate - 0.46); // positive = better than avg at home
        const awayRefStrength = (awayWinRate - 0.30); // positive = better than avg away
        
        // Adjust lambdas based on how each team performs under this referee
        const strengthDiff = homeRefStrength - awayRefStrength;
        finalHL = clamp(finalHL * (1 + strengthDiff * 0.25), 0.3, 4.5);
        finalAL = clamp(finalAL * (1 - strengthDiff * 0.25), 0.3, 4.5);
      }
      
      // 3) Home bias from referee profile
      const homeBiasAdj = 1 + (ref.homeBias - 0.46) * 0.15;
      finalHL = clamp(finalHL * homeBiasAdj, 0.3, 4.5);
      finalAL = clamp(finalAL / homeBiasAdj, 0.3, 4.5);
    }

    const gridRef = poissonGoals(finalHL, finalAL);
    const marketsRef = computeMarkets(gridRef);

    // Evaluate best picks
    let bestMkBase = null, bestProbBase = 0;
    let bestMkRef = null, bestProbRef = 0;
    for (const [mk, prob] of Object.entries(marketsBase)) {
      if (prob > bestProbBase) { bestProbBase = prob; bestMkBase = mk; }
    }
    for (const [mk, prob] of Object.entries(marketsRef)) {
      if (prob > bestProbRef) { bestProbRef = prob; bestMkRef = mk; }
    }

    // Check each market
    for (const mk of Object.keys(marketsBase)) {
      const correctB = isCorrect(mk, marketsBase[mk], f.home_score, f.away_score);
      const correctR = isCorrect(mk, marketsRef[mk], f.home_score, f.away_score);
      if (!marketCorrect.baseline[mk]) marketCorrect.baseline[mk] = [0, 0];
      if (!marketCorrect.referee[mk]) marketCorrect.referee[mk] = [0, 0];
      marketCorrect.baseline[mk][0] += correctB ? 1 : 0;
      marketCorrect.baseline[mk][1]++;
      marketCorrect.referee[mk][0] += correctR ? 1 : 0;
      marketCorrect.referee[mk][1]++;
    }

    // Best pick correctness
    if (bestMkBase && isCorrect(bestMkBase, bestProbBase, f.home_score, f.away_score)) correctBestBaseline++;
    if (bestMkRef && isCorrect(bestMkRef, bestProbRef, f.home_score, f.away_score)) correctBestReferee++;
    total++;

    // Update Elo
    if (f.home_score > f.away_score) {
      elo[home] = eloUpdate(hElo, aElo, 1);
      elo[away] = eloUpdate(aElo, hElo, 0);
      hs.hw++; as.al++;
    } else if (f.home_score < f.away_score) {
      elo[home] = eloUpdate(hElo, aElo, 0);
      elo[away] = eloUpdate(aElo, hElo, 1);
      hs.hl++; as.aw++;
    } else {
      elo[home] = eloUpdate(hElo, aElo, 0.5);
      elo[away] = eloUpdate(aElo, hElo, 0.5);
      hs.hd++; as.ad++;
    }
    hs.gf += f.home_score; hs.ga += f.away_score; hs.hm++;
    as.gf += f.away_score; as.ga += f.home_score; as.am++;
    hs.hg = (hs.hg || 0) + f.home_score;
    as.ag = (as.ag || 0) + f.away_score;

    if (total % 1000 === 0) process.stdout.write(`   ${total}/${fixtures.length}...\r`);
  }

  console.log(`\n   ✅ Processed ${total} fixtures\n`);

  // ─── RESULTS ──────────────────────────────────────────────
  console.log("━".repeat(60));
  console.log("📊 MODEL COMPARISON: BASELINE vs REFEREE-ENHANCED");
  console.log("━".repeat(60));
  console.log(`   Best pick correct (Baseline):     ${correctBestBaseline}/${total} (${(correctBestBaseline/total*100).toFixed(1)}%)`);
  console.log(`   Best pick correct (Referee):      ${correctBestReferee}/${total} (${(correctBestReferee/total*100).toFixed(1)}%)`);
  console.log(`   Improvement:                      +${((correctBestReferee - correctBestBaseline)/total*100).toFixed(1)}%`);

  console.log(`\n📊 BY MARKET (Referee model):`);
  const sorted = Object.entries(marketCorrect.referee).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]);
  for (const [mk, [c, t]] of sorted) {
    const base = marketCorrect.baseline[mk];
    const baseAcc = base ? (base[0] / base[1] * 100).toFixed(1) : '?';
    const refAcc = (c / t * 100).toFixed(1);
    const diff = base ? ((c / t - base[0] / base[1]) * 100).toFixed(1) : '0';
    const bar = '█'.repeat(Math.round(c / t * 20)) + '░'.repeat(20 - Math.round(c / t * 20));
    console.log(`   ${mk.padEnd(20)} ${bar} ${refAcc}% (base: ${baseAcc}%, Δ: ${diff > '+' ? '' : ''}${diff}%)`);
  }

  console.log(`\n📊 SUMMARY`);
  const totalBase = Object.values(marketCorrect.baseline).reduce((s, [c, t]) => s + c, 0);
  const totalBaseN = Object.values(marketCorrect.baseline).reduce((s, [c, t]) => s + t, 0);
  const totalRef = Object.values(marketCorrect.referee).reduce((s, [c, t]) => s + c, 0);
  const totalRefN = Object.values(marketCorrect.referee).reduce((s, [c, t]) => s + t, 0);
  console.log(`   Baseline total: ${totalBase}/${totalBaseN} (${(totalBase/totalBaseN*100).toFixed(1)}%)`);
  console.log(`   Referee total:  ${totalRef}/${totalRefN} (${(totalRef/totalRefN*100).toFixed(1)}%)`);
  console.log(`   Delta:          +${((totalRef - totalBase) / totalBaseN * 100).toFixed(2)}%`);
}

main().catch(console.error);
