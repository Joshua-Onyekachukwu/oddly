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
  unprocessable,
  badRequest,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import { accumulatorQuerySchema, accumulatorCreateSchema, validateQuery, validateBody } from "@/lib/api/validation";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);
    const rl = checkRateLimit(`acc:${user.id}`, 60, 60000);

    const { searchParams } = new URL(request.url);
    const validation = validateQuery(accumulatorQuerySchema, searchParams);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: validation.error },
        { status: 400 }
      );
    }
    const { page, pageSize, status } = validation.data;
    const offset = validation.data.offset ?? (page - 1) * pageSize;

    let query = supabase
      .from("accumulators")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (status) {
      query = query.eq("status", status as "pending" | "won" | "lost" | "partial");
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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(accumulatorCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid accumulator data", details: validation.error },
        { status: 400 }
      );
    }

    const { name, picks: selections, stake } = validation.data;

    // Calculate combined odds and probability
    let combinedOdds = 1;
    for (const sel of selections) {
      combinedOdds *= sel.odds;
    }

    // Create accumulator
    const { data: accumulator, error: accError } = await supabase
      .from("accumulators")
      .insert({
        user_id: user.id,
        name: name || `${selections.length}-leg accumulator`,
        selections: selections as any,
        combined_odds: combinedOdds,
        estimated_probability: 0,
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
