/**
 * ODDLY Cross-Model Communication Layer
 *
 * Models don't just predict independently — they share signals.
 * For example:
 * - If the Goals model sees high xG → it tells 1X2 "expect goals, reduce draw"
 * - If the 1X2 model sees a strong favorite → it tells Goals "fewer goals expected"
 * - If BTTS model sees both teams score → it tells DC "12 likely"
 * - If DC model sees draw is likely → it tells BTTS "BTTS less likely in draws"
 */

/**
 * Extract signals from the Goals model for other models.
 */
function goalsTo1x2(goalsOutput) {
  const { expectedGoals, homeLambda, awayLambda } = goalsOutput;
  return {
    highScoring: expectedGoals > 2.8,
    lowScoring: expectedGoals < 2.0,
    homeDominant: homeLambda > awayLambda * 1.5,
    balanced: Math.abs(homeLambda - awayLambda) < 0.3,
  };
}

/**
 * Extract signals from the 1X2 model for Goals model.
 */
function oneXtwoToGoals(model1x2) {
  return {
    homeWinProb: model1x2.home,
    drawProb: model1x2.draw,
    awayWinProb: model1x2.away,
    strongFavorite: Math.max(model1x2.home, model1x2.away) > 0.65,
    likelyDraw: model1x2.draw > 0.30,
  };
}

/**
 * Extract signals from BTTS model for Goals model.
 */
function bttsToGoals(bttsOutput) {
  return {
    bothScore: bttsOutput.bttsYes > 0.60,
    cleanSheetLikely: bttsOutput.bttsNo > 0.60,
  };
}

/**
 * Extract signals from DC model for 1X2 model.
 */
function dcTo1x2(dcOutput) {
  return {
    homeNotLose: dcOutput.dc1X > 0.75,
    awayNotLose: dcOutput.dcX2 > 0.75,
    expectWinner: dcOutput.dc12 > 0.70,
  };
}

/**
 * Extract signals from the Draw model for other models.
 */
function drawToGoals(drawOutput) {
  return {
    likelyDraw: drawOutput.drawProb > 0.28,
    veryLikelyDraw: drawOutput.drawProb > 0.33,
    lowGoalExpectation: drawOutput.features?.lowScoringSignal > 0.6,
    tightMatch: drawOutput.features?.tightMatchSignal > 0.7,
  };
}

/**
 * Compute all cross-model signals from an initial round of predictions.
 * Call this after all models have made their first prediction.
 */
function computeSignals(modelOutputs) {
  const signals = {};

  if (modelOutputs.goals) {
    signals.fromGoals = goalsTo1x2(modelOutputs.goals);
  }
  if (modelOutputs.oneXtwo) {
    signals.from1x2 = oneXtwoToGoals(modelOutputs.oneXtwo);
  }
  if (modelOutputs.btts) {
    signals.fromBtts = bttsToGoals(modelOutputs.btts);
  }
  if (modelOutputs.dc) {
    signals.fromDc = dcTo1x2(modelOutputs.dc);
  }
  if (modelOutputs.draw) {
    signals.fromDraw = drawToGoals(modelOutputs.draw);
  }

  return signals;
}

/**
 * Second-pass refinement: use cross-model signals to adjust predictions.
 * This is where models "talk to each other."
 */
function refinePredictions(modelOutputs, signals) {
  const refined = { ...modelOutputs };

  // Goals model refinement from 1X2
  if (signals.from1x2?.strongFavorite && refined.goals) {
    // Strong favorite → slightly fewer goals (controlled game)
    refined.goals.over25 *= 0.97;
    refined.goals.under25 = 1 - refined.goals.over25;
  }

  // 1X2 refinement from Goals
  if (signals.fromGoals?.highScoring && refined.oneXtwo) {
    // High-scoring → reduce draw, increase home/away
    const drawReduction = refined.oneXtwo.draw * 0.05;
    refined.oneXtwo.draw -= drawReduction;
    refined.oneXtwo.home += drawReduction * 0.6;
    refined.oneXtwo.away += drawReduction * 0.4;
    // Normalize
    const total = refined.oneXtwo.home + refined.oneXtwo.draw + refined.oneXtwo.away;
    refined.oneXtwo.home /= total;
    refined.oneXtwo.draw /= total;
    refined.oneXtwo.away /= total;
  }

  // BTTS refinement from Goals
  if (signals.fromGoals?.lowScoring && refined.btts) {
    refined.btts.bttsYes *= 0.95;
    refined.btts.bttsNo = 1 - refined.btts.bttsYes;
  }

  // DC refinement from Draw model
  if (signals.fromDraw?.likelyDraw && refined.dc) {
    // Draw model says draw likely → 1X and X2 both increase
    refined.dc.dc1X = Math.min(0.99, refined.dc.dc1X * 1.03);
    refined.dc.dcX2 = Math.min(0.99, refined.dc.dcX2 * 1.03);
  }

  // BTTS refinement from Draw model
  if (signals.fromDraw?.tightMatch && refined.btts) {
    // Tight match → less likely both teams score
    refined.btts.bttsYes *= 0.94;
    refined.btts.bttsNo = 1 - refined.btts.bttsYes;
  }

  // Goals model refinement from Draw model
  if (signals.fromDraw?.veryLikelyDraw && refined.goals) {
    // Very likely draw → fewer total goals expected
    refined.goals.over25 *= 0.95;
    refined.goals.under25 = 1 - refined.goals.over25;
  }

  return refined;
}

module.exports = {
  goalsTo1x2,
  oneXtwoToGoals,
  bttsToGoals,
  dcTo1x2,
  computeSignals,
  refinePredictions,
};
