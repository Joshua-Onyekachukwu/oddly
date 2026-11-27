/**
 * GET /api/v1/rollover/stats
 *
 * Monthly rollover tracker metrics (spec §5) computed from the user's
 * rollover_chains + rollover_picks rows: chains started/completed/
 * broken, pick outcomes, win/loss streaks, max drawdown, average odds
 * and model probability, bankroll totals, and progress toward the
 * 10/21 monthly rollover targets.
 *
 * Auth: required (any authenticated user). Rate limited per user.
 *
 * Honesty: all figures are PAPER/SIMULATED — picks are user-marked and
 * there is no real-money settlement feed (see src/lib/rollover/stats.ts).
 *
 * Response shape (successResponse wrapper → { success, data }):
 * { ...RolloverStats } — see src/lib/rollover/stats.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  requireAuth,
  checkRateLimit,
  addRateLimitHeaders,
  internalError,
  successResponse,
  AuthError,
} from "@/lib/api/utils";
import { computeRolloverStats } from "@/lib/rollover/stats";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ROW_LIMIT = 5000;

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);

    const rl = checkRateLimit(`rollover:stats:${user.id}`, request, 60, 60_000);
    if (!rl.allowed) {
      return addRateLimitHeaders(
        NextResponse.json({ success: false, error: "Rate limit exceeded" }, { status: 429 }),
        rl.remaining,
        rl.resetAt
      );
    }

    // All chains for this user (service role + explicit user filter).
    const { data: chains, error: chainErr } = await supabaseAdmin
      .from("rollover_chains")
      .select(
        "id, starting_stake, current_balance, banked_amount, target_days, current_day, status, started_at, ended_at"
      )
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(ROW_LIMIT);

    if (chainErr) {
      console.error("[ROLLOVER] stats chain query failed:", chainErr.message);
      return internalError("Failed to load rollover chains");
    }

    const chainIds = (chains || []).map((c) => c.id);
    let picks: {
      id: string;
      chain_id: string | null;
      day_number: number | null;
      odds: number | null;
      model_probability: number | null;
      stake: number | null;
      potential_return: number | null;
      actual_return: number | null;
      result: string | null;
      settled_at: string | null;
    }[] = [];

    if (chainIds.length > 0) {
      const { data: pickRows, error: pickErr } = await supabaseAdmin
        .from("rollover_picks")
        .select(
          "id, chain_id, day_number, odds, model_probability, stake, potential_return, actual_return, result, settled_at"
        )
        .in("chain_id", chainIds)
        .order("settled_at", { ascending: true })
        .limit(ROW_LIMIT);

      if (pickErr) {
        console.error("[ROLLOVER] stats pick query failed:", pickErr.message);
        return internalError("Failed to load rollover picks");
      }
      picks = pickRows || [];
    }

    const stats = computeRolloverStats(chains || [], picks);

    return successResponse(stats);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    console.error("[ROLLOVER] stats failed:", error);
    return internalError("Rollover stats failed");
  }
}
