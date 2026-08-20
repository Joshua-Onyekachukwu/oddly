/**
 * GET /api/v1/predictions
 * 
 * List predictions with filtering and pagination.
 * 
 * Query Params:
 *   - page, pageSize: pagination
 *   - fixtureId: filter by fixture
 *   - league: filter by league
 *   - minProbability: minimum model_probability threshold
 *   - market: filter by market type
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
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

export async function GET(request: NextRequest) {
  const rl = checkRateLimit("predictions", 120, 60000);
  const { searchParams } = new URL(request.url);
  const { page, pageSize, offset } = parsePagination(searchParams);

  const fixtureId = searchParams.get("fixtureId");
  const league = searchParams.get("league");
  const minProbability = searchParams.get("minProbability");
  const market = searchParams.get("market");

  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    let query = supabase
      .from("predictions")
      .select("*", { count: "exact" });

    if (fixtureId) {
      query = query.eq("fixture_id", fixtureId);
    }
    if (minProbability) {
      query = query.gte("model_probability", parseFloat(minProbability));
    }
    if (market) {
      query = query.eq("market", market);
    }

    query = query
      .order("model_probability", { ascending: false })
      .range(offset, offset + pageSize - 1);

    const { data, count, error } = await query;

    if (error) {
      return internalError(`Database query failed: ${error.message}`);
    }

    const meta = buildPaginationMeta(page, pageSize, count || 0);
    const response = successResponse(data || [], meta);
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error) {
    console.error("GET /api/v1/predictions error:", error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);

    const body = await request.json();
    const { fixtureId, forceRegenerate = false } = body;

    if (!fixtureId) {
      return unprocessable("fixtureId is required");
    }

    // Check if predictions already exist
    if (!forceRegenerate) {
      const { data: existing } = await supabase
        .from("predictions")
        .select("id")
        .eq("fixture_id", fixtureId)
        .limit(1);

      if (existing && existing.length > 0) {
        return successResponse(
          { message: "Predictions already exist. Use forceRegenerate=true to regenerate." },
          undefined,
          200
        );
      }
    }

    // Fetch fixture
    const { data: fixture, error: fixtureError } = await supabase
      .from("fixtures")
      .select("*, teams!home_team_id(canonical_name), teams!away_team_id(canonical_name)")
      .eq("id", fixtureId)
      .single();

    if (fixtureError || !fixture) {
      return unprocessable("Fixture not found");
    }

    // TODO: Call NVIDIA AI models to generate predictions
    // For now, return a placeholder
    const predictions = [
      {
        fixture_id: fixtureId,
        market: "over_under_2.5",
        selection: "Over 2.5",
        model_probability: 0.0,
        confidence_lower: 0.0,
        confidence_upper: 0.0,
        model_version: "placeholder-v1",
        features_used: {},
        sub_model_probabilities: {},
        model_disagreement: 0.0,
        data_quality_score: 0,
      },
    ];

    const { data: inserted, error: insertError } = await supabase
      .from("predictions")
      .insert(predictions)
      .select();

    if (insertError) {
      return internalError(`Failed to store predictions: ${insertError.message}`);
    }

    return createdResponse(inserted);
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "UNAUTHORIZED") {
        return unprocessable(authErr.message);
      }
    }
    console.error("POST /api/v1/predictions error:", error);
    return internalError();
  }
}
