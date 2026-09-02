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
import { predictMatchEnsemble, checkPrediction } from "@/lib/models/ensemble";
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
    .select("id, fixture_id, market, selection, model_probability, result")
    .in("fixture_id", fixtureIds);

  const predByFixture: Record<string, Array<any>> = {};
  for (const p of existingPreds || []) {
    if (!predByFixture[p.fixture_id]) predByFixture[p.fixture_id] = [];
    predByFixture[p.fixture_id].push(p);
  }

  // Pre-build Elo and form maps
  const eloMap: Record<string, number> = {};
  const formMap: Record<string, Array<{ gf: number; ga: number; isHome: boolean }>> = {};
  const sortedFixtures = [...fixtures].sort(
    (a, b) => (a.kickoff_time || "").localeCompare(b.kickoff_time || "")
  );
  for (const f of sortedFixtures) {
    const hs = (f.home_team as any)?.canonical_name || "Home";
    const as = (f.away_team as any)?.canonical_name || "Away";
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
  let ensembleHits = 0;
  let ensembleMisses = 0;

  for (const fixture of fixtures) {
    const preds = predByFixture[fixture.id] || [];
    if (preds.length === 0) continue;

    const hs = (fixture.home_team as any)?.canonical_name || "Home";
    const as = (fixture.away_team as any)?.canonical_name || "Away";
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

    for (const p of preds) {
      if (p.result && p.result !== "pending") continue;
      const isCorrect = checkPrediction(pred, p.market, p.selection, homeScore, awayScore);
      settled++;
      if (isCorrect) correct++;
      else incorrect++;

      await supabaseAdmin
        .from("predictions")
        .update({ result: isCorrect ? "correct" : "wrong", settled_at: new Date().toISOString() })
        .eq("id", p.id)
        .eq("result", "pending");
    }
  }

  // Archive to settlement_feed
  let archived = 0;
  if (settled > 0) {
    try {
      const { data: feedData } = await supabaseAdmin
        .from("predictions")
        .select("fixture_id, market, selection, model_probability, model_version, result, settled_at, match_name")
        .not("result", "is", null)
        .neq("result", "pending")
        .order("settled_at", { ascending: false })
        .limit(500);

      if (feedData && feedData.length > 0) {
        await supabaseAdmin.from("settlement_feed").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        const rows = feedData.map((p: any) => ({
          fixture_id: p.fixture_id || "",
          market: p.market,
          selection: p.selection,
          model_probability: p.model_probability || 0,
          model_version: p.model_version || "v5.1",
          result: p.result,
          match_name: p.match_name || null,
          settled_at: p.settled_at || new Date().toISOString(),
        }));
        const BATCH = 100;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH);
          await supabaseAdmin.from("settlement_feed").insert(batch);
          archived += batch.length;
        }
        console.log(`[SETTLE] Archived ${archived} predictions to settlement_feed`);
      }
    } catch (archiveErr) {
      console.error("[SETTLE] Archive warning (non-blocking):", archiveErr);
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[SETTLE] Done: ${settled} settled, ${correct} correct, ${incorrect} incorrect ` +
    `(${ensembleHits} ensemble, ${ensembleMisses} fallback) (${duration}ms)`
  );

  return { settled, correct, incorrect, archived, ensembleHits, ensembleMisses, fixturesProcessed: fixtures.length };
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
