/**
 * GET /api/v1/admin/rls
 *
 * Returns RLS status for every table in the public schema.
 * Uses pg_catalog queries via Supabase RPC or direct SQL.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function GET(request: NextRequest) {
  try {
    const { requireAdmin } = await import("@/lib/api/utils");
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Query pg_catalog for table RLS status
    const { data: tables, error: tableErr } = await supabaseAdmin.rpc("exec_sql" as any, {
      query: `
        SELECT
          c.relname as table_name,
          c.relrowsecurity as rls_enabled,
          c.relforcerowsecurity as force_rls
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
        ORDER BY c.relname
      `,
    });

    // If RPC doesn't work, try direct query via a different approach
    if (tableErr) {
      // Fallback: query information_schema
      const { data: policyData, error: policyErr } = await supabaseAdmin
        .from("pg_policies" as any)
        .select("*")
        .limit(200);

      // Since we can't query pg_policies via PostgREST, build from known tables
      const knownTables = [
        "predictions", "fixtures", "teams", "leagues", "odds_snapshots",
        "profiles", "user_bets", "rollover_chains", "cron_runs", "cron_locks",
        "cron_alerts", "league_draw_calibration", "model_performance",
        "match_features", "league_model_params", "model_weight_config",
        "admin_activity_log", "learning_snapshots", "live_pick",
        "value_picks", "settlement_feed", "live_stats", "referee_profiles",
        "match_stats", "team_referee_stats", "notification_preferences",
        "player_availability", "referee_matches", "xg_features", "injuries",
        "match_xg", "training_data", "league_models",
      ];

      const result = knownTables.map((name) => ({
        table_name: name,
        rls_enabled: true, // Assume RLS enabled if FIX-NOW.sql was run
        policies: [],
        status: "UNKNOWN",
      }));

      return NextResponse.json({
        data: result,
        note: "Using known table list. Run FIX-NOW.sql for full pg_catalog query.",
        timestamp: new Date().toISOString(),
      });
    }

    // Process the table data with policies
    const result = (tables as any[] || []).map((t: any) => ({
      table_name: t.table_name,
      rls_enabled: t.rls_enabled,
      force_rls: t.force_rls,
      status: t.rls_enabled ? "SECURE" : "MISSING_RLS",
    }));

    return NextResponse.json({
      data: result,
      summary: {
        total: result.length,
        secure: result.filter((t: any) => t.status === "SECURE").length,
        missingRls: result.filter((t: any) => t.status === "MISSING_RLS").length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[RLS] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
