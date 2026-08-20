/**
 * GET /api/v1/user/bets
 * 
 * List the current user's bets with filtering.
 * Requires authentication.
 * 
 * Query Params:
 *   - page, pageSize: pagination
 *   - status: filter by status (pending, won, lost, void)
 *
 * POST /api/v1/user/bets
 * 
 * Record a new bet.
 * Requires authentication.
 * 
 * Body:
 *   - recommendationId: string (required)
 *   - market: string (required)
 *   - selection: string (required)
 *   - stake: number (required, in NGN)
 *   - odds: number (required, decimal odds)
 *   - bookmaker: string (optional)
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  createdResponse,
  requireAuth,
  parsePagination,
  buildPaginationMeta,
  internalError,
  badRequest,
  unprocessable,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);
    const rl = checkRateLimit(`bets:${user.id}`, 60, 60000);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = parsePagination(searchParams);
    const status = searchParams.get("status");

    let query = supabase
      .from("user_bets")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("placed_at", { ascending: false });

    if (status) {
      query = query.eq("status", status as "pending" | "won" | "lost" | "void");
    }

    query = query.range(offset, offset + pageSize - 1);

    const { data, count, error } = await query;

    if (error) {
      return internalError(`Database query failed: ${error.message}`);
    }

    const meta = buildPaginationMeta(page, pageSize, count || 0);
    const response = successResponse(data || [], meta);
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") return unprocessable(authErr.message);
    }
    console.error("GET /api/v1/user/bets error:", error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);

    const body = await request.json();
    const { recommendationId, market, selection, stake, odds, bookmaker } = body;

    if (!recommendationId) return badRequest("recommendationId is required");
    if (!market) return badRequest("market is required");
    if (!selection) return badRequest("selection is required");
    if (!stake || stake <= 0) return badRequest("stake must be a positive number");
    if (!odds || odds < 1) return badRequest("odds must be >= 1.0");

    // Verify recommendation exists
    const { data: rec, error: recError } = await supabase
      .from("recommendations")
      .select("id, fixture_id, model_probability")
      .eq("id", recommendationId)
      .single();

    if (recError || !rec) {
      return unprocessable("Recommendation not found");
    }

    const { data: bet, error: betError } = await supabase
      .from("user_bets")
      .insert({
        user_id: user.id,
        recommendation_id: recommendationId,
        fixture_id: rec.fixture_id,
        market,
        selection,
        bookmaker: bookmaker || null,
        odds_at_placement: odds,
        stake,
        status: "pending",
      })
      .select()
      .single();

    if (betError) {
      return internalError(`Failed to record bet: ${betError.message}`);
    }

    return createdResponse(bet);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") return unprocessable(authErr.message);
    }
    console.error("POST /api/v1/user/bets error:", error);
    return internalError();
  }
}
