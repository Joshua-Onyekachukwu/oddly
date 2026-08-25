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

/**
 * Scan known API routes for auth coverage
 */
async function scanAuthCoverage(): Promise<RouteAuthStatus[]> {
  const routes: RouteAuthStatus[] = [
    // Cron routes
    { path: "/api/v1/cron/pipeline", method: "GET", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/settle", method: "POST", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/predict", method: "POST", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/sync", method: "POST", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/daily", method: "POST", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/learn", method: "POST", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/archive", method: "POST", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },
    { path: "/api/v1/cron/cleanup", method: "POST", hasAuth: true, authType: "VERCEL_CRON_SECRET", rateLimited: false },

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
    { path: "/api/v1/analytics", method: "GET", hasAuth: false, authType: "none", rateLimited: false },
  ];
  return routes;
}

/**
 * Get RLS status from the database
 */
async function getRLSStatus() {
  try {
    const { data, error } = await supabaseAdmin.rpc("check_rls_status" as any);
    if (error) {
      // Fallback: query pg_tables directly
      const { data: tables } = await supabaseAdmin
        .from("pg_tables" as any)
        .select("tablename")
        .eq("schemaname", "public");
      return { tables: tables || [], source: "pg_tables (fallback)" };
    }
    return { tables: data || [], source: "check_rls_status()" };
  } catch {
    return { tables: [], source: "unavailable" };
  }
}

/**
 * Get policy count per table
 */
async function getPolicyCounts() {
  try {
    // Query information_schema for policies
    const { data, error } = await supabaseAdmin.rpc("check_rls_status" as any);
    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}

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
    const [authCoverage, rlsStatus, policyCounts] = await Promise.all([
      scanAuthCoverage(),
      getRLSStatus(),
      getPolicyCounts(),
    ]);

    // Count stats
    const totalRoutes = authCoverage.length;
    const authedRoutes = authCoverage.filter((r) => r.hasAuth).length;
    const unauthedRoutes = authCoverage.filter((r) => !r.hasAuth);
    const rateLimitedRoutes = authCoverage.filter((r) => r.rateLimited).length;

    // RLS stats
    const totalTables = (policyCounts as any[]).length || 0;
    const tablesWithRLS = (policyCounts as any[]).filter((t: any) => t.rls_enabled).length;
    const tablesWithoutRLS = (policyCounts as any[]).filter((t: any) => !t.rls_enabled);

    // Security score
    const authScore = totalRoutes > 0 ? Math.round((authedRoutes / totalRoutes) * 100) : 0;
    const rlsScore = totalTables > 0 ? Math.round((tablesWithRLS / totalTables) * 100) : 0;
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
        tablesWithRLS,
        tablesWithoutRLS: tablesWithoutRLS.length,
      },
      authCoverage,
      unauthedRoutes,
      rlsPolicies: policyCounts,
      tablesWithoutRLS: tablesWithoutRLS.map((t: any) => t.table_name),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[SECURITY] Error:", error.message);
    return NextResponse.json({ error: "Security audit failed" }, { status: 500 });
  }
}
