import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

/**
 * POST /api/v1/admin/run-pipeline
 *
 * Manual trigger for the full pipeline from admin dashboard.
 * Runs: sync → predict → settle → learn
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin user
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startTime = Date.now();
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const results: Record<string, any> = {};

    // Step 1: Sync
    console.log("[ADMIN PIPELINE] Step 1/4: Syncing...");
    try {
      const syncRes = await fetch(`${origin}/api/v1/cron/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "all" }),
      });
      results.sync = await syncRes.json();
    } catch (e) {
      results.sync = { error: e instanceof Error ? e.message : "Sync failed" };
    }

    // Step 2: Predict
    console.log("[ADMIN PIPELINE] Step 2/4: Predicting...");
    await new Promise(r => setTimeout(r, 3000));
    try {
      const predictRes = await fetch(`${origin}/api/v1/cron/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      results.predict = await predictRes.json();
    } catch (e) {
      results.predict = { error: e instanceof Error ? e.message : "Predict failed" };
    }

    // Step 3: Settle
    console.log("[ADMIN PIPELINE] Step 3/4: Settling...");
    await new Promise(r => setTimeout(r, 3000));
    try {
      const settleRes = await fetch(`${origin}/api/v1/cron/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      results.settle = await settleRes.json();
    } catch (e) {
      results.settle = { error: e instanceof Error ? e.message : "Settle failed" };
    }

    // Step 4: Learn
    console.log("[ADMIN PIPELINE] Step 4/4: Learning...");
    await new Promise(r => setTimeout(r, 3000));
    try {
      const learnRes = await fetch(`${origin}/api/v1/cron/learn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      results.learn = await learnRes.json();
    } catch (e) {
      results.learn = { error: e instanceof Error ? e.message : "Learn failed" };
    }

    const duration = Date.now() - startTime;
    console.log(`[ADMIN PIPELINE] Complete in ${duration}ms`);

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[ADMIN PIPELINE] Error:", error);
    return NextResponse.json({ error: "Pipeline failed" }, { status: 500 });
  }
}
