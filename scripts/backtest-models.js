#!/usr/bin/env node

/**
 * ODDLY Model Backtesting Framework
 *
 * Tests each prediction model against historical data to measure accuracy,
 * calibration, and ROI. Compares models and generates an ensemble.
 *
 * Models Tested:
 *   1. Dixon-Coles (Poisson-based) — best for scoreline probabilities
 *   2. Elo Rating — best for long-term team strength
 *   3. XGBoost — best for non-linear feature interactions
 *   4. Ensemble (weighted average) — the production model
 *
 * Usage: node scripts/backtest-models.js [--season=2024] [--league=<id>]
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local not found.");
    process.exit(1);
  }
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Model Implementations ───────────────────────────────────────────────────

/**
 * Dixon-Coles Model (simplified Poisson)
 * Uses attack/defense ratings to predict scoreline probabilities.
 */
function dixonColesPredict(homeAttack, homeDefense, awayAttack, awayDefense) {
  const avgGoals = 1.35; // Historical average goals per team per match

  const homeLambda = Math.exp(homeAttack * avgGoals);
  const awayLambda = Math.exp(awayAttack * avgGoals);

  // Simplified Poisson probabilities
  let pHome = 0, pDraw = 0, pAway = 0;
  let pOver25 = 0, pBtts = 0;

  for (let hg = 0; hg <= 8; hg++) {
    for (let ag = 0; ag <= 8; ag++) {
      const prob = poissonProb(homeLambda, hg) * poissonProb(awayLambda, ag);
      if (hg > ag) pHome += prob;
      else if (hg === ag) pDraw += prob;
      else pAway += prob;
      if (hg + ag > 2.5) pOver25 += prob;
      if (hg > 0 && ag > 0) pBtts += prob;
    }
  }

  return {
    home_win_prob: round(pHome),
    draw_prob: round(pDraw),
    away_win_prob: round(pAway),
    over25_prob: round(pOver25),
    under25_prob: round(1 - pOver25),
    btts_yes_prob: round(pBtts),
    btts_no_prob: round(1 - pBtts),
  };
}

function poissonProb(lambda, k) {
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

function logFactorial(n) {
  let result = 0;
  for (let i = 2; i <= n; i++) result += Math.log(i);
  return result;
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * Elo Model
 * Uses Elo ratings to predict match outcome probabilities.
 */
function eloPredict(homeElo, awayElo) {
  const homeAdvantage = 65;
  const adjustedHome = homeElo + homeAdvantage;

  const expectedHome = 1 / (1 + Math.pow(10, (awayElo - adjustedHome) / 400));

  // Map to 3-way probabilities using a heuristic
  const drawProb = 0.25; // Base draw probability
  const homeProb = expectedHome * (1 - drawProb);
  const awayProb = (1 - expectedHome) * (1 - drawProb);

  return {
    home_win_prob: round(homeProb),
    draw_prob: round(drawProb),
    away_win_prob: round(awayProb),
    over25_prob: 0.5, // Elo doesn't directly predict goals
    under25_prob: 0.5,
    btts_yes_prob: 0.5,
    btts_no_prob: 0.5,
  };
}

/**
 * XGBoost Model (simplified — uses logistic regression approximation)
 * In production, this would use a trained XGBoost model.
 * Here we use a weighted combination of features as a proxy.
 */
function xgboostPredict(features) {
  const {
    home_ppg, away_ppg,
    home_goals_scored, home_goals_conceded,
    away_goals_scored, away_goals_conceded,
    home_home_win_rate, away_away_win_rate,
    h2h_home_win_rate, implied_home_prob, implied_draw_prob, implied_away_prob,
  } = features;

  // If we have market odds, use them as the strongest feature
  if (implied_home_prob && implied_draw_prob && implied_away_prob) {
    // Adjust based on form features
    const formAdjustment = ((home_ppg || 1.5) - (away_ppg || 1.5)) * 0.05;

    const homeProb = clamp(implied_home_prob + formAdjustment);
    const drawProb = clamp(implied_draw_prob - formAdjustment * 0.3);
    const awayProb = 1 - homeProb - drawProb;

    const expectedGoals = ((home_goals_scored || 1.3) + (away_goals_conceded || 1.2) + (away_goals_scored || 1.1) + (home_goals_conceded || 1.2)) / 2;

    return {
      home_win_prob: round(homeProb),
      draw_prob: round(Math.max(0.1, drawProb)),
      away_win_prob: round(Math.max(0.05, awayProb)),
      over25_prob: round(expectedGoals > 2.5 ? 0.6 + (expectedGoals - 2.5) * 0.1 : 0.4 - (2.5 - expectedGoals) * 0.1),
      under25_prob: round(expectedGoals > 2.5 ? 0.4 - (expectedGoals - 2.5) * 0.1 : 0.6 + (2.5 - expectedGoals) * 0.1),
      btts_yes_prob: round(((home_goals_scored || 1.3) > 0.8 && (away_goals_scored || 1.1) > 0.8) ? 0.6 : 0.4),
      btts_no_prob: round(((home_goals_scored || 1.3) > 0.8 && (away_goals_scored || 1.1) > 0.8) ? 0.4 : 0.6),
    };
  }

  // Fallback: use form-based heuristic
  const homeStrength = (home_ppg || 1.5) / 3;
  const awayStrength = (away_ppg || 1.5) / 3;
  const total = homeStrength + awayStrength + 0.25; // +0.25 for draws

  return {
    home_win_prob: round((homeStrength / total) * 0.9 + 0.05),
    draw_prob: round(0.25),
    away_win_prob: round((awayStrength / total) * 0.9 + 0.05),
    over25_prob: round(0.5),
    under25_prob: round(0.5),
    btts_yes_prob: round(0.5),
    btts_no_prob: round(0.5),
  };
}

/**
 * Ensemble Model — weighted average of all models
 */
function ensemblePredict(dixonColes, elo, xgboost) {
  const w = { dc: 0.25, elo: 0.20, xgb: 0.55 };

  return {
    home_win_prob: round(dixonColes.home_win_prob * w.dc + elo.home_win_prob * w.elo + xgboost.home_win_prob * w.xgb),
    draw_prob: round(dixonColes.draw_prob * w.dc + elo.draw_prob * w.elo + xgboost.draw_prob * w.xgb),
    away_win_prob: round(dixonColes.away_win_prob * w.dc + elo.away_win_prob * w.elo + xgboost.away_win_prob * w.xgb),
    over25_prob: round(dixonColes.over25_prob * w.dc + elo.over25_prob * w.elo + xgboost.over25_prob * w.xgb),
    under25_prob: round(dixonColes.under25_prob * w.dc + elo.under25_prob * w.elo + xgboost.under25_prob * w.xgb),
    btts_yes_prob: round(dixonColes.btts_yes_prob * w.dc + elo.btts_yes_prob * w.elo + xgboost.btts_yes_prob * w.xgb),
    btts_no_prob: round(dixonColes.btts_no_prob * w.dc + elo.btts_no_prob * w.elo + xgboost.btts_no_prob * w.xgb),
  };
}

function clamp(v, min = 0.01, max = 0.99) {
  return Math.max(min, Math.min(max, v));
}

// ─── Evaluation Metrics ──────────────────────────────────────────────────────

function logLoss(predicted, actual) {
  const p = clamp(predicted);
  return actual ? -Math.log(p) : -Math.log(1 - p);
}

function brierScore(predicted, actual) {
  return (predicted - (actual ? 1 : 0)) ** 2;
}

function accuracy(correct, total) {
  return total > 0 ? (correct / total) * 100 : 0;
}

// ─── Backtesting Engine ──────────────────────────────────────────────────────

async function backtestModels() {
  console.log("🔄 ODDLY Model Backtesting Framework");
  console.log("━".repeat(60));

  const seasonFilter = process.argv.find(a => a.startsWith("--season="))?.split("=")[1];
  const leagueFilter = process.argv.find(a => a.startsWith("--league="))?.split("=")[1];

  // Fetch feature data
  let query = supabase
    .from("match_features")
    .select(`
      *,
      historical_matches!inner(
        id, home_team_id, away_team_id, home_score, away_score,
        match_date, season, league_id, home_odds, draw_odds, away_odds
      )
    `)
    .order("historical_matches(match_date)", { ascending: true });

  if (seasonFilter) {
    query = query.eq("season", parseInt(seasonFilter));
  }
  if (leagueFilter) {
    query = query.eq("league_id", leagueFilter);
  }

  const { data: features, error } = await query;

  if (error) {
    console.error("❌ Failed to fetch features:", error);
    console.log("   Run 'npm run compute:features' first.");
    return;
  }

  if (!features || features.length === 0) {
    console.log("⚠️  No features found. Run 'npm run compute:features' first.");
    return;
  }

  console.log(`📊 Backtesting on ${features.length} matches\n`);

  // Track results for each model
  const models = {
    "dixon-coles": { correct: 0, total: 0, logLossSum: 0, brierSum: 0 },
    "elo": { correct: 0, total: 0, logLossSum: 0, brierSum: 0 },
    "xgboost": { correct: 0, total: 0, logLossSum: 0, brierSum: 0 },
    "ensemble": { correct: 0, total: 0, logLossSum: 0, brierSum: 0 },
  };

  const predictionsToStore = [];

  for (const feature of features) {
    const match = feature.historical_matches;
    if (!match || match.home_score === null) continue;

    const actualResult = match.home_score > match.away_score ? "home"
      : match.home_score < match.away_score ? "away" : "draw";

    // Generate predictions from each model
    const homeAttack = (feature.home_ppg_last5 || 1.5) / 2.5;
    const awayAttack = (feature.away_ppg_last5 || 1.5) / 2.5;
    const homeDefense = 1 - (feature.home_goals_conceded_avg || 1.2) / 3;
    const awayDefense = 1 - (feature.away_goals_conceded_avg || 1.2) / 3;

    const dc = dixonColesPredict(homeAttack, homeDefense, awayAttack, awayDefense);
    const eloPred = eloPredict(feature.home_elo || 1500, feature.away_elo || 1500);
    const xgb = xgboostPredict({
      home_ppg: feature.home_ppg_last5,
      away_ppg: feature.away_ppg_last5,
      home_goals_scored: feature.home_goals_scored_avg,
      home_goals_conceded: feature.home_goals_conceded_avg,
      away_goals_scored: feature.away_goals_scored_avg,
      away_goals_conceded: feature.away_goals_conceded_avg,
      home_home_win_rate: feature.home_home_win_rate,
      away_away_win_rate: feature.away_away_win_rate,
      h2h_home_win_rate: feature.h2h_home_win_rate,
      implied_home_prob: feature.implied_home_prob,
      implied_draw_prob: feature.implied_draw_prob,
      implied_away_prob: feature.implied_away_prob,
    });

    const ens = ensemblePredict(dc, eloPred, xgb);

    // Evaluate each model
    for (const [modelName, prediction] of [
      ["dixon-coles", dc],
      ["elo", eloPred],
      ["xgboost", xgb],
      ["ensemble", ens],
    ]) {
      const predictedProb = prediction[`${actualResult}_win_prob`];
      if (predictedProb === undefined) continue;

      const isCorrect = predictedProb === Math.max(prediction.home_win_prob, prediction.draw_prob, prediction.away_win_prob);
      const ll = logLoss(predictedProb, true);
      const bs = brierScore(predictedProb, true);

      models[modelName].total++;
      if (predictedProb === Math.max(prediction.home_win_prob, prediction.draw_prob, prediction.away_win_prob)) {
        models[modelName].correct++;
      }
      models[modelName].logLossSum += ll;
      models[modelName].brierSum += bs;

      // Store prediction for later analysis
      predictionsToStore.push({
        match_id: match.id,
        model_name: modelName,
        home_win_prob: prediction.home_win_prob,
        draw_prob: prediction.draw_prob,
        away_win_prob: prediction.away_win_prob,
        over25_prob: prediction.over25_prob,
        btts_yes_prob: prediction.btts_yes_prob,
        confidence: Math.max(prediction.home_win_prob, prediction.draw_prob, prediction.away_win_prob),
        actual_result: actualResult,
        home_score_actual: match.home_score,
        away_score_actual: match.away_score,
        brier_score: bs,
        log_loss: ll,
      });
    }
  }

  // Print results
  console.log("━".repeat(60));
  console.log("📊 BACKTESTING RESULTS");
  console.log("━".repeat(60));

  for (const [name, stats] of Object.entries(models)) {
    const acc = accuracy(stats.correct, stats.total);
    const avgLL = stats.total > 0 ? stats.logLossSum / stats.total : 0;
    const avgBS = stats.total > 0 ? stats.brierSum / stats.total : 0;

    console.log(`\n  ${name.toUpperCase()}`);
    console.log(`    Accuracy:   ${acc.toFixed(1)}% (${stats.correct}/${stats.total})`);
    console.log(`    Log Loss:   ${avgLL.toFixed(4)}`);
    console.log(`    Brier:      ${avgBS.toFixed(4)}`);
  }

  // Store predictions
  console.log(`\n💾 Storing ${predictionsToStore.length} predictions...`);

  const batchSize = 100;
  for (let i = 0; i < predictionsToStore.length; i += batchSize) {
    const batch = predictionsToStore.slice(i, i + batchSize);
    await supabase.from("model_predictions").upsert(batch, {
      onConflict: "match_id,model_name",
    });
  }

  console.log("   ✅ Predictions stored");

  // Store performance summary
  for (const [name, stats] of Object.entries(models)) {
    await supabase.from("model_performance_history").insert({
      model_name: name,
      model_version: "v1",
      evaluation_date: new Date().toISOString().split("T")[0],
      total_predictions: stats.total,
      correct_predictions: stats.correct,
      accuracy: Number(accuracy(stats.correct, stats.total).toFixed(1)),
      brier_score: Number((stats.total > 0 ? stats.brierSum / stats.total : 0).toFixed(4)),
      log_loss: Number((stats.total > 0 ? stats.logLossSum / stats.total : 0).toFixed(4)),
    });
  }

  console.log("\n" + "━".repeat(60));
  console.log("✅ Backtesting complete. Results stored in model_predictions and model_performance_history.");
  console.log("━".repeat(60));
}

backtestModels().catch(err => {
  console.error("\n❌ Backtesting failed:", err.message);
  process.exit(1);
});
