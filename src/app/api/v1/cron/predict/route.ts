/**
 * GET /api/v1/cron/predict
 *
 * Generates predictions for upcoming fixtures using the meta-ensemble.
 * Calls the same ensemble wrapper as the settle cron - no duplicate math.
 *
 * Schedule: every 2 hours (every 2 hours)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { predictMatchEnsemble } from "@/lib/models/ensemble";

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
 * ONE prediction engine - no inline Poisson, no duplicate formulas.
 */
async function runPredictionPipeline() {
  const startTime = Date.now();

  // Get upcoming fixtures (12-48h window)
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

  if (fixErr) {
    console.error("[PREDICT] Fixture query error:", fixErr);
    return {
      success: false,
      duration: `${Date.now() - startTime}ms`,
      error: fixErr.message,
    };
  }

  if (!fixtures?.length) {
    return {
      success: true,
      duration: `${Date.now() - startTime}ms`,
      results: { total: 0, predictions: 0, details: "No fixtures in 12-48h window" },
      timestamp: new Date().toISOString(),
    };
  }

  console.log(`[PREDICT] Found ${fixtures.length} fixtures in prediction window`);

  // Pre-load Elo and form (shared across all fixtures)
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

      // Elo update
      const h = (eloMap[home] || 1500) + 65;
      const a = eloMap[away] || 1500;
      const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
      const actual = f.home_score > f.away_score ? 1 : f.home_score < f.away_score ? 0 : 0.5;
      eloMap[home] = (eloMap[home] || 1500) + 32 * (actual - eH);
      eloMap[away] = (eloMap[away] || 1500) + 32 * ((1 - actual) - (1 - eH));

      // Form
      if (!formMap[home]) formMap[home] = [];
      if (!formMap[away]) formMap[away] = [];
      formMap[home].push({ gf: f.home_score, ga: f.away_score, isHome: true });
      formMap[away].push({ gf: f.away_score, ga: f.home_score, isHome: false });
      if (formMap[home].length > 15) formMap[home].shift();
      if (formMap[away].length > 15) formMap[away].shift();
    }
  }

  console.log(`[PREDICT] Loaded ${histFixtures?.length || 0} historical matches for Elo/form`);

  // Generate predictions using the ensemble
  const predictions: any[] = [];
  let ensembleHits = 0;
  let ensembleMisses = 0;

  for (const fixture of fixtures) {
    const home = (fixture as any).home?.canonical_name;
    const away = (fixture as any).away?.canonical_name;
    if (!home || !away) continue;

    try {
      const result = await predictMatchEnsemble(
        home,
        away,
        fixture.league_id,
        eloMap,
        formMap
      );

      if (!result) {
        ensembleMisses++;
        continue;
      }

      ensembleHits++;

      // Store all market predictions
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
    success: true,
    duration: `${duration}ms`,
    results: {
      total: fixtures.length,
      predictions: inserted,
      ensembleHits,
      ensembleMisses,
      modelVersion: "meta-ensemble-v2.0",
    },
    timestamp: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[CRON] Starting prediction pipeline...");
    const result = await runPredictionPipeline();
    console.log(`[CRON] Prediction pipeline completed in ${result.duration}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[CRON] Prediction pipeline error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    console.log("[MANUAL] Prediction pipeline triggered");
    const result = await runPredictionPipeline();
    console.log(`[MANUAL] Prediction pipeline completed in ${result.duration}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[MANUAL] Prediction pipeline error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
