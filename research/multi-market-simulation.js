#!/usr/bin/env node

/**
 * ODDLY Multi-Market Historical Simulation
 * 
 * Tests ALL supported betting markets across the full historical dataset.
 * For each match, generates predictions for every market, evaluates outcomes,
 * and discovers which markets are most predictable under what conditions.
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

// ─── Poisson Model ───────────────────────────────────────────────────────
function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function poissonGoals(homeLambda, awayLambda, maxGoals = 8) {
  const grid = [];
  for (let i = 0; i <= maxGoals; i++) {
    grid[i] = [];
    for (let j = 0; j <= maxGoals; j++) {
      grid[i][j] = poissonProb(homeLambda, i) * poissonProb(awayLambda, j);
    }
  }
  return grid;
}

// ─── Market Probabilities from Poisson Grid ──────────────────────────────
function computeAllMarkets(grid) {
  const markets = {};

  // 1X2
  let pHome = 0, pDraw = 0, pAway = 0;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (i > j) pHome += grid[i][j];
      else if (i === j) pDraw += grid[i][j];
      else pAway += grid[i][j];
    }
  }
  markets["1X2_Home"] = clamp(pHome);
  markets["1X2_Draw"] = clamp(pDraw);
  markets["1X2_Away"] = clamp(pAway);

  // Double Chance
  markets["DC_1X"] = clamp(pHome + pDraw);
  markets["DC_X2"] = clamp(pDraw + pAway);
  markets["DC_12"] = clamp(pHome + pAway);

  // Draw No Bet (remove draw probability, redistribute)
  const dnbTotal = pHome + pAway;
  markets["DNB_Home"] = dnbTotal > 0 ? clamp(pHome / dnbTotal) : 0.5;
  markets["DNB_Away"] = dnbTotal > 0 ? clamp(pAway / dnbTotal) : 0.5;

  // Over/Under Total Goals
  const totals = {};
  let cumUnder = 0;
  for (let t = 0; t <= 9; t++) {
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid[i].length; j++) {
        if (i + j === t) cumUnder += grid[i][j];
      }
    }
    totals[t] = cumUnder;
  }

  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const underP = totals[Math.floor(line)] || 0;
    markets[`OU_Under_${line}`] = clamp(underP);
    markets[`OU_Over_${line}`] = clamp(1 - underP);
  }

  // BTTS
  let pBttsYes = 0;
  for (let i = 1; i < grid.length; i++) {
    for (let j = 1; j < grid[i].length; j++) {
      pBttsYes += grid[i][j];
    }
  }
  markets["BTTS_Yes"] = clamp(pBttsYes);
  markets["BTTS_No"] = clamp(1 - pBttsYes);

  // Home Team Goals
  let pHomeOver05 = 0, pHomeOver15 = 0, pHomeOver25 = 0;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (i >= 1) pHomeOver05 += grid[i][j];
      if (i >= 2) pHomeOver15 += grid[i][j];
      if (i >= 3) pHomeOver25 += grid[i][j];
    }
  }
  markets["HomeGoals_Over_0.5"] = clamp(pHomeOver05);
  markets["HomeGoals_Over_1.5"] = clamp(pHomeOver15);
  markets["HomeGoals_Over_2.5"] = clamp(pHomeOver25);

  // Away Team Goals
  let pAwayOver05 = 0, pAwayOver15 = 0, pAwayOver25 = 0;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (j >= 1) pAwayOver05 += grid[i][j];
      if (j >= 2) pAwayOver15 += grid[i][j];
      if (j >= 3) pAwayOver25 += grid[i][j];
    }
  }
  markets["AwayGoals_Over_0.5"] = clamp(pAwayOver05);
  markets["AwayGoals_Over_1.5"] = clamp(pAwayOver15);
  markets["AwayGoals_Over_2.5"] = clamp(pAwayOver25);

  // Exact goal ranges
  let p00 = grid[0]?.[0] || 0;
  let p10 = grid[1]?.[0] || 0;
  let p01 = grid[0]?.[1] || 0;
  let p11 = grid[1]?.[1] || 0;
  let p21 = grid[2]?.[1] || 0;
  let p12 = grid[1]?.[2] || 0;
  let p20 = grid[2]?.[0] || 0;
  let p02 = grid[0]?.[2] || 0;
  
  markets["Score_0_0"] = clamp(p00);
  markets["Score_1_0"] = clamp(p10);
  markets["Score_0_1"] = clamp(p01);
  markets["Score_1_1"] = clamp(p11);

  return markets;
}

// ─── Actual Outcomes ─────────────────────────────────────────────────────
function computeActualOutcomes(homeScore, awayScore) {
  const outcomes = {};
  const totalGoals = homeScore + awayScore;
  const btts = homeScore > 0 && awayScore > 0;

  // 1X2
  outcomes["1X2_Home"] = homeScore > awayScore ? 1 : 0;
  outcomes["1X2_Draw"] = homeScore === awayScore ? 1 : 0;
  outcomes["1X2_Away"] = homeScore < awayScore ? 1 : 0;

  // Double Chance
  outcomes["DC_1X"] = homeScore >= awayScore ? 1 : 0;
  outcomes["DC_X2"] = homeScore <= awayScore ? 1 : 0;
  outcomes["DC_12"] = homeScore !== awayScore ? 1 : 0;

  // Draw No Bet
  outcomes["DNB_Home"] = homeScore > awayScore ? 1 : homeScore === awayScore ? 0.5 : 0;
  outcomes["DNB_Away"] = homeScore < awayScore ? 1 : homeScore === awayScore ? 0.5 : 0;

  // Over/Under
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    outcomes[`OU_Over_${line}`] = totalGoals > line ? 1 : 0;
    outcomes[`OU_Under_${line}`] = totalGoals < line ? 1 : totalGoals === line ? 0 : 1;
    // Fix: Under wins when total < line
    outcomes[`OU_Under_${line}`] = totalGoals < line ? 1 : 0;
  }

  // BTTS
  outcomes["BTTS_Yes"] = btts ? 1 : 0;
  outcomes["BTTS_No"] = btts ? 0 : 1;

  // Team Goals
  outcomes["HomeGoals_Over_0.5"] = homeScore >= 1 ? 1 : 0;
  outcomes["HomeGoals_Over_1.5"] = homeScore >= 2 ? 1 : 0;
  outcomes["HomeGoals_Over_2.5"] = homeScore >= 3 ? 1 : 0;
  outcomes["AwayGoals_Over_0.5"] = awayScore >= 1 ? 1 : 0;
  outcomes["AwayGoals_Over_1.5"] = awayScore >= 2 ? 1 : 0;
  outcomes["AwayGoals_Over_2.5"] = awayScore >= 3 ? 1 : 0;

  // Exact Scores
  outcomes["Score_0_0"] = homeScore === 0 && awayScore === 0 ? 1 : 0;
  outcomes["Score_1_0"] = homeScore === 1 && awayScore === 0 ? 1 : 0;
  outcomes["Score_0_1"] = homeScore === 0 && awayScore === 1 ? 1 : 0;
  outcomes["Score_1_1"] = homeScore === 1 && awayScore === 1 ? 1 : 0;

  return outcomes;
}

// ─── Elo System ──────────────────────────────────────────────────────────
class EloSystem {
  constructor() { this.ratings = {}; }
  get(t) { return this.ratings[t] || 1500; }
  predict(home, away) {
    const h = this.get(home) + 65;
    const a = this.get(away);
    return 1 / (1 + Math.pow(10, (a - h) / 400));
  }
  update(home, away, hg, ag) {
    const h = this.get(home) + 65;
    const a = this.get(away);
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.ratings[home] = this.get(home) + 32 * (actual - eH);
    this.ratings[away] = this.get(away) + 32 * ((1 - actual) - (1 - eH));
  }
}

// ─── Form Tracker ────────────────────────────────────────────────────────
class FormTracker {
  constructor() { this.history = {}; }
  record(team, goalsFor, goalsAgainst) {
    if (!this.history[team]) this.history[team] = [];
    this.history[team].push({ gf: goalsFor, ga: goalsAgainst });
    if (this.history[team].length > 30) this.history[team].shift();
  }
  getLambda(team, isHome) {
    const last = (this.history[team] || []).slice(-10);
    if (last.length < 3) return isHome ? 1.45 : 1.15;
    const avgGF = last.reduce((s, m) => s + m.gf, 0) / last.length;
    const avgGA = last.reduce((s, m) => s + m.ga, 0) / last.length;
    // Strength-adjusted expected goals
    return clamp(isHome ? avgGF * 1.1 : avgGF * 0.9, 0.3, 4.0);
  }
  getConcededLambda(team, isHome) {
    const last = (this.history[team] || []).slice(-10);
    if (last.length < 3) return isHome ? 1.15 : 1.35;
    const avgGA = last.reduce((s, m) => s + m.ga, 0) / last.length;
    return clamp(isHome ? avgGA * 0.95 : avgGA * 1.05, 0.3, 4.0);
  }
}

// ─── Main Simulation ─────────────────────────────────────────────────────
async function main() {
  console.log("🔬 ODDLY Multi-Market Historical Simulation");
  console.log("━".repeat(70));

  // Load ALL finished matches chronologically
  console.log("   Loading historical matches...");
  let allMatches = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select(`
        id, home_score, away_score, kickoff_time, league_id,
        home:teams!fixtures_home_team_id_fkey(canonical_name),
        away:teams!fixtures_away_team_id_fkey(canonical_name)
      `)
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;
    allMatches = allMatches.concat(batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  console.log(`   Loaded ${allMatches.length} finished matches`);

  // League stats
  const leagueCounts = {};
  for (const m of allMatches) {
    const lid = m.league_id || "unknown";
    leagueCounts[lid] = (leagueCounts[lid] || 0) + 1;
  }
  console.log(`   Leagues: ${Object.keys(leagueCounts).length}`);

  // Initialize models
  const elo = new EloSystem();
  const form = new FormTracker();

  // Tracking structures
  const marketStats = {};
  const marketNames = [
    "1X2_Home", "1X2_Draw", "1X2_Away",
    "DC_1X", "DC_X2", "DC_12",
    "DNB_Home", "DNB_Away",
    "OU_Over_0.5", "OU_Under_0.5",
    "OU_Over_1.5", "OU_Under_1.5",
    "OU_Over_2.5", "OU_Under_2.5",
    "OU_Over_3.5", "OU_Under_3.5",
    "OU_Over_4.5", "OU_Under_4.5",
    "BTTS_Yes", "BTTS_No",
    "HomeGoals_Over_0.5", "HomeGoals_Over_1.5", "HomeGoals_Over_2.5",
    "AwayGoals_Over_0.5", "AwayGoals_Over_1.5", "AwayGoals_Over_2.5",
  ];

  for (const m of marketNames) {
    marketStats[m] = { correct: 0, total: 0, probSum: 0, brierSum: 0, predictions: [] };
  }

  // Confidence buckets
  const confBuckets = {};
  for (const range of ["50-59", "60-69", "70-79", "80-84", "85-89", "90-94", "95+"]) {
    confBuckets[range] = { correct: 0, total: 0 };
  }

  // Per-match tracking
  let bestMarketPerMatch = [];
  let matchesWithStrongPick = { "70": 0, "75": 0, "80": 0, "85": 0, "90": 0, "95": 0 };

  // Rolling accuracy tracking
  const rollingWindow = [];
  const rollingAccuracy = [];

  console.log("\n🔄 Running simulation...\n");

  const startTime = Date.now();

  for (let i = 0; i < allMatches.length; i++) {
    const match = allMatches[i];
    const homeName = match.home?.canonical_name;
    const awayName = match.away?.canonical_name;
    if (!homeName || !awayName) continue;

    const hg = match.home_score;
    const ag = match.away_score;

    // Generate predictions BEFORE recording result (no leakage)
    const homeEloProb = elo.predict(homeName, awayName);
    const homeFormLambda = form.getLambda(homeName, true);
    const awayFormLambda = form.getLambda(awayName, false);
    
    // Adjust lambdas by Elo strength
    const eloDiff = elo.get(homeName) + 65 - elo.get(awayName);
    const strengthFactor = 1 + eloDiff * 0.0003;
    const adjHomeLambda = clamp(homeFormLambda * strengthFactor, 0.3, 4.0);
    const adjAwayLambda = clamp(awayFormLambda / strengthFactor, 0.3, 4.0);

    const grid = poissonGoals(adjHomeLambda, adjAwayLambda);
    const predictions = computeAllMarkets(grid);
    const actuals = computeActualOutcomes(hg, ag);

    // Find best market for this match
    let bestMarket = null;
    let bestProb = 0;

    for (const market of marketNames) {
      const pred = predictions[market];
      const actual = actuals[market];
      if (pred === undefined || actual === undefined) continue;

      const isCorrect = (pred >= 0.5 && actual === 1) || (pred < 0.5 && actual === 0);

      marketStats[market].total++;
      marketStats[market].probSum += pred;

      // Brier score
      const brier = Math.pow(pred - actual, 2);
      marketStats[market].brierSum += brier;

      if (isCorrect) marketStats[market].correct++;

      // Confidence bucket
      const confPct = Math.round(pred * 100);
      let bucket;
      if (confPct >= 95) bucket = "95+";
      else if (confPct >= 90) bucket = "90-94";
      else if (confPct >= 85) bucket = "85-89";
      else if (confPct >= 80) bucket = "80-84";
      else if (confPct >= 70) bucket = "70-79";
      else if (confPct >= 60) bucket = "60-69";
      else bucket = "50-59";

      if (confBuckets[bucket]) {
        confBuckets[bucket].total++;
        if (isCorrect) confBuckets[bucket].correct++;
      }

      // Track best market per match
      if (pred > bestProb) {
        bestProb = pred;
        bestMarket = { market, selection: market.split("_").slice(1).join("_"), probability: pred, correct: isCorrect };
      }
    }

    if (bestMarket) {
      bestMarketPerMatch.push(bestMarket);

      // Check coverage at different thresholds
      for (const threshold of [70, 75, 80, 85, 90, 95]) {
        if (bestProb >= threshold / 100) {
          matchesWithStrongPick[threshold]++;
        }
      }
    }

    // Rolling accuracy
    rollingWindow.push(bestMarket?.correct ? 1 : 0);
    if (rollingWindow.length > 200) rollingWindow.shift();
    if (i % 100 === 0 && rollingWindow.length > 0) {
      const acc = rollingWindow.reduce((s, v) => s + v, 0) / rollingWindow.length;
      rollingAccuracy.push({ match: i, accuracy: acc });
    }

    // Update models AFTER recording (learn from result)
    elo.update(homeName, awayName, hg, ag);
    form.record(homeName, hg, ag);
    form.record(awayName, ag, hg);

    // Progress
    if (i % 500 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const bestAcc = bestMarketPerMatch.length > 0
        ? (bestMarketPerMatch.filter(m => m.correct).length / bestMarketPerMatch.length * 100).toFixed(1)
        : "—";
      process.stdout.write(`   ${i}/${allMatches.length} (${elapsed}s) Best-market accuracy: ${bestAcc}%\r`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ Simulation complete in ${elapsed}s\n`);

  // ─── Results Report ──────────────────────────────────────────────────
  console.log("━".repeat(70));
  console.log("📊 MULTI-MARKET SIMULATION RESULTS");
  console.log("━".repeat(70));
  console.log(`   Matches analyzed: ${allMatches.length}`);
  console.log(`   Markets tested: ${marketNames.length}`);
  console.log("");

  // 1. Best Market Per Match
  const totalBest = bestMarketPerMatch.length;
  const bestCorrect = bestMarketPerMatch.filter(m => m.correct).length;
  console.log("🎯 BEST MARKET PER MATCH (highest probability outcome)");
  console.log("━".repeat(70));
  console.log(`   Overall accuracy: ${bestCorrect}/${totalBest} = ${(bestCorrect / totalBest * 100).toFixed(1)}%`);
  console.log("");

  // Coverage analysis
  console.log("📈 COVERAGE ANALYSIS (matches with at least one market above threshold)");
  console.log("━".repeat(70));
  for (const [threshold, count] of Object.entries(matchesWithStrongPick)) {
    const pct = (count / allMatches.length * 100).toFixed(1);
    const accInBucket = bestMarketPerMatch.filter(m => m.probability >= threshold / 100);
    const accCorrect = accInBucket.filter(m => m.correct).length;
    const acc = accInBucket.length > 0 ? (accCorrect / accInBucket.length * 100).toFixed(1) : "—";
    console.log(`   ${threshold}%+ confidence: ${count}/${allMatches.length} matches (${pct}%) | Accuracy: ${acc}%`);
  }
  console.log("");

  // 2. Market-by-Market Performance
  console.log("📊 MARKET-BY-MARKET PERFORMANCE");
  console.log("━".repeat(70));
  console.log("   Market                    Predictions  Accuracy   Avg Prob   Brier");
  console.log("   " + "─".repeat(66));

  const sortedMarkets = Object.entries(marketStats)
    .filter(([_, s]) => s.total > 0)
    .sort((a, b) => (b[1].correct / b[1].total) - (a[1].correct / a[1].total));

  for (const [market, stats] of sortedMarkets) {
    const acc = (stats.correct / stats.total * 100).toFixed(1);
    const avgProb = (stats.probSum / stats.total * 100).toFixed(1);
    const brier = (stats.brierSum / stats.total).toFixed(4);
    const label = market.padEnd(26);
    console.log(`   ${label} ${String(stats.total).padStart(8)}    ${acc.padStart(6)}%   ${avgProb.padStart(6)}%   ${brier}`);
  }
  console.log("");

  // 3. Confidence Calibration
  console.log("🎯 CONFIDENCE CALIBRATION");
  console.log("━".repeat(70));
  console.log("   Range      Predictions  Correct   Accuracy   Expected");
  console.log("   " + "─".repeat(60));
  for (const [range, stats] of Object.entries(confBuckets)) {
    if (stats.total === 0) continue;
    const acc = (stats.correct / stats.total * 100).toFixed(1);
    const expectedLow = parseInt(range) || 50;
    const expectedHigh = range === "95+" ? 100 : parseInt(range.split("-")[1]) || 60;
    const expected = `${expectedLow}-${expectedHigh}%`;
    console.log(`   ${range.padEnd(11)} ${String(stats.total).padStart(8)}    ${String(stats.correct).padStart(6)}   ${acc.padStart(6)}%    ${expected}`);
  }
  console.log("");

  // 4. Market Categories Summary
  console.log("📋 MARKET CATEGORY SUMMARY");
  console.log("━".repeat(70));

  const categories = {
    "1X2 (Match Result)": ["1X2_Home", "1X2_Draw", "1X2_Away"],
    "Double Chance": ["DC_1X", "DC_X2", "DC_12"],
    "Draw No Bet": ["DNB_Home", "DNB_Away"],
    "Over/Under Goals": ["OU_Over_0.5", "OU_Under_0.5", "OU_Over_1.5", "OU_Under_1.5", "OU_Over_2.5", "OU_Under_2.5", "OU_Over_3.5", "OU_Under_3.5", "OU_Over_4.5", "OU_Under_4.5"],
    "BTTS": ["BTTS_Yes", "BTTS_No"],
    "Team Goals": ["HomeGoals_Over_0.5", "HomeGoals_Over_1.5", "HomeGoals_Over_2.5", "AwayGoals_Over_0.5", "AwayGoals_Over_1.5", "AwayGoals_Over_2.5"],
  };

  for (const [catName, catMarkets] of Object.entries(categories)) {
    let catCorrect = 0, catTotal = 0;
    for (const m of catMarkets) {
      catCorrect += marketStats[m]?.correct || 0;
      catTotal += marketStats[m]?.total || 0;
    }
    const acc = catTotal > 0 ? (catCorrect / catTotal * 100).toFixed(1) : "—";
    console.log(`   ${catName.padEnd(25)} ${String(catTotal).padStart(8)} predictions  ${acc}% accuracy`);
  }
  console.log("");

  // 5. Top 10 Best Markets
  console.log("🏆 TOP 10 MOST PREDICTABLE MARKETS");
  console.log("━".repeat(70));
  const top10 = sortedMarkets.slice(0, 10);
  for (let i = 0; i < top10.length; i++) {
    const [market, stats] = top10[i];
    const acc = (stats.correct / stats.total * 100).toFixed(1);
    const avgProb = (stats.probSum / stats.total * 100).toFixed(1);
    console.log(`   ${i + 1}. ${market.padEnd(25)} ${acc}% accuracy (${stats.total} matches, avg prob ${avgProb}%)`);
  }
  console.log("");

  // 6. Save results
  const results = {
    timestamp: new Date().toISOString(),
    totalMatches: allMatches.length,
    marketsTested: marketNames.length,
    bestMarketAccuracy: totalBest > 0 ? (bestCorrect / totalBest * 100).toFixed(1) : 0,
    coverage: matchesWithStrongPick,
    marketStats: Object.fromEntries(
      Object.entries(marketStats).map(([k, v]) => [k, {
        total: v.total,
        correct: v.correct,
        accuracy: v.total > 0 ? +(v.correct / v.total * 100).toFixed(1) : 0,
        avgProb: v.total > 0 ? +(v.probSum / v.total * 100).toFixed(1) : 0,
        brierScore: v.total > 0 ? +(v.brierSum / v.total).toFixed(4) : 0,
      }])
    ),
    calibration: confBuckets,
  };

  const outPath = path.join(__dirname, "..", "docs", "multi-market-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`💾 Results saved to docs/multi-market-results.json`);
  console.log("━".repeat(70));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
