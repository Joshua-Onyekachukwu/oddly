import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/v1/realtime/value-picks
 * Replace all value picks (replaces Convex upsertValuePicks mutation).
 *
 * Body: { picks: [{ fixtureId, matchName, market, selection, modelProb,
 *         bookmakerOdds, impliedProb, edge, ev, tier }] }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET;
    if (!auth || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const picks = body.picks || [];
    if (picks.length === 0) {
      return NextResponse.json({ ok: true, count: 0 });
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Clear old picks (triggers will also cap at 500)
    await sb.from("value_picks").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert new picks in batches
    const batchSize = 100;
    let inserted = 0;
    for (let i = 0; i < picks.length; i += batchSize) {
      const batch = picks.slice(i, i + batchSize).map((p: any) => ({
        fixture_id: p.fixtureId || null,
        match_name: p.matchName || null,
        market: p.market,
        selection: p.selection,
        model_prob: p.modelProb,
        bookmaker_odds: p.bookmakerOdds || null,
        implied_prob: p.impliedProb || null,
        edge: p.edge || null,
        ev: p.ev || null,
        tier: p.tier || "MEDIUM",
      }));

      const { error } = await sb.from("value_picks").insert(batch);
      if (error) {
        console.error("[Realtime] value_picks batch error:", error.message);
        continue;
      }
      inserted += batch.length;
    }

    return NextResponse.json({ ok: true, count: inserted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
