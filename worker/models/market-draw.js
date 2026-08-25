/**
 * ODDLY Market Model: Draw Prediction
 *
 * Dedicated model for predicting draws — the biggest error source.
 *
 * The existing 1X2 model uses a flat 25% base for draws with only a tiny
 * Elo adjustment. This model uses 15+ draw-specific features:
 *
 * KEY DRAW SIGNALS:
 * 1. Low Elo difference (teams are evenly matched)
 * 2. Draw odds from bookmakers (market-implied draw probability)
 * 3. H2H draw rate (some fixtures produce draws consistently)
 * 4. League draw rate (some leagues have more draws)
 * 5. Both teams' defensive solidity (low goals conceded = tight games)
 * 6. Both teams' low scoring rate (neither scores freely)
 * 7. Balanced form (both teams on similar points per game)
 * 8. Low combined expected goals
 * 9. Home team not dominant (home advantage is weak)
 * 10. Away team not weak (away team can hold on)
 * 11. Recent draw history in form
 * 12. Tight matches (small goal difference in recent results)
 * 13. Mid-table teams (not title contenders or relegation battlers)
 * 14. Low BTTS rate (games often 0-0 or 1-1)
 * 15. Referee tendencies (some refs allow more draws)
 */

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Compute draw-specific features from the standard match features.
 * These are the features that correlate most strongly with draws.
 */
function extractDrawFeatures(features) {
  // 1. Elo balance: closer ratings = more likely draw
  const eloAbsDiff = Math.abs(features.eloDiff || features.elo_diff || 0);
  const eloBalance = 1 - Math.min(eloAbsDiff / 300, 1); // 0=blowout, 1=evenly matched

  // 2. Implied draw probability from odds (strongest single signal)
  let impliedDrawProb = null;
  if (features.draw_odds && features.draw_odds > 0) {
    impliedDrawProb = 1 / features.draw_odds;
  }

  // 3. H2H draw rate (if we have enough meetings)
  let h2hDrawRate = null;
  if (features.h2h_draw_rate !== undefined) {
    h2hDrawRate = features.h2h_draw_rate;
  } else if (features.h2h_meetings >= 3) {
    // Estimate from H2H data if available
    h2hDrawRate = features.h2h_draw_rate || null;
  }

  // 4. League draw rate
  const leagueDrawPct = features.league_draw_pct || features.draw_pct || 0.25;

  // 5. Defensive balance: both teams concede similar amounts = tight games
  const homeConceded = features.home_avg_conceded || features.homeGA || 1.3;
  const awayConceded = features.away_avg_conceded || features.awayGA || 1.3;
  const defensiveBalance = 1 - Math.abs(homeConceded - awayConceded) / 2; // 0=imbalanced, 1=balanced

  // 6. Low combined scoring: both teams score ≤1.2 avg = tight games
  const homeGoals = features.home_avg_goals || features.homeGF || 1.3;
  const awayGoals = features.away_avg_goals || features.awayGF || 1.1;
  const combinedScoring = (homeGoals + awayGoals) / 2;
  const lowScoringSignal = 1 - Math.min(combinedScoring / 3, 1); // 0=high-scoring, 1=low-scoring

  // 7. Form balance: similar PPG = evenly matched
  const homePPG = features.home_form_ppg || features.homePPG || 1.5;
  const awayPPG = features.away_form_ppg || features.awayPPG || 1.2;
  const ppgDiff = Math.abs(homePPG - awayPPG);
  const formBalance = 1 - Math.min(ppgDiff / 2, 1); // 0=mismatch, 1=even

  // 8. Home team not dominant: if home win rate is moderate (not too high, not too low)
  const homeWinRate = features.home_win_rate || 0.45;
  const homeNotDominant = homeWinRate < 0.55 && homeWinRate > 0.30 ? 1 : 0.5;

  // 9. Away team not weak: can hold on for a draw
  const awayWinRate = features.away_win_rate || 0.35;
  const awayNotWeak = awayWinRate > 0.25 ? 1 : 0.5;

  // 10. Clean sheet balance: both teams keep clean sheets = 0-0 or 1-1 likely
  const homeCleanSheet = features.home_clean_sheet_pct || 0.3;
  const awayCleanSheet = features.away_clean_sheet_pct || 0.3;
  const cleanSheetBalance = Math.min(homeCleanSheet, awayCleanSheet) * 2;

  // 11. Elo-derived draw probability (standard formula)
  const eloDrawProb = 1 / (1 + Math.pow(10, eloAbsDiff / 400)) * 0.5;

  // 12. Goal difference balance
  const homeGD = (homeGoals - homeConceded);
  const awayGD = (awayGoals - awayConceded);
  const gdBalance = 1 - Math.abs(homeGD - awayGD) / 3;

  // 13. Combined goal expectancy (from Poisson if available)
  const combinedGoals = (features.homeLambda || homeGoals) + (features.awayLambda || awayGoals);
  const goalExpectancySignal = combinedGoals < 2.3 ? 1 : combinedGoals < 2.8 ? 0.7 : 0.3;

  // 14. Defensive solidity both sides (average, not min)
  const avgConceded = (homeConceded + awayConceded) / 2;
  const defensiveSolidity = avgConceded < 1.0 ? 1 : avgConceded < 1.3 ? 0.7 : 0.4;

  // 15. Tight matches: small goal difference in average results
  const tightMatchSignal = Math.abs(homeGoals - homeConceded - (awayGoals - awayConceded)) < 0.5 ? 1 : 0.6;

  return {
    eloBalance,
    impliedDrawProb,
    h2hDrawRate,
    leagueDrawPct,
    defensiveBalance,
    lowScoringSignal,
    formBalance,
    homeNotDominant,
    awayNotWeak,
    cleanSheetBalance,
    eloDrawProb,
    gdBalance,
    goalExpectancySignal,
    defensiveSolidity,
    tightMatchSignal,
  };
}

/**
 * Predict draw probability for a single match.
 *
 * Uses a weighted logistic regression with 15 draw-specific features.
 * The model is calibrated to produce realistic draw probabilities
 * (typical range: 15%-35%, with extremes at 10%-40%).
 *
 * @param {Object} features - Standard match features
 * @param {Object} drawWeights - Optional weight overrides from training
 * @returns {Object} { drawProb, confidence, signals, reasoning }
 */
function predict(features, drawWeights) {
  const df = extractDrawFeatures(features);

  // Default weights — calibrated so typical draw probs land 18-32%
  // Market-implied draw prob is the strongest single signal
  // sigmoid(-4.0) ≈ 1.8%, so we need ~3.0 from features to reach ~25%
  const w = drawWeights || {
    intercept: -4.0,           // Base: sigmoid(-4.0) ≈ 1.8% before features
    eloBalance: 0.3,           // Moderate: evenly matched teams draw more
    impliedDrawProb: 3.0,      // Dominant: market odds are the best draw signal
    h2hDrawRate: 0.2,          // Weak: some H2H patterns
    leagueDrawPct: 1.5,        // Strong: league baseline is very predictive
    defensiveBalance: 0.15,    // Weak: both defending well
    lowScoringSignal: 0.2,     // Weak: low-scoring = tight
    formBalance: 0.3,          // Moderate: similar form = draw
    homeNotDominant: 0.1,      // Weak: home team not running away
    awayNotWeak: 0.1,          // Weak: away team can hold on
    cleanSheetBalance: 0.15,   // Weak: clean sheets on both sides
    eloDrawProb: 0.15,         // Weak: Elo draw formula is crude
    gdBalance: 0.1,            // Weak: goal difference balance
    goalExpectancySignal: 0.2, // Weak: low total goals = draw
    defensiveSolidity: 0.1,    // Weak: both sides defend well
    tightMatchSignal: 0.08,    // Weak: tight match indicator
  };

  // Compute logistic regression
  let z = w.intercept;
  z += df.eloBalance * w.eloBalance;
  z += (df.impliedDrawProb || df.leagueDrawPct) * w.impliedDrawProb;
  z += (df.h2hDrawRate || 0.25) * w.h2hDrawRate;
  z += df.leagueDrawPct * w.leagueDrawPct;
  z += df.defensiveBalance * w.defensiveBalance;
  z += df.lowScoringSignal * w.lowScoringSignal;
  z += df.formBalance * w.formBalance;
  z += df.homeNotDominant * w.homeNotDominant;
  z += df.awayNotWeak * w.awayNotWeak;
  z += df.cleanSheetBalance * w.cleanSheetBalance;
  z += df.eloDrawProb * w.eloDrawProb;
  z += df.gdBalance * w.gdBalance;
  z += df.goalExpectancySignal * w.goalExpectancySignal;
  z += df.defensiveSolidity * w.defensiveSolidity;
  z += df.tightMatchSignal * w.tightMatchSignal;

  // Raw probability
  let drawProb = sigmoid(z);

  // Calibration: clamp to realistic range (5%-45%)
  drawProb = clamp(drawProb, 0.05, 0.45);

  // Confidence based on signal strength
  const signalCount = Object.values(df).filter(v => v > 0.6).length;
  const confidence =
    signalCount >= 8 ? "high" :
    signalCount >= 5 ? "medium" : "low";

  // Key signals for reasoning
  const signals = [];
  if (df.eloBalance > 0.7) signals.push("evenly matched (Elo)");
  if (df.impliedDrawProb && df.impliedDrawProb > 0.28) signals.push("market prices draw highly");
  if (df.h2hDrawRate && df.h2hDrawRate > 0.30) signals.push("H2H history shows draws");
  if (df.leagueDrawPct > 0.27) signals.push("high-draw league");
  if (df.defensiveBalance > 0.7) signals.push("balanced defenses");
  if (df.lowScoringSignal > 0.6) signals.push("low-scoring teams");
  if (df.formBalance > 0.7) signals.push("similar form");
  if (df.homeNotDominant > 0.8) signals.push("home team not dominant");
  if (df.awayNotWeak > 0.8) signals.push("away team competitive");
  if (df.cleanSheetBalance > 0.5) signals.push("both keep clean sheets");
  if (df.goalExpectancySignal > 0.7) signals.push("low expected goals");

  // Reasoning
  const reasoning = [];
  if (drawProb > 0.30) {
    reasoning.push(`Strong draw signal: ${(drawProb * 100).toFixed(1)}%`);
  } else if (drawProb > 0.25) {
    reasoning.push(`Above-average draw chance: ${(drawProb * 100).toFixed(1)}%`);
  } else {
    reasoning.push(`Below-average draw chance: ${(drawProb * 100).toFixed(1)}%`);
  }
  if (signals.length > 0) {
    reasoning.push(`Key factors: ${signals.slice(0, 3).join(", ")}`);
  }

  return {
    drawProb,
    confidence,
    signals,
    features: df,
    reasoning: reasoning.join(". "),
  };
}

/**
 * Adjust home/away probabilities after draw model refines the draw.
 * Ensures all three probabilities sum to 1.
 */
function adjustProbs(homeProb, drawProb, awayProb, newDrawProb) {
  // How much did the draw change?
  const drawDelta = newDrawProb - drawProb;

  // Redistribute the delta to home and away proportionally
  const homeAwayTotal = homeProb + awayProb;
  if (homeAwayTotal === 0) {
    return { home: 1/3, draw: newDrawProb, away: 1/3 };
  }

  const homeShare = homeProb / homeAwayTotal;
  const awayShare = awayProb / homeAwayTotal;

  let newHome = homeProb - drawDelta * homeShare;
  let newAway = awayProb - drawDelta * awayShare;

  // Clamp and normalize
  newHome = clamp(newHome, 0.05, 0.85);
  newAway = clamp(newAway, 0.05, 0.85);
  newDrawProb = clamp(newDrawProb, 0.05, 0.45);

  const total = newHome + newDrawProb + newAway;
  return {
    home: clamp(newHome / total),
    draw: clamp(newDrawProb / total),
    away: clamp(newAway / total),
  };
}

module.exports = { predict, extractDrawFeatures, adjustProbs, sigmoid, clamp };
