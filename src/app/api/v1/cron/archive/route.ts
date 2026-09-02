/**
 * POST /api/v1/cron/archive
 *
 * Archives settled predictions from predictions table to settlement_feed table.
 * Replaces Convex settlementFeed with Supabase-native realtime table.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withLock } from "@/lib/cron/lock";
import { startRun, completeRun, type CronRunResult } from "@/lib/cron/logger";

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

async function runArchive(limit: number = 500): Promise<{ archived: number; total: number }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  );

  // Get newly settled predictions
  const { data: settled } = await supabase
    .from("predictions")
    .select("id, fixture_id, market, selection, model_probability, model_version, result, settled_at, match_name")
    .not("result", "is", null)
    .neq("result", "pending")
    .order("settled_at", { ascending: false })
    .limit(limit);

  if (!settled || settled.length === 0) {
    return { archived: 0, total: 0 };
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

  return { archived, total: settled.length };
}

export async function POST(request: NextRequest) {
  try {
    const { requireAdmin } = await import("@/lib/api/utils");
    await requireAdmin(request);

    const body = await request.json().catch(() => ({}));
    const limit = body.limit || 500;

    const executionId = await startRun("archive", "manual");
    const lockResult = await withLock("archive", () => runArchive(limit), { leaseSeconds: 300 });

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, { status: "FAILED", errorMessage: lockResult.error, durationMs: lockResult.durationMs });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result!;
    await completeRun(executionId, {
      status: "SUCCESS",
      recordsCreated: result.archived,
      durationMs: lockResult.durationMs,
    });

    return NextResponse.json({
      archived: result.archived,
      total: result.total,
      duration: `${lockResult.durationMs}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[ARCHIVE] Error:", error.message);
    return NextResponse.json({ error: "Archive failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const executionId = await startRun("archive", "cron");
    const lockResult = await withLock("archive", () => runArchive(), { leaseSeconds: 300 });

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, { status: "FAILED", errorMessage: lockResult.error, durationMs: lockResult.durationMs });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result!;
    await completeRun(executionId, {
      status: "SUCCESS",
      recordsCreated: result.archived,
      durationMs: lockResult.durationMs,
    });

    return NextResponse.json({
      archived: result.archived,
      total: result.total,
      duration: `${lockResult.durationMs}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[ARCHIVE] Error:", error.message);
    return NextResponse.json({ error: "Archive failed" }, { status: 500 });
  }
}
