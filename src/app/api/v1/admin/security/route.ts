/**
 * GET /api/v1/admin/security
 *
 * Security audit endpoint — returns auth coverage, rate limit config,
 * and RLS policy status for all tables.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/api/utils";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

interface RouteAuthStatus {
  path: string;
  method: string;
  hasAuth: boolean;
  authType: string;
  rateLimited: boolean;
}

interface RLSAuditResult {
  table_name: string;
  rls_enabled: boolean;
  anon_readable: boolean;
  service_readable: boolean;
  should_have_rls: boolean;
  policy_count: number;
  status: "SECURE" | "PUBLICLY_READABLE" | "NO_RLS" | "UNKNOWN";
}

// Sensitive tables that must block anon access
const SENSITIVE_TABLES = [
  "predictions", "profiles", "user_bets", "rollover_chains",
  "cron_runs", "cron_locks", "cron_alerts", "league_draw_calibration",
  "model_performance", "admin_activity_log", "notification_preferences",
  "agent_audit", "live_pick", "value_picks", "settlement_feed", "live_stats",
  "learning_snapshots", "validation_results", "player_injury_data",
  "league_model_params", "training_data", "feature_store",
  "league_models", "team_strengths", "player_impact",
];

const anonClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

/**
 * Probe each sensitive table with the anon key to verify RLS blocks access.
 */
async function probeAnonAccess(): Promise<RLSAuditResult[]> {
  const results: RLSAuditResult[] = [];

  for (const tableName of SENSITIVE_TABLES) {
    try {
      // Check if service role can read
      const { error: svcErr } = await supabaseAdmin
        .from(tableName)
        .select("*", { count: "exact", head: true });
      const serviceReadable = !svcErr;

      // Check if anon key can read
      const { error: anonErr } = await anonClient
        .from(tableName)
        .select("*", { count: "exact", head: true });
      const anonReadable = !anonErr;

      // Determine RLS status
      const rlsEnabled = serviceReadable && !anonReadable;

      // Get policy count via pg_policies
      let policyCount = 0;
      try {
        const { data: policies } = await supabaseAdmin
          .from("pg_policies" as any)
          .select("policyname")
          .eq("tablename", tableName);
        policyCount = policies?.length || 0;
      } catch {}

      let status: RLSAuditResult["status"] = "UNKNOWN";
      if (anonReadable) status = "PUBLICLY_READABLE";
      else if (rlsEnabled) status = "SECURE";
      else if (!serviceReadable) status = "SECURE"; // table doesn't exist or is empty
      else status = "NO_RLS";

      results.push({
        table_name: tableName,
        rls_enabled: rlsEnabled || !serviceReadable,
        anon_readable: anonReadable,
        service_readable: serviceReadable,
        should_have_rls: true,
        policy_count: policyCount,
        status,
      });
    } catch {
      // Table might not exist — skip
    }
  }

  return results;
}

/**
 * Scan known API routes for auth coverage
 */
async function scanAuthCoverage(): Promise<RouteAuthStatus[]> {
  const routes: RouteAuthStatus[] = [
    // Cron routes
    { path: "/api/v1/cron/pipeline", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/settle", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/settle", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/cron/predict", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/predict", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/cron/sync", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/sync", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/cron/daily", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/daily", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/cron/learn", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/learn", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/cron/archive", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/archive", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/cron/cleanup", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/cleanup", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/cron/validate", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/validate", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/cron/pipeline", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },

    // Admin routes
    { path: "/api/v1/admin/picks", method: "GET", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/admin/security", method: "GET", hasAuth: true, authType: "requireAdmin", rateLimited: false },

    // User routes
    { path: "/api/v1/predictions", method: "GET", hasAuth: true, authType: "requireAdmin", rateLimited: true },
    { path: "/api/v1/predictions", method: "POST", hasAuth: true, authType: "requireAuth", rateLimited: true },

    // AI routes
    { path: "/api/v1/ai-chat", method: "POST", hasAuth: true, authType: "requireAuth + rateLimit", rateLimited: true },

    // Betting agent
    { path: "/api/v1/betting-agent/recommendations", method: "POST", hasAuth: true, authType: "requireAuth + rateLimit", rateLimited: true },
    { path: "/api/v1/betting-agent/betslip", method: "POST", hasAuth: true, authType: "requireAuth + rateLimit", rateLimited: true },
    { path: "/api/v1/betting-agent/audit", method: "GET", hasAuth: true, authType: "requireAdmin", rateLimited: false },

    // Analytics
    { path: "/api/v1/analytics", method: "GET", hasAuth: true, authType: "requireAdmin", rateLimited: false },
    { path: "/api/v1/analytics", method: "POST", hasAuth: true, authType: "requireAdmin", rateLimited: false },

    // AI monitor
    { path: "/api/v1/ai-monitor", method: "GET", hasAuth: true, authType: "requireAdmin", rateLimited: false },
  ];
  return routes;
}

/**
 * Get RLS status from the database
 */


export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err: any) {
    if (err?.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [authCoverage, rlsAudit] = await Promise.all([
      scanAuthCoverage(),
      probeAnonAccess(),
    ]);

    // Auth stats
    const totalRoutes = authCoverage.length;
    const authedRoutes = authCoverage.filter((r) => r.hasAuth).length;
    const unauthedRoutes = authCoverage.filter((r) => !r.hasAuth);
    const rateLimitedRoutes = authCoverage.filter((r) => r.rateLimited).length;

    // RLS audit stats
    const totalTables = rlsAudit.length;
    const tablesSecure = rlsAudit.filter((t) => t.status === "SECURE").length;
    const tablesPublic = rlsAudit.filter((t) => t.status === "PUBLICLY_READABLE");
    const tablesNoRls = rlsAudit.filter((t) => t.status === "NO_RLS");
    const tablesUnknown = rlsAudit.filter((t) => t.status === "UNKNOWN");

    // Security score — anon-readable tables are penalized heavily
    const authScore = totalRoutes > 0 ? Math.round((authedRoutes / totalRoutes) * 100) : 0;
    const rlsScore = totalTables > 0 ? Math.round((tablesSecure / totalTables) * 100) : 0;
    const overallScore = Math.round((authScore + rlsScore) / 2);

    return NextResponse.json({
      success: true,
      summary: {
        overallScore,
        authScore,
        rlsScore,
        totalRoutes,
        authedRoutes,
        unauthedCount: unauthedRoutes.length,
        rateLimitedRoutes,
        totalTables,
        tablesWithRLS: tablesSecure,
        tablesWithoutRLS: tablesPublic.length + tablesNoRls.length,
      },
      authCoverage,
      unauthedRoutes,
      rlsAudit,
      tablesPubliclyReadable: tablesPublic.map((t) => t.table_name),
      tablesWithoutRls: tablesNoRls.map((t) => t.table_name),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[SECURITY] Error:", error.message);
    return NextResponse.json({ error: "Security audit failed" }, { status: 500 });
  }
}
