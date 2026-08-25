/**
 * POST /api/v1/cron/archive
 *
 * Archives settled predictions from predictions table to settlement_feed table.
 * Replaces Convex settlementFeed with Supabase-native realtime table.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) {
    console.error("[CRON] CRITICAL: VERCEL_CRON_SECRET not set");
    return false;
  }
  return authHeader === `Bearer ${cronSecret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );

    const body = await request.json().catch(() => ({}));
    const limit = body.limit || 500;

    // Get newly settled predictions
    const { data: settled } = await supabase
      .from("predictions")
      .select("id, fixture_id, market, selection, model_probability, model_version, result, settled_at, match_name")
      .not("result", "is", null)
      .neq("result", "pending")
      .order("settled_at", { ascending: false })
      .limit(limit);

    if (!settled || settled.length === 0) {
      return NextResponse.json({ archived: 0, message: "No settled predictions to archive" });
    }

    // Map to settlement_feed rows
    const rows = settled.map((p) => ({
      fixture_id: p.fixture_id || "",
      market: p.market,
      selection: p.selection,
      model_probability: p.model_probability || 0,
      model_version: p.model_version || "v5.1",
      result: p.result,
      match_name: p.match_name || null,
      settled_at: p.settled_at || new Date().toISOString(),
    }));

    // Delete existing feed and insert new (keeps feed fresh)
    await supabase.from("settlement_feed").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert in batches (trigger auto-trims to 500)
    const BATCH = 100;
    let archived = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase.from("settlement_feed").insert(batch);
      if (error) {
        console.error("[ARCHIVE] Batch error:", error.message);
        continue;
      }
      archived += batch.length;
    }

    return NextResponse.json({
      archived,
      total: settled.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[ARCHIVE] Error:", error.message);
    return NextResponse.json({ error: "Archive failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ready",
    endpoint: "POST /api/v1/cron/archive",
    description: "Archives settled predictions to Supabase settlement_feed",
  });
}
