/**
 * GET /api/v1/odds
 * 
 * Fetch live odds from external providers.
 * Proxies to The Odds API with server-side caching.
 * 
 * Query Params:
 *   - sport: string (default: "soccer_epl")
 *   - regions: string (default: "uk,eu")
 *   - markets: string (default: "h2h,totals")
 *   - bookmakers: string (default: "bet365,pinnacle,betway")
 */

import { NextRequest } from "next/server";
import {
  successResponse,
  badRequest,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || "";

// Simple in-memory cache (5 min TTL)
const oddsCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
  const rl = checkRateLimit("odds", request, 30, 60000); // 30 req/min (external API has its own limits)

  const { searchParams } = new URL(request.url);
  const sport = searchParams.get("sport") || "soccer_epl";
  const regions = searchParams.get("regions") || "uk,eu";
  const markets = searchParams.get("markets") || "h2h,totals";
  const bookmakers = searchParams.get("bookmakers") || "bet365,pinnacle,betway";

  if (!THE_ODDS_API_KEY) {
    return badRequest("Odds API not configured");
  }

  // Build cache key
  const cacheKey = `${sport}:${regions}:${markets}:${bookmakers}`;
  const now = Date.now();

  // Check cache
  const cached = oddsCache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    const response = successResponse(cached.data, undefined, 200);
    response.headers.set("X-Cache", "HIT");
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  }

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=${regions}&markets=${markets}&bookmakers=${bookmakers}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Odds API error ${response.status}:`, errorText);
      return internalError(`Odds API returned ${response.status}`);
    }

    const data = await response.json();

    // Get usage from headers
    const used = parseInt(response.headers.get("x-requests-used") || "0");
    const remaining = parseInt(response.headers.get("x-requests-remaining") || "0");

    // Cache the response
    oddsCache.set(cacheKey, { data, expiresAt: now + CACHE_TTL });

    const apiResponse = successResponse(
      {
        fixtures: data,
        usage: { used, remaining, total: used + remaining },
      },
      undefined,
      200
    );
    apiResponse.headers.set("X-Cache", "MISS");
    apiResponse.headers.set("X-Odds-Api-Remaining", String(remaining));
    addRateLimitHeaders(apiResponse, rl.remaining, rl.resetAt);

    return apiResponse;
  } catch (error) {
    console.error("GET /api/v1/odds error:", error);
    return internalError();
  }
}
