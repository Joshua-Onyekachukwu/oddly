/**
 * GET /api/v1/accumulators
 * 
 * List the current user's accumulators.
 * Requires authentication.
 * 
 * Query Params:
 *   - page, pageSize: pagination
 *   - status: filter by status (pending, won, lost, partial)
 *
 * POST /api/v1/accumulators
 * 
 * Create a new accumulator.
 * Requires authentication.
 * 
 * Body:
 *   - name: string (optional)
 *   - selections: Array<{predictionId, market, selection, odds}> (required, 2-10 picks)
 *   - stake: number (optional, default 1000 in NGN)
 *   - strategy: string (optional: conservative, balanced, aggressive, longshot)
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
  unprocessable,
  badRequest,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);
    const rl = checkRateLimit(`acc:${user.id}`, 60, 60000);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = parsePagination(searchParams);
    const status = searchParams.get("status");

    let query = supabase
      .from("accumulators")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
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
    console.error("GET /api/v1/accumulators error:", error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);

    const body = await request.json();
    const { name, selections, stake = 1000, strategy = "balanced" } = body;

    if (!selections || !Array.isArray(selections) || selections.length < 2) {
      return badRequest("Accumulator requires at least 2 selections");
    }

    if (selections.length > 10) {
      return badRequest("Accumulator cannot have more than 10 selections");
    }

    // Calculate combined odds and probability
    let combinedOdds = 1;
    let estimatedProbability = 1;
    for (const sel of selections) {
      if (!sel.odds || sel.odds < 1) {
        return badRequest(`Invalid odds for selection: ${sel.selection}`);
      }
      combinedOdds *= sel.odds;
      if (sel.modelProbability) {
        estimatedProbability *= sel.modelProbability;
      }
    }

    // Create accumulator
    const { data: accumulator, error: accError } = await supabase
      .from("accumulators")
      .insert({
        user_id: user.id,
        name: name || `${selections.length}-leg accumulator`,
        selections,
        combined_odds: combinedOdds,
        estimated_probability: estimatedProbability,
        strategy,
        stake,
        status: "pending",
      })
      .select()
      .single();

    if (accError) {
      return internalError(`Failed to create accumulator: ${accError.message}`);
    }

    return createdResponse(accumulator);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") return unprocessable(authErr.message);
    }
    console.error("POST /api/v1/accumulators error:", error);
    return internalError();
  }
}
