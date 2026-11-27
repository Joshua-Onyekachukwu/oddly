/**
 * Ensemble → Recommendations bridge
 *
 * The canonical predict cron (/api/v1/cron/predict) writes `predictions` rows
 * from the meta-ensemble but historically never wrote `recommendations`, so
 * /api/v1/value-bets, the accumulator page and Crown Jewel/value-bet
 * notifications starved. This module derives recommendation rows from the
 * ensemble predictions + latest odds snapshots, mirroring the thresholds the
 * NVIDIA engine path (src/lib/nvidia/prediction-engine.ts) uses:
 *
 *   - only selections with bookmaker odds are considered
 *   - edge = model_probability - (1 / best_odds)
 *   - rows kept when edge >= 5%
 *   - is_recommended when edge > 8% AND model_probability > 70%
 *     (same bar generateCrownJewel() applies)
 *
 * Idempotent: deletes existing recommendation rows for the fixture scoped to
 * the markets the ensemble covers, then re-inserts — safe on re-runs.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const MIN_EDGE = 0.05;
const RECOMMENDED_EDGE = 0.08;
const RECOMMENDED_PROB = 0.7;
const ODDS_LOOKBACK_DAYS = 14;

interface PredictionRow {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  model_probability: number | string;
}

/**
 * Map a predictions-table (market, selection) pair to the
 * odds_snapshots (market, selection) pair written by src/lib/sync/odds.ts.
 * Returns null when no bookmaker market exists for this selection.
 */
export function toOddsKey(
  market: string,
  selection: string
): { market: string; selection: string } | null {
  const m = (market || "").toLowerCase();
  const s = (selection || "").toLowerCase();

  // 1X2 → match_result (home/draw/away)
  if (m === "1x2" || m === "match_result" || m === "matchresult") {
    if (s === "home" || s === "draw" || s === "away") {
      return { market: "match_result", selection: s };
    }
    return null;
  }

  // OU over_2.5 / under_3.5 → over_under_2.5 / over_under_3.5 (over/under)
  if (m === "ou" || m === "over_under" || m === "totals") {
    const match = s.match(/^(over|under)_(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const line = match[2];
    // The Odds API sync only produces totals lines 1.5/2.5/3.5; allow the
    // full half-line set so other writers' odds are picked up if present.
    if (!["0.5", "1.5", "2.5", "3.5", "4.5"].includes(line)) return null;
    return { market: `over_under_${line}`, selection: match[1] };
  }

  // BTTS, DC, DNB, HomeGoals, AwayGoals — no bookmaker odds market synced.
  return null;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Derive and upsert `recommendations` rows for fixtures that just received
 * ensemble predictions.
 *
 * @param fixtureIds  fixtures processed in this run
 * @param modelVersion ensemble model_version written to `predictions`
 * @returns counts for cron logging
 */
export async function syncEnsembleRecommendations(
  fixtureIds: string[],
  modelVersion: string
): Promise<{ fixtures: number; recommendations: number }> {
  if (!fixtureIds.length || !modelVersion) {
    return { fixtures: 0, recommendations: 0 };
  }

  // PostgREST hard-caps responses at 1000 rows — chunk fixture-id lookups
  // so large batches don't silently lose tail fixtures.
  const preds: PredictionRow[] = [];
  for (let i = 0; i < fixtureIds.length; i += 25) {
    const { data, error: predErr } = await supabaseAdmin
      .from("predictions")
      .select("id, fixture_id, market, selection, model_probability")
      .in("fixture_id", fixtureIds.slice(i, i + 25))
      .eq("model_version", modelVersion);
    if (predErr) {
      console.error("[RECS] Failed to fetch ensemble predictions:", predErr.message);
      return { fixtures: 0, recommendations: 0 };
    }
    preds.push(...((data || []) as PredictionRow[]));
  }
  if (!preds.length) {
    return { fixtures: 0, recommendations: 0 };
  }

  // 2. Latest odds per fixture/market/selection → best (max) odds across
  //    bookmakers, same "best price" semantics as the NVIDIA engine.
  //    Chunked small: odds history per fixture can be hundreds of rows.
  const since = new Date(
    Date.now() - ODDS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const oddsRows: Array<{
    fixture_id: string;
    market: string;
    selection: string;
    odds: number | string;
  }> = [];
  for (let i = 0; i < fixtureIds.length; i += 3) {
    const { data, error: oddsErr } = await supabaseAdmin
      .from("odds_snapshots")
      .select("fixture_id, market, selection, odds")
      .in("fixture_id", fixtureIds.slice(i, i + 3))
      .gte("snapshot_time", since)
      .order("snapshot_time", { ascending: false });
    if (oddsErr) {
      console.error("[RECS] Failed to fetch odds snapshots:", oddsErr.message);
      return { fixtures: 0, recommendations: 0 };
    }
    oddsRows.push(...(data || []));
  }

  const bestOdds = new Map<string, number>();
  for (const row of oddsRows || []) {
    const key = `${row.fixture_id}|${row.market}|${row.selection}`;
    const odds = Number(row.odds);
    const prev = bestOdds.get(key);
    if (prev === undefined || odds > prev) bestOdds.set(key, odds);
  }

  // 3. Derive recommendation rows.
  const recommendations: Record<string, unknown>[] = [];
  const marketsCovered = new Set<string>();

  for (const pred of preds as PredictionRow[]) {
    const prob = Number(pred.model_probability);
    if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) continue;

    const oddsKey = toOddsKey(pred.market, pred.selection);
    if (!oddsKey) continue;
    marketsCovered.add(pred.market);

    const odds = bestOdds.get(
      `${pred.fixture_id}|${oddsKey.market}|${oddsKey.selection}`
    );
    if (!odds || odds <= 1) continue;

    const impliedProb = 1 / odds;
    const edge = prob - impliedProb;
    if (edge < MIN_EDGE) continue;

    // Same scoring formulas as src/lib/nvidia/prediction-engine.ts
    const edgeScore = Math.min(edge * 100 * 2, 30);
    const confScore = prob * 30;
    const opportunityScore = Math.min(Math.round(edgeScore + confScore + 40), 100);
    const riskTier = edge > 0.15 ? "low" : edge > 0.08 ? "medium" : "high";
    const confPct = prob * 100;
    const confidenceTier =
      confPct >= 85 ? "very_high" : confPct >= 75 ? "high" : confPct >= 65 ? "medium" : "low";
    const kellyFraction = Math.max(0, ((prob * odds - 1) / (odds - 1)) * 0.25);

    recommendations.push({
      fixture_id: pred.fixture_id,
      prediction_id: pred.id,
      market: pred.market,
      selection: pred.selection,
      bookmaker_odds: round4(odds),
      raw_implied_probability: round4(impliedProb),
      fair_implied_probability: round4(impliedProb),
      model_probability: round4(prob),
      edge: round4(edge),
      opportunity_score: opportunityScore,
      opportunity_breakdown: {
        edge_score: Math.round(edgeScore * 100) / 100,
        confidence_score: Math.round(confScore * 100) / 100,
        base_score: 40,
        source: "meta-ensemble",
      },
      risk_tier: riskTier,
      confidence_tier: confidenceTier,
      kelly_fraction: round4(kellyFraction),
      is_recommended: edge > RECOMMENDED_EDGE && prob > RECOMMENDED_PROB,
      is_avoid: false,
      explanation: {
        source: "meta-ensemble",
        model_version: modelVersion,
        reasoning: `Ensemble model gives ${(prob * 100).toFixed(1)}% probability vs ${(impliedProb * 100).toFixed(1)}% implied by best odds ${odds}. Edge: ${(edge * 100).toFixed(1)}%.`,
        odds_market: oddsKey.market,
        odds_selection: oddsKey.selection,
      },
    });
  }

  // 4. Idempotent replace: remove prior ensemble-derived rows for these
  //    fixtures/markets, then insert fresh ones. Scoped to ensemble market
  //    names so rows written by other engines are untouched. Runs even when
  //    nothing qualifies this time so stale rows don't linger.
  const markets = [...marketsCovered];
  if (!markets.length) {
    return { fixtures: fixtureIds.length, recommendations: 0 };
  }

  const { error: delErr } = await supabaseAdmin
    .from("recommendations")
    .delete()
    .in("fixture_id", fixtureIds)
    .in("market", markets);
  if (delErr) {
    console.error("[RECS] Failed to clear stale recommendations:", delErr.message);
    return { fixtures: fixtureIds.length, recommendations: 0 };
  }

  if (!recommendations.length) {
    return { fixtures: fixtureIds.length, recommendations: 0 };
  }

  let inserted = 0;
  for (let i = 0; i < recommendations.length; i += 50) {
    const batch = recommendations.slice(i, i + 50);
    const { error } = await supabaseAdmin.from("recommendations").insert(batch as any);
    if (error) {
      console.error("[RECS] Insert error:", error.message);
    } else {
      inserted += batch.length;
    }
  }

  return { fixtures: fixtureIds.length, recommendations: inserted };
}
