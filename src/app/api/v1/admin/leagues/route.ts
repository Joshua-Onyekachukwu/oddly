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
import { logAdminAction } from "@/lib/admin/audit";

// leagues writes are service-role only under RLS ("Service role manages
// leagues"); the user-scoped client from requireAdmin can read but not write.
const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:leagues:${user.id}`, request, 60, 60000);

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

    // Enrich with fixture counts (upcoming/finished) and league model params.
    // league_model_params is keyed by league_name (text), not league_id.
    const [{ data: fixtureRows }, { data: paramRows }] = await Promise.all([
      supabase.from("fixtures").select("league_id, status"),
      supabase.from("league_model_params").select("*"),
    ]);

    const countsByLeague = new Map<
      string,
      { total: number; upcoming: number; finished: number }
    >();
    for (const f of fixtureRows || []) {
      if (!f.league_id) continue;
      const c = countsByLeague.get(f.league_id) || { total: 0, upcoming: 0, finished: 0 };
      c.total += 1;
      if (f.status === "finished") c.finished += 1;
      else c.upcoming += 1;
      countsByLeague.set(f.league_id, c);
    }

    const paramsByName = new Map<string, unknown>();
    for (const p of paramRows || []) {
      paramsByName.set((p as { league_name: string }).league_name, p);
    }

    const enriched = (data || []).map((league) => {
      const c = countsByLeague.get(league.id) || { total: 0, upcoming: 0, finished: 0 };
      return {
        ...league,
        fixture_count: c.total,
        upcoming_count: c.upcoming,
        finished_count: c.finished,
        model_params: paramsByName.get(league.name) || null,
      };
    });

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

    const { name, country, active, priority } = validation.data;

    const { data, error } = await supabaseAdmin
      .from("leagues")
      .insert({
        name,
        country: country || null,
        is_active: active,
        priority: priority ?? 0,
      })
      .select()
      .single();

    if (error) {
      return internalError(`Failed to save league: ${error.message}`);
    }

    await logAdminAction(user.id, "league.create", "league", data.id, {
      name,
      country: country || null,
      active,
      priority: priority ?? 0,
    });

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
