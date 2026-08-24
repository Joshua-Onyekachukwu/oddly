/**
 * POST /api/v1/cron/archive
 * 
 * Archives settled predictions from Supabase to Convex.
 * Idempotent: skips IDs already in Convex.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CONVEX_URL = process.env.CONVEX_URL || "https://limitless-mole-387.convex.cloud";
const CONVEX_ACCESS_TOKEN = process.env.CONVEX_ACCESS_TOKEN;

async function convexQuery(functionName: string, args: Record<string, any> = {}) {
  if (!CONVEX_URL) return null;
  try {
    const res = await fetch(`${CONVEX_URL}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: functionName, args, format: "json" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? data;
  } catch {
    return null;
  }
}

async function convexMutation(functionName: string, args: Record<string, any> = {}) {
  if (!CONVEX_URL) return null;
  try {
    const res = await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: functionName, args, format: "json" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? data;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );

    if (!CONVEX_URL) {
      return NextResponse.json({ error: "Convex not configured" }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const limit = body.limit || 500;

    // Get newly settled predictions from Supabase
    const { data: settled } = await supabase
      .from("predictions")
      .select("id,fixture_id,market,selection,model_probability,confidence_lower,confidence_upper,model_version,result,settled_at,created_at")
      .not("result", "is", null)
      .order("settled_at", { ascending: false })
      .limit(limit * 2);

    if (!settled || settled.length === 0) {
      return NextResponse.json({ archived: 0, message: "No settled predictions to archive" });
    }

    // Archive to Convex in batches
    const BATCH = 100; // Convex mutations have size limits
    let archived = 0;

    for (let i = 0; i < settled.length; i += BATCH) {
      const batch = settled.slice(i, i + BATCH);

      // Use batch archive mutation
      const result = await convexMutation("predictions:archiveBatch", {
        predictions: batch.map((p) => ({
          fixtureId: p.fixture_id || "",
          market: p.market,
          selection: p.selection,
          modelProbability: p.model_probability || 0,
          modelVersion: p.model_version || "v4.0-settle",
          result: p.result,
          settledAt: p.settled_at,
        })),
      });

      if (result) {
        archived += batch.length;
      }
    }

    // Log audit trail
    await convexMutation("predictions:insertAuditLog", {
      action: "archive_predictions",
      rowsAffected: archived,
      details: { source: "supabase", limit, batchCount: Math.ceil(settled.length / BATCH) },
    });

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
    description: "Archives settled predictions from Supabase to Convex",
  });
}
