/**
 * POST /api/v1/cron/archive
 * 
 * Archives settled predictions from Supabase to CockroachDB.
 * Idempotent: skips IDs already in CockroachDB.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function loadCockroach() {
  const url = process.env.COCKROACHDB_URL;
  if (!url) return null;
  
  const { Pool } = require("pg");
  return new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 5000,
  });
}

function esc(v: any): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );

    const cockroach = loadCockroach();
    if (!cockroach) {
      return NextResponse.json({ error: "CockroachDB not configured" }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const limit = body.limit || 500;

    // Get IDs already in CockroachDB
    const { rows: existing } = await cockroach.query("SELECT id FROM cockroach_predictions");
    const existingIds = new Set(existing.map((r: any) => r.id));

    // Get newly settled predictions from Supabase
    const { data: settled } = await supabase
      .from("predictions")
      .select("id,fixture_id,market,selection,model_probability,confidence_lower,confidence_upper,model_version,result,settled_at,created_at")
      .not("result", "is", null)
      .order("settled_at", { ascending: false })
      .limit(limit * 2);

    if (!settled || settled.length === 0) {
      await cockroach.end();
      return NextResponse.json({ archived: 0, message: "No settled predictions to archive" });
    }

    // Filter out already archived
    const newRows = settled.filter((p) => !existingIds.has(p.id));

    if (newRows.length === 0) {
      await cockroach.end();
      return NextResponse.json({ archived: 0, message: "All already archived" });
    }

    // Batch insert
    const BATCH = 200;
    let archived = 0;

    for (let i = 0; i < newRows.length; i += BATCH) {
      const batch = newRows.slice(i, i + BATCH);
      const values = batch
        .map(
          (p) =>
            "(" +
            [
              esc(p.id),
              esc(p.fixture_id),
              esc(p.market),
              esc(p.selection),
              p.model_probability || 0,
              p.confidence_lower || 0,
              p.confidence_upper || 0,
              esc(p.model_version || "v5.1"),
              esc(p.result),
              esc(p.settled_at),
              esc(p.created_at),
            ].join(",") +
            ")"
        )
        .join(",");

      try {
        await cockroach.query(
          "INSERT INTO cockroach_predictions (id,fixture_id,market,selection,model_probability,confidence_lower,confidence_upper,model_version,result,settled_at,created_at) VALUES " +
            values
        );
        archived += batch.length;
      } catch (e: any) {
        console.error("[ARCHIVE] Batch error:", e.message?.slice(0, 80));
      }
    }

    await cockroach.end();

    return NextResponse.json({
      archived,
      total: newRows.length,
      skipped: newRows.length - archived,
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
    description: "Archives settled predictions from Supabase to CockroachDB",
  });
}
