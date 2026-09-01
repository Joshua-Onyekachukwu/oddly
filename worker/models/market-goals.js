/**
 * ODDLY Market Model: Goals (Over/Under)
 *
 * Specialized model for predicting goal totals.
 * Uses Poisson distribution with xG-enhanced lambdas.
 * Best features: xG, attack ratings, defensive ratings, pressing intensity.
 */

function clamp(v, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}

function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

/**
 * Compute Poisson score grid for given lambdas.
 */
function scoreGrid(homeLambda, awayLambda, maxGoals = 8) {
  const grid = [];
  for (let i = 0; i <= maxGoals; i++) {
    grid[i] = [];
    for (let j = 0; j <= maxGoals; j++) {
      grid[i][j] = poissonProb(homeLambda, i) * poissonProb(awayLambda, j);
    }
  }
  return grid;
}

/**
 * Compute total goals distribution from score grid.
 */
function totalGoalsDist(grid) {
  const maxT = (grid.length - 1) * 2;
  const dist = new Array(maxT + 1).fill(0);
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      dist[i + j] += grid[i][j];
    }
  }
  return dist;
}

/**
 * Compute lambdas for this match, preferring xG data when available.
 */
function computeLambdas(features) {
  const homeAttack = features.homeGF || 1.4;
  const homeDefense = features.homeGA || 1.1;
  const awayAttack = features.awayGF || 1.1;
  const awayDefense = features.awayGA || 1.2;
  const leagueAvgGoals = features.leagueAvgGoals || 2.6;
  const leagueAvgPerTeam = leagueAvgGoals / 2;

  // APPROACH: Log-ratio amplification for realistic lambda spread
  // Team features are noisy but the RATIO to league avg is informative
  // We amplify these ratios to create meaningful differentiation
  
  // Attack strength: how much better/worse than average
  const homeAttackStr = Math.log(homeAttack / leagueAvgPerTeam); // positive = good attack
  const awayAttackStr = Math.log(awayAttack / leagueAvgPerTeam);
  // Defensive weakness: how much worse/better than average defense
  const awayDefWeak = Math.log(awayDefense / leagueAvgPerTeam); // positive = weak defense
  const homeDefWeak = Math.log(homeDefense / leagueAvgPerTeam);

  // Lambda = league_avg * exp(amplified_strength)
  // Amplification factor of 1.5 creates realistic spread
  const AMP = 1.5;
  let homeLambda = leagueAvgPerTeam * Math.exp((homeAttackStr + awayDefWeak) * AMP);
  let awayLambda = leagueAvgPerTeam * Math.exp((awayAttackStr + homeDefWeak) * AMP);

  // Clamp to realistic range
  homeLambda = clamp(homeLambda, 0.5, 4.5);
  awayLambda = clamp(awayLambda, 0.3, 3.5);

  // xG-enhanced lambdas (much more accurate)
  if (features.homeXG && features.awayXG) {
    const hXGHome = features.homeXGHome || features.homeXG;
    const aXGAway = features.awayXGAway || features.awayXG;
    const hXGDefHome = features.homeXGA || features.homeXG;
    const aXGDefAway = features.awayXGA || features.awayXG;

    // Home: attack (home xG) vs defense (away xGA)
    homeLambda = clamp(
      (hXGHome * 0.55 + homeLambda * 0.3 + aXGDefAway * 0.15) * 1.05,
      0.3, 4.5
    );
    // Away: attack (away xG) vs defense (home xGA)
    awayLambda = clamp(
      (aXGAway * 0.55 + awayLambda * 0.3 + hXGDefHome * 0.15) * 0.95,
      0.3, 4.5
    );

    // Recent form xG adjustment
    if (features.homeXGLast5 && features.homeXGLast5 > 0) {
      homeLambda *= clamp(features.homeXGLast5 / Math.max(features.homeXG, 0.1), 0.85, 1.15);
    }
    if (features.awayXGLast5 && features.awayXGLast5 > 0) {
      awayLambda *= clamp(features.awayXGLast5 / Math.max(features.awayXG, 0.1), 0.85, 1.15);
    }

    // Pressing intensity
    if (features.homePPDA && features.awayPPDA && features.homePPDA > 0 && features.awayPPDA > 0) {
      const pressingEdge = (1 / features.homePPDA - 1 / features.awayPPDA) * 5;
      homeLambda *= clamp(1 + pressingEdge * 0.3, 0.9, 1.1);
      awayLambda *= clamp(1 - pressingEdge * 0.3, 0.9, 1.1);
    }
  } else {
    // No xG data — use Elo-adjusted estimates
    const eloDiff = features.eloDiff || 0;
    homeLambda = clamp(homeLambda * (1 + eloDiff * 0.0003), 0.3, 4.5);
    awayLambda = clamp(awayLambda * (1 - eloDiff * 0.0003), 0.3, 4.5);
  }

  return { homeLambda, awayLambda };
}

/**
 * Predict Over/Under probabilities for a single match.
 *
 * @param {Object} features - Computed match features
 * @param {Object} crossSignals - Signals from other models (1X2, BTTS)
 * @returns {Object} { over25, under25, expectedGoals, grid, reasoning }
 */
function predict(features, crossSignals = {}) {
  const { homeLambda, awayLambda } = computeLambdas(features);
  const grid = scoreGrid(homeLambda, awayLambda);
  const totalDist = totalGoalsDist(grid);
  const expectedGoals = homeLambda + awayLambda;

  // Over/Under lines
  const over05 = 1 - (totalDist[0] || 0);
  const over15 = 1 - (totalDist[0] + totalDist[1] || 0);
  const over25 = 1 - (totalDist[0] + totalDist[1] + totalDist[2] || 0);
  const over35 = 1 - (totalDist.slice(0, 4).reduce((s, v) => s + v, 0));
  const over45 = 1 - (totalDist.slice(0, 5).reduce((s, v) => s + v, 0));

  // Cross-model adjustment: nuanced based on match type
  if (crossSignals.homeWinProb > 0.70) {
    // Very strong favorite → slight reduction (controlled game)
    const adj = 0.97;
    over25 = clamp(over25 * adj);
  } else if (crossSignals.homeWinProb > 0.55 && crossSignals.balanced) {
    // Moderate favorite + both teams score → slightly MORE goals
    const adj = 1.03;
    over25 = clamp(over25 * adj);
  }  return {
    over05: clamp(over05), over15: clamp(over15),
    over25: clamp(over25), over35: clamp(over35),
    over45: clamp(over45), under05: clamp(1 - over05), under15: clamp(1 - over15),
    under25: clamp(1 - over25), under35: clamp(1 - over35),
    under45: clamp(1 - over45),
    homeLambda, awayLambda, expectedGoals, grid,
    confidence: over25 > 0.65 || over25 < 0.35 ? "high" : "medium",
    reasoning: `Expected ${(expectedGoals).toFixed(2)} goals (${homeLambda.toFixed(2)} home, ${awayLambda.toFixed(2)} away)`,
  };
}

module.exports = { predict, computeLambdas, scoreGrid, totalGoalsDist, poissonProb, clamp };
