import { NextRequest, NextResponse } from "next/server";
import { syncTodayFixtures } from "@/lib/sync/fixtures";
import { syncAllOdds, getOddsApiUsage } from "@/lib/sync/odds";
import { notifyValueBets, notifyCrownJewel } from "@/lib/notifications";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { withLock } from "@/lib/cron/lock";
import { startRun, completeRun, type CronRunResult } from "@/lib/cron/logger";

/**
 * Verify the request is from Vercel Cron or an authorized caller.
 * Vercel Cron sends: Authorization: Bearer <VERCEL_CRON_SECRET>
 */
function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;

  // If no cron secret configured, allow all (dev mode)
  if (!cronSecret) { console.error('[CRON] CRITICAL: VERCEL_CRON_SECRET not set — cron auth disabled'); return false; }

  // Verify Vercel cron secret
  if (authHeader === `Bearer ${cronSecret}`) return true;

  return false;
}

/**
 * Run the full sync pipeline: fixtures → odds → notifications.
 */
async function runSync(type: string = "all") {
  const results: Record<string, unknown> = {};
  const startTime = Date.now();

  // Sync odds first — The Odds API is the primary data source.
  // It creates fixtures automatically from odds data.
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

  // Sync fixtures from API-Football (secondary — free plan limited to 2022-2024).
  // This is a fallback; The Odds API already creates most fixtures.
  if (type === "fixtures" || type === "all") {
    try {
      const fixtureResult = await syncTodayFixtures();
      results.fixtures = fixtureResult;
    } catch (error) {
      // Silently handle — API-Football free plan may not have current season
      results.fixtures = {
        note: "API-Football free plan limited to 2022-2024 seasons. The Odds API is primary source.",
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

  return {
    success: true,
    type,
    duration: `${duration}ms`,
    results,
    timestamp: new Date().toISOString(),
  };
}

/**
 * GET /api/v1/cron/sync
 *
 * Called by Vercel Cron Jobs (every 6 hours).
 * Runs full sync: fixtures → odds → value bet notifications.
 * Returns sync status and API usage stats if called without cron auth.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[CRON] Starting scheduled sync...");
    const executionId = await startRun("sync", "cron");
    const lockResult = await withLock("sync", () => runSync("all"), { leaseSeconds: 600 });

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, { status: "FAILED", errorMessage: lockResult.error, durationMs: lockResult.durationMs });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result!;
    await completeRun(executionId, {
      status: "SUCCESS",
      durationMs: lockResult.durationMs,
      metadata: { type: result.type },
    });

    console.log(`[CRON] Sync completed in ${result.duration}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/cron/sync
 *
 * Manual trigger for fixture and/or odds sync.
 * Can be called by admin dashboard or manual trigger.
 *
 * Body:
 *   { type: "fixtures" | "odds" | "all" }
 */
export async function POST(request: NextRequest) {
  try {
    const { requireAdmin } = await import("@/lib/api/utils");
    await requireAdmin(request);

    const body = await request.json().catch(() => ({ type: "all" }));
    const type = body.type || "all";

    console.log(`[MANUAL] Sync triggered: ${type}`);
    const executionId = await startRun("sync", "manual");
    const lockResult = await withLock("sync", () => runSync(type), { leaseSeconds: 600 });

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, { status: "FAILED", errorMessage: lockResult.error, durationMs: lockResult.durationMs });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result!;
    await completeRun(executionId, {
      status: "SUCCESS",
      durationMs: lockResult.durationMs,
      metadata: { type: result.type },
    });

    console.log(`[MANUAL] Sync completed in ${result.duration}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
