/**
 * GET /api/v1/admin/db-health
 * 
 * Database health monitoring dashboard.
 * Shows Supabase vs Convex storage and performance.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { successResponse, requireAdmin, internalError } from "@/lib/api/utils";

export const dynamic = "force-dynamic";

const CONVEX_URL = process.env.CONVEX_URL || "https://limitless-mole-387.convex.cloud";

async function convexQuery(functionName: string) {
  if (!CONVEX_URL) return null;
  try {
    const res = await fetch(`${CONVEX_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: functionName, args: {}, format: "json" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? data;
  } catch {
    return null;
  }
}

async function getConvexStats() {
  try {
    const stats = await convexQuery("predictions:getStats");
    if (!stats) return { connected: false, error: "Could not reach Convex" };

    return {
      connected: true,
      tables: stats,
      totalRows: Object.values(stats as Record<string, number>).reduce((a, b) => (a as number) + (b as number), 0) as number,
    };
  } catch (err: any) {
    return { connected: false, error: err.message?.slice(0, 100) };
  }
}

async function getSupabaseStats(supabase: any) {
  const tables = [
    "leagues", "teams", "fixtures", "predictions", "odds_snapshots",
    "accumulators", "model_performance",
  ];

  const counts: Record<string, number> = {};
  for (const t of tables) {
    try {
      const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
      counts[t] = count || 0;
    } catch {
      counts[t] = 0;
    }
  }

  const { count: settled } = await supabase
    .from("predictions")
    .select("*", { count: "exact", head: true })
    .not("result", "is", null);

  return {
    connected: true,
    tables: counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    settledPredictions: settled || 0,
    unsettledPredictions: counts.predictions - (settled || 0),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin(request);

    const [sbStats, cvStats] = await Promise.all([
      getSupabaseStats(supabase),
      getConvexStats(),
    ]);

    const ownership = [
      { dataset: "Users & Auth", supabase: true, convex: false, sourceOfTruth: "Supabase" },
      { dataset: "Active Predictions", supabase: true, convex: false, sourceOfTruth: "Supabase" },
      { dataset: "Historical Predictions", supabase: true, convex: true, sourceOfTruth: "Convex" },
      { dataset: "xG Features", supabase: false, convex: true, sourceOfTruth: "Convex" },
      { dataset: "Referee Profiles", supabase: false, convex: true, sourceOfTruth: "Convex" },
      { dataset: "Odds Snapshots", supabase: true, convex: false, sourceOfTruth: "Supabase" },
      { dataset: "User Accumulators", supabase: true, convex: false, sourceOfTruth: "Supabase" },
    ];

    return successResponse({
      supabase: sbStats,
      convex: cvStats,
      ownership,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("GET /api/v1/admin/db-health error:", error);
    return internalError();
  }
}
