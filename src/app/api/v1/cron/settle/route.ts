/**
 * POST /api/v1/cron/settle
 *
 * Settles predictions against actual match results using the ensemble model.
 * Includes cron logging and execution locking.
 *
 * Schedule: every 4 hours (vercel.json)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { predictMatchEnsemble, checkPredictionOutcome } from "@/lib/models/ensemble";
import { normalizeTeamName } from "@/lib/football/team-normalizer";
import { withLock } from "@/lib/cron/lock";
import { startRun, completeRun, type CronRunResult } from "@/lib/cron/logger";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) {
    console.error("[CRON] CRITICAL: VERCEL_CRON_SECRET not set");
    return false;
  }
  return authHeader === `Bearer ${cronSecret}`;
}

interface SettleResult {
  settled: number;
  correct: number;
  incorrect: number;
  voided: number;
  undetermined: number;
  archived: number;
  ensembleHits: number;
  ensembleMisses: number;
  fixturesProcessed: number;
}

async function runSettlement(): Promise<SettleResult> {
  const startTime = Date.now();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: fixtures, error: fixErr } = await supabaseAdmin
    .from("fixtures")
    .select(
      `id, home_team_id, away_team_id, league_id, kickoff_time,
       home_score, away_score, status,
       home_team:teams!fixtures_home_team_id_fkey(id, canonical_name),
       away_team:teams!fixtures_away_team_id_fkey(id, canonical_name)`
    )
    .eq("status", "finished")
    .not("home_score", "is", null)
    .gte("kickoff_time", sevenDaysAgo)
    .order("kickoff_time", { ascending: false })
    .limit(500);

  if (fixErr || !fixtures) throw new Error(`Failed to load fixtures: ${fixErr?.message}`);
  console.log(`[SETTLE] Processing ${fixtures.length} finished fixtures...`);

  const fixtureIds = fixtures.map((f) => f.id);
  const { data: existingPreds } = await supabaseAdmin
    .from("predictions")
    .select("id, fixture_id, market, selection, model_probability, model_version, confidence_tier, result")
    .in("fixture_id", fixtureIds);

  const predByFixture: Record<string, Array<any>> = {};
  for (const p of existingPreds || []) {
    if (!predByFixture[p.fixture_id]) predByFixture[p.fixture_id] = [];
    predByFixture[p.fixture_id].push(p);
  }

  // Pre-build Elo and form maps from the same 2000-match window the predict
  // cron uses, so settlement-time ratings match prediction-time ratings.
  const { data: eloHistory } = await supabaseAdmin
    .from("fixtures")
    .select(
      `kickoff_time, home_score, away_score,
       home_team:teams!fixtures_home_team_id_fkey(canonical_name),
       away_team:teams!fixtures_away_team_id_fkey(canonical_name)`
    )
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: false })
    .limit(2000);

  const eloMap: Record<string, number> = {};
  const formMap: Record<string, Array<{ gf: number; ga: number; isHome: boolean }>> = {};
  const sortedFixtures = [...(eloHistory || [])].sort(
    (a, b) => (a.kickoff_time || "").localeCompare(b.kickoff_time || "")
  );
  for (const f of sortedFixtures) {
    const hs = normalizeTeamName((f.home_team as any)?.canonical_name || "Home");
    const as = normalizeTeamName((f.away_team as any)?.canonical_name || "Away");
    const hg = f.home_score || 0;
    const ag = f.away_score || 0;
    const h = (eloMap[hs] || 1500) + 65;
    const a = eloMap[as] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    eloMap[hs] = (eloMap[hs] || 1500) + 32 * (actual - eH);
    eloMap[as] = (eloMap[as] || 1500) + 32 * (1 - actual - (1 - eH));
    if (!formMap[hs]) formMap[hs] = [];
    if (!formMap[as]) formMap[as] = [];
    formMap[hs].push({ gf: hg, ga: ag, isHome: true });
    formMap[as].push({ gf: ag, ga: hg, isHome: false });
    if (formMap[hs].length > 15) formMap[hs].shift();
    if (formMap[as].length > 15) formMap[as].shift();
  }

  let settled = 0;
  let correct = 0;
  let incorrect = 0;
  let voided = 0;
  let undetermined = 0;
  let ensembleHits = 0;
  let ensembleMisses = 0;

  // Audit + feed rows collected during settlement (batch-inserted after the loop)
  const settlementEvents: any[] = [];
  const feedRows: any[] = [];

  for (const fixture of fixtures) {
    const preds = predByFixture[fixture.id] || [];
    if (preds.length === 0) continue;

    const hs = normalizeTeamName((fixture.home_team as any)?.canonical_name || "Home");
    const as = normalizeTeamName((fixture.away_team as any)?.canonical_name || "Away");
    const homeScore = fixture.home_score || 0;
    const awayScore = fixture.away_score || 0;

    const ensemblePred = await predictMatchEnsemble(hs, as, fixture.league_id || undefined, eloMap, formMap as any);
    const pred: Record<string, any> = { ...(ensemblePred?.markets || {}) };
    if (ensemblePred) ensembleHits++;
    else ensembleMisses++;

    if (ensemblePred?.bestPick) {
      const bp = ensemblePred.bestPick;
      pred["smart_selection"] = {
        market: bp.market.startsWith("1X2") ? "1X2" : bp.market.replace(/_\d+\.?\d*$/, "").toLowerCase(),
        selection: bp.market.replace("1X2_", "").replace("OU_", "").replace("DC_", "").replace("BTTS_", "").toLowerCase(),
        probability: bp.probability,
      };
    }

    // Pre-compute failure diagnostics from ensemble output
    const subModelProbs = ensemblePred ? {
      home: ensemblePred.models?.oneXtwo?.home ?? null,
      draw: ensemblePred.models?.oneXtwo?.draw ?? null,
      away: ensemblePred.models?.oneXtwo?.away ?? null,
      over25: ensemblePred.models?.goals?.over25 ?? null,
      bttsYes: ensemblePred.models?.btts?.bttsYes ?? null,
      dc1X: ensemblePred.models?.dc?.dc1X ?? null,
      expectedGoals: ensemblePred.models?.goals?.expectedGoals ?? null,
      signals: ensemblePred.signals ?? null,
    } : null;

    for (const p of preds) {
      if (p.result && p.result !== "pending") continue;
      const outcome = checkPredictionOutcome(pred, p.market, p.selection, homeScore, awayScore);

      // "undetermined" = market/selection can't be mapped to a settlement
      // rule. Leave the prediction pending rather than guess correct/wrong.
      if (outcome === "undetermined") {
        undetermined++;
        continue;
      }

      settled++;
      const isCorrect = outcome === "correct";
      const isVoid = outcome === "void";
      if (isCorrect) correct++;
      else if (isVoid) voided++;
      else incorrect++;

      const settledAt = new Date().toISOString();
      const newResult = isCorrect ? "correct" : isVoid ? "void" : "wrong";

      // Build update payload
      const updatePayload: Record<string, any> = {
        result: newResult,
        settled_at: settledAt,
      };

      // Audit trail: record every first settle (pending/null -> settled).
      // This loop skips already-settled predictions, so unchanged
      // re-settles never reach here and corrections are only logged by
      // whichever code path actually changes `result`.
      settlementEvents.push({
        prediction_id: p.id,
        fixture_id: fixture.id,
        market: p.market,
        selection: p.selection,
        previous_result: p.result || "pending",
        new_result: newResult,
        settled_at: settledAt,
        source: "cron/settle",
        raw_score: { home_score: homeScore, away_score: awayScore, status: fixture.status },
        notes: isCorrect ? null : isVoid ? "settled_void" : "settled_incorrect",
      });

      // Feed row for append-only upsert keyed on prediction_id
      feedRows.push({
        prediction_id: p.id,
        fixture_id: fixture.id,
        market: p.market,
        selection: p.selection,
        model_probability: p.model_probability || 0,
        model_version: p.model_version || ensemblePred?.modelVersion || "v5.1",
        result: newResult,
        match_name: null,
        settled_at: settledAt,
      });

      // On wrong predictions, store failure diagnostics (voids are pushes,
      // not failures — no diagnostics needed).
      if (outcome === "wrong" && ensemblePred) {
        // Model disagreement: std dev of sub-model probabilities for the predicted selection
        const sel = (p.selection || "").toLowerCase();
        let disagreement = 0;
        if (subModelProbs) {
          const probs = [
            subModelProbs.home,
            subModelProbs.draw,
            subModelProbs.away,
          ].filter((v): v is number => v != null);
          if (probs.length > 1) {
            const mean = probs.reduce((s, v) => s + v, 0) / probs.length;
            disagreement = Math.sqrt(probs.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / probs.length);
          }
        }

        // Actual outcome description
        const totalGoals = homeScore + awayScore;
        const outcome = homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw";
        const bothScored = homeScore > 0 && awayScore > 0;

        // Why it failed: compare ensemble prediction to actual
        const ensembleProb = p.model_probability || 0;
        const impliedEdge = ensembleProb - (p.odds_value || 0);

        updatePayload.sub_model_probabilities = subModelProbs;
        updatePayload.model_disagreement = Math.round(disagreement * 10000) / 10000;
        updatePayload.features_used = {
          failure_summary: {
            predicted_selection: sel,
            actual_outcome: outcome,
            actual_score: `${homeScore}-${awayScore}`,
            total_goals: totalGoals,
            both_scored: bothScored,
            ensemble_confidence: ensembleProb,
            model_version: p.model_version || ensemblePred.modelVersion,
            disagreement: Math.round(disagreement * 10000) / 10000,
            key_signals: ensemblePred.signals ? Object.entries(ensemblePred.signals)
              .filter(([, v]: [string, any]) => v && v.strength !== undefined)
              .map(([k, v]: [string, any]) => ({ signal: k, strength: v.strength, direction: v.direction }))
              : [],
            settlement_date: new Date().toISOString(),
          },
        };
      }

      await supabaseAdmin
        .from("predictions")
        .update(updatePayload)
        .eq("id", p.id)
        .eq("result", "pending");
    }
  }

  // Append-only audit trail: one settlement_events row per prediction
  // settled this run (first settles only — see loop above).
  let eventsWritten = 0;
  if (settlementEvents.length > 0) {
    try {
      const BATCH = 200;
      for (let i = 0; i < settlementEvents.length; i += BATCH) {
        const { error: evErr } = await supabaseAdmin
          .from("settlement_events")
          .insert(settlementEvents.slice(i, i + BATCH));
        if (evErr) {
          console.error("[SETTLE] settlement_events insert error:", evErr.message);
        } else {
          eventsWritten += Math.min(BATCH, settlementEvents.length - i);
        }
      }
    } catch (evErr) {
      console.error("[SETTLE] settlement_events warning (non-blocking):", evErr);
    }
  }

  // Archive this run's settlements to settlement_feed via upsert on the
  // prediction_id natural key. Append-only: history is preserved (the DB
  // trigger trims rows older than 90 days). The archive cron remains as
  // an idempotent backstop for predictions settled outside this route
  // (e.g. lib/prediction/tracking.ts).
  let archived = 0;
  if (feedRows.length > 0) {
    try {
      const BATCH = 100;
      for (let i = 0; i < feedRows.length; i += BATCH) {
        const { error: upsertErr } = await supabaseAdmin
          .from("settlement_feed")
          .upsert(feedRows.slice(i, i + BATCH), { onConflict: "prediction_id" });
        if (upsertErr) {
          console.error("[SETTLE] settlement_feed upsert error:", upsertErr.message);
        } else {
          archived += Math.min(BATCH, feedRows.length - i);
        }
      }
      console.log(`[SETTLE] Upserted ${archived} predictions to settlement_feed`);
    } catch (archiveErr) {
      console.error("[SETTLE] Archive warning (non-blocking):", archiveErr);
    }
  }

  // Update model_performance after settlement
  if (settled > 0) {
    try {
      // Get recent settled predictions (last 24h) for each market
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentSettled } = await supabaseAdmin
        .from("predictions")
        .select("market, model_version, selection, result, model_probability")
        .not("result", "is", null)
        .neq("result", "pending")
        .gte("settled_at", oneDayAgo)
        .limit(10000);

      if (recentSettled && recentSettled.length > 0) {
        // Group by market; accumulate Brier inline (O(n)) — the previous
        // version did a linear .find() per probability, which was O(n²)
        // and could match the wrong row when probabilities collided.
        const byMarket: Record<string, { total: number; correct: number; brierSum: number; probCount: number }> = {};
        for (const p of recentSettled) {
          if (p.result === "void") continue; // pushes are neither hit nor miss
          const mkt = p.market || "unknown";
          if (!byMarket[mkt]) byMarket[mkt] = { total: 0, correct: 0, brierSum: 0, probCount: 0 };
          byMarket[mkt].total++;
          if (p.result === "correct") byMarket[mkt].correct++;
          if (p.model_probability) {
            const actual = p.result === "correct" ? 1 : 0;
            byMarket[mkt].brierSum += Math.pow(p.model_probability - actual, 2);
            byMarket[mkt].probCount++;
          }
        }

        const nowIso = new Date().toISOString();
        for (const [mkt, stats] of Object.entries(byMarket)) {
          const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
          const brier = stats.probCount > 0 ? stats.brierSum / stats.probCount : 0;

          // Upsert on the (model_version, market, league_id) natural key
          // instead of delete + insert — idempotent across reruns.
          const { error: upsertErr } = await supabaseAdmin
            .from("model_performance")
            .upsert(
              {
                model_version: "v2.0-meta-ensemble",
                market: mkt,
                league_id: null,
                total_predictions: stats.total,
                correct_predictions: stats.correct,
                brier_score: Math.round(brier * 10000) / 10000,
                calibration_data: {
                  source: "settle_cron",
                  accuracy_pct: Math.round(accuracy * 1000) / 10,
                  avg_brier: Math.round(brier * 10000) / 10000,
                  tracked_at: nowIso,
                  window: "24h",
                },
                period_start: oneDayAgo,
                period_end: nowIso,
              },
              { onConflict: "model_version,market,league_id" }
            );

          if (upsertErr) {
            console.error(`[SETTLE] model_performance upsert error for ${mkt}:`, upsertErr.message);
          } else {
            console.log(`[SETTLE] Updated model_performance for ${mkt}: ${(accuracy * 100).toFixed(1)}% (${stats.total} predictions)`);
          }
        }
      }
    } catch (perfErr) {
      console.error("[SETTLE] model_performance update warning (non-blocking):", perfErr);
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[SETTLE] Done: ${settled} settled, ${correct} correct, ${incorrect} incorrect, ` +
    `${voided} void, ${undetermined} undetermined ` +
    `(${ensembleHits} ensemble, ${ensembleMisses} fallback, ${eventsWritten} audit events) (${duration}ms)`
  );

  return { settled, correct, incorrect, voided, undetermined, archived, ensembleHits, ensembleMisses, fixturesProcessed: fixtures.length };
}

export async function POST(request: NextRequest) {
  try {
    const { requireAdmin } = await import("@/lib/api/utils");
    await requireAdmin(request);

    console.log("[MANUAL] Settlement triggered from admin");
    const executionId = await startRun("settle", "manual");
    const lockResult = await withLock("settle", runSettlement, { leaseSeconds: 600 });

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, {
        status: "FAILED",
        errorMessage: lockResult.error,
        durationMs: lockResult.durationMs,
      });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result!;
    const accuracy = result.settled > 0 ? ((result.correct / result.settled) * 100).toFixed(1) + "%" : "N/A";

    const cronResult: CronRunResult = {
      status: "SUCCESS",
      recordsProcessed: result.fixturesProcessed,
      predictionsSettled: result.settled,
      recordsCreated: result.archived,
      metadata: {
        correct: result.correct,
        incorrect: result.incorrect,
        voided: result.voided,
        undetermined: result.undetermined,
        accuracy,
        ensembleHits: result.ensembleHits,
        ensembleMisses: result.ensembleMisses,
      },
    };

    await completeRun(executionId, cronResult);

    return NextResponse.json({
      success: true,
      model: "meta-ensemble-v2.0",
      settled: result.settled,
      correct: result.correct,
      incorrect: result.incorrect,
      voided: result.voided,
      undetermined: result.undetermined,
      accuracy,
      ensembleHits: result.ensembleHits,
      ensembleMisses: result.ensembleMisses,
      fixturesProcessed: result.fixturesProcessed,
      archived: result.archived,
      duration: `${lockResult.durationMs}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[SETTLE] Error:", error);
    return NextResponse.json({ error: "Settle failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const executionId = await startRun("settle", "cron");
    const lockResult = await withLock("settle", runSettlement, { leaseSeconds: 600 });

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, {
        status: "FAILED",
        errorMessage: lockResult.error,
        durationMs: lockResult.durationMs,
      });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result!;
    const accuracy = result.settled > 0 ? ((result.correct / result.settled) * 100).toFixed(1) + "%" : "N/A";

    const cronResult: CronRunResult = {
      status: "SUCCESS",
      recordsProcessed: result.fixturesProcessed,
      predictionsSettled: result.settled,
      recordsCreated: result.archived,
      metadata: {
        correct: result.correct,
        incorrect: result.incorrect,
        voided: result.voided,
        undetermined: result.undetermined,
        accuracy,
        ensembleHits: result.ensembleHits,
        ensembleMisses: result.ensembleMisses,
      },
    };

    await completeRun(executionId, cronResult);

    return NextResponse.json({
      success: true,
      model: "meta-ensemble-v2.0",
      settled: result.settled,
      correct: result.correct,
      incorrect: result.incorrect,
      voided: result.voided,
      undetermined: result.undetermined,
      accuracy,
      ensembleHits: result.ensembleHits,
      ensembleMisses: result.ensembleMisses,
      fixturesProcessed: result.fixturesProcessed,
      archived: result.archived,
      duration: `${lockResult.durationMs}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[SETTLE] Error:", error);
    return NextResponse.json({ error: "Settle failed" }, { status: 500 });
  }
}
