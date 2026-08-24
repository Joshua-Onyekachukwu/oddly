/**
 * ODDLY Market Model: Double Chance (1X, X2, 12)
 *
 * Specialized model for Double Chance markets.
 * Derives from 1X2 predictions but adjusts for the combined nature.
 */

const { clamp } = require("./market-1x2");

/**
 * Predict Double Chance probabilities for a single match.
 *
 * @param {Object} model1x2 - Output from 1X2 model (home, draw, away)
 * @param {Object} features - Match features
 * @returns {Object} { dc1X, dcX2, dc12, confidence, reasoning }
 */
function predict(model1x2, features) {
  const { home, draw, away } = model1x2;

  // Double Chance = sum of constituent probabilities
  const dc1X = clamp(home + draw);  // Home or Draw
  const dcX2 = clamp(draw + away);  // Draw or Away
  const dc12 = clamp(home + away);  // Home or Away (no draw)

  // Find best double chance
  const best = dc1X > dcX2 && dc1X > dc12 ? "1X" :
               dcX2 > dc12 ? "X2" : "12";

  const confidence =
    Math.max(dc1X, dcX2, dc12) >= 0.75 ? "high" :
    Math.max(dc1X, dcX2, dc12) >= 0.65 ? "medium" : "low";

  const reasoning = [];
  if (best === "1X") {
    reasoning.push(`${features.homeName || "Home"} not to lose (${(dc1X * 100).toFixed(1)}%)`);
    if (home > 0.5) reasoning.push("Strong home advantage");
  } else if (best === "X2") {
    reasoning.push(`${features.awayName || "Away"} not to lose (${(dcX2 * 100).toFixed(1)}%)`);
  } else {
    reasoning.push(`Draw unlikely — expect a winner (${(dc12 * 100).toFixed(1)}%)`);
  }

  return { dc1X, dcX2, dc12, best, confidence, reasoning: reasoning.join(". ") };
}

module.exports = { predict, clamp };
