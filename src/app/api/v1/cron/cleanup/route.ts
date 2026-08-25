import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Verify the request is from Vercel Cron or an authorized caller.
 */
function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) { console.error('[CRON] CRITICAL: VERCEL_CRON_SECRET not set — cron auth disabled'); return false; }
  if (authHeader === `Bearer ${cronSecret}`) return true;
  return false;
}

interface CleanupResult {
  table: string;
  deleted: number;
  error?: string;
}

/**
 * Run all cleanup tasks and return results.
 */
async function runCleanup(): Promise<{
  success: boolean;
  results: CleanupResult[];
  duration: string;
  totalDeleted: number;
  timestamp: string;
}> {
  const startTime = Date.now();
  const results: CleanupResult[] = [];

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Delete notifications older than 30 days
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("notifications")
      .delete({ count: "exact" })
      .lt("created_at", thirtyDaysAgo);
    results.push({ table: "notifications (>30d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "notifications (>30d)", deleted: 0, error: String(e) });
  }

  // 2. Delete read notifications older than 7 days
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("notifications")
      .delete({ count: "exact" })
      .eq("is_read", true)
      .lt("created_at", sevenDaysAgo);
    results.push({ table: "notifications (read >7d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "notifications (read >7d)", deleted: 0, error: String(e) });
  }

  // 3. Delete old odds snapshots (keep last 14 days per fixture)
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("odds_snapshots")
      .delete({ count: "exact" })
      .lt("snapshot_time", fourteenDaysAgo);
    results.push({ table: "odds_snapshots (>14d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "odds_snapshots (>14d)", deleted: 0, error: String(e) });
  }

  // 4. Delete expired predictions (fixtures that already finished, older than 7 days)
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("predictions")
      .delete({ count: "exact" })
      .lt("created_at", sevenDaysAgo);
    results.push({ table: "predictions (>7d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "predictions (>7d)", deleted: 0, error: String(e) });
  }

  // 5. Delete old recommendations (keep 30 days)
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("recommendations")
      .delete({ count: "exact" })
      .lt("created_at", thirtyDaysAgo);
    results.push({ table: "recommendations (>30d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "recommendations (>30d)", deleted: 0, error: String(e) });
  }

  // 6. Delete expired AI cache entries (older than 24 hours)
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("ai_cache")
      .delete({ count: "exact" })
      .lt("created_at", oneDayAgo);
    results.push({ table: "ai_cache (>24h)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "ai_cache (>24h)", deleted: 0, error: String(e) });
  }

  // 7. Delete old admin activity logs (keep 90 days)
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("admin_activity_log")
      .delete({ count: "exact" })
      .lt("created_at", ninetyDaysAgo);
    results.push({ table: "admin_activity_log (>90d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "admin_activity_log (>90d)", deleted: 0, error: String(e) });
  }

  // 8. Delete old training logs (keep 60 days)
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("training_log")
      .delete({ count: "exact" })
      .lt("created_at", sixtyDaysAgo);
    results.push({ table: "training_log (>60d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "training_log (>60d)", deleted: 0, error: String(e) });
  }

  // 9. Delete old model performance records (keep 90 days)
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("model_performance")
      .delete({ count: "exact" })
      .lt("created_at", ninetyDaysAgo);
    results.push({ table: "model_performance (>90d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "model_performance (>90d)", deleted: 0, error: String(e) });
  }

  // 10. Delete finished fixtures older than 30 days (cascade will clean bets/picks)
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("fixtures")
      .delete({ count: "exact" })
      .in("status", ["finished", "cancelled", "postponed"])
      .lt("kickoff_time", thirtyDaysAgo);
    results.push({ table: "fixtures (finished >30d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "fixtures (finished >30d)", deleted: 0, error: String(e) });
  }

  // 11. Delete expired rollover chains (older than 30 days, not active)
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("rollover_chains")
      .delete({ count: "exact" })
      .in("status", ["completed", "broken"])
      .lt("updated_at", thirtyDaysAgo);
    results.push({ table: "rollover_chains (inactive >30d)", deleted: count || 0 });
  } catch (e) {
    results.push({ table: "rollover_chains (inactive >30d)", deleted: 0, error: String(e) });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  const duration = `${Date.now() - startTime}ms`;

  return {
    success: true,
    results,
    duration,
    totalDeleted,
    timestamp: new Date().toISOString(),
  };
}

/**
 * GET /api/v1/cron/cleanup
 *
 * Called by Vercel Cron (daily at 03:00 UTC).
 * Cleans up old notifications, expired predictions, stale odds, and other data.
 */
export async function GET(request: NextRequest) {
  try {
    if (isAuthorizedCron(request)) {
      const authHeader = request.headers.get("authorization");
      const cronSecret = process.env.VERCEL_CRON_SECRET;

      if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        console.log("[CRON] Starting daily cleanup...");
        const result = await runCleanup();
        console.log(`[CRON] Cleanup completed in ${result.duration} — ${result.totalDeleted} rows deleted`);
        return NextResponse.json(result);
      }
    }

    // Status check
    return NextResponse.json({
      status: "ready",
      schedule: "Daily at 03:00 UTC",
      description: "Purges old notifications, expired predictions, stale odds, and finished fixtures",
      retention: {
        "notifications (>30d read >7d)": "30 / 7 days",
        "odds_snapshots": "14 days",
        "predictions": "7 days",
        "recommendations": "30 days",
        "ai_cache": "24 hours",
        "admin_activity_log": "90 days",
        "training_log": "60 days",
        "model_performance": "90 days",
        "fixtures (finished)": "30 days",
        "rollover_chains (inactive)": "30 days",
      },
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/cron/cleanup
 *
 * Manual trigger from admin dashboard.
 */
export async function POST(request: NextRequest) {
  try {
    console.log("[MANUAL] Cleanup triggered");
    const result = await runCleanup();
    console.log(`[MANUAL] Cleanup completed in ${result.duration} — ${result.totalDeleted} rows deleted`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Cleanup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
