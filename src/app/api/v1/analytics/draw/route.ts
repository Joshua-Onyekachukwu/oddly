/**
 * GET /api/v1/analytics/draw
 *
 * Draw-specific analytics for the accuracy dashboard.
 * Uses materialized views for zero full-table-scan performance.
 *
 * Query Params:
 *   - type: "summary" | "confusion" | "buckets" | "leagues" | "trend"
 *   - league: filter by league name
 *   - days: trend window (default: 90)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// ── Summary: overall draw performance ──────────────────────────
async function getDrawSummary() {
  // Get overall draw performance from mv_draw_performance
  const { data: perf } = await (supabaseAdmin as any)
    .from("mv_draw_performance")
    .select("*");

  if (!perf || perf.length === 0) {
    return {
      totalPredictions: 0,
      actualDraws: 0,
      predictedDraws: 0,
      correctDraws: 0,
      missedDraws: 0,
      falseDraws: 0,
      drawAccuracy: 0,
      drawPrecision: 0,
      drawRecall: 0,
      drawF1: 0,
      homeToDrawErrors: 0,
      awayToDrawErrors: 0,
      drawToHomeErrors: 0,
      drawToAwayErrors: 0,
    };
  }

  // Aggregate across all leagues
  const total = perf.reduce((s: number, r: any) => s + r.total_predictions, 0);
  const actualDraws = perf.reduce((s: number, r: any) => s + r.actual_draws, 0);
  const predictedDraws = perf.reduce((s: number, r: any) => s + r.predicted_draws, 0);
  const correctDraws = perf.reduce((s: number, r: any) => s + r.correct_draws, 0);
  const homeToDraw = perf.reduce((s: number, r: any) => s + r.home_to_draw_errors, 0);
  const awayToDraw = perf.reduce((s: number, r: any) => s + r.away_to_draw_errors, 0);
  const drawToHome = perf.reduce((s: number, r: any) => s + r.draw_to_home_errors, 0);
  const drawToAway = perf.reduce((s: number, r: any) => s + r.draw_to_away_errors, 0);

  const missedDraws = homeToDraw + awayToDraw;
  const falseDraws = drawToHome + drawToAway;

  const drawPrecision = predictedDraws > 0 ? correctDraws / predictedDraws : 0;
  const drawRecall = actualDraws > 0 ? correctDraws / actualDraws : 0;
  const drawF1 = drawPrecision + drawRecall > 0
    ? (2 * drawPrecision * drawRecall) / (drawPrecision + drawRecall)
    : 0;
  const drawAccuracy = actualDraws > 0 ? correctDraws / actualDraws : 0;

  return {
    totalPredictions: total,
    actualDraws,
    predictedDraws,
    correctDraws,
    missedDraws,
    falseDraws,
    drawAccuracy: Math.round(drawAccuracy * 10000) / 100,
    drawPrecision: Math.round(drawPrecision * 10000) / 100,
    drawRecall: Math.round(drawRecall * 10000) / 100,
    drawF1: Math.round(drawF1 * 10000) / 100,
    homeToDrawErrors: homeToDraw,
    awayToDrawErrors: awayToDraw,
    drawToHomeErrors: drawToHome,
    drawToAwayErrors: drawToAway,
  };
}

// ── Confusion matrix ───────────────────────────────────────────
async function getConfusionMatrix() {
  const { data: perf } = await (supabaseAdmin as any)
    .from("mv_draw_performance")
    .select("*");

  if (!perf || perf.length === 0) {
    return {
      matrix: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      labels: ["Home", "Draw", "Away"],
    };
  }

  // Aggregate confusion matrix across all leagues
  // Row = predicted, Column = actual
  const totalCorrectHomes = perf.reduce((s: number, r: any) => s + r.correct_homes, 0);
  const totalCorrectDraws = perf.reduce((s: number, r: any) => s + r.correct_draws, 0);
  const totalCorrectAways = perf.reduce((s: number, r: any) => s + r.correct_aways, 0);
  const totalHToD = perf.reduce((s: number, r: any) => s + r.home_to_draw_errors, 0);
  const totalAToD = perf.reduce((s: number, r: any) => s + r.away_to_draw_errors, 0);
  const totalDToH = perf.reduce((s: number, r: any) => s + r.draw_to_home_errors, 0);
  const totalDToA = perf.reduce((s: number, r: any) => s + r.draw_to_away_errors, 0);

  // We need home-to-home, home-to-away, away-to-home, away-to-away
  // These aren't directly in the materialized view, so compute from totals
  const totalPredictedHomes = perf.reduce((s: number, r: any) => s + r.predicted_homes, 0);
  const totalPredictedAways = perf.reduce((s: number, r: any) => s + r.predicted_aways, 0);
  const totalActualHomes = perf.reduce((s: number, r: any) => s + r.actual_homes, 0);
  const totalActualAways = perf.reduce((s: number, r: any) => s + r.actual_aways, 0);

  const homeToAway = Math.max(0, totalPredictedHomes - totalCorrectHomes - totalHToD);
  const awayToHome = Math.max(0, totalPredictedAways - totalCorrectAways - totalAToD);

  return {
    matrix: [
      [totalCorrectHomes, totalHToD, homeToAway],
      [totalDToH, totalCorrectDraws, totalDToA],
      [awayToHome, totalAToD, totalCorrectAways],
    ],
    labels: ["Home", "Draw", "Away"],
  };
}

// ── Probability buckets ────────────────────────────────────────
async function getProbabilityBuckets() {
  const { data: buckets } = await (supabaseAdmin as any)
    .from("mv_draw_probability_buckets")
    .select("*")
    .neq("prob_bucket", "no_draw_pred")
    .order("sort_order");

  return buckets || [];
}

// ── League performance ─────────────────────────────────────────
async function getLeaguePerformance() {
  const { data: perf } = await (supabaseAdmin as any)
    .from("mv_draw_performance")
    .select("*")
    .order("total_predictions", { ascending: false });

  if (!perf || perf.length === 0) return [];

  return perf.map((r: any) => ({
    leagueId: r.league_id,
    leagueName: r.league_name,
    totalPredictions: r.total_predictions,
    actualDraws: r.actual_draws,
    predictedDraws: r.predicted_draws,
    correctDraws: r.correct_draws,
    missedDraws: r.home_to_draw_errors + r.away_to_draw_errors,
    falseDraws: r.draw_to_home_errors + r.draw_to_away_errors,
    actualDrawRate: r.actual_draw_rate,
    predictedDrawRate: r.predicted_draw_rate,
    drawPrecision: r.draw_precision,
    drawRecall: r.draw_recall,
    drawF1: r.draw_precision + r.draw_recall > 0
      ? Math.round((2 * r.draw_precision * r.draw_recall / (r.draw_precision + r.draw_recall)) * 10000) / 100
      : 0,
    calibrationError: Math.abs(r.predicted_draw_rate - r.actual_draw_rate),
    firstPrediction: r.first_prediction,
    lastPrediction: r.last_prediction,
  }));
}

// ── Trend ──────────────────────────────────────────────────────
async function getDrawTrend(days: number) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data: trend } = await (supabaseAdmin as any)
    .from("mv_draw_trend")
    .select("*")
    .gte("week", cutoff)
    .order("week", { ascending: true });

  return trend || [];
}

// ── Calibration (league-level calibration status) ──────────────
async function getCalibration() {
  try {
    const { data: cal } = await supabaseAdmin
      .from("league_draw_calibration")
      .select("*")
      .eq("status", "champion")
      .order("sample_size", { ascending: false });

    return cal || [];
  } catch {
    return [];
  }
}

// ── Main handler ───────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "summary";
  const days = parseInt(url.searchParams.get("days") || "90");

  try {
    let data: any;

    switch (type) {
      case "confusion":
        data = await getConfusionMatrix();
        break;
      case "buckets":
        data = await getProbabilityBuckets();
        break;
      case "leagues":
        data = await getLeaguePerformance();
        break;
      case "trend":
        data = await getDrawTrend(days);
        break;
      case "calibration":
        data = await getCalibration();
        break;
      case "summary":
      default:
        data = await getDrawSummary();
        break;
    }

    return NextResponse.json({
      success: true,
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[DRAW-ANALYTICS] Error:", error.message);
    return NextResponse.json(
      { error: "Draw analytics query failed", detail: error.message },
      { status: 500 }
    );
  }
}

// POST: refresh draw materialized views (admin only)
export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get("authorization");
    const secret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
    if (!auth || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabaseAdmin.rpc("refresh_draw_views");
    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Draw analytics views refreshed",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Refresh failed", detail: error.message },
      { status: 500 }
    );
  }
}
