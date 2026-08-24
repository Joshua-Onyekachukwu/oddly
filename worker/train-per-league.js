#!/usr/bin/env node
/**
 * ODDLY Per-League Model Training
 *
 * Trains separate logistic regression coefficients for each league.
 * Different leagues have different scoring patterns:
 * - Bundesliga: high-scoring (more goals, more home wins)
 * - Serie A: tactical (more draws, fewer goals)
 * - Ligue 1: PSG-dominant (predictable top, unpredictable rest)
 *
 * Usage: node worker/train-per-league.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

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

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Logistic regression training via gradient descent
 */
function trainLogisticRegression(X, y, learningRate = 0.01, epochs = 500) {
  const n = X.length;
  const m = X[0].length;
  const weights = new Array(m).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0;
    const gradients = new Array(m).fill(0);
    let biasGrad = 0;

    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < m; j++) z += weights[j] * X[i][j];
      const pred = sigmoid(z);
      const error = pred - y[i];
      totalLoss += -y[i] * Math.log(pred + 1e-7) - (1 - y[i]) * Math.log(1 - pred + 1e-7);

      for (let j = 0; j < m; j++) gradients[j] += error * X[i][j];
      biasGrad += error;
    }

    for (let j = 0; j < m; j++) weights[j] -= learningRate * gradients[j] / n;
    bias -= learningRate * biasGrad / n;

    if (epoch % 100 === 0) {
      console.log(`   Epoch ${epoch}: loss ${(totalLoss / n).toFixed(4)}`);
    }
  }

  return { weights, bias };
}

/**
 * Build feature vector from match data
 */
function buildFeatures(homeStats, awayStats, eloDiff, h2h) {
  return [
    eloDiff / 400,                    // Normalized elo difference
    homeStats.ppg || 1.4,             // Home points per game
    awayStats.ppg || 1.1,             // Away points per game
    (homeStats.gf || 1.4) - (awayStats.ga || 1.1),  // Attack vs defense
    (awayStats.gf || 1.1) - (homeStats.ga || 1.4),  // Away attack vs home defense
    homeStats.cleanSheetRate || 0.3,  // Home clean sheet rate
    awayStats.cleanSheetRate || 0.3,  // Away clean sheet rate
    homeStats.winRate || 0.4,         // Home win rate
    awayStats.winRate || 0.3,         // Away win rate
    h2h.h2hHomeWins - 0.4,           // H2H home advantage
    (homeStats.gf || 1.4) + (awayStats.gf || 1.1), // Expected total goals
  ];
}

async function main() {
  console.log("🎯 ODDLY Per-League Model Training");
  console.log("━".repeat(50));

  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // Target leagues with enough data
  const targetLeagues = [
    "Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1",
    "Eredivisie", "Championship", "Primeira Liga",
  ];

  const { data: leagues } = await supabase.from("leagues").select("id, name");
  const leagueMap = {};
  for (const l of leagues || []) leagueMap[l.name] = l.id;

  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamNameMap = {};
  for (const t of teams || []) teamNameMap[t.id] = t.canonical_name;

  const leagueModels = {};

  for (const leagueName of targetLeagues) {
    const leagueId = leagueMap[leagueName];
    if (!leagueId) continue;

    console.log(`\n⚽ ${leagueName}...`);

    // Get finished fixtures for this league
    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, home_team_id, away_team_id, home_score, away_score, kickoff_time")
      .eq("league_id", leagueId)
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true });

    if (!fixtures || fixtures.length < 50) {
      console.log(`   ⚠️  Only ${fixtures?.length || 0} fixtures — skipping (need 50+)`);
      continue;
    }

    console.log(`   📋 ${fixtures.length} fixtures`);

    // Build team stats chronologically
    const teamStats = {};
    const elo = {};
    const h2h = {};

    function getStats(team) {
      if (!teamStats[team]) teamStats[team] = { gf: 0, ga: 0, hw: 0, hd: 0, hl: 0, aw: 0, ad: 0, al: 0, hm: 0, am: 0, matches: 0 };
      return teamStats[team];
    }

    function eloExpected(rA, rB) { return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }
    function eloUpdate(rA, rB, sA, k = 20) { return rA + k * (sA - eloExpected(rA, rB)); }

    const X = []; // Features
    const y = []; // Labels (1 = home win, 0 = draw or away)

    // Use 70% for training, 30% for validation
    const trainEnd = Math.floor(fixtures.length * 0.7);

    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      const home = teamNameMap[f.home_team_id];
      const away = teamNameMap[f.away_team_id];
      if (!home || !away) continue;

      const hs = getStats(home);
      const as = getStats(away);
      const hElo = elo[home] || 1500;
      const aElo = elo[away] || 1500;
      const eloDiff = hElo - aElo;

      // Compute stats
      const homePPG = hs.hm > 0 ? (hs.hw * 3 + hs.hd) / hs.hm : 1.4;
      const awayPPG = as.am > 0 ? (as.aw * 3 + as.ad) / as.am : 1.1;
      const homeGF = hs.hm > 0 ? hs.gf / hs.hm : 1.4;
      const homeGA = hs.hm > 0 ? hs.ga / hs.hm : 1.1;
      const awayGF = as.am > 0 ? as.gf / as.am : 1.1;
      const awayGA = as.am > 0 ? as.ga / as.am : 1.3;
      const homeCSR = hs.hm > 0 ? (hs.hm - hs.ga) / hs.hm : 0.3;
      const awayCSR = as.am > 0 ? (as.am - as.ga) / as.am : 0.3;
      const homeWR = hs.hm > 0 ? hs.hw / hs.hm : 0.4;
      const awayWR = as.am > 0 ? as.aw / as.am : 0.3;

      const h2hKey = `${home}|${away}`;
      const h2hData = h2h[h2hKey] || { homeWins: 0, total: 0 };
      const h2hHomeWins = h2hData.total > 0 ? h2hData.homeWins / h2hData.total : 0.4;

      const features = [
        eloDiff / 400,
        homePPG,
        awayPPG,
        homeGF - awayGA,
        awayGF - homeGA,
        homeCSR,
        awayCSR,
        homeWR,
        awayWR,
        h2hHomeWins - 0.4,
        homeGF + awayGF,
      ];

      const actual = f.home_score > f.away_score ? 1 : 0;

      if (i < trainEnd) {
        X.push(features);
        y.push(actual);
      }

      // Update stats
      hs.gf += f.home_score; hs.ga += f.away_score; hs.hm++; hs.matches++;
      as.gf += f.away_score; as.ga += f.home_score; as.am++; as.matches++;
      if (f.home_score > f.away_score) { hs.hw++; as.al++; }
      else if (f.home_score < f.away_score) { hs.hl++; as.aw++; }
      else { hs.hd++; as.ad++; }

      elo[home] = eloUpdate(hElo, aElo, f.home_score > f.away_score ? 1 : f.home_score === f.away_score ? 0.5 : 0);
      elo[away] = eloUpdate(aElo, hElo, f.away_score > f.home_score ? 1 : f.home_score === f.away_score ? 0.5 : 0);

      // Update H2H
      if (!h2h[h2hKey]) h2h[h2hKey] = { homeWins: 0, total: 0 };
      h2h[h2hKey].total++;
      if (f.home_score > f.away_score) h2h[h2hKey].homeWins++;
    }

    if (X.length < 30) {
      console.log(`   ⚠️  Only ${X.length} training samples — skipping`);
      continue;
    }

    // Train
    console.log(`   🏋️ Training on ${X.length} matches...`);
    const model = trainLogisticRegression(X, y, 0.05, 300);

    // Validate on remaining data
    let correct = 0, total = 0;
    for (let i = trainEnd; i < fixtures.length; i++) {
      const f = fixtures[i];
      const home = teamNameMap[f.home_team_id];
      const away = teamNameMap[f.away_team_id];
      if (!home || !away) continue;

      // Use final stats for validation
      const hs = getStats(home);
      const as = getStats(away);
      const features = [
        (elo[home] || 1500) - (elo[away] || 1500),
        hs.hm > 0 ? (hs.hw * 3 + hs.hd) / hs.hm : 1.4,
        as.am > 0 ? (as.aw * 3 + as.ad) / as.am : 1.1,
        (hs.hm > 0 ? hs.gf / hs.hm : 1.4) - (as.am > 0 ? as.ga / as.am : 1.3),
        (as.am > 0 ? as.gf / as.am : 1.1) - (hs.hm > 0 ? hs.ga / hs.hm : 1.1),
        hs.hm > 0 ? (hs.hm - hs.ga) / hs.hm : 0.3,
        as.am > 0 ? (as.am - as.ga) / as.am : 0.3,
        hs.hm > 0 ? hs.hw / hs.hm : 0.4,
        as.am > 0 ? as.aw / as.am : 0.3,
        0, // h2h
        (hs.hm > 0 ? hs.gf / hs.hm : 1.4) + (as.am > 0 ? as.gf / as.am : 1.1),
      ];

      let z = model.bias;
      for (let j = 0; j < model.weights.length; j++) z += model.weights[j] * features[j];
      const pred = sigmoid(z);
      const actual = f.home_score > f.away_score ? 1 : 0;
      const predicted = pred > 0.5 ? 1 : 0;
      if (predicted === actual) correct++;
      total++;
    }

    const accuracy = total > 0 ? (correct / total * 100).toFixed(1) : "N/A";
    console.log(`   ✅ Validation accuracy: ${accuracy}% (${correct}/${total})`);

    leagueModels[leagueName] = {
      weights: model.weights,
      bias: model.bias,
      accuracy: parseFloat(accuracy),
      training_samples: X.length,
      validation_samples: total,
      feature_names: [
        "eloDiff", "homePPG", "awayPPG", "attackVsDefense", "awayAttackVsHomeDefense",
        "homeCleanSheet", "awayCleanSheet", "homeWinRate", "awayWinRate", "h2hHomeAdv",
        "expectedTotalGoals",
      ],
    };
  }

  // Save models
  const outputPath = path.join(__dirname, "..", "data", "per-league-models.json");
  fs.writeFileSync(outputPath, JSON.stringify({
    trained_at: new Date().toISOString(),
    leagues: leagueModels,
  }, null, 2));

  console.log("\n" + "━".repeat(50));
  console.log("📊 Per-League Model Summary");
  for (const [name, model] of Object.entries(leagueModels)) {
    console.log(`   ${name.padEnd(20)} ${model.accuracy}% (${model.training_samples} train, ${model.validation_samples} val)`);
  }
  console.log(`\n💾 Saved to ${outputPath}`);
}

main().catch(console.error);
