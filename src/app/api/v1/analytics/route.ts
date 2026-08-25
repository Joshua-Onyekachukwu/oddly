/**
 * GET /api/v1/analytics
 *
 * Replaces Convex read queries with Supabase-powered analytics.
 * No more full table scans on 599K records in Convex.
 *
 * Query Params:
 *   - type: "calibration" | "accuracy" | "markets" | "daily" | "high-conf" | "feed" | "summary"
 *   - days: number (default: 30)
 *   - market: filter by market
 *   - result: filter by result ("correct" | "wrong")
 *   - limit: max results (default: 100)
 *   - offset: pagination offset
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  successResponse,
  requireAdmin,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

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

// ─── Analytics Handlers ───────────────────────────────────────

async function getCalibrationBuckets(days: number) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Use Supabase RPC or aggregation — NOT full table scan
  const { data: preds } = await supabaseAdmin
    .from("predictions")
    .select("model_probability, result")
    .not("result", "is", null)
    .neq("result", "pending")
    .gte("created_at", startDate)
    .limit(50000);

  if (!preds?.length) return [];

  const buckets = [
    { range: "50-59%", min: 0.50, max: 0.59, total: 0, correct: 0, sumProb: 0 },
    { range: "60-64%", min: 0.60, max: 0.64, total: 0, correct: 0, sumProb: 0 },
    { range: "65-69%", min: 0.65, max: 0.69, total: 0, correct: 0, sumProb: 0 },
    { range: "70-74%", min: 0.70, max: 0.74, total: 0, correct: 0, sumProb: 0 },
    { range: "75-79%", min: 0.75, max: 0.79, total: 0, correct: 0, sumProb: 0 },
    { range: "80-84%", min: 0.80, max: 0.84, total: 0, correct: 0, sumProb: 0 },
    { range: "85-89%", min: 0.85, max: 0.89, total: 0, correct: 0, sumProb: 0 },
    { range: "90%+", min: 0.90, max: 1.0, total: 0, correct: 0, sumProb: 0 },
  ];

  for (const p of preds) {
    for (const b of buckets) {
      if (p.model_probability >= b.min && p.model_probability <= b.max) {
        b.total++;
        if (p.result === "correct") b.correct++;
        b.sumProb += p.model_probability;
        break;
      }
    }
  }

  return buckets
    .filter((b) => b.total > 0)
    .map((b) => ({
      range: b.range,
      total: b.total,
      correct: b.correct,
      accuracy: Math.round((b.correct / b.total) * 1000) / 10,
      avgPredicted: Math.round((b.sumProb / b.total) * 100),
    }));
}

async function getMarketAccuracy(days: number) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: preds } = await supabaseAdmin
    .from("predictions")
    .select("market, result")
    .not("result", "is", null)
    .neq("result", "pending")
    .gte("created_at", startDate)
    .limit(50000);

  if (!preds?.length) return [];

  const byMarket: Record<string, { total: number; correct: number }> = {};
  for (const p of preds) {
    if (!byMarket[p.market]) byMarket[p.market] = { total: 0, correct: 0 };
    byMarket[p.market].total++;
    if (p.result === "correct") byMarket[p.market].correct++;
  }

  return Object.entries(byMarket)
    .map(([market, stats]) => ({
      market,
      total: stats.total,
      correct: stats.correct,
      accuracy: Math.round((stats.correct / stats.total) * 1000) / 10,
    }))
    .sort((a, b) => b.total - a.total);
}

async function getDailyStats(days: number) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: preds } = await supabaseAdmin
    .from("predictions")
    .select("result, settled_at")
    .not("result", "is", null)
    .neq("result", "pending")
    .gte("settled_at", startDate)
    .order("settled_at", { ascending: false })
    .limit(20000);

  if (!preds?.length) return [];

  const dailyMap: Record<string, { correct: number; total: number }> = {};
  for (const p of preds) {
    const date = (p.settled_at || "").slice(0, 10);
    if (!date) continue;
    if (!dailyMap[date]) dailyMap[date] = { correct: 0, total: 0 };
    dailyMap[date].total++;
    if (p.result === "correct") dailyMap[date].correct++;
  }

  return Object.entries(dailyMap)
    .map(([date, stats]) => ({
      date,
      total: stats.total,
      correct: stats.correct,
      accuracy: Math.round((stats.correct / stats.total) * 1000) / 10,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);
}

async function getHighConfidenceStats(threshold: number, days: number) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: preds } = await supabaseAdmin
    .from("predictions")
    .select("model_probability, result")
    .not("result", "is", null)
    .neq("result", "pending")
    .gte("model_probability", threshold)
    .gte("created_at", startDate)
    .limit(20000);

  if (!preds?.length) return { total: 0, correct: 0, accuracy: 0, threshold };

  const correct = preds.filter((p) => p.result === "correct").length;
  return {
    total: preds.length,
    correct,
    accuracy: Math.round((correct / preds.length) * 1000) / 10,
    threshold,
  };
}

async function getSettlementFeed(limit: number, offset: number) {
  const { data: preds } = await supabaseAdmin
    .from("predictions")
    .select("id, fixture_id, market, selection, model_probability, model_version, result, settled_at")
    .not("result", "is", null)
    .neq("result", "pending")
    .order("settled_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return preds || [];
}

async function getSummary(days: number) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { count: total } = await supabaseAdmin
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .not("result", "is", null)
    .neq("result", "pending")
    .gte("created_at", startDate);

  const { count: correct } = await supabaseAdmin
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .eq("result", "correct")
    .gte("created_at", startDate);

  const { count: totalAll } = await supabaseAdmin
    .from("predictions")
    .select("id", { count: "exact", head: true });

  return {
    period: `${days} days`,
    settled: total || 0,
    correct: correct || 0,
    accuracy: total ? Math.round((correct || 0) / total * 1000) / 10 : 0,
    totalPredictions: totalAll || 0,
  };
}

// ─── Route Handler ────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // Allow cron auth or admin auth
    const isCron = isAuthorizedCron(request);
    if (!isCron) {
      try {
        await requireAdmin(request);
      } catch {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const rl = checkRateLimit(`analytics:${isCron ? "cron" : "admin"}`, 120, 60000);
    const { searchParams } = new URL(request.url);

    const type = searchParams.get("type") || "summary";
    const days = parseInt(searchParams.get("days") || "30", 10);
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let data: any;

    switch (type) {
      case "calibration":
        data = await getCalibrationBuckets(days);
        break;
      case "markets":
        data = await getMarketAccuracy(days);
        break;
      case "daily":
        data = await getDailyStats(days);
        break;
      case "high-conf": {
        const threshold = parseFloat(searchParams.get("threshold") || "0.65");
        data = await getHighConfidenceStats(threshold, days);
        break;
      }
      case "feed":
        data = await getSettlementFeed(limit, offset);
        break;
      case "summary":
      default:
        data = await getSummary(days);
        break;
    }

    const response = successResponse({
      type,
      data,
      meta: { days, generated_at: new Date().toISOString() },
    });

    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    console.error("GET /api/v1/analytics error:", error);
    return internalError();
  }
}
