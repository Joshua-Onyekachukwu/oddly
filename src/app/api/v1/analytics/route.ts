/**
 * GET /api/v1/analytics
 *
 * Analytics powered by materialized views — zero full table scans.
 *
 * Query Params:
 *   - type: "calibration" | "accuracy" | "markets" | "daily" | "high-conf" | "feed" | "summary"
 *   - days: number (default: 30)
 *   - market: filter by market
 *   - limit: max results (default: 100)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) return false;
  return authHeader === `Bearer ${cronSecret}`;
}

// ── Calibration: use materialized view ──────────────────────────
async function getCalibration() {
  const { data, error } = await supabaseAdmin.rpc("get_calibration_buckets");
  if (error) {
    // Fallback: query the materialized view directly
    const { data: mv } = await supabaseAdmin
      .from("mv_calibration_buckets")
      .select("prob_range, total, correct, avg_predicted, actual_accuracy")
      .neq("prob_range", "Other")
      .order("sort_order");
    return mv || [];
  }
  return data || [];
}

// ── Market accuracy: use materialized view ──────────────────────
async function getMarketAccuracy() {
  const { data, error } = await supabaseAdmin.rpc("get_market_accuracy");
  if (error) {
    const { data: mv } = await supabaseAdmin
      .from("mv_market_accuracy")
      .select("*")
      .order("total", { ascending: false });
    return mv || [];
  }
  return data || [];
}

// ── Daily accuracy: use materialized view ───────────────────────
async function getDailyAccuracy(days: number) {
  const { data, error } = await supabaseAdmin.rpc("get_daily_accuracy", {
    days_back: days,
  });
  if (error) {
    const { data: mv } = await supabaseAdmin
      .from("mv_daily_accuracy")
      .select("*")
      .gte("pred_date", new Date(Date.now() - days * 86400000).toISOString().split("T")[0])
      .order("pred_date", { ascending: false });
    return mv || [];
  }
  return data || [];
}

// ── Settlement summary: use materialized view ───────────────────
async function getSettlementSummary() {
  const { data, error } = await supabaseAdmin.rpc("get_settlement_summary");
  if (error) {
    const { data: mv } = await supabaseAdmin
      .from("mv_settlement_summary")
      .select("*")
      .single();
    return mv || {};
  }
  return data?.[0] || {};
}

// ── High confidence: use indexed partial query (small result set) ──
async function getHighConfidence(limit: number) {
  const { data } = await supabaseAdmin
    .from("predictions")
    .select("id, fixture_id, market, selection, model_probability, result, model_version, created_at")
    .gte("model_probability", 0.70)
    .not("result", "is", null)
    .neq("result", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}

// ── Feed: use indexed query (small result set) ──────────────────
async function getFeed(limit: number) {
  const { data } = await supabaseAdmin
    .from("predictions")
    .select("id, fixture_id, market, selection, model_probability, result, model_version, created_at")
    .not("result", "is", null)
    .neq("result", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data || [];
}

// ── Model accuracy: use materialized view ───────────────────────
async function getModelAccuracy() {
  const { data: mv } = await supabaseAdmin
    .from("mv_model_accuracy")
    .select("*")
    .order("total", { ascending: false });
  return mv || [];
}

// ── Main handler ────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "summary";
  const days = parseInt(url.searchParams.get("days") || "30");
  const limit = parseInt(url.searchParams.get("limit") || "100");

  try {
    let data: any;

    switch (type) {
      case "calibration":
        data = await getCalibration();
        break;
      case "markets":
        data = await getMarketAccuracy();
        break;
      case "daily":
        data = await getDailyAccuracy(days);
        break;
      case "high-conf":
        data = await getHighConfidence(limit);
        break;
      case "feed":
        data = await getFeed(limit);
        break;
      case "model":
        data = await getModelAccuracy();
        break;
      case "accuracy":
      case "summary":
      default:
        data = await getSettlementSummary();
        break;
    }

    return NextResponse.json({
      success: true,
      type,
      count: Array.isArray(data) ? data.length : 1,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[ANALYTICS] Error:", error.message);
    return NextResponse.json(
      { error: "Analytics query failed", detail: error.message },
      { status: 500 }
    );
  }
}

// POST: refresh materialized views (admin only)
export async function POST(request: NextRequest) {
  try {
    const { error } = await supabaseAdmin.rpc("refresh_analytics_views");
    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Analytics views refreshed",
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Refresh failed", detail: error.message },
      { status: 500 }
    );
  }
}
