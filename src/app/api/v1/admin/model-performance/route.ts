/**
 * GET /api/v1/admin/model-performance
 * 
 * Get model performance metrics for the admin dashboard.
 * Admin only.
 * 
 * Query Params:
 *   - days: number of days to look back (default: 30)
 *   - model: filter by specific model version
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  requireAdmin,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import { z } from "zod";
import { validateQuery } from "@/lib/api/validation";
import { trackPredictionAccuracy, getModelPerformanceStats } from "@/lib/prediction/tracking";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  model: z.string().max(100).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:model-perf:${user.id}`, 30, 60000);

    const { searchParams } = new URL(request.url);
    const validation = validateQuery(querySchema, searchParams);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: validation.error },
        { status: 400 }
      );
    }

    const { days, model: modelName } = validation.data;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString();

    // Fetch model performance records
    let perfQuery = supabase
      .from("model_performance")
      .select("*")
      .gte("created_at", startStr)
      .order("created_at", { ascending: false });

    if (modelName) {
      perfQuery = perfQuery.eq("model_version", modelName);
    }

    const { data: performance, error: perfError } = await perfQuery;

    if (perfError) {
      return internalError(`Performance query failed: ${perfError.message}`);
    }

    // Aggregate by model_version
    const modelStats: Record<string, {
      model: string;
      totalPredictions: number;
      correctPredictions: number;
      accuracy: number;
      avgBrierScore: number;
      avgRoi: number;
    }> = {};

    for (const record of performance || []) {
      const model = record.model_version;
      if (!modelStats[model]) {
        modelStats[model] = {
          model,
          totalPredictions: 0,
          correctPredictions: 0,
          accuracy: 0,
          avgBrierScore: 0,
          avgRoi: 0,
        };
      }
      const stats = modelStats[model];
      stats.totalPredictions += record.total_predictions || 0;
      stats.correctPredictions += record.correct_predictions || 0;
      stats.avgBrierScore += record.brier_score || 0;
      stats.avgRoi += record.roi || 0;
    }

    // Calculate averages
    for (const stats of Object.values(modelStats)) {
      const count = (performance || []).filter(
        (r) => r.model_version === stats.model
      ).length;
      stats.accuracy = stats.totalPredictions > 0
        ? stats.correctPredictions / stats.totalPredictions
        : 0;
      stats.avgBrierScore = count > 0 ? stats.avgBrierScore / count : 0;
      stats.avgRoi = count > 0 ? stats.avgRoi / count : 0;
    }

    // Overall summary
    const totalPredictions = (performance || []).reduce(
      (sum, r) => sum + (r.total_predictions || 0), 0
    );
    const totalCorrect = (performance || []).reduce(
      (sum, r) => sum + (r.correct_predictions || 0), 0
    );

    const response = successResponse({
      summary: {
        period: `${days} days`,
        totalPredictions,
        overallAccuracy: totalPredictions > 0 ? totalCorrect / totalPredictions : 0,
        modelsTracked: Object.keys(modelStats).length,
      },
      models: Object.values(modelStats),
    });

    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("FORBIDDEN", authErr.message, 403);
      }
    }
    console.error("GET /api/v1/admin/model-performance error:", error);
    return internalError();
  }
}

/**
 * POST /api/v1/admin/model-performance
 * 
 * Trigger prediction accuracy tracking for finished matches.
 * Admin only.
 * 
 * Body:
 *   - fixtureId: optional UUID to track a specific fixture
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:model-track:${user.id}`, 5, 60000);

    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    let fixtureId: string | undefined;
    try {
      const body = await request.json();
      if (body.fixtureId) {
        const idValidation = z.string().uuid().safeParse(body.fixtureId);
        if (!idValidation.success) {
          return NextResponse.json(
            { error: "Invalid fixture ID format" },
            { status: 400 }
          );
        }
        fixtureId = idValidation.data;
      }
    } catch {
      // No body provided, track all finished matches
    }

    const result = await trackPredictionAccuracy(fixtureId);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("FORBIDDEN", authErr.message, 403);
      }
    }
    console.error("POST /api/v1/admin/model-performance error:", error);
    return internalError();
  }
}
