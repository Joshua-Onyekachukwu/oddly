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
 *   decision: "qualified" | "wait" | "skip",  // spec §4 daily decision
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
  RolloverEngineConfig,
  buildRolloverTickets,
  canonicalMarket,
} from "@/lib/rollover/engine";
import { fetchRolloverCandidates } from "@/lib/rollover/candidates";
import { featureGateResponse } from "@/lib/subscription/entitlements";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Route ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);

    // Entitlement gate (Elite feature once paid launch enables enforcement —
    // see src/lib/subscription/entitlements.ts). Currently open to all tiers.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .maybeSingle();
    const gate = featureGateResponse(profile?.subscription_tier, "rollover");
    if (!gate.allowed) {
      return NextResponse.json({ success: false, ...gate.body }, { status: gate.status });
    }

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

    // 1–5. Fixtures → predictions → odds → candidates (shared fetcher,
    //        identical pipeline to the original inline implementation)
    let bundle;
    try {
      bundle = await fetchRolloverCandidates(windowFrom, windowTo);
    } catch (fetchErr) {
      console.error("[ROLLOVER] candidate fetch failed:", fetchErr);
      return internalError("Failed to load fixtures");
    }
    const { candidates, fixtures, latestPreds } = bundle;
    const withOdds = bundle.candidatesWithOdds;

    if (fixtures.length === 0) {
      return successResponse({
        date: dateParam || new Date().toISOString().slice(0, 10),
        window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
        tickets: [],
        reason: "no_candidates",
        decision: "skip",
        message: "No upcoming fixtures in the requested window.",
        stats: {
          fixturesConsidered: 0, predictionsConsidered: 0, candidatesWithOdds: 0,
          qualifiedCount: 0, combinationsEvaluated: 0, rejectedCount: 0,
        },
        config: DEFAULT_ROLLOVER_CONFIG,
        generatedAt: new Date().toISOString(),
      });
    }

    // 6. Engine config: defaults + optional overrides via query params
    const config: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      topTickets: Math.min(Math.max(limitParam || DEFAULT_ROLLOVER_CONFIG.topTickets, 1), 20),
    };

    const result = buildRolloverTickets(candidates, config);

    // Daily decision (spec §4). The engine derives it from its own inputs;
    // the route refines one case it alone can see: predictions existed but
    // NONE had usable odds → "wait" (promising picks, missing reliable
    // odds — a rescan on odds updates may qualify them).
    const decision =
      result.decision === "skip" &&
      (latestPreds?.length ?? 0) > 0 &&
      withOdds === 0
        ? "wait"
        : result.decision;

    // 7. Rejected-opportunity audit log (spec §6) — bounded to the top 50
    //    rejected candidates per run. Service-role insert; failures are
    //    logged but must NEVER break the recommendation.
    const rejectionRows = result.rejected.slice(0, 50).map((r) => ({
      fixture_id: r.candidate.fixtureId,
      market: canonicalMarket(r.candidate.market),
      selection: r.candidate.selection,
      model_probability: r.candidate.modelProbability,
      reason_code: (r.reasons[0] ?? "unknown").split(":")[0],
      detail: {
        reasons: r.reasons,
        odds: r.candidate.odds,
        bookmaker: r.candidate.bookmaker ?? null,
        fixtureLabel: r.candidate.fixtureLabel ?? null,
        leagueId: r.candidate.leagueId ?? null,
        evaluated_for: dateParam || new Date().toISOString().slice(0, 10),
      },
      evaluated_at: new Date().toISOString(),
    }));
    if (rejectionRows.length > 0) {
      try {
        // rollover_rejections is not yet in generated Database types —
        // cast the client for this audit-table write only.
        const { error: rejErr } = await (supabaseAdmin as any)
          .from("rollover_rejections")
          .insert(rejectionRows);
        if (rejErr) {
          console.error("[ROLLOVER] rejection log insert failed:", rejErr.message);
        }
      } catch (rejEx) {
        console.error("[ROLLOVER] rejection log insert threw:", rejEx);
      }
    }

    return successResponse({
      date: dateParam || new Date().toISOString().slice(0, 10),
      window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
      tickets: result.tickets,
      reason: result.reason,
      decision,
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
