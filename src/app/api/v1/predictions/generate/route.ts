import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  generatePredictionsForFixture,
  generateTodayPredictions,
} from "@/lib/nvidia/prediction-engine";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/v1/predictions/generate
 * 
 * Generate predictions for a fixture or all today's fixtures.
 * Requires admin role or valid API key.
 * 
 * Body:
 *   { fixture_id: string } — generate for one fixture
 *   { all: true } — generate for all today's fixtures
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate — check for admin or API key
    const authHeader = request.headers.get("authorization");
    const apiKey = request.headers.get("x-api-key");

    if (!authHeader && !apiKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let isAdmin = false;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);

      if (user) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        isAdmin = profile?.role === "admin";
      }
    }

    // Allow internal API key
    if (apiKey === process.env.INTERNAL_API_KEY) {
      isAdmin = true;
    }

    if (!isAdmin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Generate for a single fixture
    if (body.fixture_id) {
      const result = await generatePredictionsForFixture(body.fixture_id);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || "Prediction generation failed" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        fixture_id: body.fixture_id,
        predictions_count: result.predictions.length,
        summary: result.summary,
        predictions: result.predictions,
      });
    }

    // Generate for all today's fixtures
    if (body.all === true) {
      const result = await generateTodayPredictions();

      return NextResponse.json({
        success: result.failed === 0,
        total: result.total,
        success_count: result.success,
        failed_count: result.failed,
        errors: result.errors,
      });
    }

    return NextResponse.json(
      { error: "Provide fixture_id or { all: true }" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Prediction generation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/predictions/generate
 * 
 * Get prediction generation status and today's stats.
 */
export async function GET() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [fixturesResult, predictionsResult, recommendationsResult] =
      await Promise.all([
        supabaseAdmin
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .gte("kickoff_time", todayStart.toISOString()),

        supabaseAdmin
          .from("predictions")
          .select("id", { count: "exact", head: true })
          .gte("created_at", todayStart.toISOString()),

        supabaseAdmin
          .from("recommendations")
          .select("id", { count: "exact", head: true })
          .eq("is_recommended", true)
          .gte("created_at", todayStart.toISOString()),
      ]);

    return NextResponse.json({
      today: {
        fixtures: fixturesResult.count || 0,
        predictions: predictionsResult.count || 0,
        recommendations: recommendationsResult.count || 0,
      },
      model: "oddly-ai-v1",
      engine: "nvidia-llama-3.1-70b-instruct",
    });
  } catch (error) {
    console.error("Status check error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
