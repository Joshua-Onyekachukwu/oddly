import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/utils";

/**
 * Verify the request is from Vercel Cron or an authorized caller.
 */
function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  // SECURITY: Never allow all requests when secret is not set
  if (!cronSecret) {
    console.error('[CRON] CRITICAL: VERCEL_CRON_SECRET not set — cron auth disabled');
    return false;
  }
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Call an internal API endpoint with optional cron auth.
 */
async function callInternal(
  path: string,
  method: string = "GET",
  body?: Record<string, unknown>
): Promise<{ success: boolean; data: unknown; duration: string }> {
  const start = Date.now();
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add cron secret for internal calls
    const cronSecret = process.env.VERCEL_CRON_SECRET;
    if (cronSecret) {
      headers["Authorization"] = `Bearer ${cronSecret}`;
    }

    const res = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json();
    const duration = `${Date.now() - start}ms`;

    return { success: res.ok, data, duration };
  } catch (error) {
    const duration = `${Date.now() - start}ms`;
    return {
      success: false,
      data: { error: error instanceof Error ? error.message : "Unknown error" },
      duration,
    };
  }
}

/**
 * GET /api/v1/cron/daily
 *
 * Unified daily cron job for Vercel Hobby plan (only 1 cron allowed).
 * Runs all three jobs in sequence: sync → predict → cleanup.
 *
 * Vercel sends this at 06:00 UTC every day.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[DAILY CRON] Starting daily pipeline...");
    const startTime = Date.now();
    const results: Record<string, unknown> = {};

    // Step 1: Sync fixtures and odds
    console.log("[DAILY CRON] Step 1/5: Syncing fixtures and odds...");
    const syncResult = await callInternal("/api/v1/cron/sync", "POST", { type: "all" });
    results.sync = syncResult;
    console.log(`[DAILY CRON] Sync completed in ${syncResult.duration}`);

    // Step 2: Generate predictions
    console.log("[DAILY CRON] Step 2/5: Generating predictions...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const predictResult = await callInternal("/api/v1/cron/predict", "POST");
    results.predict = predictResult;
    console.log(`[DAILY CRON] Predict completed in ${predictResult.duration}`);

    // Step 3: Settle finished matches
    console.log("[DAILY CRON] Step 3/5: Settling finished matches...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const settleResult = await callInternal("/api/v1/cron/settle", "POST");
    results.settle = settleResult;
    console.log(`[DAILY CRON] Settle completed in ${settleResult.duration}`);

    // Step 4: Learn from results
    console.log("[DAILY CRON] Step 4/5: Learning from results...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const learnResult = await callInternal("/api/v1/cron/learn", "POST");
    results.learn = learnResult;
    console.log(`[DAILY CRON] Learn completed in ${learnResult.duration}`);

    // Step 5: Refresh materialized views (reduces Disk IO)
    console.log("[DAILY CRON] Step 5/6: Refreshing materialized views...");
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        process.env.SUPABASE_SERVICE_ROLE_KEY || ""
      );
      const start = Date.now();
      await admin.rpc("refresh_analytics_views");
      const dur = Date.now() - start;
      results.refreshViews = { success: true, duration: `${dur}ms` };
      console.log(`[DAILY CRON] Views refreshed in ${dur}ms`);
    } catch (err: any) {
      results.refreshViews = { success: false, error: err.message };
      console.error(`[DAILY CRON] View refresh failed (non-blocking):`, err.message);
    }

    // Step 6: Cleanup old data
    console.log("[DAILY CRON] Step 6/6: Cleaning up old data...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const cleanupResult = await callInternal("/api/v1/cron/cleanup", "POST");
    results.cleanup = cleanupResult;
    console.log(`[DAILY CRON] Cleanup completed in ${cleanupResult.duration}`);

    const totalDuration = `${Date.now() - startTime}ms`;
    console.log(`[DAILY CRON] All steps completed in ${totalDuration}`);

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[DAILY CRON] Error:", error);
    return NextResponse.json(
      { error: "Daily cron failed" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/cron/daily
 *
 * Manual trigger from admin dashboard.
 */
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require admin for manual pipeline trigger
    await requireAdmin(request);
    
    console.log("[MANUAL] Daily pipeline triggered");
    const startTime = Date.now();
    const results: Record<string, unknown> = {};

    // Step 1: Sync
    console.log("[MANUAL] Step 1/3: Syncing...");
    const syncResult = await callInternal("/api/v1/cron/sync", "POST", { type: "all" });
    results.sync = syncResult;

    // Step 2: Predict
    console.log("[MANUAL] Step 2/3: Predicting...");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const predictResult = await callInternal("/api/v1/cron/predict", "POST");
    results.predict = predictResult;

    // Step 3: Cleanup
    console.log("[MANUAL] Step 3/3: Cleaning up...");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const cleanupResult = await callInternal("/api/v1/cron/cleanup", "POST");
    results.cleanup = cleanupResult;

    const totalDuration = `${Date.now() - startTime}ms`;
    console.log(`[MANUAL] Pipeline completed in ${totalDuration}`);

    return NextResponse.json({
      success: true,
      duration: totalDuration,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[MANUAL] Pipeline error:", error);
    return NextResponse.json(
      { error: "Pipeline failed" },
      { status: 500 }
    );
  }
}
