/**
 * GET /api/v1/value-bets
 * 
 * Get value bets — predictions where model_probability suggests edge.
 * Uses the recommendations table which pre-computes edge calculations.
 * 
 * Query Params:
 *   - page, pageSize: pagination
 *   - minEdge: minimum edge threshold (default: 0.05)
 *   - league: filter by league
 *   - recommended: boolean (show only is_recommended=true)
 *   - riskTier: filter by risk_tier
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  parsePagination,
  buildPaginationMeta,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

export async function GET(request: NextRequest) {
  const rl = checkRateLimit("value-bets", 60, 60000);
  const { searchParams } = new URL(request.url);
  const { page, pageSize, offset } = parsePagination(searchParams);

  const minEdge = parseFloat(searchParams.get("minEdge") || "0.05");
  const league = searchParams.get("league");
  const recommended = searchParams.get("recommended");
  const riskTier = searchParams.get("riskTier");

  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    let query = supabase
      .from("recommendations")
      .select("*", { count: "exact" })
      .gte("edge", minEdge)
      .order("edge", { ascending: false });

    if (recommended === "true") {
      query = query.eq("is_recommended", true);
    }
    if (riskTier) {
      query = query.eq("risk_tier", riskTier);
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
  } catch (error) {
    console.error("GET /api/v1/value-bets error:", error);
    return internalError();
  }
}
