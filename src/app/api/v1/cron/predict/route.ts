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
import { predictMatchEnsemble, resetBatchCaches } from "@/lib/models/ensemble";
import { syncEnsembleRecommendations } from "@/lib/recommendations/ensemble";
import { getInjuryFeaturesForPrediction } from "@/lib/injury/feature-engineering";
import {
  collectDataQuality,
  applyDataQualityToTier,
  probabilityTier,
} from "@/lib/prediction/data-quality";
import { getLeagueGateVerdicts } from "@/lib/analytics/competition-gate";
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
  recommendations: number;
  modelVersion: string;
  dataQuality?: Record<string, number>;
}> {
  resetBatchCaches();
  const startTime = Date.now();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const { data: fixtures, error: fixErr } = await supabaseAdmin
    .from("fixtures")
    .select(
      `id, league_id, kickoff_time, home_team_id, away_team_id,
       home:teams!fixtures_home_team_id_fkey(id, canonical_name),
       away:teams!fixtures_away_team_id_fkey(id, canonical_name)`
    )
    .eq("status", "scheduled")
    .gte("kickoff_time", now.toISOString())
    .lte("kickoff_time", windowEnd.toISOString())
    .order("kickoff_time");

  if (fixErr) throw new Error(`Fixture query error: ${fixErr.message}`);
  if (!fixtures?.length) {
    return { total: 0, predictions: 0, skipped: 0, ensembleHits: 0, ensembleMisses: 0, recommendations: 0, modelVersion: "meta-ensemble-v2.0" };
  }

  console.log(`[PREDICT] Found ${fixtures.length} fixtures in prediction window`);

  // Pre-load Elo and form with NORMALIZED team names
  const eloMap: Record<string, number> = {};
  const formMap: Record<string, { gf: number; ga: number; isHome: boolean }[]> = {};

  // Import normalizer
  const { normalizeTeamName } = await import("@/lib/football/team-normalizer");

  const { data: histFixtures } = await supabaseAdmin
    .from("fixtures")
    .select(
      `kickoff_time, home_score, away_score,
       home:teams!fixtures_home_team_id_fkey(canonical_name),
       away:teams!fixtures_away_team_id_fkey(canonical_name)`
    )
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: false })
    .limit(2000);

  // Replay chronologically (oldest → newest) for correct Elo evolution
  const chronological = [...(histFixtures || [])].sort(
    (a, b) => (a.kickoff_time || "").localeCompare(b.kickoff_time || "")
  );

  if (chronological.length) {
    for (const f of chronological) {
      const homeRaw = (f as any).home?.canonical_name;
      const awayRaw = (f as any).away?.canonical_name;
      if (!homeRaw || !awayRaw) continue;
      // Normalize both team names for consistent lookups
      const home = normalizeTeamName(homeRaw);
      const away = normalizeTeamName(awayRaw);
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

  console.log(`[PREDICT] Loaded ${chronological.length} historical matches for Elo/form (${Object.keys(eloMap).length} teams)`);

  // IDEMPOTENCY: Check which fixtures already have pending predictions.
  // NOTE: PostgREST hard-caps responses at 1000 rows, and ~45 fixtures ×
  // ~24 markets exceeds that — an unchunked `.in()` silently drops the tail
  // fixtures, which then get re-processed every run and hit
  // uq_prediction_fixture_market_selection on insert. Chunk the lookup.
  const fixtureIds = fixtures.map((f) => f.id);
  const existingFixtureIds = new Set<string>();
  const CHUNK = 25; // 25 fixtures × ~30 markets stays well under the 1000-row cap
  for (let i = 0; i < fixtureIds.length; i += CHUNK) {
    const { data: existingPreds, error: predLookupErr } = await supabaseAdmin
      .from("predictions")
      .select("fixture_id")
      .in("fixture_id", fixtureIds.slice(i, i + CHUNK))
      .eq("result", "pending");
    if (predLookupErr) {
      console.error("[PREDICT] Existing-predictions lookup error:", predLookupErr.message);
    }
    for (const p of existingPreds || []) existingFixtureIds.add(p.fixture_id);
  }
  const skipCount = existingFixtureIds.size;
  if (skipCount > 0) {
    console.log(`[PREDICT] Skipping ${skipCount} fixtures with existing pending predictions`);
  }

  // Data-quality scoring: batched per-fixture assessment of history, injuries,
  // odds, xG, lineups and freshness. Stored on every prediction row as metadata
  // (never gates recording — the immutable audit trail is preserved).
  const qualityInputs = fixtures
    .filter((f: any) => !existingFixtureIds.has(f.id))
    .map((f: any) => ({
      id: f.id,
      kickoff_time: f.kickoff_time,
      league_id: f.league_id ?? null,
      home_team_id: f.home_team_id ?? f.home?.id ?? null,
      away_team_id: f.away_team_id ?? f.away?.id ?? null,
      home_name: f.home?.canonical_name ?? null,
      away_name: f.away?.canonical_name ?? null,
    }));
  let dataQualityByFixture = new Map<string, import("@/lib/prediction/data-quality").DataQualityResult>();
  const dataQualityVerdicts: Record<string, number> = {};
  try {
    dataQualityByFixture = await collectDataQuality(qualityInputs, supabaseAdmin, now);
    for (const dq of dataQualityByFixture.values()) {
      dataQualityVerdicts[dq.verdict] = (dataQualityVerdicts[dq.verdict] ?? 0) + 1;
    }
    console.log(`[PREDICT] Data-quality verdicts: ${JSON.stringify(dataQualityVerdicts)}`);
  } catch (dqErr: any) {
    console.error("[PREDICT] Data-quality collection failed (non-fatal):", dqErr?.message);
  }

  // Competition gate verdicts (league_model_gates, refreshed weekly by learn
  // cron). Advisory only — recorded into input_snapshot for audit/analysis;
  // predictions are NEVER suppressed, even for 'exclude' leagues.
  let leagueGateVerdicts = new Map<string, string>();
  try {
    leagueGateVerdicts = await getLeagueGateVerdicts(supabaseAdmin);
  } catch (gateErr: any) {
    console.error("[PREDICT] League gate lookup failed (non-fatal):", gateErr?.message);
  }

  // Generate predictions using the ensemble
  const predictions: any[] = [];
  let ensembleHits = 0;
  let ensembleMisses = 0;
  // fixture_id → model_version for fixtures that produced ensemble output,
  // used to derive `recommendations` rows after predictions are inserted.
  const predictedFixtures = new Map<string, string>();

  for (const fixture of fixtures) {
    if (existingFixtureIds.has(fixture.id)) continue;

    const homeRaw = (fixture as any).home?.canonical_name;
    const awayRaw = (fixture as any).away?.canonical_name;
    if (!homeRaw || !awayRaw) continue;
    // Normalize fixture team names to match form/Elo map keys
    const home = normalizeTeamName(homeRaw);
    const away = normalizeTeamName(awayRaw);
    if (!home || !away) continue;

    try {
      const result = await predictMatchEnsemble(home, away, fixture.league_id, eloMap, formMap, fixture.kickoff_time);
      if (!result) { ensembleMisses++; continue; }

      ensembleHits++;
      predictedFixtures.set(fixture.id, result.modelVersion);
      // Rich injury features (point-in-time safe: only snapshots at/before now)
      let injuryFeatures: unknown = null;
      try {
        injuryFeatures = await getInjuryFeaturesForPrediction(fixture.id, now);
      } catch {}
      const injurySnapshot = injuryFeatures
        ? {
            home_impact: (injuryFeatures as any).home_features?.injury_impact_score ?? null,
            away_impact: (injuryFeatures as any).away_features?.injury_impact_score ?? null,
            home_missing_key: (injuryFeatures as any).home_features?.missing_key_players ?? null,
            away_missing_key: (injuryFeatures as any).away_features?.missing_key_players ?? null,
            home_availability_pct: (injuryFeatures as any).home_features?.availability_pct ?? null,
            away_availability_pct: (injuryFeatures as any).away_features?.availability_pct ?? null,
          }
        : null;
      // Immutable input snapshot — what the model saw at prediction time
      const dataQuality = dataQualityByFixture.get(fixture.id) ?? null;
      const inputSnapshot = {
        kickoff_time: fixture.kickoff_time,
        league_id: fixture.league_id,
        home_elo: Math.round(eloMap[home] ?? 1500),
        away_elo: Math.round(eloMap[away] ?? 1500),
        home_form: (formMap[home] || []).slice(-5),
        away_form: (formMap[away] || []).slice(-5),
        injury: injurySnapshot,
        data_quality: dataQuality,
        league_gate: leagueGateVerdicts.get(fixture.league_id ?? "unknown") ?? null,
        captured_at: now.toISOString(),
      };
      for (const [market, prob] of Object.entries(result.markets)) {
        const parts = market.split("_");
        // Abstention: data quality caps confidence_tier but never suppresses
        // the row — predictions are an immutable audit record.
        const baseTier = probabilityTier(prob);
        const confidenceTier = dataQuality
          ? applyDataQualityToTier(baseTier, dataQuality)
          : "LOW";
        predictions.push({
          fixture_id: fixture.id,
          market: parts[0],
          selection: parts.slice(1).join("_").toLowerCase(),
          model_probability: Math.round(prob * 10000) / 10000,
          model_version: result.modelVersion,
          input_snapshot: inputSnapshot,
          feature_version: "ensemble-v1",
          injury_features_used: injuryFeatures,
          injury_snapshot_date: injuryFeatures ? now.toISOString() : null,
          confidence_tier: confidenceTier,
          // data_quality_score column is 0-100 int in this schema
          // (seed.sql / nvidia engine convention); full breakdown in jsonb.
          data_quality_score: dataQuality ? Math.round(dataQuality.score * 100) : null,
          data_quality_breakdown: dataQuality,
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

  // Derive `recommendations` (value bets) from the ensemble predictions so
  // /api/v1/value-bets, the accumulator page and Crown Jewel notifications
  // are populated by the canonical pipeline — previously only the manual
  // NVIDIA engine wrote this table.
  let recommendationsInserted = 0;
  if (predictedFixtures.size > 0) {
    const byVersion = new Map<string, string[]>();
    for (const [fixtureId, mv] of predictedFixtures) {
      const list = byVersion.get(mv) || [];
      list.push(fixtureId);
      byVersion.set(mv, list);
    }
    for (const [mv, ids] of byVersion) {
      const recResult = await syncEnsembleRecommendations(ids, mv);
      recommendationsInserted += recResult.recommendations;
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `[PREDICT] Done: ${fixtures.length} fixtures, ${inserted} predictions, ` +
    `${recommendationsInserted} recommendations ` +
    `(${ensembleHits} ensemble, ${ensembleMisses} misses) in ${duration}ms`
  );

  return {
    total: fixtures.length,
    predictions: inserted,
    skipped: skipCount,
    ensembleHits,
    ensembleMisses,
    recommendations: recommendationsInserted,
    modelVersion: "meta-ensemble-v2.0",
    dataQuality: dataQualityVerdicts,
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
    const { requireAdmin } = await import("@/lib/api/utils");
    await requireAdmin(request);

    console.log("[MANUAL] Prediction pipeline triggered from admin");
    const executionId = await startRun("predict", "manual");
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
    await completeRun(executionId, {
      status: "SUCCESS",
      recordsProcessed: result.total,
      predictionsGenerated: result.predictions,
      durationMs: lockResult.durationMs,
      metadata: {
        skipped: result.skipped,
        ensembleHits: result.ensembleHits,
        ensembleMisses: result.ensembleMisses,
      },
    });

    return NextResponse.json({ success: true, results: result, duration: `${lockResult.durationMs}ms`, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[MANUAL] Prediction pipeline error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
