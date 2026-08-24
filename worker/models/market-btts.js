/**
 * ODDLY Market Model: BTTS (Both Teams To Score)
 *
 * Specialized model for predicting whether both teams will score.
 * Uses Poisson grid + attack/defense ratings + xG data.
 */

const { scoreGrid, clamp } = require("./market-goals");

/**
 * Predict BTTS probabilities for a single match.
 *
 * @param {Object} features - Computed match features
 * @param {Object} goalsModel - Output from goals model (provides lambdas + grid)
 * @param {Object} crossSignals - Signals from other models
 * @returns {Object} { bttsYes, bttsNo, confidence, reasoning }
 */
function predict(features, goalsModel, crossSignals = {}) {
  const grid = goalsModel.grid;
  if (!grid) {
    // Fallback: estimate from attack/defense ratings
    const homeAttack = (features.homeGF || 1.4) / 1.3;
    const awayAttack = (features.awayGF || 1.1) / 1.3;
    const homeDefense = (features.homeGA || 1.1) / 1.3;
    const awayDefense = (features.awayGA || 1.2) / 1.3;
    const bttsYes = clamp(
      1 - (1 - homeAttack * awayDefense) * (1 - awayAttack * homeDefense),
      0.15, 0.85
    );
    return {
      bttsYes, bttsNo: clamp(1 - bttsYes),
      confidence: "low",
      reasoning: "Estimated from attack/defense ratings (no grid available)",
    };
  }

  // P(both score) = 1 - P(home 0) - P(away 0) + P(both 0)
  let pHomeZero = 0, pAwayZero = 0, pBothZero = 0;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (i === 0 && j === 0) pBothZero = grid[i][j];
      if (i === 0) pAwayZero += grid[i][j];
      if (j === 0) pHomeZero += grid[i][j];
    }
  }
  const bttsYes = clamp(1 - pHomeZero - pAwayZero + pBothZero);

  // Cross-model signal: if goals model expects very high scoring, BTTS more likely
  let adjustedBtts = bttsYes;
  if (goalsModel.expectedGoals > 3.0) {
    adjustedBtts = clamp(bttsYes * 1.05);
  } else if (goalsModel.expectedGoals < 1.8) {
    adjustedBtts = clamp(bttsYes * 0.95);
  }

  // xG-specific adjustments
  if (features.homeXG && features.awayXG) {
    // Both teams have decent xG → more likely BTTS
    if (features.homeXG > 1.0 && features.awayXG > 1.0) {
      adjustedBtts = clamp(adjustedBtts * 1.03);
    }
    // One team has very low xG → less likely BTTS
    if (features.homeXG < 0.7 || features.awayXG < 0.7) {
      adjustedBtts = clamp(adjustedBtts * 0.97);
    }
  }

  const confidence = adjustedBtts > 0.70 || adjustedBtts < 0.30 ? "high" : "medium";
  const reasoning = [];
  if (adjustedBtts > 0.60) {
    reasoning.push(`Both teams likely to score (${(adjustedBtts * 100).toFixed(1)}%)`);
    if (features.homeGF > 1.3) reasoning.push(`${features.homeName || "Home"} scores regularly`);
    if (features.awayGF > 1.0) reasoning.push(`${features.awayName || "Away"} has scoring threat`);
  } else {
    reasoning.push(`BTTS unlikely (${(adjustedBtts * 100).toFixed(1)}%)`);
    if (features.cleanSheet > 0.3) reasoning.push("Strong defensive record");
  }

  return {
    bttsYes: adjustedBtts,
    bttsNo: clamp(1 - adjustedBtts),
    confidence,
    reasoning: reasoning.join(". "),
  };
}

module.exports = { predict, clamp };
