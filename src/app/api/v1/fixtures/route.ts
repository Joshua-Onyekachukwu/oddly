/**
 * GET /api/v1/fixtures
 * 
 * List fixtures with filtering, sorting, and pagination.
 * 
 * Query Params:
 *   - page: number (default: 1)
 *   - pageSize: number (default: 20, max: 100)
 *   - league: string (league ID)
 *   - date: string (YYYY-MM-DD)
 *   - status: string (NS, 1H, HT, 2H, FT, etc.)
 *   - search: string (team name search)
 *   - sortBy: string (kickoff_time, created_at)
 *   - sortOrder: asc | desc
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  parsePagination,
  buildPaginationMeta,
  parseFilters,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
  type ApiSuccessResponse,
} from "@/lib/api/utils";

interface FixtureRow {
  id: string;
  league_id: number;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  // Rate limit
  const rl = checkRateLimit("fixtures", 120, 60000);

  const { searchParams } = new URL(request.url);
  const { page, pageSize, offset } = parsePagination(searchParams);
  const { search, league, status, date, sortBy, sortOrder } = parseFilters(searchParams);

  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    let query = supabase
      .from("fixtures")
      .select("*", { count: "exact" });

    // Filters
    if (league) {
      query = query.eq("league_id", parseInt(league, 10));
    }
    if (status) {
      query = query.eq("status", status);
    }
    if (date) {
      const startOfDay = `${date}T00:00:00Z`;
      const endOfDay = `${date}T23:59:59Z`;
      query = query.gte("kickoff_time", startOfDay).lte("kickoff_time", endOfDay);
    }
    if (search) {
      query = query.or(`home_team_name.ilike.%${search}%,away_team_name.ilike.%${search}%`);
    }

    // Sorting
    query = query.order(sortBy, { ascending: sortOrder === "asc" });

    // Pagination
    query = query.range(offset, offset + pageSize - 1);

    const { data, count, error } = await query;

    if (error) {
      return internalError(`Database query failed: ${error.message}`);
    }

    const total = count || 0;
    const meta = buildPaginationMeta(page, pageSize, total);

    const response = successResponse<FixtureRow[]>(data || [], meta, rl.allowed ? 200 : 429);
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);

    return response;
  } catch (error) {
    console.error("GET /api/v1/fixtures error:", error);
    return internalError();
  }
}
