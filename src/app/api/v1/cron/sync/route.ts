import { NextRequest, NextResponse } from "next/server";
import { syncTodayFixtures } from "@/lib/sync/fixtures";
import { syncAllOdds, getOddsApiUsage } from "@/lib/sync/odds";

/**
 * GET /api/v1/cron/sync
 * 
 * Returns sync status and API usage stats.
 */
export async function GET() {
  try {
    const usage = await getOddsApiUsage();

    return NextResponse.json({
      status: "ready",
      usage,
      endpoints: {
        POST_fixtures: "Sync fixtures from API-Football",
        POST_odds: "Sync odds from The Odds API",
        POST_all: "Sync everything (fixtures + odds)",
      },
    });
  } catch (error) {
    console.error("Sync status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/cron/sync
 * 
 * Trigger fixture and/or odds sync.
 * 
 * Body:
 *   { type: "fixtures" | "odds" | "all" }
 * 
 * Can be called by:
 * - Vercel Cron Jobs
 * - Admin dashboard
 * - Manual trigger
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({ type: "all" }));
    const type = body.type || "all";

    const results: Record<string, unknown> = {};
    const startTime = Date.now();

    // Sync fixtures
    if (type === "fixtures" || type === "all") {
      try {
        const fixtureResult = await syncTodayFixtures();
        results.fixtures = fixtureResult;
      } catch (error) {
        results.fixtures = {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    // Sync odds (depends on fixtures existing)
    if (type === "odds" || type === "all") {
      try {
        const oddsResult = await syncAllOdds();
        results.odds = oddsResult;
      } catch (error) {
        results.odds = {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      type,
      duration: `${duration}ms`,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
