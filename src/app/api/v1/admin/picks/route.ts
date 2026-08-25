/**
 * GET /api/v1/admin/picks
 *
 * Returns today's ONE GAME PICK with full CLV analysis and lineup data.
 * Admin only.
 *
 * Query Params:
 *   - fixtureId: optional specific fixture to show picks for
 *   - limit: number of historical picks to return (default: 20)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  successResponse,
  requireAdmin,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

/* ── helpers ─────────────────────────────────────────────────── */

function loadJSON(filePath: string): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch {}
  return null;
}

function getTodayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ── GET ─────────────────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:picks:${user.id}`, 60, 60000);

    const { searchParams } = new URL(request.url);
    const fixtureId = searchParams.get("fixtureId") || undefined;
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 100);

    /* ── 1. Pipeline state (for picks history) ─────────────── */
    const path = require("path");
    const DATA_DIR = path.join(process.cwd(), "data");
    const pipelineState = loadJSON(path.join(DATA_DIR, "pipeline-state.json")) || {
      picks: [],
      phases: {},
      lastRun: null,
      lastResults: null,
    };

    /* ── 2. CLV snapshots & features ──────────────────────── */
    const clvSnapshots = loadJSON(path.join(DATA_DIR, "clv-snapshots.json")) || { snapshots: {} };
    const clvFeatures = loadJSON(path.join(DATA_DIR, "clv-features.json")) || { features: {} };

    /* ── 3. Predicted lineups ─────────────────────────────── */
    const predictedLineups = loadJSON(path.join(DATA_DIR, "predicted-lineups.json")) || { predictions: [] };

    /* ── 4. Market consensus ──────────────────────────────── */
    const marketConsensus = loadJSON(path.join(DATA_DIR, "market-consensus.json")) || { features: {} };

    /* ── 5. Get today's fixtures from Supabase ────────────── */
    const today = getTodayISO();
    const todayStart = `${today}T00:00:00Z`;
    const todayEnd = `${today}T23:59:59Z`;

    let fixtureQuery = supabase
      .from("fixtures")
      .select("*, leagues!inner(id, name, country)")
      .gte("kickoff_time", todayStart)
      .lte("kickoff_time", todayEnd)
      .order("kickoff_time", { ascending: true });

    if (fixtureId) {
      fixtureQuery = fixtureQuery.eq("id", fixtureId);
    }

    const { data: fixtures, error: fixErr } = await fixtureQuery;

    if (fixErr) {
      return internalError(`Fixture query failed: ${fixErr.message}`);
    }

    /* ── 6. Get team names ────────────────────────────────── */
    const teamIds = [
      ...new Set((fixtures || []).flatMap((f: any) => [f.home_team_id, f.away_team_id])),
    ];
    const { data: teams } = await supabase
      .from("teams")
      .select("id, canonical_name, short_name")
      .in("id", teamIds);

    const teamMap: Record<string, { name: string; short: string }> = {};
    (teams || []).forEach((t: any) => {
      teamMap[t.id] = { name: t.canonical_name, short: t.short_name || t.canonical_name };
    });

    /* ── 7. For each fixture, get predictions + odds + CLV ── */
    const fixtureDetails = await Promise.all(
      (fixtures || []).map(async (fixture: any) => {
        const home = teamMap[fixture.home_team_id] || { name: "Unknown", short: "UNK" };
        const away = teamMap[fixture.away_team_id] || { name: "Unknown", short: "UNK" };

        // Predictions
        const { data: preds } = await supabase
          .from("predictions")
          .select("*")
          .eq("fixture_id", fixture.id)
          .order("model_probability", { ascending: false });

        // Odds
        const { data: odds } = await supabase
          .from("odds_snapshots")
          .select("*")
          .eq("fixture_id", fixture.id);

        // Average odds
        const avgOdds = { home: 0, draw: 0, away: 0 };
        const oddsCounts = { home: 0, draw: 0, away: 0 };
        for (const o of odds || []) {
          const sel = (o.selection || "").toLowerCase();
          const val = (o as any).odds_value || o.odds || 0;
          if (sel === "home" || sel === "1") { avgOdds.home += val; oddsCounts.home++; }
          else if (sel === "draw" || sel === "x") { avgOdds.draw += val; oddsCounts.draw++; }
          else if (sel === "away" || sel === "2") { avgOdds.away += val; oddsCounts.away++; }
        }
        if (oddsCounts.home > 0) avgOdds.home /= oddsCounts.home;
        if (oddsCounts.draw > 0) avgOdds.draw /= oddsCounts.draw;
        if (oddsCounts.away > 0) avgOdds.away /= oddsCounts.away;

        const overround =
          avgOdds.home > 0 && avgOdds.draw > 0 && avgOdds.away > 0
            ? 1 / avgOdds.home + 1 / avgOdds.draw + 1 / avgOdds.away - 1
            : 0;

        // CLV data
        const clvSnapArr = clvSnapshots.snapshots?.[fixture.id] || [];
        const clvFeat = clvFeatures.features?.[fixture.id] || null;

        // Predicted lineup
        const lineupPred = (predictedLineups.predictions || []).find(
          (p: any) => p.fixture_id === fixture.id
        );

        // Market consensus
        const consensus = marketConsensus.features?.[fixture.id] || null;

        // Best prediction
        const bestPred = preds?.[0] || null;
        const selectionKey = (bestPred?.selection || "").toLowerCase();
        const selectionOdds =
          selectionKey === "home" || selectionKey === "1"
            ? avgOdds.home
            : selectionKey === "draw" || selectionKey === "x"
              ? avgOdds.draw
              : selectionKey === "away" || selectionKey === "2"
                ? avgOdds.away
                : 0;
        const impliedProb = selectionOdds > 0 ? 1 / selectionOdds : 0;
        const edge = (bestPred?.model_probability || 0) - impliedProb;

        // Composite score (same formula as pre-match-update.js phase3)
        const compositeScore =
          (bestPred?.model_probability || 0) * 40 +
          Math.max(0, edge) * 100 * 30 +
          (clvFeat?.consensusStrength || 0.5) * 15 +
          ((clvFeat?.sharpMoneyHome === 1 && bestPred?.selection === "Home") ||
          (clvFeat?.sharpMoneyAway === 1 && bestPred?.selection === "Away")
            ? 15
            : 0);

        const kickoff = new Date(fixture.kickoff_time);
        const now = new Date();
        const minutesUntil = Math.round((kickoff.getTime() - now.getTime()) / 60000);

        return {
          fixture_id: fixture.id,
          home: { ...home, id: fixture.home_team_id },
          away: { ...away, id: fixture.away_team_id },
          kickoff_time: fixture.kickoff_time,
          league: fixture.leagues
            ? { name: fixture.leagues.name, country: fixture.leagues.country }
            : null,
          status: fixture.status,
          home_score: fixture.home_score,
          away_score: fixture.away_score,
          minutes_until_kickoff: minutesUntil,

          // All predictions for this fixture
          predictions: (preds || []).map((p: any) => ({
            id: p.id,
            market: p.market,
            selection: p.selection,
            probability: p.model_probability,
            model_version: p.model_version,
            settlement_result: p.settlement_result,
          })),

          best_prediction: bestPred
            ? {
                market: bestPred.market,
                selection: bestPred.selection,
                probability: bestPred.model_probability,
                model_version: bestPred.model_version,
              }
            : null,

          odds: {
            home: Math.round(avgOdds.home * 100) / 100,
            draw: Math.round(avgOdds.draw * 100) / 100,
            away: Math.round(avgOdds.away * 100) / 100,
            overround: Math.round(overround * 10000) / 10000,
            implied_probs: {
              home: avgOdds.home > 0 ? Math.round((1 / avgOdds.home) * 10000) / 10000 : 0,
              draw: avgOdds.draw > 0 ? Math.round((1 / avgOdds.draw) * 10000) / 10000 : 0,
              away: avgOdds.away > 0 ? Math.round((1 / avgOdds.away) * 10000) / 10000 : 0,
            },
            selection_odds: Math.round(selectionOdds * 100) / 100,
            implied_probability: Math.round(impliedProb * 10000) / 10000,
            edge: Math.round(edge * 10000) / 10000,
            edge_pct: impliedProb > 0 ? Math.round((edge / impliedProb) * 10000) / 100 : 0,
            bookmaker_count: (odds || []).reduce(
              (acc: number, o: any) => {
                if (!acc || !acc.toString().includes(o.bookmaker)) return acc;
                return acc;
              },
              new Set((odds || []).map((o: any) => o.bookmaker)).size
            ),
            total_snapshots: odds?.length || 0,
          },

          clv: clvFeat
            ? {
                raw: {
                  home: clvFeat.clvHome,
                  draw: clvFeat.clvDraw,
                  away: clvFeat.clvAway,
                },
                sharp_money: {
                  home: clvFeat.sharpMoneyHome === 1,
                  draw: clvFeat.sharpMoneyDraw === 1,
                  away: clvFeat.sharpMoneyAway === 1,
                },
                movement_pct: {
                  home: Math.round((clvFeat.movementHome || 0) * 10000) / 100,
                  draw: Math.round((clvFeat.movementDraw || 0) * 10000) / 100,
                  away: Math.round((clvFeat.movementAway || 0) * 10000) / 100,
                },
                implied_shift: {
                  home: clvFeat.impliedShiftHome,
                  draw: clvFeat.impliedShiftDraw,
                  away: clvFeat.impliedShiftAway,
                },
                sharpest_side: clvFeat.sharpestSide,
                consensus_strength: clvFeat.consensusStrength,
                overround_change: clvFeat.overroundChange,
                closing_overround: clvFeat.closingOverround,
                snapshot_count: clvFeat.snapshotCount,
                first_snapshot: clvFeat.firstSnapshot,
                last_snapshot: clvFeat.lastSnapshot,
              }
            : clvSnapArr.length > 0
              ? { raw_snapshots: clvSnapArr }
              : null,

          lineup: lineupPred
            ? {
                home: {
                  formation: lineupPred.predicted_lineup?.home?.formation,
                  strength_pct: lineupPred.predicted_lineup?.home?.lineupImpact?.strengthPct,
                  missing_count: lineupPred.predicted_lineup?.home?.missingPlayers?.length || 0,
                  key_missing:
                    lineupPred.predicted_lineup?.home?.missingPlayers?.length || 0,
                  xi: lineupPred.predicted_lineup?.home?.xi,
                  injuries: lineupPred.predicted_lineup?.home?.injuries,
                },
                away: {
                  formation: lineupPred.predicted_lineup?.away?.formation,
                  strength_pct: lineupPred.predicted_lineup?.away?.lineupImpact?.strengthPct,
                  missing_count: lineupPred.predicted_lineup?.away?.missingPlayers?.length || 0,
                  key_missing:
                    lineupPred.predicted_lineup?.away?.missingPlayers?.length || 0,
                  xi: lineupPred.predicted_lineup?.away?.xi,
                  injuries: lineupPred.predicted_lineup?.away?.injuries,
                },
                confidence: lineupPred.predicted_lineup?.confidence,
                generated_at: lineupPred.generated_at,
              }
            : null,

          market_consensus: consensus,
          composite_score: Math.round(compositeScore * 100) / 100,
          confidence_tier:
            (bestPred?.model_probability || 0) >= 0.7
              ? "ELITE"
              : (bestPred?.model_probability || 0) >= 0.6
                ? "HIGH"
                : "MEDIUM",
        };
      })
    );

    /* ── 8. Rank fixtures by composite score ──────────────── */
    fixtureDetails.sort((a: any, b: any) => b.composite_score - a.composite_score);

    /* ── 9. Get today's pick from pipeline state ──────────── */
    const todayPicks = (pipelineState.picks || [])
      .filter((p: any) => p.decided_at?.slice(0, 10) === today)
      .slice(-limit);

    /* ── 10. Historical picks (last N days) ───────────────── */
    const historicalPicks = (pipelineState.picks || []).slice(-limit).reverse();

    /* ── 11. Pipeline phases for today ────────────────────── */
    const todayPhases: Record<string, any> = {};
    for (const [key, val] of Object.entries(pipelineState.phases || {})) {
      if (key.startsWith(today.replace(/-/g, ""))) {
        todayPhases[key] = val;
      }
    }

    const response = successResponse({
      // Today's top pick (the ONE GAME PICK)
      today_pick: fixtureDetails[0] || null,

      // All fixtures today ranked by composite score
      all_fixtures: fixtureDetails,

      // Picks made by the pipeline today
      pipeline_picks: todayPicks,

      // Historical picks
      historical_picks: historicalPicks,

      // Pipeline state
      pipeline: {
        last_run: pipelineState.lastRun,
        total_picks: (pipelineState.picks || []).length,
        phases_completed: Object.keys(pipelineState.phases || {}).length,
        today_phases: todayPhases,
        last_results: pipelineState.lastResults,
      },

      // CLV data summary
      clv: {
        total_fixtures_tracked: Object.keys(clvSnapshots.snapshots || {}).length,
        total_features_computed: Object.keys(clvFeatures.features || {}).length,
        last_snapshot: clvSnapshots.meta?.lastSnapshot || null,
      },

      // Lineup summary
      lineups: {
        total_predicted: (predictedLineups.predictions || []).length,
        generated_at: predictedLineups.generated_at || null,
      },

      meta: {
        date: today,
        generated_at: new Date().toISOString(),
      },
    });

    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse: errResp } = await import("@/lib/api/utils");
        return errResp("FORBIDDEN", authErr.message, 403);
      }
    }
    console.error("GET /api/v1/admin/picks error:", error);
    return internalError();
  }
}
