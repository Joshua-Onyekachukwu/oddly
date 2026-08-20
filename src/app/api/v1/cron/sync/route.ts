import { NextRequest, NextResponse } from "next/server";
import { syncTodayFixtures } from "@/lib/sync/fixtures";
import { syncAllOdds, getOddsApiUsage } from "@/lib/sync/odds";
import { notifyValueBets, notifyCrownJewel } from "@/lib/notifications";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

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

    // After sync, check for new value bets and Crown Jewel
    if (type === "all" || type === "odds") {
      try {
        const supabase = createClient<Database>(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Check for value bets
        const { data: valueBets } = await supabase
          .from("recommendations")
          .select(`
            id, market, selection, bookmaker_odds, edge,
            fixture:fixtures(id, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name))
          `)
          .eq("is_recommended", true)
          .order("edge", { ascending: false })
          .limit(5);

        if (valueBets?.length) {
          const formatted = valueBets.map((vb) => {
            const fixture = vb.fixture as unknown as {
              home_team: { canonical_name: string };
              away_team: { canonical_name: string };
            };
            return {
              fixture: `${fixture?.home_team?.canonical_name || "?"} vs ${fixture?.away_team?.canonical_name || "?"}`,
              market: vb.market,
              selection: vb.selection,
              edge: Number(vb.edge),
              odds: Number(vb.bookmaker_odds),
            };
          });
          const notified = await notifyValueBets(formatted);
          results.notifications = { valueBets: notified };
        }

        // Check for Crown Jewel
        const { data: crownJewel } = await supabase
          .from("recommendations")
          .select(`
            id, market, selection, edge, model_probability,
            fixture:fixtures(home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), league:leagues(name))
          `)
          .eq("is_recommended", true)
          .order("edge", { ascending: false })
          .limit(1)
          .single();

        if (crownJewel) {
          const fixture = crownJewel.fixture as unknown as {
            home_team: { canonical_name: string };
            away_team: { canonical_name: string };
            league: { name: string };
          };
          await notifyCrownJewel(
            {
              homeTeam: fixture?.home_team?.canonical_name || "?",
              awayTeam: fixture?.away_team?.canonical_name || "?",
              league: fixture?.league?.name || "?",
            },
            {
              market: crownJewel.market,
              selection: crownJewel.selection,
              edge: Number(crownJewel.edge),
              confidence: Number(crownJewel.model_probability),
            }
          );
        }
      } catch (err) {
        console.error("Notification trigger error:", err);
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
