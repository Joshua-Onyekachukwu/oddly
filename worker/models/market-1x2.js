/**
 * ODDLY Market Model: 1X2 (Match Result)
 *
 * Specialized model for predicting Home Win / Draw / Away Win.
 * Uses features that matter most for match outcome prediction:
 * - Elo rating difference (strongest predictor)
 * - Home/away form splits
 * - Head-to-head record
 * - Defensive solidity (clean sheets)
 * - Momentum (win streaks)
 * - Referee home bias
 * - Injury impact differential
 */

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Load 1X2-specific weights from the feature store or use defaults
 */
function getWeights(weightConfig) {
  if (weightConfig) {
    return {
      intercept: weightConfig.intercept || -0.5887,
      eloDiff: weightConfig.elo_diff_weight || 0.0037,
      homePPG: weightConfig.home_ppg_weight || 0.0025,
      awayPPG: weightConfig.away_ppg_weight || -0.1225,
      homeGF: weightConfig.home_gf_weight || 0.0938,
      homeGA: weightConfig.home_ga_weight || -0.1713,
      awayGF: weightConfig.away_gf_weight || 0.0738,
      awayGA: weightConfig.away_ga_weight || -0.1738,
      cleanSheet: weightConfig.clean_sheet_weight || 0.4813,
      homeWinRate: weightConfig.home_win_rate_weight || 0.0225,
      awayWinRate: weightConfig.away_win_rate_weight || -0.1225,
      streak: weightConfig.streak_weight || 0.1338,
      fatigue: weightConfig.fatigue_weight || 0.02,
      h2h: weightConfig.h2h_weight || 0.1738,
    };
  }
  return {
    intercept: -0.5887,
    eloDiff: 0.0037,
    homePPG: 0.0025,
    awayPPG: -0.1225,
    homeGF: 0.0938,
    homeGA: -0.1713,
    awayGF: 0.0738,
    awayGA: -0.1738,
    cleanSheet: 0.4813,
    homeWinRate: 0.0225,
    awayWinRate: -0.1225,
    streak: 0.1338,
    fatigue: 0.02,
    h2h: 0.1738,
  };
}

/**
 * Predict 1X2 probabilities for a single match.
 *
 * @param {Object} features - Computed match features
 * @param {Object} weightConfig - Weight configuration from feature store
 * @param {Object} crossSignals - Signals from other models (goals, BTTS, DC)
 * @returns {Object} { home, draw, away, confidence, reasoning }
 */
function predict(features, weightConfig, crossSignals = {}) {
  const w = getWeights(weightConfig);

  // Core logistic regression
  let z = w.intercept;
  z += features.eloDiff * w.eloDiff;
  z += features.homePPG * w.homePPG;
  z += features.awayPPG * w.awayPPG;
  z += features.homeGF * w.homeGF;
  z += features.homeGA * w.homeGA;
  z += features.awayGF * w.awayGF;
  z += features.awayGA * w.awayGA;
  z += features.cleanSheet * w.cleanSheet;
  z += features.homeWinRate * w.homeWinRate;
  z += features.awayWinRate * w.awayWinRate;
  z += features.streak * w.streak;
  z += features.fatigue * w.fatigue;
  z += features.h2h * w.h2h;

  // Referee features (if available)
  if (features.refereeHomeBias) {
    z += features.refereeHomeBias * 0.15;
  }
  if (features.refereeYellowPerMatch) {
    z += (features.refereeYellowPerMatch - 3.5) * -0.02 * 0.3;
  }
  if (features.homeTeamRefWinRate && features.homeTeamRefMatches >= 3) {
    z += (features.homeTeamRefWinRate - 0.46) * 0.08;
  }
  if (features.awayTeamRefWinRate && features.awayTeamRefMatches >= 3) {
    z += (0.30 - features.awayTeamRefWinRate) * 0.08;
  }

  // Injury differential
  if (features.homeInjuryImpact || features.awayInjuryImpact) {
    z += (features.homeInjuryImpact || 0) + (features.awayInjuryImpact || 0) * -1;
  }

  // Cross-model signals from Goals model
  if (crossSignals.highScoring) {
    // If goals model predicts high-scoring, reduce draw probability
    z += 0.05;
  }
  if (crossSignals.balancedAttacks) {
    // Both teams likely to score → less likely to be a blowout
    z *= 0.95;
  }

  const homeProb = sigmoid(z);

  // Draw probability from Elo-derived estimate
  const eloH = features.eloHome || 1500;
  const eloA = features.eloAway || 1000;
  const drawBase = 0.25 + (features.eloDiff === 0 ? 0.05 : -Math.abs(features.eloDiff) * 0.00005);
  const drawProb = clamp(drawBase);

  // Away from residual
  let awayProb = clamp(1 - homeProb - drawProb);

  // Normalize
  const total = homeProb + drawProb + awayProb;
  const home = clamp(homeProb / total);
  const draw = clamp(drawProb / total);
  const away = clamp(awayProb / total);

  // Confidence
  const maxProb = Math.max(home, draw, away);
  const confidence =
    maxProb >= 0.65 ? "high" :
    maxProb >= 0.50 ? "medium" : "low";

  // Reasoning
  const reasoning = [];
  if (home > away) {
    reasoning.push(`${features.homeName || "Home"} favored at ${(home * 100).toFixed(1)}%`);
    if (features.eloDiff > 100) reasoning.push(`Strong Elo advantage (+${features.eloDiff})`);
    if (features.cleanSheet > 0.3) reasoning.push("Strong defensive record");
  } else if (away > home) {
    reasoning.push(`${features.awayName || "Away"} favored at ${(away * 100).toFixed(1)}%`);
  } else {
    reasoning.push("Evenly matched — draw possible");
  }

  return {
    home,
    draw,
    away,
    confidence,
    bestPick: home > draw && home > away ? "Home" : away > draw ? "Away" : "Draw",
    bestProb: Math.max(home, draw, away),
    reasoning: reasoning.join(". "),
  };
}

module.exports = { predict, getWeights, sigmoid, clamp };
