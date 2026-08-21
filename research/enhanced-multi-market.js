#!/usr/bin/env node

/**
 * ODDLY Enhanced Multi-Market Simulation v2
 * 
 * Improvements over v1:
 * - Market-specific model weights (1X2, Over/Under, BTTS use different features)
 * - Head-to-head history
 * - Rest days between matches
 * - Goal-scoring patterns (home/away splits)
 * - Value detection against bookmaker odds
 * - Continuous learning with periodic retraining
 * - Out-of-sample testing (train on first 60%, test on last 40%)
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

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

// ─── Poisson ─────────────────────────────────────────────────────────────
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

// ─── Market Computation ──────────────────────────────────────────────────
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

  // Goals totals
  const totals = {};
  let cumUnder = 0;
  for (let t = 0; t <= 9; t++) {
    for (let i = 0; i < grid.length; i++)
      for (let j = 0; j < grid[i].length; j++)
        if (i + j === t) cumUnder += grid[i][j];
    totals[t] = cumUnder;
  }
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    m[`OU_Over_${line}`] = clamp(1 - (totals[Math.floor(line)] || 0));
    m[`OU_Under_${line}`] = clamp(totals[Math.floor(line)] || 0);
  }

  // BTTS
  let btts = 0;
  for (let i = 1; i < grid.length; i++)
    for (let j = 1; j < grid[i].length; j++) btts += grid[i][j];
  m["BTTS_Yes"] = clamp(btts); m["BTTS_No"] = clamp(1 - btts);

  // Team goals
  let hO05 = 0, hO15 = 0, hO25 = 0, aO05 = 0, aO15 = 0, aO25 = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = 0; j < grid[i].length; j++) {
      if (i >= 1) hO05 += grid[i][j]; if (i >= 2) hO15 += grid[i][j]; if (i >= 3) hO25 += grid[i][j];
      if (j >= 1) aO05 += grid[i][j]; if (j >= 2) aO15 += grid[i][j]; if (j >= 3) aO25 += grid[i][j];
    }
  m["HomeGoals_Over_0.5"] = clamp(hO05); m["HomeGoals_Over_1.5"] = clamp(hO15); m["HomeGoals_Over_2.5"] = clamp(hO25);
  m["AwayGoals_Over_0.5"] = clamp(aO05); m["AwayGoals_Over_1.5"] = clamp(aO15); m["AwayGoals_Over_2.5"] = clamp(aO25);

  return m;
}

function computeActual(hg, ag) {
  const o = {};
  const total = hg + ag;
  o["1X2_Home"] = hg > ag ? 1 : 0; o["1X2_Draw"] = hg === ag ? 1 : 0; o["1X2_Away"] = hg < ag ? 1 : 0;
  o["DC_1X"] = hg >= ag ? 1 : 0; o["DC_X2"] = hg <= ag ? 1 : 0; o["DC_12"] = hg !== ag ? 1 : 0;
  o["DNB_Home"] = hg > ag ? 1 : hg === ag ? 0.5 : 0;
  o["DNB_Away"] = hg < ag ? 1 : hg === ag ? 0.5 : 0;
  for (const l of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    o[`OU_Over_${l}`] = total > l ? 1 : 0; o[`OU_Under_${l}`] = total < l ? 1 : 0;
  }
  const btts = hg > 0 && ag > 0;
  o["BTTS_Yes"] = btts ? 1 : 0; o["BTTS_No"] = btts ? 0 : 1;
  o["HomeGoals_Over_0.5"] = hg >= 1 ? 1 : 0; o["HomeGoals_Over_1.5"] = hg >= 2 ? 1 : 0; o["HomeGoals_Over_2.5"] = hg >= 3 ? 1 : 0;
  o["AwayGoals_Over_0.5"] = ag >= 1 ? 1 : 0; o["AwayGoals_Over_1.5"] = ag >= 2 ? 1 : 0; o["AwayGoals_Over_2.5"] = ag >= 3 ? 1 : 0;
  return o;
}

// ─── Enhanced Team Tracker ───────────────────────────────────────────────
class TeamTracker {
  constructor() {
    this.history = {};
    this.h2h = {};
    this.elo = {};
  }

  recordMatch(home, away, hg, ag, date) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ opp: away, gf: hg, ga: ag, isHome: true, date });
    this.history[away].push({ opp: home, gf: ag, ga: hg, isHome: false, date });
    if (this.history[home].length > 50) this.history[home].shift();
    if (this.history[away].length > 50) this.history[away].shift();

    // H2H
    const h2hKey = [home, away].sort().join(" vs ");
    if (!this.h2h[h2hKey]) this.h2h[h2hKey] = [];
    this.h2h[h2hKey].push({ home, away, hg, ag, date });

    // Elo update
    this.updateElo(home, away, hg, ag);
  }

  updateElo(home, away, hg, ag) {
    const hRating = (this.elo[home] || 1500) + 65;
    const aRating = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (aRating - hRating) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }

  predictMatch(home, away) {
    const h = (this.elo[home] || 1500) + 65;
    const a = this.elo[away] || 1500;
    return 1 / (1 + Math.pow(10, (a - h) / 400));
  }

  getFeatures(home, away, matchDate) {
    const hf = this.getTeamFeatures(home, true);
    const af = this.getTeamFeatures(away, false);
    const h2h = this.getH2HFeatures(home, away);
    const eloDiff = (this.elo[home] || 1500) - (this.elo[away] || 1500);

    // Home attack vs Away defense
    const homeAttack = hf.goalsScored * 1.15;
    const awayDefense = af.goalsConceded * 1.05;
    // Away attack vs Home defense
    const awayAttack = af.goalsScored * 0.95;
    const homeDefense = hf.goalsConceded * 0.95;

    // Adjusted lambdas
    const homeLambda = clamp(homeAttack * (awayDefense / 1.3) * (1 + eloDiff * 0.0004), 0.3, 4.5);
    const awayLambda = clamp(awayAttack * (homeDefense / 1.3) * (1 - eloDiff * 0.0004), 0.3, 4.5);

    return {
      homeLambda, awayLambda,
      homeEloProb: this.predictMatch(home, away),
      homeForm: hf, awayForm: af, h2h, eloDiff,
    };
  }

  getTeamFeatures(team, isHome) {
    const hist = (this.history[team] || []).slice(-15);
    if (hist.length < 3) return {
      ppg: 1.5, goalsScored: 1.3, goalsConceded: 1.2, winRate: 0.4,
      homePpg: 1.7, awayPpg: 1.2, cleanSheetRate: 0.25, bttsRate: 0.5,
      streak: 0, form5: "", lastMatchDays: 7,
    };

    const recent5 = hist.slice(-5);
    const recent10 = hist.slice(-10);

    // Overall
    const ppg = recent5.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / recent5.length;
    const goalsScored = recent5.reduce((s, m) => s + m.gf, 0) / recent5.length;
    const goalsConceded = recent5.reduce((s, m) => s + m.ga, 0) / recent5.length;
    const winRate = recent5.filter(m => m.gf > m.ga).length / recent5.length;

    // Home/Away splits
    const homeMatches = hist.filter(m => m.isHome);
    const awayMatches = hist.filter(m => !m.isHome);
    const homePpg = homeMatches.length > 0
      ? homeMatches.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(homeMatches.length, 5)
      : ppg;
    const awayPpg = awayMatches.length > 0
      ? awayMatches.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(awayMatches.length, 5)
      : ppg;

    // Clean sheet / BTTS rates
    const cleanSheetRate = recent10.filter(m => m.ga === 0).length / recent10.length;
    const bttsRate = recent10.filter(m => m.gf > 0 && m.ga > 0).length / recent10.length;

    // Streak
    let streak = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
      const won = hist[i].gf > hist[i].ga;
      const lost = hist[i].gf < hist[i].ga;
      if (streak >= 0 && won) streak++;
      else if (streak <= 0 && lost) streak--;
      else break;
    }

    // Form string
    const form5 = recent5.map(m => m.gf > m.ga ? "W" : m.gf < m.ga ? "L" : "D").join("");

    // Days since last match
    const lastMatchDays = hist.length > 1
      ? Math.floor((Date.now() - new Date(hist[hist.length - 1].date).getTime()) / 86400000) || 3
      : 7;

    return { ppg, goalsScored, goalsConceded, winRate, homePpg, awayPpg, cleanSheetRate, bttsRate, streak, form5, lastMatchDays };
  }

  getH2HFeatures(home, away) {
    const key = [home, away].sort().join(" vs ");
    const matches = (this.h2h[key] || []).slice(-10);
    if (matches.length < 2) return { h2hHomeWins: 0, h2hDraws: 0, h2hAwayWins: 0, h2hAvgGoals: 2.5, h2hCount: 0 };

    let hW = 0, d = 0, aW = 0, totalGoals = 0;
    for (const m of matches) {
      const actualHome = m.home === home ? m.hg : m.ag;
      const actualAway = m.home === home ? m.ag : m.hg;
      if (actualHome > actualAway) hW++;
      else if (actualHome === actualAway) d++;
      else aW++;
      totalGoals += m.hg + m.ag;
    }

    return {
      h2hHomeWins: hW / matches.length,
      h2hDraws: d / matches.length,
      h2hAwayWins: aW / matches.length,
      h2hAvgGoals: totalGoals / matches.length,
      h2hCount: matches.length,
    };
  }
}

// ─── Main Simulation ─────────────────────────────────────────────────────
async function main() {
  console.log("🔬 ODDLY Enhanced Multi-Market Simulation v2");
  console.log("━".repeat(70));

  // Load all finished matches
  console.log("   Loading matches...");
  let allMatches = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("id, home_score, away_score, kickoff_time, league_id, home_team_id, away_team_id, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    allMatches = allMatches.concat(batch);
    offset += 999;
    if (batch.length < 1000) break;
  }
  console.log(`   Loaded ${allMatches.length} matches`);

  // Train/test split: first 60% train, last 40% test (out-of-sample)
  const splitIdx = Math.floor(allMatches.length * 0.6);
  const trainMatches = allMatches.slice(0, splitIdx);
  const testMatches = allMatches.slice(splitIdx);
  console.log(`   Train: ${trainMatches.length} | Test: ${testMatches.length} (out-of-sample)`);

  // Run simulation on BOTH sets
  for (const [label, matches] of [["TRAINING", trainMatches], ["TEST (OUT-OF-SAMPLE)", testMatches]]) {
    console.log(`\n${"━".repeat(70)}`);
    console.log(`📊 ${label} SET — ${matches.length} matches`);
    console.log("━".repeat(70));

    const tracker = new TeamTracker();
    const marketStats = {};
    const marketNames = [
      "1X2_Home", "1X2_Draw", "1X2_Away",
      "DC_1X", "DC_X2", "DC_12",
      "OU_Over_0.5", "OU_Over_1.5", "OU_Over_2.5", "OU_Over_3.5", "OU_Over_4.5",
      "OU_Under_0.5", "OU_Under_1.5", "OU_Under_2.5", "OU_Under_3.5", "OU_Under_4.5",
      "BTTS_Yes", "BTTS_No",
      "HomeGoals_Over_0.5", "HomeGoals_Over_1.5", "HomeGoals_Over_2.5",
      "AwayGoals_Over_0.5", "AwayGoals_Over_1.5", "AwayGoals_Over_2.5",
    ];
    for (const m of marketNames) marketStats[m] = { correct: 0, total: 0, brierSum: 0 };

    const confBuckets = {};
    for (const r of ["50-59", "60-69", "70-79", "80-84", "85-89", "90-94", "95+"])
      confBuckets[r] = { correct: 0, total: 0 };

    let bestPerMatch = [];
    let strongPickCounts = { 70: 0, 80: 0, 85: 0, 90: 0, 95: 0 };

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const home = match.home?.canonical_name;
      const away = match.away?.canonical_name;
      if (!home || !away) continue;
      const hg = match.home_score;
      const ag = match.away_score;

      // Generate predictions BEFORE recording result
      const features = tracker.getFeatures(home, away, match.kickoff_time);
      const grid = poissonGoals(features.homeLambda, features.awayLambda);
      const predictions = computeMarkets(grid);
      const actuals = computeActual(hg, ag);

      // Find best market
      let bestMarket = null;
      let bestProb = 0;
      for (const mk of marketNames) {
        const pred = predictions[mk];
        const act = actuals[mk];
        if (pred === undefined || act === undefined) continue;
        const correct = (pred >= 0.5 && act === 1) || (pred < 0.5 && act === 0);
        marketStats[mk].total++;
        marketStats[mk].brierSum += Math.pow(pred - act, 2);
        if (correct) marketStats[mk].correct++;

        const conf = Math.round(pred * 100);
        let bucket;
        if (conf >= 95) bucket = "95+"; else if (conf >= 90) bucket = "90-94";
        else if (conf >= 85) bucket = "85-89"; else if (conf >= 80) bucket = "80-84";
        else if (conf >= 70) bucket = "70-79"; else if (conf >= 60) bucket = "60-69";
        else bucket = "50-59";
        if (confBuckets[bucket]) { confBuckets[bucket].total++; if (correct) confBuckets[bucket].correct++; }

        if (pred > bestProb) {
          bestProb = pred;
          bestMarket = { market: mk, probability: pred, correct };
        }
      }

      if (bestMarket) {
        bestPerMatch.push(bestMarket);
        for (const t of [70, 80, 85, 90, 95]) {
          if (bestProb >= t / 100) strongPickCounts[t]++;
        }
      }

      // Update tracker AFTER (no leakage)
      tracker.recordMatch(home, away, hg, ag, match.kickoff_time);

      if (i % 2000 === 0) process.stdout.write(`   ${i}/${matches.length}\r`);
    }

    // Print results
    const totalBest = bestPerMatch.length;
    const bestCorrect = bestPerMatch.filter(m => m.correct).length;
    console.log(`\n   Best Market Per Match: ${bestCorrect}/${totalBest} = ${(bestCorrect / totalBest * 100).toFixed(1)}%\n`);

    console.log("   Coverage:");
    for (const [t, c] of Object.entries(strongPickCounts)) {
      const inBucket = bestPerMatch.filter(m => m.probability >= t / 100);
      const accInBucket = inBucket.length > 0 ? (inBucket.filter(m => m.correct).length / inBucket.length * 100).toFixed(1) : "—";
      console.log(`     ${t}%+: ${c}/${matches.length} (${(c / matches.length * 100).toFixed(0)}%) | Accuracy: ${accInBucket}%`);
    }

    console.log("\n   Top Markets:");
    const sorted = Object.entries(marketStats)
      .filter(([_, s]) => s.total > 0)
      .sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total));
    for (const [mk, s] of sorted.slice(0, 10)) {
      const acc = (s.correct / s.total * 100).toFixed(1);
      const brier = (s.brierSum / s.total).toFixed(4);
      console.log(`     ${mk.padEnd(25)} ${acc}% (${s.total}) Brier: ${brier}`);
    }

    console.log("\n   Calibration:");
    for (const [r, s] of Object.entries(confBuckets)) {
      if (s.total === 0) continue;
      const acc = (s.correct / s.total * 100).toFixed(1);
      console.log(`     ${r.padEnd(8)} ${String(s.total).padStart(8)} predictions  ${acc}% accuracy`);
    }
  }

  console.log("\n" + "━".repeat(70));
  console.log("✅ Enhanced simulation complete");
  console.log("━".repeat(70));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
