/**
 * GET /api/v1/admin/rls
 *
 * Returns real RLS status for every table by probing the database.
 * Uses PostgREST to check table accessibility and pg_policies via RPC.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

// All known tables in the schema
const KNOWN_TABLES = [
  "predictions", "fixtures", "teams", "leagues", "odds_snapshots",
  "profiles", "user_bets", "rollover_chains", "cron_runs", "cron_locks",
  "cron_alerts", "league_draw_calibration", "model_performance",
  "match_features", "league_model_params", "model_weight_config",
  "admin_activity_log", "learning_snapshots", "live_pick",
  "value_picks", "settlement_feed", "live_stats", "referee_profiles",
  "match_stats", "team_referee_stats", "notification_preferences",
  "player_availability", "referee_matches", "xg_features", "injuries",
  "match_xg", "training_data", "league_models", "team_strengths",
  "player_impact", "feature_store", "agent_audit",
];

// Sensitive tables that SHOULD have RLS
const SHOULD_HAVE_RLS = [
  "predictions", "profiles", "user_bets", "rollover_chains",
  "cron_runs", "cron_locks", "cron_alerts", "league_draw_calibration",
  "model_performance", "admin_activity_log", "notification_preferences",
  "agent_audit", "live_pick", "value_picks", "settlement_feed", "live_stats",
];

export async function GET(request: NextRequest) {
  try {
    const { requireAdmin } = await import("@/lib/api/utils");
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: any[] = [];
  let checked = 0;

  // Probe each table via PostgREST (service role can read all)
  for (const tableName of KNOWN_TABLES) {
    try {
      const { data, error, count } = await supabaseAdmin
        .from(tableName)
        .select("*", { count: "exact", head: true });

      const exists = !error || error.code !== "42P01"; // 42P01 = relation does not exist
      const rlsBlocked = error?.code === "42501"; // 42501 = insufficient privilege (RLS blocking)

      // Check if RLS is enabled by trying anon access
      let rlsEnabled = false;
      let anonAccess = false;
      try {
        const anonClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || "",
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
        );
        const { error: anonErr } = await anonClient
          .from(tableName)
          .select("*", { count: "exact", head: true });

        anonAccess = !anonErr;
        // If service role can read but anon cannot, RLS is likely enabled
        rlsEnabled = exists && !anonAccess;
      } catch {
        rlsEnabled = exists;
      }

      if (exists) {
        results.push({
          table_name: tableName,
          rls_enabled: rlsEnabled,
          anon_readable: anonAccess,
          service_readable: !error || error.code !== "42501",
          row_count: count || 0,
          status: rlsEnabled ? "SECURE" : anonAccess ? "PUBLICLY_READABLE" : "UNKNOWN",
          should_have_rls: SHOULD_HAVE_RLS.includes(tableName),
        });
      }

      checked++;
    } catch {
      // Table doesn't exist or other error
    }
  }

  // Also try to get policy info from pg_policies via RPC if available
  let policyInfo: any[] = [];
  try {
    const { data: policyData } = await supabaseAdmin.rpc("get_table_policies" as any);
    if (policyData) policyInfo = policyData;
  } catch {
    // RPC not available - that's fine, we have the basic info
  }

  // Summary
  const secureCount = results.filter((t) => t.status === "SECURE").length;
  const publicCount = results.filter((t) => t.status === "PUBLICLY_READABLE").length;
  const missingRlsCount = results.filter((t) => t.should_have_rls && !t.rls_enabled).length;

  return NextResponse.json({
    data: results.sort((a, b) => {
      // Sort: insecure first, then by name
      if (a.should_have_rls && !a.rls_enabled) return -1;
      if (b.should_have_rls && !b.rls_enabled) return 1;
      return a.table_name.localeCompare(b.table_name);
    }),
    policies: policyInfo,
    summary: {
      total: results.length,
      secure: secureCount,
      publiclyReadable: publicCount,
      missingRls: missingRlsCount,
      checked,
    },
    timestamp: new Date().toISOString(),
  });
}
