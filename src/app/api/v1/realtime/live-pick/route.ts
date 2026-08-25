import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/v1/realtime/live-pick
 * Upsert the current live pick (replaces Convex upsertLivePick mutation).
 *
 * Body: { fixtureId, matchName, market, selection, probability, odds, edge,
 *         compositeScore, confidenceTier, decision, clvSignal, leagueName, kickoffTime }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
    if (!auth || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Delete existing live picks, insert new one
    await sb.from("live_pick").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const { error } = await sb.from("live_pick").insert({
      fixture_id: body.fixtureId,
      match_name: body.matchName,
      market: body.market,
      selection: body.selection,
      probability: body.probability,
      odds: body.odds,
      edge: body.edge,
      composite_score: body.compositeScore,
      confidence_tier: body.confidenceTier,
      decision: body.decision,
      clv_signal: body.clvSignal || null,
      league_name: body.leagueName || null,
      kickoff_time: body.kickoffTime,
      decided_at: body.decidedAt || new Date().toISOString(),
    });

    if (error) {
      console.error("[Realtime] live_pick insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
