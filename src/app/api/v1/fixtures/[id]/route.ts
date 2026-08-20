/**
 * GET /api/v1/fixtures/[id]
 * 
 * Get a single fixture by ID with full details including
 * predictions, odds, and head-to-head data.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
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
  const rl = checkRateLimit(`fixture:${id}`, 120, 60000);

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

    // Fetch odds snapshots
    const { data: odds } = await supabase
      .from("odds_snapshots")
      .select("*")
      .eq("fixture_id", id)
      .order("captured_at", { ascending: false })
      .limit(10);

    const response = successResponse({
      fixture,
      predictions: predictions || [],
      odds: odds || [],
    });

    addRateLimitHeaders(response, rl.remaining, rl.resetAt);

    return response;
  } catch (error) {
    console.error(`GET /api/v1/fixtures/${id} error:`, error);
    return internalError();
  }
}
