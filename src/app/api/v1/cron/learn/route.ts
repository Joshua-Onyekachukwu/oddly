/**
 * POST /api/v1/cron/learn
 *
 * Continuous learning + league draw calibration with champion/challenger.
 * Includes cron logging and execution locking.
 *
 * Schedule: weekly on Sunday at 3am (vercel.json)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withLock } from "@/lib/cron/lock";
import { startRun, completeRun, type CronRunResult } from "@/lib/cron/logger";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) { console.error("[CRON] CRITICAL: VERCEL_CRON_SECRET not set"); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

interface LearnResult {
  overallAccuracy: number;
  highConfAccuracy: number;
  brierScore: number;
  totalPredictions: number;
  marketBreakdown: Array<{ market: string; accuracy: number; total: number; correct: number }>;
  calibration: Array<{ range: string; avgPredicted: number; actualAccuracy: number; samples: number }>;
  drawCalibration: DrawCalibrationResult | null;
  viewsRefreshed: boolean;
}

interface DrawCalibrationResult {
  leaguesCalibrated: number;
  championPromotions: number;
  challengerRejections: number;
  alertsGenerated: number;
}

/**
 * League draw calibration with Bayesian shrinkage.
 * For each league with enough data:
 * 1. Calculate actual draw rate and model draw rate
 * 2. Bayesian shrinkage toward global rate for small samples
 * 3. Champion/challenger evaluation
 * 4. Promote only if challenger is better
 */
async function calibrateDrawByLeague(): Promise<DrawCalibrationResult> {
  const result: DrawCalibrationResult = {
    leaguesCalibrated: 0,
    championPromotions: 0,
    challengerRejections: 0,
    alertsGenerated: 0,
  };

  try {
    // Get settled 1X2 predictions with actual outcomes
    const { data: preds } = await supabaseAdmin
      .from("predictions")
      .select("id, fixture_id, selection, model_probability, result, created_at")
      .eq("market", "1X2")
      .in("result", ["correct", "wrong"])
      .gte("settled_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .limit(50000);

    if (!preds || preds.length < 100) return result;

    // Get fixtures with scores and leagues
    const fixtureIds = [...new Set(preds.map(p => p.fixture_id))];
    const { data: fixtures } = await supabaseAdmin
      .from("fixtures")
      .select("id, home_score, away_score, league_id, leagues(name)")
      .in("id", fixtureIds)
      .not("home_score", "is", null);

    if (!fixtures) return result;

    const fixtureMap: Record<string, any> = {};
    for (const f of fixtures) fixtureMap[f.id] = f;

    // Group by league
    const byLeague: Record<string, {
      leagueName: string;
      predictions: Array<{ selection: string; drawProb: number; isCorrect: boolean; actualDraw: boolean }>;
    }> = {};

    for (const p of preds) {
      const f = fixtureMap[p.fixture_id];
      if (!f || f.home_score === null) continue;

      const actualDraw = f.home_score === f.away_score;
      const predictedDraw = p.selection?.toLowerCase() === "draw";

      // Get draw probability from the selection's probability
      const drawProb = predictedDraw ? (p.model_probability || 0.25) : 0;

      const leagueId = f.league_id || "unknown";
      const leagueName = (f.leagues as any)?.name || "Unknown";
      if (!byLeague[leagueId]) byLeague[leagueId] = { leagueName, predictions: [] };
      byLeague[leagueId].predictions.push({
        selection: p.selection?.toLowerCase() || "",
        drawProb,
        isCorrect: p.result === "correct",
        actualDraw,
      });
    }

    // Global draw rate
    const totalMatches = preds.length;
    const totalActualDraws = preds.filter((p) => {
      const f = fixtureMap[p.fixture_id];
      return f && f.home_score === f.away_score;
    }).length;
    const globalDrawRate = totalActualDraws / totalMatches;

    // Calibrate each league
    for (const [leagueId, league] of Object.entries(byLeague)) {
      if (league.predictions.length < 20) continue; // Need at least 20 predictions

      result.leaguesCalibrated++;

      const leagueActualDraws = league.predictions.filter(p => p.actualDraw).length;
      const leagueDrawRate = leagueActualDraws / league.predictions.length;

      const leaguePredictedDraws = league.predictions.filter(p => p.selection === "draw");
      const modelDrawRate = leaguePredictedDraws.length > 0
        ? leaguePredictedDraws.reduce((s, p) => s + p.drawProb, 0) / leaguePredictedDraws.length
        : 0.25;

      // Bayesian shrinkage: blend league rate toward global rate based on sample size
      const confidence = Math.min(league.predictions.length / 100, 1); // 100 predictions = full confidence
      const shrunkDrawRate = globalDrawRate * (1 - confidence) + leagueDrawRate * confidence;

      // Calibration error
      const calibrationError = Math.abs(modelDrawRate - shrunkDrawRate);

      // Champion/challenger evaluation
      const { data: existingCal } = await supabaseAdmin
        .from("league_draw_calibration")
        .select("id, calibration_version, calibration_parameters, validation_metrics, status")
        .eq("league_id", leagueId)
        .eq("status", "champion")
        .order("created_at", { ascending: false })
        .limit(1);

      const version = `v${new Date().toISOString().slice(0, 10)}_shrinkage`;
      const metrics = {
        sampleSize: league.predictions.length,
        leagueDrawRate: Math.round(leagueDrawRate * 10000) / 10000,
        globalDrawRate: Math.round(globalDrawRate * 10000) / 10000,
        shrunkDrawRate: Math.round(shrunkDrawRate * 10000) / 10000,
        modelDrawRate: Math.round(modelDrawRate * 10000) / 10000,
        calibrationError: Math.round(calibrationError * 10000) / 10000,
        confidence: Math.round(confidence * 100) / 100,
      };

      const shouldPromote = !existingCal?.length ||
        calibrationError < ((existingCal[0].validation_metrics as any)?.calibrationError || 0.5);

      if (shouldPromote) {
        // Retire old champion
        if (existingCal?.length) {
          await supabaseAdmin
            .from("league_draw_calibration")
            .update({ status: "retired" })
            .eq("id", existingCal[0].id);
        }

        // Insert new champion
        await supabaseAdmin.from("league_draw_calibration").insert({
          league_id: leagueId,
          league_name: byLeague[leagueId].leagueName,
          calibration_version: version,
          training_start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          training_end: new Date().toISOString().slice(0, 10),
          sample_size: league.predictions.length,
          global_draw_rate: globalDrawRate,
          league_draw_rate: leagueDrawRate,
          model_draw_rate: modelDrawRate,
          calibration_method: "bayesian_shrinkage",
          calibration_parameters: { shrunkDrawRate, confidence },
          validation_metrics: metrics,
          status: "champion",
        });
        result.championPromotions++;
      } else {
        result.challengerRejections++;
      }

      // Health alerts: if calibration error is too high
      if (calibrationError > 0.10) {
        try {
          await supabaseAdmin.rpc("log_cron_alert", {
            p_job_name: "learn",
            p_alert_type: "DRAWDOWN",
            p_severity: calibrationError > 0.15 ? "CRITICAL" : "WARNING",
            p_message: `League ${byLeague[leagueId].leagueName}: draw calibration error ${(calibrationError * 100).toFixed(1)}% (threshold: 10%)`,
            p_metric_value: calibrationError,
            p_threshold: 0.10,
          });
          result.alertsGenerated++;
        } catch {}
      }
    }
  } catch (err: any) {
    console.error("[LEARN] Draw calibration error:", err.message);
  }

  return result;
}

async function runLearn(): Promise<LearnResult> {
  const startTime = Date.now();
  console.log("[LEARN] Starting learning cycle...");

  // 1. Compute accuracy by market (use materialized view if available)
  let settledPreds: any[] = [];
  let source = "materialized_view";
  try {
    const { data: mv } = await supabaseAdmin.from("mv_market_accuracy").select("*");
    if (mv && mv.length > 0) {
      console.log("[LEARN] Using materialized view for market accuracy");
    }
  } catch {}

  // Fallback: indexed query with limit
  const { data: preds } = await supabaseAdmin
    .from("predictions")
    .select("market, selection, model_probability, result, fixture_id")
    .not("result", "is", null)
    .neq("result", "pending")
    .gte("settled_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .limit(20000);

  settledPreds = preds || [];
  if (settledPreds.length > 0) source = "fallback_query";

  if (!settledPreds || settledPreds.length === 0) {
    return {
      overallAccuracy: 0, highConfAccuracy: 0, brierScore: 0,
      totalPredictions: 0, marketBreakdown: [], calibration: [],
      drawCalibration: null, viewsRefreshed: false,
    };
  }

  // Group by market
  const marketStats: Record<string, { total: number; correct: number; probabilities: number[] }> = {};
  for (const p of settledPreds) {
    const mkt = p.market || "unknown";
    if (!marketStats[mkt]) marketStats[mkt] = { total: 0, correct: 0, probabilities: [] };
    marketStats[mkt].total++;
    if (p.result === "correct") marketStats[mkt].correct++;
    if (p.model_probability) marketStats[mkt].probabilities.push(p.model_probability);
  }

  // Calibration per confidence bucket
  const buckets: Record<string, { predicted: number[]; actual: number[] }> = {};
  for (const p of settledPreds) {
    if (!p.model_probability) continue;
    const bucket = Math.floor(p.model_probability * 10) * 10;
    const key = `${bucket}-${bucket + 10}`;
    if (!buckets[key]) buckets[key] = { predicted: [], actual: [] };
    buckets[key].predicted.push(p.model_probability);
    buckets[key].actual.push(p.result === "correct" ? 1 : 0);
  }

  const calibration = Object.entries(buckets).map(([range, data]) => ({
    range,
    avgPredicted: data.predicted.reduce((a, b) => a + b, 0) / data.predicted.length,
    actualAccuracy: data.actual.reduce((a, b) => a + b, 0) / data.actual.length,
    samples: data.predicted.length,
  }));

  // Overall metrics
  const totalPreds = settledPreds.length;
  const totalCorrect = settledPreds.filter(p => p.result === "correct").length;
  const overallAccuracy = totalCorrect / totalPreds;

  const highConf = settledPreds.filter(p => (p.model_probability || 0) >= 0.7);
  const highConfCorrect = highConf.filter(p => p.result === "correct").length;
  const highConfAccuracy = highConf.length > 0 ? highConfCorrect / highConf.length : 0;

  const brier = settledPreds.reduce((sum, p) => {
    const prob = p.model_probability || 0.5;
    const actual = p.result === "correct" ? 1 : 0;
    return sum + Math.pow(prob - actual, 2);
  }, 0) / totalPreds;

  // Record performance snapshot
  try {
    await supabaseAdmin.from("learning_snapshots").insert({
      snapshot_type: "daily",
      metrics: {
        timestamp: new Date().toISOString(),
        total_predictions: totalPreds,
        correct: totalCorrect,
        overall_accuracy: overallAccuracy,
        high_confidence_accuracy: highConfAccuracy,
        brier_score: brier,
        market_breakdown: Object.entries(marketStats).map(([market, stats]) => ({
          market, accuracy: stats.correct / stats.total, total: stats.total, correct: stats.correct,
        })),
      },
      created_at: new Date().toISOString(),
    });
  } catch {}

  // League draw calibration
  console.log("[LEARN] Running league draw calibration...");
  const drawCalibration = await calibrateDrawByLeague();
  console.log(`[LEARN] Draw calibration: ${drawCalibration.leaguesCalibrated} leagues, ${drawCalibration.championPromotions} promotions`);

  // Refresh materialized views
  let viewsRefreshed = false;
  try {
    await supabaseAdmin.rpc("refresh_analytics_views");
    viewsRefreshed = true;
    console.log("[LEARN] Refreshed analytics materialized views");
  } catch {}

  const duration = Date.now() - startTime;
  console.log(`[LEARN] Done: ${(overallAccuracy * 100).toFixed(1)}% overall, ${(highConfAccuracy * 100).toFixed(1)}% high-conf (${duration}ms)`);

  return {
    overallAccuracy,
    highConfAccuracy,
    brierScore: brier,
    totalPredictions: totalPreds,
    marketBreakdown: Object.entries(marketStats).map(([market, stats]) => ({
      market, accuracy: stats.correct / stats.total, total: stats.total, correct: stats.correct,
    })),
    calibration: calibration.filter(c => c.samples >= 5),
    drawCalibration,
    viewsRefreshed,
  };
}

export async function POST(request: NextRequest) {
  try {
    // Allow manual triggers without auth (like predict cron)
    const isManual = !request.headers.get("authorization");
    if (!isManual && !isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const executionId = await startRun("learn", isManual ? "manual" : "cron");
    const lockResult = await withLock("learn", runLearn, { leaseSeconds: 1800 }); // 30min lease for training

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, {
        status: "FAILED", errorMessage: lockResult.error, durationMs: lockResult.durationMs,
      });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result!;
    const cronResult: CronRunResult = {
      status: "SUCCESS",
      recordsProcessed: result.totalPredictions,
      metadata: {
        overallAccuracy: `${(result.overallAccuracy * 100).toFixed(1)}%`,
        highConfidence: `${(result.highConfAccuracy * 100).toFixed(1)}%`,
        brierScore: result.brierScore.toFixed(4),
        drawCalibration: result.drawCalibration,
        viewsRefreshed: result.viewsRefreshed,
      },
    };

    await completeRun(executionId, cronResult);

    return NextResponse.json({
      success: true,
      accuracy: `${(result.overallAccuracy * 100).toFixed(1)}%`,
      highConfidence: `${(result.highConfAccuracy * 100).toFixed(1)}%`,
      brier: result.brierScore.toFixed(4),
      totalPredictions: result.totalPredictions,
      marketBreakdown: result.marketBreakdown,
      calibration: result.calibration,
      drawCalibration: result.drawCalibration,
      viewsRefreshed: result.viewsRefreshed,
      duration: `${lockResult.durationMs}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[LEARN] Error:", error);
    return NextResponse.json({ error: "Learn failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ready",
    endpoint: "POST /api/v1/cron/learn",
    description: "Computes accuracy metrics, league draw calibration, and refreshes analytics views",
  });
}
