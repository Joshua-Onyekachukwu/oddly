/**
 * GET /api/v1/fixtures/[id]
 * 
 * Get a single fixture by ID with full details including
 * predictions, odds, head-to-head data, team feature profiles,
 * injuries/availability, prediction context and odds movement.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { fetchMatchContext } from "@/lib/matches/match-context";
import {
  successResponse,
  notFound,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rl = checkRateLimit(`fixture:${id}`, request, 120, 60000);

  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Fetch fixture
    const { data: fixture, error } = await supabase
      .from("fixtures")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !fixture) {
      return notFound("Fixture");
    }

    // Fetch predictions for this fixture
    const { data: predictions } = await supabase
      .from("predictions")
      .select("*")
      .eq("fixture_id", id)
      .order("confidence", { ascending: false });

    // Fetch odds snapshots (snapshot_time is the real column; the previous
    // captured_at ordering silently returned no rows).
    const { data: odds } = await supabase
      .from("odds_snapshots")
      .select("*")
      .eq("fixture_id", id)
      .order("snapshot_time", { ascending: false })
      .limit(50);

    // Richer context sections: team profiles, H2H (with linked xG),
    // injuries joined to importance scores, prediction context and odds
    // movement. All honest-empty-state safe — sections are null/[] when the
    // underlying tables have no rows for this fixture.
    const context = await fetchMatchContext(supabase as any, fixture as any);

    // Surface the fixture-level data-quality assessment carried on prediction
    // rows (all rows for a fixture share the same breakdown).
    const dataQuality =
      (predictions?.[0] as any)?.data_quality_breakdown ??
      (predictions?.[0] as any)?.input_snapshot?.data_quality ??
      null;

    const response = successResponse({
      fixture,
      predictions: predictions || [],
      odds: odds || [],
      data_quality: dataQuality,
      team_profiles: context.team_profiles,
      h2h: context.h2h,
      injuries: context.injuries,
      prediction_context: context.prediction_context,
      odds_summary: context.odds_summary,
    });

    addRateLimitHeaders(response, rl.remaining, rl.resetAt);

    return response;
  } catch (error) {
    console.error(`GET /api/v1/fixtures/${id} error:`, error);
    return internalError();
  }
}
