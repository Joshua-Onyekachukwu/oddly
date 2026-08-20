import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getNVIDIAClient } from "./client";
import { buildPredictionPrompt, SYSTEM_PROMPTS } from "./prompts";

const supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Prediction {
  market: string;
  selection: string;
  probability: number;
  confidence: number;
  confidence_range: [number, number];
  model_version: string;
  reasoning: string;
}

interface PredictionResult {
  predictions: Prediction[];
  summary: string;
  risk_level: "low" | "medium" | "high";
  key_factors: string[];
}

/**
 * Generate predictions for a single fixture using NVIDIA AI.
 * Returns structured predictions and saves them to Supabase.
 */
export async function generatePredictionsForFixture(fixtureId: string): Promise<{
  success: boolean;
  predictions: Prediction[];
  summary: string;
  error?: string;
}> {
  try {
    // 1. Fetch fixture data with teams and league
    const { data: fixture, error: fixtureError } = await supabaseAdmin
      .from("fixtures")
      .select(`
        id,
        kickoff_time,
        status,
        home_team:teams!fixtures_home_team_id_fkey(canonical_name),
        away_team:teams!fixtures_away_team_id_fkey(canonical_name),
        league:leagues(name)
      `)
      .eq("id", fixtureId)
      .single();

    if (fixtureError || !fixture) {
      return { success: false, predictions: [], summary: "", error: "Fixture not found" };
    }

    // 2. Fetch current odds for this fixture
    const { data: oddsData } = await supabaseAdmin
      .from("odds_snapshots")
      .select("market, selection, odds, bookmaker")
      .eq("fixture_id", fixtureId);

    // Build odds object (best odds per market/selection)
    const odds: Record<string, number> = {};
    if (oddsData) {
      for (const o of oddsData) {
        const key = `${o.market}_${o.selection}`;
        if (!odds[key] || Number(o.odds) > odds[key]) {
          odds[key] = Number(o.odds);
        }
      }
    }

    // 3. Fetch team form (last 5 results from fixtures table)
    const homeTeam = fixture.home_team as unknown as { canonical_name: string };
    const awayTeam = fixture.away_team as unknown as { canonical_name: string };
    const league = fixture.league as unknown as { name: string };

    // 4. Build prediction prompt
    const messages = buildPredictionPrompt({
      homeTeam: homeTeam?.canonical_name || "Home Team",
      awayTeam: awayTeam?.canonical_name || "Away Team",
      league: league?.name || "Unknown League",
      kickoff: fixture.kickoff_time,
      odds: Object.keys(odds).length > 0 ? odds : undefined,
    });

    // 5. Call NVIDIA AI
    const client = getNVIDIAClient();
    const response = await client.chat(messages, {
      taskId: "deep_analysis",
      temperature: 0.3,
      maxTokens: 2048,
    });

    const content = response.choices[0]?.message?.content || "{}";

    // 6. Parse response
    const cleaned = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let result: PredictionResult;
    try {
      result = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse NVIDIA prediction response:", content.substring(0, 500));
      return { success: false, predictions: [], summary: "", error: "Failed to parse AI response" };
    }

    // 7. Save predictions to Supabase
    if (result.predictions?.length) {
      const predictionsToInsert = result.predictions.map((p) => ({
        fixture_id: fixtureId,
        market: p.market,
        selection: p.selection,
        model_probability: p.probability,
        confidence_lower: p.confidence_range?.[0] || p.confidence - 0.1,
        confidence_upper: p.confidence_range?.[1] || p.confidence + 0.1,
        model_version: "oddly-ai-v1",
        features_used: {
          source: "nvidia_ai",
          model: "llama-3.1-70b-instruct",
          odds_used: Object.keys(odds).length > 0,
          reasoning: p.reasoning,
        },
        sub_model_probabilities: null,
        model_disagreement: null,
        data_quality_score: 85,
        data_quality_breakdown: {
          odds_fresh: Object.keys(odds).length > 0,
          has_form_data: false,
          ai_confidence: p.confidence,
        },
      }));

      // Delete existing predictions for this fixture from the same model
      await supabaseAdmin
        .from("predictions")
        .delete()
        .eq("fixture_id", fixtureId)
        .eq("model_version", "oddly-ai-v1");

      // Insert new predictions
      const { error: insertError } = await supabaseAdmin
        .from("predictions")
        .insert(predictionsToInsert);

      if (insertError) {
        console.error("Failed to save predictions:", insertError);
      }

      // 8. Generate recommendations (value bets) from predictions
      await generateRecommendations(fixtureId, result.predictions, odds);
    }

    return {
      success: true,
      predictions: result.predictions || [],
      summary: result.summary || "",
    };
  } catch (error) {
    console.error("Prediction generation error:", error);
    return {
      success: false,
      predictions: [],
      summary: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Generate recommendations (value bets) from predictions and odds
 */
async function generateRecommendations(
  fixtureId: string,
  predictions: Prediction[],
  odds: Record<string, number>
): Promise<void> {
  const recommendations: Array<{
    fixture_id: string;
    prediction_id: string;
    market: string;
    selection: string;
    bookmaker_odds: number;
    raw_implied_probability: number;
    fair_implied_probability: number;
    model_probability: number;
    edge: number;
    opportunity_score: number;
    risk_tier: string;
    confidence_tier: string;
    kelly_fraction: number;
    is_recommended: boolean;
    explanation: any;
  }> = [];

  // Get prediction IDs
  const { data: preds } = await supabaseAdmin
    .from("predictions")
    .select("id, market, selection, model_probability")
    .eq("fixture_id", fixtureId)
    .eq("model_version", "oddly-ai-v1");

  if (!preds?.length) return;

  for (const pred of preds) {
    const predProb = Number(pred.model_probability);

    // Find best odds for this market/selection
    const oddsKey = `${pred.market}_${pred.selection}`;
    const bestOdds = odds[oddsKey];

    if (!bestOdds || bestOdds <= 1) continue;

    const impliedProb = 1 / bestOdds;
    const edge = predProb - impliedProb;

    // Only recommend if edge > 5%
    if (edge < 0.05) continue;

    // Calculate opportunity score (0-100)
    const edgeScore = Math.min(edge * 100 * 2, 30); // max 30 points
    const confScore = predProb * 30; // max 30 points
    const opportunityScore = Math.round(edgeScore + confScore + 40); // base 40

    // Risk tier
    const riskTier = edge > 0.15 ? "low" : edge > 0.08 ? "medium" : "high";

    // Confidence tier
    const confPct = predProb * 100;
    const confidenceTier =
      confPct >= 85 ? "very_high" : confPct >= 75 ? "high" : confPct >= 65 ? "medium" : "low";

    // Kelly fraction
    const kellyFraction = ((predProb * bestOdds - 1) / (bestOdds - 1)) * 0.25; // quarter Kelly

    recommendations.push({
      fixture_id: fixtureId,
      prediction_id: pred.id,
      market: pred.market,
      selection: pred.selection,
      bookmaker_odds: bestOdds,
      raw_implied_probability: impliedProb,
      fair_implied_probability: impliedProb,
      model_probability: predProb,
      edge,
      opportunity_score: Math.min(opportunityScore, 100),
      risk_tier: riskTier,
      confidence_tier: confidenceTier,
      kelly_fraction: Math.max(0, kellyFraction),
      is_recommended: edge > 0.08 && predProb > 0.7,
      explanation: {
        reasoning: `AI model gives ${predProb.toFixed(1)}% probability vs ${(impliedProb * 100).toFixed(1)}% implied by odds at ${bestOdds}. Edge: ${(edge * 100).toFixed(1)}%.`,
      },
    });
  }

  if (recommendations.length) {
    // Delete existing recommendations for this fixture
    await supabaseAdmin
      .from("recommendations")
      .delete()
      .eq("fixture_id", fixtureId);

    // Insert new recommendations
    await supabaseAdmin.from("recommendations").insert(recommendations as any);
  }
}

/**
 * Generate predictions for all scheduled fixtures today
 */
export async function generateTodayPredictions(): Promise<{
  total: number;
  success: number;
  failed: number;
  errors: string[];
}> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: fixtures } = await supabaseAdmin
    .from("fixtures")
    .select("id")
    .gte("kickoff_time", todayStart.toISOString())
    .lte("kickoff_time", todayEnd.toISOString())
    .in("status", ["scheduled"]);

  if (!fixtures?.length) {
    return { total: 0, success: 0, failed: 0, errors: ["No scheduled fixtures today"] };
  }

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process fixtures sequentially to avoid rate limiting
  for (const fixture of fixtures) {
    const result = await generatePredictionsForFixture(fixture.id);
    if (result.success) {
      success++;
    } else {
      failed++;
      if (result.error) errors.push(`${fixture.id}: ${result.error}`);
    }

    // Small delay between requests to be kind to the API
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    total: fixtures.length,
    success,
    failed,
    errors,
  };
}

/**
 * Generate Crown Jewel pick — the single best bet of the day
 */
export async function generateCrownJewel(): Promise<{
  success: boolean;
  selection?: {
    fixture_id: string;
    market: string;
    selection: string;
    edge: number;
    confidence: number;
    reasoning: string;
  };
  error?: string;
}> {
  // Get all recommendations with edge > 8%
  const { data: recs } = await supabaseAdmin
    .from("recommendations")
    .select(`
      id,
      fixture_id,
      market,
      selection,
      bookmaker_odds,
      model_probability,
      edge,
      opportunity_score,
      confidence_tier,
      is_recommended
    `)
    .eq("is_recommended", true)
    .order("edge", { ascending: false })
    .limit(20);

  if (!recs?.length) {
    return { success: false, error: "No recommended bets available today" };
  }

  // Get fixture details for each
  const fixtureIds = [...new Set(recs.map((r) => r.fixture_id))];
  const { data: fixtures } = await supabaseAdmin
    .from("fixtures")
    .select(`
      id,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name),
      league:leagues(name)
    `)
    .in("id", fixtureIds);

  const fixtureMap = new Map(
    (fixtures || []).map((f) => [
      f.id,
      {
        home: (f.home_team as unknown as { canonical_name: string })?.canonical_name || "?",
        away: (f.away_team as unknown as { canonical_name: string })?.canonical_name || "?",
        league: (f.league as unknown as { name: string })?.name || "?",
      },
    ])
  );

  // Score each recommendation for Crown Jewel
  const scored = recs.map((r) => {
    const fixture = fixtureMap.get(r.fixture_id);
    const edge = Number(r.edge);
    const prob = Number(r.model_probability);
    const score = edge * 40 + prob * 30 + (r.opportunity_score || 0) * 0.3;

    return {
      fixture_id: r.fixture_id,
      market: r.market,
      selection: r.selection,
      edge,
      confidence: prob,
      score,
      fixture,
      odds: Number(r.bookmaker_odds),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best || best.edge < 0.08 || best.confidence < 0.7) {
    return { success: false, error: "No selection meets Crown Jewel threshold" };
  }

  return {
    success: true,
    selection: {
      fixture_id: best.fixture_id,
      market: best.market,
      selection: best.selection,
      edge: best.edge,
      confidence: best.confidence,
      reasoning: `Crown Jewel: ${best.fixture?.home} vs ${best.fixture?.away} (${best.fixture?.league}). ${best.market} — ${best.selection} at ${best.odds}. Edge: ${(best.edge * 100).toFixed(1)}%, confidence: ${(best.confidence * 100).toFixed(1)}%.`,
    },
  };
}
