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
const marketFeature = require("./market-feature");
const crossSignals = require("./cross-model-signals");

/**
 * Walk-forward recalibration (2026-11).
 *
 * Post-hoc calibration fitted on the 27,314-match research dataset using the
 * strict walk-forward replay harness (scripts/eval-walk-forward-replay.js +
 * scripts/eval-dump-1x2-records.js + scripts/fit-1x2-recal.js). Parameters are
 * stored in model_weight_config.recalibration (JSONB, config production_v5)
 * with a file fallback at data/calibration/1x2-recal.json.
 *
 * Honest held-out-tail (last 20%, n=5,463) results vs uncalibrated baseline:
 *   1X2 argmax acc 47.3% vs 43.7% (always-Home base rate ≈ 43.5%)
 *   1X2 multiclass log-loss 1.817 vs 1.863
 *   BTTS log-loss 0.687 vs 0.807, Brier 0.247 vs 0.291
 * See data/calibration/1x2-recal.json for full metrics.
 *
 * Applied to FINAL probabilities (after cross-model refine + league adjust),
 * i.e. stage "fin" — matching how theta was fitted.
 */
let _fileRecal;
function loadRecalibration(storeData) {
  const db = storeData && storeData.weightConfig && storeData.weightConfig.recalibration;
  if (db && db.theta) return db;
  if (_fileRecal === undefined) {
    _fileRecal = null;
    try {
      const fs = require("fs");
      const path = require("path");
      const p = path.join(__dirname, "..", "..", "data", "calibration", "1x2-recal.json");
      if (fs.existsSync(p)) _fileRecal = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (_) { /* no file → no recalibration */ }
  }
  return _fileRecal;
}

function softmax3(arr) {
  const mx = Math.max(arr[0], arr[1], arr[2]);
  const e = [Math.exp(arr[0] - mx), Math.exp(arr[1] - mx), Math.exp(arr[2] - mx)];
  const t = e[0] + e[1] + e[2];
  return [e[0] / t, e[1] / t, e[2] / t];
}

/**
 * Find a per-league override entry for a league display name (or raw code).
 * league_overrides is keyed by football-data code ("E0"...) with each entry
 * carrying `leagueName`; match on either, case-insensitive.
 */
function findLeagueOverride(recal, leagueName) {
  const ov = recal && recal.league_overrides;
  if (!ov || !leagueName) return null;
  const target = String(leagueName).toLowerCase();
  for (const [code, e] of Object.entries(ov)) {
    if (!e || typeof e !== "object") continue;
    // Honest gate: overrides the fitter marked enabled===false (held-out
    // tail got worse) are stored for provenance but never applied.
    if (e.enabled === false) continue;
    const nm = String(e.leagueName || code).toLowerCase();
    if (nm === target || String(code).toLowerCase() === target) return e;
  }
  return null;
}

/**
 * Apply a fitted per-league residual bias vector on top of already
 * globally-calibrated 1X2 probs, with honest shrinkage:
 *   strength = n / (n + shrinkK)   (shrinkK defaults to 200)
 *   q'_k ∝ q_k * exp(strength * bias_k),  bias = [bH, bD], biasAway = 0.
 * Small leagues are pulled toward the global calibration; large leagues
 * approach their fitted bias. Mutates o = {home, draw, away} in place.
 */
function applyLeagueBias(o, override) {
  if (!override || !Array.isArray(override.bias) || override.bias.length < 2) return;
  const n = typeof override.n === "number" ? override.n : 0;
  const k = typeof override.shrinkK === "number" ? override.shrinkK : 200;
  const strength = n / (n + k);
  if (!(strength > 0)) return;
  const p = [o.home, o.draw, o.away];
  const s = softmax3([
    Math.log(Math.max(p[0], 1e-6)) + strength * override.bias[0],
    Math.log(Math.max(p[1], 1e-6)) + strength * override.bias[1],
    Math.log(Math.max(p[2], 1e-6)),
  ]);
  o.home = s[0];
  o.draw = s[1];
  o.away = s[2];
}

function applyRecalibration(refined, recal, leagueName) {
  if (!recal) return;
  // 1X2: q_k ∝ p_k^alpha * exp(b_k), k = Home/Draw/Away; biasAway fixed 0.
  if (Array.isArray(recal.theta) && recal.theta.length >= 3) {
    const [alpha, bH, bD] = recal.theta;
    const o = refined.oneXtwo;
    const p = [o.home, o.draw, o.away];
    const s = [
      alpha * Math.log(Math.max(p[0], 1e-6)) + bH,
      alpha * Math.log(Math.max(p[1], 1e-6)) + bD,
      alpha * Math.log(Math.max(p[2], 1e-6)),
    ];
    const q = softmax3(s);
    o.home = q[0];
    o.draw = q[1];
    o.away = q[2];
  }
  // Per-league residual bias override (optional; only when league_name is known).
  if (refined.oneXtwo) {
    const override = findLeagueOverride(recal, leagueName);
    if (override) applyLeagueBias(refined.oneXtwo, override);
  }
  // BTTS: Platt scaling q = sigmoid(a*logit(p)+b)
  const bp = recal.btts;
  if (bp && typeof bp.a === "number" && typeof bp.b === "number" && refined.btts) {
    const p = Math.min(Math.max(refined.btts.bttsYes, 1e-6), 1 - 1e-6);
    const logit = Math.log(p / (1 - p));
    const q = 1 / (1 + Math.exp(-(bp.a * logit + bp.b)));
    refined.btts.bttsYes = q;
    refined.btts.bttsNo = 1 - q;
  }
}

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

  // ═══ MARKET-IMPLIED ODDS BLEND (opening odds only) ═══
  // features.marketImplied* are produced by worker/models/market-feature.js
  // which guarantees only snapshots strictly before kickoff are used —
  // closing/post-kickoff odds can never leak in (see that file's guards).
  // Blend weight is conservative & configurable; see DEFAULT_MARKET_ODDS_WEIGHT.
  const market1x2 = marketFeature.fromFeatures(features);
  let marketOddsApplied = null;
  if (market1x2) {
    const mw =
      (weightConfig && typeof weightConfig.market_odds_weight === "number"
        ? weightConfig.market_odds_weight
        : marketFeature.DEFAULT_MARKET_ODDS_WEIGHT);
    const blended = marketFeature.blend1x2(result1x2, market1x2, mw);
    marketOddsApplied = {
      weight: mw,
      implied: market1x2,
      blended: { home: blended.home, draw: blended.draw, away: blended.away },
    };
    result1x2.home = blended.home;
    result1x2.draw = blended.draw;
    result1x2.away = blended.away;
  }

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

  // ═══ WALK-FORWARD RECALIBRATION (post-hoc, fitted on research set) ═══
  // Applied to final probabilities — see loadRecalibration() for provenance.
  // leagueParams.league_name selects an optional per-league bias override.
  applyRecalibration(
    refined,
    loadRecalibration(storeData),
    leagueParams && leagueParams.league_name
  );

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
      marketOdds: marketOddsApplied,
    },

    // Cross-model signals
    signals,

    // Metadata
    modelVersion: "v2.0-meta-ensemble",
    marketsCount: Object.keys(allMarkets).length,
    confidence: bestProb >= 0.65 ? "high" : bestProb >= 0.50 ? "medium" : "low",
  };
}

module.exports = { predictMatch, model1x2, modelGoals, modelBtts, modelDc, marketFeature, crossSignals, applyRecalibration, applyLeagueBias, findLeagueOverride };
