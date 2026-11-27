/**
 * GET /api/v1/analytics/competition-gates
 *
 * Admin-only view of competition-specific model gating and drift status.
 * Read-only — recomputation happens in /api/v1/cron/learn (weekly).
 *
 * Query params:
 *   - type: "gates" | "drift" | "all"  (default "all")
 *   - verdict: filter gates by verdict (trusted|watch|exclude|insufficient)
 *   - drift_status: filter drift rows (stable|watch|drift_suspected|insufficient_data)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/api/utils";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "all";
    const verdict = searchParams.get("verdict");
    const driftStatus = searchParams.get("drift_status");

    const out: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
    };

    if (type === "all" || type === "gates") {
      let q = supabaseAdmin
        .from("league_model_gates")
        .select("*")
        .eq("market", "ALL")
        .order("computed_at", { ascending: false });
      if (verdict) q = q.eq("verdict", verdict);
      const { data, error } = await q.limit(500);
      if (error) {
        return NextResponse.json({ error: `league_model_gates: ${error.message}` }, { status: 500 });
      }
      // latest computed_at per league_key only
      const seen = new Set<string>();
      const latest = (data || []).filter((r: any) => {
        if (seen.has(r.league_key)) return false;
        seen.add(r.league_key);
        return true;
      });
      out.gates = latest;
      out.gateSummary = latest.reduce((acc: Record<string, number>, r: any) => {
        acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
        return acc;
      }, {});
    }

    if (type === "all" || type === "drift") {
      let q = supabaseAdmin
        .from("model_drift_status")
        .select("*")
        .order("computed_at", { ascending: false });
      if (driftStatus) q = q.eq("drift_status", driftStatus);
      const { data, error } = await q.limit(500);
      if (error) {
        return NextResponse.json({ error: `model_drift_status: ${error.message}` }, { status: 500 });
      }
      out.drift = data || [];
      out.driftSummary = (data || []).reduce((acc: Record<string, number>, r: any) => {
        acc[r.drift_status] = (acc[r.drift_status] ?? 0) + 1;
        return acc;
      }, {});
    }

    return NextResponse.json({ success: true, ...out });
  } catch (error: any) {
    console.error("[ANALYTICS/competition-gates]", error?.message);
    return NextResponse.json({ error: "Failed to load competition gates" }, { status: 500 });
  }
}
