/**
 * ODDLY Meta-Ensemble v2.0
 *
 * Orchestrates all market-specific models:
 * 1. 1X2 Model → Home/Draw/Away probabilities
 * 2. Goals Model → Over/Under probabilities for all lines
 * 3. BTTS Model → Both Teams To Score probabilities
 * 4. DC Model → Double Chance probabilities
 *
 * Models communicate through cross-model signals:
 * - Goals model shares scoring expectations with 1X2
 * - 1X2 model shares favorite strength with Goals
 * - BTTS model shares scoring likelihood with Goals
 * - DC model shares draw expectations with 1X2
 *
 * Reads all feature data from Supabase (no local JSON).
 */

const model1x2 = require("./market-1x2");
const modelGoals = require("./market-goals");
const modelBtts = require("./market-btts");
const modelDc = require("./market-dc");
const modelDraw = require("./market-draw");
const crossSignals = require("./cross-model-signals");

/**
 * Run all models for a single match and return comprehensive predictions.
 *
 * @param {Object} features - Pre-computed match features (from tracker + feature store)
 * @param {Object} storeData - Feature store data (team profiles, referee, league params, weights)
 * @returns {Object} Complete prediction with all markets + metadata
 */
function predictMatch(features, storeData = {}) {
  const { teamProfiles, refereeProfile, leagueParams, weightConfig } = storeData;

  // ═══ ROUND 1: Each model predicts independently ═══

  // 1X2 Model
  const result1x2 = model1x2.predict(features, weightConfig);

  // Draw Model (dedicated draw prediction)
  const drawResult = modelDraw.predict(features);
  // Replace the crude 1X2 draw with the refined draw model output
  const adjusted = modelDraw.adjustProbs(
    result1x2.home, result1x2.draw, result1x2.away, drawResult.drawProb
  );
  result1x2.home = adjusted.home;
  result1x2.draw = adjusted.draw;
  result1x2.away = adjusted.away;

  // Goals Model
  const resultGoals = modelGoals.predict(features);

  // BTTS Model (uses Goals model grid)
  const resultBtts = modelBtts.predict(features, resultGoals);

  // DC Model (uses 1X2 model output)
  const resultDc = modelDc.predict(result1x2, features);

  // ═══ CROSS-MODEL SIGNALS ═══

  const initialOutputs = {
    oneXtwo: result1x2,
    goals: resultGoals,
    btts: resultBtts,
    dc: resultDc,
  };

  const signals = crossSignals.computeSignals(initialOutputs);

  // ═══ ROUND 2: Refine with cross-model signals ═══

  const refined = crossSignals.refinePredictions(initialOutputs, signals);

  // ═══ LEAGUE-SPECIFIC ADJUSTMENTS ═══

  if (leagueParams) {
    // Apply league-specific ensemble weights
    const lw = leagueParams;
    if (lw.home_advantage && features.eloDiff !== undefined) {
      // League has different home advantage than default (65)
      const haAdjust = (lw.home_advantage - 65) / 65 * 0.02;
      refined.oneXtwo.home = Math.min(0.95, refined.oneXtwo.home + haAdjust);
      refined.oneXtwo.away = Math.max(0.05, refined.oneXtwo.away - haAdjust);
    }
    if (lw.goal_expectancy) {
      // League has different goal expectancy
      const goalRatio = lw.goal_expectancy / (resultGoals.expectedGoals || 2.6);
      if (Math.abs(goalRatio - 1) > 0.05) {
        refined.goals.over25 = Math.min(0.95, refined.goals.over25 * Math.sqrt(goalRatio));
        refined.goals.under25 = 1 - refined.goals.over25;
      }
    }
  }

  // ═══ ASSEMBLE FINAL OUTPUT ═══

  const allMarkets = {
    // 1X2
    "1X2_Home": refined.oneXtwo.home,
    "1X2_Draw": refined.oneXtwo.draw,
    "1X2_Away": refined.oneXtwo.away,
    // Double Chance
    "DC_1X": refined.dc.dc1X,
    "DC_X2": refined.dc.dcX2,
    "DC_12": refined.dc.dc12,
    // Over/Under
    "OU_Over_0.5": refined.goals.over05,
    "OU_Under_0.5": refined.goals.under05,
    "OU_Over_1.5": refined.goals.over15,
    "OU_Under_1.5": refined.goals.under15,
    "OU_Over_2.5": refined.goals.over25,
    "OU_Under_2.5": refined.goals.under25,
    "OU_Over_3.5": refined.goals.over35,
    "OU_Under_3.5": refined.goals.under35,
    "OU_Over_4.5": refined.goals.over45,
    "OU_Under_4.5": refined.goals.under45,
    // BTTS
    "BTTS_Yes": refined.btts.bttsYes,
    "BTTS_No": refined.btts.bttsNo,
    // DNB (Draw No Bet)
    "DNB_Home": refined.oneXtwo.home / (refined.oneXtwo.home + refined.oneXtwo.away),
    "DNB_Away": refined.oneXtwo.away / (refined.oneXtwo.home + refined.oneXtwo.away),
    // Team Goals (from Poisson grid)
    "HomeGoals_Over_0.5": resultGoals.grid ? 1 - resultGoals.grid[0].reduce((s, v) => s + v, 0) : 0.6,
    "HomeGoals_Over_1.5": resultGoals.grid ? 1 - resultGoals.grid[0].reduce((s, v, j) => j <= 1 ? s + v : s, 0) : 0.35,
    "AwayGoals_Over_0.5": resultGoals.grid ? 1 - resultGoals.grid.reduce((s, row, i) => s + row[0], 0) : 0.55,
    "AwayGoals_Over_1.5": resultGoals.grid ? 1 - resultGoals.grid.reduce((s, row, i) => s + (i <= 1 ? row[0] : 0), 0) : 0.3,
  };

  // Best pick across all markets
  let bestMarket = null;
  let bestProb = 0;
  for (const [mk, prob] of Object.entries(allMarkets)) {
    if (prob > bestProb && prob < 0.99) {
      bestProb = prob;
      bestMarket = mk;
    }
  }

  const tier =
    bestProb >= 0.70 ? "ELITE" :
    bestProb >= 0.60 ? "HIGH" :
    bestProb >= 0.50 ? "MEDIUM" : "LOW";

  return {
    markets: allMarkets,
    bestPick: { market: bestMarket, probability: bestProb, tier },

    // Model details
    models: {
      oneXtwo: result1x2,
      draw: {
        drawProb: drawResult.drawProb,
        confidence: drawResult.confidence,
        signals: drawResult.signals,
      },
      goals: {
        homeLambda: resultGoals.homeLambda,
        awayLambda: resultGoals.awayLambda,
        expectedGoals: resultGoals.expectedGoals,
        over25: resultGoals.over25,
      },
      btts: { bttsYes: resultBtts.bttsYes },
      dc: { dc1X: resultDc.dc1X, dcX2: resultDc.dcX2, dc12: resultDc.dc12 },
    },

    // Cross-model signals
    signals,

    // Metadata
    modelVersion: "v2.0-meta-ensemble",
    marketsCount: Object.keys(allMarkets).length,
    confidence: bestProb >= 0.65 ? "high" : bestProb >= 0.50 ? "medium" : "low",
  };
}

module.exports = { predictMatch, model1x2, modelGoals, modelBtts, modelDc, crossSignals };
