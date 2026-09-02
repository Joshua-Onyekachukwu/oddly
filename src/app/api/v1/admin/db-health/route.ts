/**
 * GET /api/v1/admin/db-health
 * 
 * Database health monitoring dashboard.
 * Shows Supabase storage and performance.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { successResponse, requireAdmin, internalError } from "@/lib/api/utils";

export const dynamic = "force-dynamic";

async function getSupabaseRealtimeStats(supabase: any) {
  const tables = ["live_pick", "value_picks", "settlement_feed", "live_stats"];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    try {
      const { count } = await supabase.from(t).select("*", { count: "exact", head: true });
      counts[t] = count || 0;
    } catch {
      counts[t] = 0;
    }
  }
  return { connected: true, tables: counts, totalRows: Object.values(counts).reduce((a, b) => a + b, 0) };
}

async function getSupabaseStats(supabase: any) {
  const tables = [
    "leagues", "teams", "fixtures", "predictions", "odds_snapshots",
    "accumulators", "model_performance", "live_pick", "value_picks",
    "settlement_feed", "live_stats", "referee_profiles", "match_stats",
    "team_referee_stats",
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

    const sbStats = await getSupabaseStats(supabase);
    const realtimeStats = await getSupabaseRealtimeStats(supabase);

    const ownership = [
      { dataset: "Users & Auth", sourceOfTruth: "Supabase" },
      { dataset: "Active Predictions", sourceOfTruth: "Supabase" },
      { dataset: "Historical Predictions", sourceOfTruth: "Supabase" },
      { dataset: "xG Features", sourceOfTruth: "Supabase" },
      { dataset: "Referee Profiles", sourceOfTruth: "Supabase" },
      { dataset: "Odds Snapshots", sourceOfTruth: "Supabase" },
      { dataset: "User Accumulators", sourceOfTruth: "Supabase" },
      { dataset: "Live Pick", sourceOfTruth: "Supabase" },
      { dataset: "Value Picks", sourceOfTruth: "Supabase" },
      { dataset: "Settlement Feed", sourceOfTruth: "Supabase" },
      { dataset: "Live Stats", sourceOfTruth: "Supabase" },
    ];

    return successResponse({
      supabase: sbStats,
      convex: { connected: false, deprecated: true, note: "Migrated to Supabase" },
      realtime: realtimeStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("FORBIDDEN", authErr.message, 403);
      }
      if (authErr.code === "UNAUTHORIZED") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("UNAUTHORIZED", authErr.message, 401);
      }
    }
    console.error("GET /api/v1/admin/db-health error:", error);
    return internalError();
  }
}
