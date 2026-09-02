/**
 * GET /api/v1/admin/leagues
 * 
 * List all leagues with fixture counts and status.
 * Admin only.
 *
 * POST /api/v1/admin/leagues
 * 
 * Create or update a league.
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  createdResponse,
  requireAdmin,
  parsePagination,
  buildPaginationMeta,
  internalError,
  badRequest,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import { leagueCreateSchema, validateBody } from "@/lib/api/validation";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:leagues:${user.id}`, 60, 60000);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, offset } = parsePagination(searchParams);

    const { data, count, error } = await supabase
      .from("leagues")
      .select("*", { count: "exact" })
      .order("name", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      return internalError(`Database query failed: ${error.message}`);
    }

    // Enrich with fixture counts
    const enriched = await Promise.all(
      (data || []).map(async (league) => {
        const { count: fixtureCount } = await supabase
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .eq("league_id", league.id);

        return { ...league, fixture_count: fixtureCount || 0 };
      })
    );

    const meta = buildPaginationMeta(page, pageSize, count || 0);
    const response = successResponse(enriched, meta);
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("FORBIDDEN", authErr.message, 403);
      }
      if (authErr.code === "UNAUTHORIZED") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("UNAUTHORIZED", authErr.message, 401);
      }
    }
    console.error("GET /api/v1/admin/leagues error:", error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireAdmin(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(leagueCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid league data", details: validation.error },
        { status: 400 }
      );
    }

    const { name, country, active } = validation.data;

    const { data, error } = await supabase
      .from("leagues")
      .insert({
        name,
        country: country || null,
        is_active: active,
      })
      .select()
      .single();

    if (error) {
      return internalError(`Failed to save league: ${error.message}`);
    }

    return createdResponse(data);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("FORBIDDEN", authErr.message, 403);
      }
      if (authErr.code === "UNAUTHORIZED") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("UNAUTHORIZED", authErr.message, 401);
      }
    }
    console.error("POST /api/v1/admin/leagues error:", error);
    return internalError();
  }
}
