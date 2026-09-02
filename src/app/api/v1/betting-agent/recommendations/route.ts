/**
 * POST /api/v1/betting-agent/recommendations
 *
 * AI Betting Agent — finds value across upcoming matches and returns recommendations.
 *
 * Body:
 *   - league?: string (UUID) — filter by league
 *   - days?: number (1-7) — look-ahead window (default: 3)
 *   - minEdge?: number (0-1) — minimum edge threshold (default: 0.03)
 *   - limit?: number (1-100) — max recommendations (default: 20)
 *   - bookmaker?: string — target bookmaker (default: "sportybet")
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireAuth, checkRateLimit, addRateLimitHeaders } from "@/lib/api/utils";
import { RATE_LIMITS } from "@/lib/api/rate-limits";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Shared env loader for worker-like access
function getEnv() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}

function clamp(v: number, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require authentication
    const auth = await requireAuth(request);

    // Rate limit: 10 requests per minute per user
    const rl = checkRateLimit(
      `user:${auth.user.id}:betting-agent-recommendations`,
      request,
      RATE_LIMITS.bettingAgent.recommendations.limit,
      RATE_LIMITS.bettingAgent.recommendations.windowMs
    );
    if (!rl.allowed) {
      return addRateLimitHeaders(
        NextResponse.json({ error: "Rate limit exceeded. Try again in a minute." }, { status: 429 }),
        rl.remaining,
        rl.resetAt
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is fine
    }

    const league = body.league as string | undefined;
    const days = Math.min(7, Math.max(1, (body.days as number) || 3));
    const minEdge = Math.min(1, Math.max(0, (body.minEdge as number) || 0.03));
    const limit = Math.min(100, Math.max(1, (body.limit as number) || 20));
    const bookmaker = (body.bookmaker as string) || "sportybet";

    // 1. Find upcoming fixtures
    const now = new Date();
    const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    let fixtureQuery = supabaseAdmin
      .from("fixtures")
      .select(
        `
        id, kickoff_time, league_id, status,
        home:teams!fixtures_home_team_id_fkey(id, canonical_name, logo),
        away:teams!fixtures_away_team_id_fkey(id, canonical_name, logo),
        league:leagues!fixtures_league_id_fkey(id, name, logo)
      `
      )
      .eq("status", "scheduled")
      .gte("kickoff_time", now.toISOString())
      .lte("kickoff_time", cutoff.toISOString())
      .order("kickoff_time", { ascending: true })
      .limit(200);

    if (league) {
      fixtureQuery = fixtureQuery.eq("league_id", league);
    }

    const { data: fixtures, error: fixErr } = await fixtureQuery;
    if (fixErr) {
      return NextResponse.json({ error: `Query failed: ${fixErr.message}` }, { status: 500 });
    }

    if (!fixtures || fixtures.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        meta: { total: 0, message: "No upcoming fixtures found" },
      });
    }

    // 2. Get predictions
    const fixtureIds = fixtures.map((f) => f.id);
    const { data: predictions } = await supabaseAdmin
      .from("predictions")
      .select("fixture_id, market, selection, model_probability, model_version")
      .in("fixture_id", fixtureIds)
      .not("model_probability", "is", null) as unknown as { data: { fixture_id: string; market: string; selection: string; model_probability: number; model_version: string }[] | null };

    // 3. Get odds
    const { data: odds } = await supabaseAdmin
      .from("odds_snapshots")
      .select("fixture_id, market, selection, odds")
      .in("fixture_id", fixtureIds);

    // Build odds map
    const oddsMap: Record<string, Record<string, number>> = {};
    const oddsAccum: Record<string, Record<string, number[]>> = {};
    for (const o of (odds || []) as { fixture_id: string; market: string; selection: string; odds: number }[]) {
      if (!oddsAccum[o.fixture_id]) oddsAccum[o.fixture_id] = {};
      const key = `${o.market}|${o.selection}`;
      if (!oddsAccum[o.fixture_id][key]) oddsAccum[o.fixture_id][key] = [];
      oddsAccum[o.fixture_id][key].push(o.odds);
    }
    // Average
    for (const fid of Object.keys(oddsAccum)) {
      oddsMap[fid] = {};
      for (const key of Object.keys(oddsAccum[fid])) {
        const arr = oddsAccum[fid][key];
        oddsMap[fid][key] = arr.reduce((s: number, v: number) => s + v, 0) / arr.length;
      }
    }

    // 4. Analyze value
    const MARKETS = {
      "1X2": { Home: "home", Draw: "draw", Away: "away" },
      BTTS: { Yes: "btts_yes", No: "btts_no" },
      OU: { "Over_2.5": "over_25", "Under_2.5": "under_25" },
      DC: { "1X": "dc_1x", X2: "dc_x2", "12": "dc_12" },
    };

    const recommendations: Record<string, unknown>[] = [];

    for (const fixture of fixtures) {
      const preds = (predictions || []).filter((p) => p.fixture_id === fixture.id);
      const fixtureOdds = oddsMap[fixture.id] || {};

      for (const [marketType, selections] of Object.entries(MARKETS)) {
        for (const [label, oddsKey] of Object.entries(selections)) {
          const selectionName = label.split("_")[0];
          const pred = preds.find(
            (p) => p.market === marketType && p.selection === selectionName
          );
          if (!pred || !pred.model_probability) continue;

          const modelProb = pred.model_probability;
          const bookOdds = fixtureOdds[`${marketType}|${label}`] || fixtureOdds[oddsKey] || 0;
          if (bookOdds <= 0) continue;

          const impliedProb = 1 / bookOdds;
          const edge = modelProb - impliedProb;
          const ev = modelProb * bookOdds - 1;

          if (edge >= minEdge) {
            const tier =
              edge >= 0.10 ? "ELITE" : edge >= 0.07 ? "HIGH" : edge >= 0.05 ? "VALUE" : "WATCH";

            const homeName = (fixture.home as unknown as { canonical_name?: string })?.canonical_name || "Home";
            const awayName = (fixture.away as unknown as { canonical_name?: string })?.canonical_name || "Away";
            const leagueName = (fixture.league as unknown as { name?: string })?.name || "Unknown";

            recommendations.push({
              fixtureId: fixture.id,
              match: `${homeName} vs ${awayName}`,
              league: leagueName,
              kickoff: fixture.kickoff_time,
              kickoffLocal: new Date(fixture.kickoff_time).toLocaleString("en-GB", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
              market: marketType,
              selection: label,
              selectionName,
              modelProbability: Math.round(modelProb * 1000) / 10,
              bookmakerOdds: Math.round(bookOdds * 100) / 100,
              impliedProbability: Math.round(impliedProb * 1000) / 10,
              edge: Math.round(edge * 1000) / 10,
              expectedValue: Math.round(ev * 1000) / 10,
              confidence: pred.model_probability >= 0.7 ? "high" : pred.model_probability >= 0.5 ? "medium" : "low",
              tier,
              reasoning: generateReasoning(homeName, awayName, modelProb, bookOdds, edge),
            });
          }
        }
      }
    }

    // Sort by edge and take top N
    recommendations.sort((a, b) => (b.edge as number) - (a.edge as number));
    const topPicks = recommendations.slice(0, limit);

    return NextResponse.json({
      success: true,
      data: topPicks,
      meta: {
        total: topPicks.length,
        totalAnalyzed: fixtures.length,
        fixturesWithOdds: Object.keys(oddsMap).length,
        days,
        minEdge,
        bookmaker,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Betting agent recommendations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function generateReasoning(
  home: string,
  away: string,
  modelProb: number,
  bookOdds: number,
  edge: number
): string {
  const reasons: string[] = [];
  if (modelProb > 0.65) reasons.push(`Strong model confidence (${(modelProb * 100).toFixed(1)}%)`);
  else if (modelProb > 0.55) reasons.push(`Moderate model confidence (${(modelProb * 100).toFixed(1)}%)`);
  if (edge > 0.08) reasons.push(`Significant edge of ${(edge * 100).toFixed(1)}% over market`);
  else if (edge > 0.05) reasons.push(`Good edge of ${(edge * 100).toFixed(1)}% over market`);
  if (bookOdds > 2.5) reasons.push(`Attractive odds at ${bookOdds.toFixed(2)}`);
  const implied = 1 / bookOdds;
  if (modelProb - implied > 0.05) {
    reasons.push(
      `Model sees ${(modelProb * 100).toFixed(0)}% probability vs market's ${(implied * 100).toFixed(0)}%`
    );
  }
  return reasons.length > 0 ? reasons.join(". ") + "." : "Edge detected from model-market discrepancy.";
}
