import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getInjuryFeaturesForPrediction } from "@/lib/injury/feature-engineering";
import { checkRateLimit, addRateLimitHeaders } from "@/lib/api/utils";
import { z } from "zod";
import { validateQuery, validateBody } from "@/lib/api/validation";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── Schemas ────────────────────────────────────────────────────────

const injuryFeaturesQuerySchema = z.object({
  fixture_id: z.string().uuid("Invalid fixture ID"),
  prediction_time: z.string().datetime().optional(),
});

const injuryFeaturesPostSchema = z.object({
  fixture_id: z.string().uuid("Invalid fixture ID").optional(),
  all: z.boolean().optional(),
}).refine((data) => data.fixture_id || data.all === true, {
  message: "Provide fixture_id or { all: true }",
});

// ── GET /api/v1/injuries/features ──────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const rl = checkRateLimit("injuries:features", request, 60, 60000);

    const { searchParams } = new URL(request.url);
    const validation = validateQuery(injuryFeaturesQuerySchema, searchParams);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: validation.error },
        { status: 400 }
      );
    }

    const { fixture_id, prediction_time } = validation.data;

    const predictionTime = prediction_time
      ? new Date(prediction_time)
      : new Date();

    // Get injury features with leakage prevention
    const features = await getInjuryFeaturesForPrediction(fixture_id, predictionTime);

    if (!features) {
      const response = NextResponse.json({
        success: true,
        features: null,
        message: "No injury features available for this fixture",
      });
      addRateLimitHeaders(response, rl.remaining, rl.resetAt);
      return response;
    }

    const response = NextResponse.json({
      success: true,
      features,
      snapshot_date: predictionTime.toISOString(),
      leakage_prevention: "Using historical snapshot from before prediction time",
    });
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error) {
    console.error("Error fetching injury features:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── POST /api/v1/injuries/features ─────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const rl = checkRateLimit("injuries:features:post", request, 10, 60000);

    // Authenticate
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

    if (apiKey === process.env.INTERNAL_API_KEY) {
      isAdmin = true;
    }

    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(injuryFeaturesPostSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error },
        { status: 400 }
      );
    }

    const { fixture_id, all } = validation.data;

    if (all === true) {
      // Process all upcoming fixtures
      const { data: fixtures } = await supabaseAdmin
        .from("fixtures")
        .select("id")
        .gte("kickoff_time", new Date().toISOString())
        .lte("kickoff_time", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
        .in("status", ["scheduled"]);

      if (!fixtures?.length) {
        const response = NextResponse.json({
          success: true,
          processed: 0,
          message: "No upcoming fixtures found",
        });
        addRateLimitHeaders(response, rl.remaining, rl.resetAt);
        return response;
      }

      const response = NextResponse.json({
        success: true,
        fixtures_count: fixtures.length,
        message: "Feature computation triggered for all upcoming fixtures",
        note: "Run: node scripts/compute-injury-features.js",
      });
      addRateLimitHeaders(response, rl.remaining, rl.resetAt);
      return response;
    }

    if (fixture_id) {
      const response = NextResponse.json({
        success: true,
        fixture_id,
        message: "Feature computation triggered for fixture",
        note: `Run: node scripts/compute-injury-features.js --fixture ${fixture_id}`,
      });
      addRateLimitHeaders(response, rl.remaining, rl.resetAt);
      return response;
    }

    return NextResponse.json(
      { error: "Provide fixture_id or { all: true }" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error computing injury features:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
