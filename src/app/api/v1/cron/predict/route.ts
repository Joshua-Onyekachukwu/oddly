/**
 * GET /api/v1/cron/predict
 *
 * Generates predictions for upcoming fixtures using the meta-ensemble.
 * Uses the centralized ensemble wrapper - no duplicate math.
 * Includes cron logging and execution locking.
 *
 * Schedule: every 4 hours (vercel.json)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { predictMatchEnsemble } from "@/lib/models/ensemble";
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
    console.error("[PREDICT] CRITICAL: VERCEL_CRON_SECRET not set");
    return false;
  }
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Run prediction pipeline using the ensemble wrapper.
 */
async function runPredictionPipeline(): Promise<{
  total: number;
  predictions: number;
  skipped: number;
  ensembleHits: number;
  ensembleMisses: number;
  modelVersion: string;
}> {
  const startTime = Date.now();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { data: fixtures, error: fixErr } = await supabaseAdmin
    .from("fixtures")
    .select(
      `id, league_id, kickoff_time,
       home:teams!fixtures_home_team_id_fkey(id, canonical_name),
       away:teams!fixtures_away_team_id_fkey(id, canonical_name)`
    )
    .eq("status", "scheduled")
    .gte("kickoff_time", now.toISOString())
    .lte("kickoff_time", windowEnd.toISOString())
    .order("kickoff_time");

  if (fixErr) throw new Error(`Fixture query error: ${fixErr.message}`);
  if (!fixtures?.length) {
    return { total: 0, predictions: 0, skipped: 0, ensembleHits: 0, ensembleMisses: 0, modelVersion: "meta-ensemble-v2.0" };
  }

  console.log(`[PREDICT] Found ${fixtures.length} fixtures in prediction window`);

  // Pre-load Elo and form
  const eloMap: Record<string, number> = {};
  const formMap: Record<string, { gf: number; ga: number; isHome: boolean }[]> = {};

  const { data: histFixtures } = await supabaseAdmin
    .from("fixtures")
    .select(
      `home_score, away_score,
       home:teams!fixtures_home_team_id_fkey(canonical_name),
       away:teams!fixtures_away_team_id_fkey(canonical_name)`
    )
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: true })
    .limit(2000);

  if (histFixtures) {
    for (const f of histFixtures) {
      const home = (f as any).home?.canonical_name;
      const away = (f as any).away?.canonical_name;
      if (!home || !away) continue;
      const h = (eloMap[home] || 1500) + 65;
      const a = eloMap[away] || 1500;
      const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
      const actual = f.home_score > f.away_score ? 1 : f.home_score < f.away_score ? 0 : 0.5;
      eloMap[home] = (eloMap[home] || 1500) + 32 * (actual - eH);
      eloMap[away] = (eloMap[away] || 1500) + 32 * (1 - actual - (1 - eH));
      if (!formMap[home]) formMap[home] = [];
      if (!formMap[away]) formMap[away] = [];
      formMap[home].push({ gf: f.home_score, ga: f.away_score, isHome: true });
      formMap[away].push({ gf: f.away_score, ga: f.home_score, isHome: false });
      if (formMap[home].length > 15) formMap[home].shift();
      if (formMap[away].length > 15) formMap[away].shift();
    }
  }

  console.log(`[PREDICT] Loaded ${histFixtures?.length || 0} historical matches for Elo/form`);

  // IDEMPOTENCY: Check which fixtures already have pending predictions
  const fixtureIds = fixtures.map((f) => f.id);
  const { data: existingPreds } = await supabaseAdmin
    .from("predictions")
    .select("fixture_id")
    .in("fixture_id", fixtureIds)
    .eq("result", "pending");

  const existingFixtureIds = new Set((existingPreds || []).map((p) => p.fixture_id));
  const skipCount = existingFixtureIds.size;
  if (skipCount > 0) {
    console.log(`[PREDICT] Skipping ${skipCount} fixtures with existing pending predictions`);
  }

  // Generate predictions using the ensemble
  const predictions: any[] = [];
  let ensembleHits = 0;
  let ensembleMisses = 0;

  for (const fixture of fixtures) {
    if (existingFixtureIds.has(fixture.id)) continue;

    const home = (fixture as any).home?.canonical_name;
    const away = (fixture as any).away?.canonical_name;
    if (!home || !away) continue;

    try {
      const result = await predictMatchEnsemble(home, away, fixture.league_id, eloMap, formMap);
      if (!result) { ensembleMisses++; continue; }

      ensembleHits++;
      for (const [market, prob] of Object.entries(result.markets)) {
        const parts = market.split("_");
        predictions.push({
          fixture_id: fixture.id,
          market: parts[0],
          selection: parts.slice(1).join("_"),
          model_probability: Math.round(prob * 10000) / 10000,
          model_version: result.modelVersion,
          feature_snapshot: result.featureSnapshot || null,
          ensemble_outputs: result.ensembleOutputs || null,
        });
      }
    } catch (err: any) {
      console.error(`[PREDICT] Ensemble failed for ${home} vs ${away}:`, err.message);
      ensembleMisses++;
    }
  }

  // Batch insert predictions
  let inserted = 0;
  for (let i = 0; i < predictions.length; i += 50) {
    const batch = predictions.slice(i, i + 50);
    const { error } = await supabaseAdmin.from("predictions").insert(batch);
    if (error) {
      console.error("[PREDICT] Insert error:", error.message);
    } else {
      inserted += batch.length;
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[PREDICT] Done: ${fixtures.length} fixtures, ${inserted} predictions ` +
    `(${ensembleHits} ensemble, ${ensembleMisses} misses) in ${duration}ms`
  );

  return {
    total: fixtures.length,
    predictions: inserted,
    skipped: skipCount,
    ensembleHits,
    ensembleMisses,
    modelVersion: "meta-ensemble-v2.0",
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const executionId = await startRun("predict", "cron");
    const lockResult = await withLock("predict", runPredictionPipeline, { leaseSeconds: 300 });

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
    const cronResult: CronRunResult = {
      status: "SUCCESS",
      recordsProcessed: result.total,
      predictionsGenerated: result.predictions,
      metadata: {
        skipped: result.skipped,
        ensembleHits: result.ensembleHits,
        ensembleMisses: result.ensembleMisses,
        modelVersion: result.modelVersion,
      },
    };

    await completeRun(executionId, cronResult);

    return NextResponse.json({
      success: true,
      duration: `${lockResult.durationMs}ms`,
      results: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[CRON] Prediction pipeline error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("[MANUAL] Prediction pipeline triggered");
    const result = await runPredictionPipeline();
    return NextResponse.json({ success: true, results: result, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[MANUAL] Prediction pipeline error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
