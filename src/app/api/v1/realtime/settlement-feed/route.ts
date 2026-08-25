import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/v1/realtime/settlement-feed
 * Add settlements to the feed (replaces Convex addSettlement/addSettlementBatch).
 * Auto-caps at 500 rows via trigger.
 *
 * Body: { settlements: [{ fixtureId, market, selection, modelProbability,
 *         modelVersion, result, settledAt, matchName }] }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
    if (!auth || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const settlements = body.settlements || [body]; // Support single or batch
    if (settlements.length === 0) {
      return NextResponse.json({ ok: true, count: 0 });
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const rows = settlements.map((s: any) => ({
      fixture_id: s.fixtureId,
      market: s.market,
      selection: s.selection,
      model_probability: s.modelProbability,
      model_version: s.modelVersion || "v5.1",
      result: s.result,
      match_name: s.matchName || null,
      settled_at: s.settledAt || new Date().toISOString(),
    }));

    // Insert in batches (trigger auto-trims to 500)
    const batchSize = 100;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await sb.from("settlement_feed").insert(batch);
      if (error) {
        console.error("[Realtime] settlement_feed batch error:", error.message);
        continue;
      }
      inserted += batch.length;
    }

    return NextResponse.json({ ok: true, count: inserted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
