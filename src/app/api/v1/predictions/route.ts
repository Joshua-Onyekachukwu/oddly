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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  createdResponse,
  requireAuth,
  requireAdmin,
  buildPaginationMeta,
  internalError,
  unprocessable,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import { z } from "zod";
import { validateQuery, validateBody } from "@/lib/api/validation";

const predictionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  fixtureId: z.string().uuid().optional(),
  league: z.string().uuid().optional(),
  minProbability: z.coerce.number().min(0).max(1).optional(),
  market: z.string().max(50).optional(),
});

const predictionCreateSchema = z.object({
  fixtureId: z.string().uuid("Invalid fixture ID"),
  forceRegenerate: z.boolean().default(false),
});

export async function GET(request: NextRequest) {
  // SECURITY: Admin-only — predictions are system data, not user data
  try {
    await requireAdmin(request);
  } catch (err: any) {
    if (err?.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = checkRateLimit("predictions", request, 60, 60000);
  const { searchParams } = new URL(request.url);

  const validation = validateQuery(predictionQuerySchema, searchParams);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: validation.error },
      { status: 400 }
    );
  }

  const { page, pageSize, fixtureId, minProbability, market } = validation.data;
  const offset = (page - 1) * pageSize;

  try {
    // Use service_role key (admin-only endpoint)
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let query = supabase
      .from("predictions")
      .select("*", { count: "exact" });

    if (fixtureId) {
      query = query.eq("fixture_id", fixtureId);
    }
    if (minProbability !== undefined) {
      query = query.gte("model_probability", minProbability);
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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(predictionCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error },
        { status: 400 }
      );
    }

    const { fixtureId, forceRegenerate } = validation.data;

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
