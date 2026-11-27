/**
 * GET /api/v1/rollover/recommendation
 *
 * Runs the 2-odds daily rollover engine (src/lib/rollover/engine.ts)
 * against upcoming fixtures and returns today's qualifying ~2.00-odds
 * accumulator combinations — or an honest "no ticket" result.
 *
 * Auth: required (any authenticated user). Rate limited per user.
 *
 * Query params:
 *   - date:    YYYY-MM-DD — target day (UTC). Default: today.
 *   - hours:   look-ahead window in hours when `date` is omitted (default 24)
 *   - limit:   max tickets returned (default = engine topTickets = 5, max 20)
 *
 * Response shape (successResponse wrapper → { success, data }):
 * {
 *   date: string,
 *   window: { from: string, to: string },
 *   tickets: RolloverTicket[],          // see engine.ts; empty when none qualify
 *   reason: "ok" | "no_candidates" | "no_qualified_candidates" | "no_combinations_in_band",
 *   message: string,
 *   stats: {
 *     fixturesConsidered: number,
 *     predictionsConsidered: number,
 *     candidatesWithOdds: number,
 *     qualifiedCount: number,
 *     combinationsEvaluated: number,
 *     rejectedCount: number,
 *   },
 *   config: RolloverEngineConfig,       // thresholds actually applied
 *   generatedAt: string,
 * }
 *
 * Each ticket leg carries: fixtureId, fixtureLabel, kickoffTime, market,
 * selection, modelProbability, odds, impliedProbability, edge,
 * expectedValue, bookmaker, sourceId — plus ticket-level combinedOdds,
 * combinedProbability, combinedEv, score and a per-leg rationale array.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  requireAuth,
  checkRateLimit,
  addRateLimitHeaders,
  internalError,
  badRequest,
  successResponse,
  AuthError,
} from "@/lib/api/utils";
import {
  DEFAULT_ROLLOVER_CONFIG,
  RolloverCandidate,
  RolloverEngineConfig,
  buildRolloverTickets,
  canonicalMarket,
} from "@/lib/rollover/engine";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Odds older than this are ignored (freshness gate). */
const ODDS_MAX_AGE_HOURS = 12;
/** PostgREST row cap per query. */
const ROW_LIMIT = 1000;

// ─── Market/selection normalization for odds ↔ prediction matching ────

function normKey(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Build the set of odds-map keys that could correspond to a
 * (market, selection) pair from `predictions`. Covers naming drift
 * between The Odds API snapshots and ensemble market keys.
 */
function oddsKeyVariants(market: string, selection: string): string[] {
  const m = canonicalMarket(market);
  const s = normKey(selection);
  const keys = new Set<string>();

  const marketAliases: Record<string, string[]> = {
    "1x2": ["1x2", "h2h"],
    ou: ["ou", "over_under", "totals", "total_goals", "ou_"],
    btts: ["btts", "both_teams_to_score"],
    dc: ["dc", "double_chance"],
    dnb: ["dnb", "draw_no_bet"],
    homegoals: ["homegoals", "home_goals"],
    awaygoals: ["awaygoals", "away_goals"],
  };
  const markets = marketAliases[m] ?? [m];

  // Selection aliases for common odds-feed spellings
  const selAliases: Record<string, string[]> = {
    home: ["home", "1"],
    draw: ["draw", "x"],
    away: ["away", "2"],
    yes: ["yes"],
    no: ["no"],
    "1x": ["1x", "1_x"],
    x2: ["x2", "x_2"],
    "12": ["12", "1_2"],
  };

  for (const mk of markets) {
    for (const sv of selAliases[s] ?? [s]) {
      keys.add(`${mk}|${sv}`);
      // Some feeds store market inside selection or vice versa
      keys.add(`${mk}|${s}`);
    }
    keys.add(`${m}|${s}`);
  }
  return [...keys];
}

// ─── Route ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);

    const rl = checkRateLimit(`rollover:recommendation:${user.id}`, request, 30, 60_000);
    if (!rl.allowed) {
      return addRateLimitHeaders(
        NextResponse.json({ success: false, error: "Rate limit exceeded" }, { status: 429 }),
        rl.remaining,
        rl.resetAt
      );
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const hoursParam = parseInt(searchParams.get("hours") || "24", 10);
    const limitParam = parseInt(searchParams.get("limit") || String(DEFAULT_ROLLOVER_CONFIG.topTickets), 10);

    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return badRequest("date must be YYYY-MM-DD");
    }
    const hours = Number.isFinite(hoursParam) ? Math.min(Math.max(hoursParam, 1), 168) : 24;

    // Resolve the fixture window
    let windowFrom: Date;
    let windowTo: Date;
    if (dateParam) {
      windowFrom = new Date(`${dateParam}T00:00:00.000Z`);
      windowTo = new Date(`${dateParam}T23:59:59.999Z`);
    } else {
      windowFrom = new Date();
      windowTo = new Date(Date.now() + hours * 60 * 60 * 1000);
    }

    // 1. Upcoming fixtures in window
    const { data: fixtures, error: fixErr } = await supabaseAdmin
      .from("fixtures")
      .select(
        `id, kickoff_time, league_id, status,
         home:teams!fixtures_home_team_id_fkey(canonical_name),
         away:teams!fixtures_away_team_id_fkey(canonical_name)`
      )
      .gte("kickoff_time", windowFrom.toISOString())
      .lte("kickoff_time", windowTo.toISOString())
      .in("status", ["scheduled", "live"])
      .order("kickoff_time", { ascending: true })
      .limit(ROW_LIMIT);

    if (fixErr) {
      console.error("[ROLLOVER] fixture query failed:", fixErr.message);
      return internalError("Failed to load fixtures");
    }
    if (!fixtures || fixtures.length === 0) {
      return successResponse({
        date: dateParam || new Date().toISOString().slice(0, 10),
        window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
        tickets: [],
        reason: "no_candidates",
        message: "No upcoming fixtures in the requested window.",
        stats: {
          fixturesConsidered: 0, predictionsConsidered: 0, candidatesWithOdds: 0,
          qualifiedCount: 0, combinationsEvaluated: 0, rejectedCount: 0,
        },
        config: DEFAULT_ROLLOVER_CONFIG,
        generatedAt: new Date().toISOString(),
      });
    }

    const fixtureIds = fixtures.map((f) => f.id);
    const fixtureById = new Map(fixtures.map((f) => [f.id, f]));

    // 2. Predictions for those fixtures (latest per fixture+market+selection)
    const { data: preds } = await supabaseAdmin
      .from("predictions")
      .select(
        "id, fixture_id, market, selection, model_probability, model_disagreement, data_quality_score, created_at, result"
      )
      .in("fixture_id", fixtureIds)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT * 5);

    // Keep only the newest prediction per normalized (fixture, market, selection)
    const seenPred = new Set<string>();
    const latestPreds: typeof preds = [];
    for (const p of preds || []) {
      const key = `${p.fixture_id}|${canonicalMarket(p.market)}|${normKey(p.selection)}`;
      if (seenPred.has(key)) continue;
      seenPred.add(key);
      latestPreds.push(p);
    }

    // 3. Odds: latest snapshot per fixture+market+selection within freshness
    //    window; take the BEST (max) decimal odds across bookmakers.
    const oddsCutoff = new Date(Date.now() - ODDS_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
    const { data: oddsRows } = await supabaseAdmin
      .from("odds_snapshots")
      .select("fixture_id, market, selection, odds, snapshot_time, bookmaker")
      .in("fixture_id", fixtureIds)
      .gte("snapshot_time", oddsCutoff)
      .order("snapshot_time", { ascending: false })
      .limit(ROW_LIMIT * 5);

    // odds map: key = fixtureId|market|selection(normalized) → best odds.
    // Group all rows per key and take MAX decimal odds across bookmakers
    // (best available price, per plan §3 assumptions).
    const oddsMap = new Map<string, { odds: number; bookmaker: string | null }>();
    const oddsGroups = new Map<string, { odds: number; bookmaker: string | null }[]>();
    for (const o of oddsRows || []) {
      const key = `${o.fixture_id}|${canonicalMarket(o.market)}|${normKey(o.selection)}`;
      const arr = oddsGroups.get(key) ?? [];
      arr.push({ odds: Number(o.odds), bookmaker: (o as any).bookmaker ?? null });
      oddsGroups.set(key, arr);
    }
    for (const [key, arr] of oddsGroups) {
      const best = arr.reduce((a, b) => (b.odds > a.odds ? b : a));
      oddsMap.set(key, best);
    }

    // 4. Recommendations fallback: rows already carry matched bookmaker_odds
    const { data: recs } = await supabaseAdmin
      .from("recommendations")
      .select("fixture_id, market, selection, bookmaker_odds, model_probability, created_at")
      .in("fixture_id", fixtureIds)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT);

    const recOdds = new Map<string, number>();
    for (const r of recs || []) {
      const key = `${r.fixture_id}|${canonicalMarket(r.market)}|${normKey(r.selection)}`;
      if (!recOdds.has(key)) recOdds.set(key, Number(r.bookmaker_odds));
    }

    // 5. Assemble candidates
    const candidates: RolloverCandidate[] = [];
    let withOdds = 0;

    for (const p of latestPreds || []) {
      const prob = Number(p.model_probability);
      if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) continue;

      const fixture = fixtureById.get(p.fixture_id);
      if (!fixture) continue;

      // Resolve odds: exact normalized key first, then alias variants
      let odds: number | null = null;
      let bookmaker: string | null = null;
      const directKey = `${p.fixture_id}|${canonicalMarket(p.market)}|${normKey(p.selection)}`;
      const direct = oddsMap.get(directKey);
      if (direct) {
        odds = direct.odds;
        bookmaker = direct.bookmaker;
      } else {
        for (const variant of oddsKeyVariants(p.market, p.selection)) {
          const [mk, sv] = variant.split("|");
          const hit = oddsMap.get(`${p.fixture_id}|${mk}|${sv}`);
          if (hit) { odds = hit.odds; bookmaker = hit.bookmaker; break; }
        }
      }
      if (odds == null) {
        const recOddsVal = recOdds.get(directKey);
        if (recOddsVal && recOddsVal > 1) odds = recOddsVal;
      }
      if (odds == null || !(odds > 1)) continue;
      withOdds++;

      const home = (fixture as any).home?.canonical_name ?? "Home";
      const away = (fixture as any).away?.canonical_name ?? "Away";

      candidates.push({
        fixtureId: p.fixture_id,
        fixtureLabel: `${home} vs ${away}`,
        kickoffTime: fixture.kickoff_time,
        market: p.market,
        selection: p.selection,
        modelProbability: prob,
        odds,
        bookmaker,
        modelDisagreement: p.model_disagreement != null ? Number(p.model_disagreement) : null,
        dataQualityScore: p.data_quality_score != null ? Number(p.data_quality_score) : null,
        leagueId: fixture.league_id,
        sourceId: p.id,
      });
    }

    // 6. Engine config: defaults + optional overrides via query params
    const config: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      topTickets: Math.min(Math.max(limitParam || DEFAULT_ROLLOVER_CONFIG.topTickets, 1), 20),
    };

    const result = buildRolloverTickets(candidates, config);

    return successResponse({
      date: dateParam || new Date().toISOString().slice(0, 10),
      window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
      tickets: result.tickets,
      reason: result.reason,
      message: result.message,
      stats: {
        fixturesConsidered: fixtures.length,
        predictionsConsidered: (latestPreds || []).length,
        candidatesWithOdds: withOdds,
        qualifiedCount: result.qualifiedCount,
        combinationsEvaluated: result.combinationsEvaluated,
        rejectedCount: result.rejected.length,
      },
      // Rejections are useful for debugging but can be large — cap at 50.
      rejected: result.rejected.slice(0, 50).map((r) => ({
        fixtureId: r.candidate.fixtureId,
        market: canonicalMarket(r.candidate.market),
        selection: r.candidate.selection,
        modelProbability: r.candidate.modelProbability,
        odds: r.candidate.odds,
        reasons: r.reasons,
      })),
      config,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    console.error("[ROLLOVER] recommendation failed:", error);
    return internalError("Rollover recommendation failed");
  }
}
