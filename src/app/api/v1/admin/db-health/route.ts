/**
 * GET /api/v1/admin/db-health
 * 
 * Database health monitoring and comparison dashboard.
 * Shows Supabase vs CockroachDB storage, performance, and migration status.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { successResponse, requireAdmin, internalError } from "@/lib/api/utils";

export const dynamic = "force-dynamic";

async function getCockroachStats() {
  const url = process.env.COCKROACHDB_URL;
  if (!url) return { connected: false, error: "COCKROACHDB_URL not configured" };

  try {
    const pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 2,
      connectionTimeoutMillis: 5000,
    });

    const tables = [
      "cockroach_leagues", "cockroach_teams", "cockroach_fixtures",
      "cockroach_predictions", "cockroach_xg_features", "cockroach_referee_profiles",
      "cockroach_injuries", "cockroach_league_models",
    ];

    const counts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const { rows } = await pool.query(`SELECT COUNT(*) as n FROM ${t}`);
        counts[t] = parseInt(rows[0].n);
      } catch {
        counts[t] = 0;
      }
    }

    // Check storage size
    let storageSize = 0;
    try {
      const { rows } = await pool.query(
        `SELECT SUM(range_size) as total FROM crdb_internal.ranges_no_leases`
      );
      storageSize = parseInt(rows[0]?.total || "0");
    } catch { /* ignore */ }

    await pool.end();

    return {
      connected: true,
      tables: counts,
      totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
      storageBytes: storageSize,
      storageMB: (storageSize / 1024 / 1024).toFixed(2),
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

  // Settled vs unsettled
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

    // Run both checks in parallel
    const [sbStats, crStats] = await Promise.all([
      getSupabaseStats(supabase),
      getCockroachStats(),
    ]);

    // Migration progress
    const sbPredictions = sbStats.tables.predictions || 0;
    const crPredictions = (crStats as any).tables?.cockroach_predictions || 0;
    const migrationProgress = sbPredictions > 0
      ? ((crPredictions / sbPredictions) * 100).toFixed(1)
      : "0";

    // Data ownership matrix
    const ownership = [
      { dataset: "Users & Auth", supabase: true, cockroachDB: false, sourceOfTruth: "Supabase" },
      { dataset: "Active Predictions", supabase: true, cockroachDB: false, sourceOfTruth: "Supabase" },
      { dataset: "Historical Predictions", supabase: true, cockroachDB: true, sourceOfTruth: "CockroachDB" },
      { dataset: "Historical Fixtures", supabase: true, cockroachDB: true, sourceOfTruth: "CockroachDB" },
      { dataset: "xG Features", supabase: false, cockroachDB: true, sourceOfTruth: "CockroachDB" },
      { dataset: "Referee Profiles", supabase: false, cockroachDB: true, sourceOfTruth: "CockroachDB" },
      { dataset: "Training Data", supabase: false, cockroachDB: true, sourceOfTruth: "CockroachDB" },
      { dataset: "League Models", supabase: false, cockroachDB: true, sourceOfTruth: "CockroachDB" },
      { dataset: "Odds Snapshots", supabase: true, cockroachDB: false, sourceOfTruth: "Supabase" },
      { dataset: "User Accumulators", supabase: true, cockroachDB: false, sourceOfTruth: "Supabase" },
    ];

    return successResponse({
      supabase: sbStats,
      cockroachDB: crStats,
      migration: {
        progress: `${migrationProgress}%`,
        sbPredictions,
        crPredictions,
        remaining: sbPredictions - crPredictions,
      },
      ownership,
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    console.error("GET /api/v1/admin/db-health error:", error);
    return internalError();
  }
}
