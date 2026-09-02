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

import { NextRequest, NextResponse } from "next/server";
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
import { userBetCreateSchema, validateBody } from "@/lib/api/validation";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);
    const rl = checkRateLimit(`bets:${user.id}`, request, 60, 60000);

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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(userBetCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid bet data", details: validation.error },
        { status: 400 }
      );
    }

    const { recommendationId, market, selection, stake, odds, bookmaker } = validation.data;

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
