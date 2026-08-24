import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface PredictionRecord {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  model_probability: number;
  confidence_lower: number;
  confidence_upper: number;
  result: string | null;
}

interface FixtureRecord {
  id: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  kickoff_time: string;
  league_id: string | null;
}

/**
 * Calculate the actual outcome of a prediction based on the match result.
 * Returns true if the prediction was correct, false otherwise.
 */
function calculateOutcome(
  prediction: PredictionRecord,
  fixture: FixtureRecord
): { actualOutcome: boolean; outcomeLabel: string } | null {
  if (fixture.home_score === null || fixture.away_score === null) return null;
  if (fixture.status !== "FT") return null;

  const home = fixture.home_score;
  const away = fixture.away_score;

  // Match result labels
  const matchResult = home > away ? "Home" : home < away ? "Away" : "Draw";
  const totalGoals = home + away;
  const bothScored = home > 0 && away > 0;
  const goalDiff = home - away;

  // Support both legacy and current market naming
  const market = prediction.market.toLowerCase();
  const selection = prediction.selection;

  // 1X2 / Match Result / h2h
  if (market === "1x2" || market === "match_result" || market === "h2h") {
    return {
      actualOutcome: selection === matchResult,
      outcomeLabel: matchResult,
    };
  }

  // Over/Under totals
  if (market.startsWith("ou_over") || market.startsWith("ou_under") || market === "totals") {
    const isOver = selection.toLowerCase().includes("over") || market.includes("over");
    const isUnder = selection.toLowerCase().includes("under") || market.includes("under");
    // Extract line from market (e.g., "OU_Over_2.5" → 2.5)
    const lineMatch = market.match(/(\d+\.?\d*)/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : 2.5;
    if (isOver) {
      return { actualOutcome: totalGoals > line, outcomeLabel: totalGoals > line ? "over" : "under" };
    }
    if (isUnder) {
      return { actualOutcome: totalGoals < line, outcomeLabel: totalGoals < line ? "under" : "over" };
    }
  }

  // BTTS
  if (market === "btts" || market.includes("btts")) {
    const isYes = selection.toLowerCase().includes("yes");
    return {
      actualOutcome: isYes ? bothScored : !bothScored,
      outcomeLabel: bothScored ? "yes" : "no",
    };
  }

  // Double Chance (DC)
  if (market.startsWith("dc_")) {
    if (market.includes("home") || market.includes("1x")) {
      return { actualOutcome: home >= away, outcomeLabel: home >= away ? "hit" : "miss" };
    }
    if (market.includes("away") || market.includes("x2")) {
      return { actualOutcome: away >= home, outcomeLabel: away >= home ? "hit" : "miss" };
    }
    if (market.includes("12")) {
      return { actualOutcome: home !== away, outcomeLabel: home !== away ? "hit" : "miss" };
    }
  }

  // Handicap / Spreads
  if (market.startsWith("hc_") || market === "spreads") {
    const handicapMatch = market.match(/(\d+\.?\d*)/);
    const handicap = handicapMatch ? parseFloat(handicapMatch[1]) : 1;
    const isHome = selection.toLowerCase().includes("home");
    if (isHome) {
      return { actualOutcome: goalDiff > handicap, outcomeLabel: goalDiff > handicap ? "cover" : "no_cover" };
    }
    return { actualOutcome: -goalDiff > handicap, outcomeLabel: -goalDiff > handicap ? "cover" : "no_cover" };
  }

  return null;
}

/**
 * Calculate log loss for a single prediction.
 * Lower log loss = better calibrated predictions.
 */
function logLoss(predicted: number, actual: boolean): number {
  const p = Math.max(0.001, Math.min(0.999, predicted)); // Clamp to avoid log(0)
  return actual ? -Math.log(p) : -Math.log(1 - p);
}

/**
 * Calculate Brier score for a single prediction.
 * Lower Brier score = better calibrated predictions (0 to 1).
 */
function brierScore(predicted: number, actual: boolean): number {
  return (predicted - (actual ? 1 : 0)) ** 2;
}

/**
 * Get confidence tier label from probability
 */
function getConfidenceTier(prob: number): "very_high" | "high" | "medium" | "low" {
  if (prob >= 0.8) return "very_high";
  if (prob >= 0.65) return "high";
  if (prob >= 0.5) return "medium";
  return "low";
}

/**
 * Track prediction accuracy for all finished matches.
 * Called after a match finishes (status = "FT") to log how accurate each prediction was.
 */
export async function trackPredictionAccuracy(fixtureId?: string) {
  console.log("[Model Tracking] Starting accuracy tracking...");

  // Find finished fixtures that haven't been tracked yet
  let fixtureQuery = supabase
    .from("fixtures")
    .select("id, home_score, away_score, status, kickoff_time, league_id")
    .eq("status", "finished");

  if (fixtureId) {
    fixtureQuery = fixtureQuery.eq("id", fixtureId);
  }

  const { data: fixtures, error: fixtureError } = await fixtureQuery;

  if (fixtureError) {
    console.error("[Model Tracking] Failed to fetch fixtures:", fixtureError);
    return { success: false, error: fixtureError.message };
  }

  if (!fixtures || fixtures.length === 0) {
    console.log("[Model Tracking] No finished fixtures to track");
    return { success: true, tracked: 0 };
  }

  let totalTracked = 0;
  let totalCorrect = 0;
  let totalLogLoss = 0;
  let totalBrier = 0;
  const performanceByMarket: Record<string, { correct: number; total: number; logLossSum: number; brierSum: number }> = {};

  for (const fixture of fixtures) {
    // Get all predictions for this fixture
    const { data: predictions, error: predError } = await supabase
      .from("predictions")
      .select("id, fixture_id, market, selection, model_probability, confidence_lower, confidence_upper, result")
      .eq("fixture_id", fixture.id);

    if (predError || !predictions) continue;

    for (const prediction of predictions) {
      // Skip already-tracked predictions
      if (prediction.result !== null) continue;

      const outcome = calculateOutcome(prediction as PredictionRecord, fixture as FixtureRecord);
      if (!outcome) continue;

      const ll = logLoss(prediction.model_probability, outcome.actualOutcome);
      const bs = brierScore(prediction.model_probability, outcome.actualOutcome);
      const confidenceTier = getConfidenceTier(prediction.model_probability);

      // Update the prediction result
      await supabase
        .from("predictions")
        .update({ result: outcome.actualOutcome ? "correct" : "wrong" })
        .eq("id", prediction.id);

      // Accumulate stats (we batch the model_performance inserts below)
      totalTracked++;
      if (outcome.actualOutcome) totalCorrect++;
      totalLogLoss += ll;
      totalBrier += bs;

      // Track by market
      if (!performanceByMarket[prediction.market]) {
        performanceByMarket[prediction.market] = { correct: 0, total: 0, logLossSum: 0, brierSum: 0 };
      }
      performanceByMarket[prediction.market].total++;
      if (outcome.actualOutcome) performanceByMarket[prediction.market].correct++;
      performanceByMarket[prediction.market].logLossSum += ll;
      performanceByMarket[prediction.market].brierSum += bs;
    }
  }

  const accuracy = totalTracked > 0 ? (totalCorrect / totalTracked) * 100 : 0;
  const avgLogLoss = totalTracked > 0 ? totalLogLoss / totalTracked : 0;
  const avgBrier = totalTracked > 0 ? totalBrier / totalTracked : 0;

  // Write aggregated model_performance records (one per market)
  const perfRecords = Object.entries(performanceByMarket).map(([market, stats]) => ({
    model_version: "v5.1",
    market,
    total_predictions: stats.total,
    correct_predictions: stats.correct,
    brier_score: Number((stats.brierSum / stats.total).toFixed(4)),
    calibration_data: {
      avg_log_loss: Number((stats.logLossSum / stats.total).toFixed(4)),
      avg_brier: Number((stats.brierSum / stats.total).toFixed(4)),
      accuracy_pct: Number(((stats.correct / stats.total) * 100).toFixed(1)),
      tracked_at: new Date().toISOString(),
    },
  }));

  if (perfRecords.length > 0) {
    const { error: perfError } = await supabase.from("model_performance").insert(perfRecords);
    if (perfError) {
      console.error("[Model Tracking] Failed to write model_performance:", perfError.message);
    } else {
      console.log(`[Model Tracking] Wrote ${perfRecords.length} aggregated model_performance records`);
    }
  }

  console.log(`[Model Tracking] Tracked ${totalTracked} predictions: ${accuracy.toFixed(1)}% accuracy, ${avgLogLoss.toFixed(3)} avg log loss, ${avgBrier.toFixed(3)} avg Brier`);

  return {
    success: true,
    tracked: totalTracked,
    correct: totalCorrect,
    accuracy: Number(accuracy.toFixed(1)),
    avgLogLoss: Number(avgLogLoss.toFixed(4)),
    avgBrier: Number(avgBrier.toFixed(4)),
    byMarket: Object.entries(performanceByMarket).map(([market, stats]) => ({
      market,
      correct: stats.correct,
      total: stats.total,
      accuracy: Number(((stats.correct / stats.total) * 100).toFixed(1)),
      avgLogLoss: Number((stats.logLossSum / stats.total).toFixed(4)),
      avgBrier: Number((stats.brierSum / stats.total).toFixed(4)),
    })),
  };
}

/**
 * Get aggregate model performance stats.
 * Returns overall accuracy, calibration metrics, and per-market breakdown.
 */
export async function getModelPerformanceStats() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error } = await supabase
    .from("model_performance")
    .select("market, total_predictions, correct_predictions, brier_score, calibration_data, model_version, created_at")
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false });

  if (error || !recent) {
    return { success: false, error: error?.message || "No data" };
  }

  // Aggregate stats
  let totalPredictions = 0;
  let correctPredictions = 0;
  let totalLogLoss = 0;
  let totalBrier = 0;
  const byMarket: Record<string, { correct: number; total: number; logLossSum: number; brierSum: number }> = {};
  const byTier: Record<string, { correct: number; total: number }> = {};

  for (const record of recent) {
    const meta = (record.calibration_data || {}) as Record<string, unknown>;
    const actualOutcome = meta.actual_outcome as boolean | undefined;
    const ll = meta.log_loss as number | undefined;
    const bs = record.brier_score as number | undefined;
    const market = record.market;
    const tier = record.model_version;

    if (actualOutcome === undefined) continue;

    totalPredictions++;
    if (actualOutcome) correctPredictions++;
    if (ll !== undefined) totalLogLoss += ll;
    if (bs !== undefined) totalBrier += bs;

    // By market
    if (market) {
      if (!byMarket[market]) byMarket[market] = { correct: 0, total: 0, logLossSum: 0, brierSum: 0 };
      byMarket[market].total++;
      if (actualOutcome) byMarket[market].correct++;
      if (ll !== undefined) byMarket[market].logLossSum += ll;
      if (bs !== undefined) byMarket[market].brierSum += bs;
    }

    // By confidence tier
    if (tier) {
      if (!byTier[tier]) byTier[tier] = { correct: 0, total: 0 };
      byTier[tier].total++;
      if (actualOutcome) byTier[tier].correct++;
    }
  }

  return {
    success: true,
    totalPredictions,
    correctPredictions,
    accuracy: totalPredictions > 0 ? Number(((correctPredictions / totalPredictions) * 100).toFixed(1)) : 0,
    avgLogLoss: totalPredictions > 0 ? Number((totalLogLoss / totalPredictions).toFixed(4)) : 0,
    avgBrier: totalPredictions > 0 ? Number((totalBrier / totalPredictions).toFixed(4)) : 0,
    byMarket: Object.entries(byMarket).map(([market, stats]) => ({
      market,
      correct: stats.correct,
      total: stats.total,
      accuracy: Number(((stats.correct / stats.total) * 100).toFixed(1)),
      avgLogLoss: Number((stats.logLossSum / stats.total).toFixed(4)),
      avgBrier: Number((stats.brierSum / stats.total).toFixed(4)),
    })),
    byTier: Object.entries(byTier).map(([tier, stats]) => ({
      tier,
      correct: stats.correct,
      total: stats.total,
      accuracy: Number(((stats.correct / stats.total) * 100).toFixed(1)),
    })),
  };
}
