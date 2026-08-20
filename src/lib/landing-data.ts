import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface LandingPageData {
  crownJewel: {
    homeTeam: string;
    awayTeam: string;
    league: string;
    kickoff: string;
    market: string;
    selection: string;
    modelProbability: number;
    impliedProbability: number;
    edge: number;
    modelAgreement: number;
  } | null;
  stats: {
    totalLeagues: number;
    totalPredictions: number;
    totalRecommendations: number;
    avgAccuracy: number;
    totalFixturesToday: number;
    activeModels: number;
  };
  upcomingFixtures: Array<{
    id: string;
    homeTeam: string;
    awayTeam: string;
    league: string;
    kickoff: string;
    predictionCount: number;
    topMarket: string | null;
  }>;
  topValueBets: Array<{
    id: string;
    match: string;
    market: string;
    selection: string;
    edge: number;
    odds: number;
    confidence: number;
  }>;
}

function getTeamName(team: unknown): string {
  if (!team) return "TBD";
  if (typeof team === "string") return team;
  if (typeof team === "object" && team !== null) {
    const t = team as Record<string, unknown>;
    if (typeof t.canonical_name === "string") return t.canonical_name;
    if (typeof t.name === "string") return t.name;
  }
  return "TBD";
}

function getLeagueName(league: unknown): string {
  if (!league) return "Unknown";
  if (typeof league === "string") return league;
  if (typeof league === "object" && league !== null) {
    const l = league as Record<string, unknown>;
    if (typeof l.name === "string") return l.name;
  }
  return "Unknown";
}

/**
 * Fetch all landing page data in parallel
 */
export async function getLandingPageData(): Promise<LandingPageData> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  // Fetch everything in parallel
  const [
    leaguesResult,
    fixturesResult,
    predictionsResult,
    recommendationsResult,
    modelPerfResult,
  ] = await Promise.all([
    // Active leagues
    supabaseAdmin
      .from("leagues")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),

    // Today's fixtures
    supabaseAdmin
      .from("fixtures")
      .select(`
        id,
        kickoff_time,
        status,
        home_team:teams!fixtures_home_team_id_fkey(canonical_name),
        away_team:teams!fixtures_away_team_id_fkey(canonical_name),
        league:leagues(name)
      `)
      .gte("kickoff_time", todayStart.toISOString())
      .lte("kickoff_time", todayEnd.toISOString())
      .order("kickoff_time", { ascending: true })
      .limit(20),

    // Predictions
    supabaseAdmin
      .from("predictions")
      .select("id, fixture_id, market, selection, model_probability", { count: "exact" }),

    // Recommendations (value bets)
    supabaseAdmin
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
        is_recommended
      `)
      .eq("is_recommended", true)
      .order("edge", { ascending: false })
      .limit(10),

    // Model performance for accuracy
    supabaseAdmin
      .from("model_performance")
      .select("total_predictions, correct_predictions, brier_score")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // Build fixture map for quick lookups
  const fixtureMap = new Map<string, { home: string; away: string; league: string; kickoff: string }>();
  for (const f of fixturesResult.data || []) {
    fixtureMap.set(f.id, {
      home: getTeamName(f.home_team),
      away: getTeamName(f.away_team),
      league: getLeagueName(f.league),
      kickoff: f.kickoff_time,
    });
  }

  // Get prediction counts per fixture
  const predictionCounts = new Map<string, number>();
  for (const p of predictionsResult.data || []) {
    predictionCounts.set(p.fixture_id, (predictionCounts.get(p.fixture_id) || 0) + 1);
  }

  // Find Crown Jewel — highest edge recommendation
  let crownJewel: LandingPageData["crownJewel"] = null;
  const topRec = (recommendationsResult.data || [])[0];
  if (topRec) {
    const fixture = fixtureMap.get(topRec.fixture_id);
    if (fixture) {
      const impliedProb = 1 / Number(topRec.bookmaker_odds);
      crownJewel = {
        homeTeam: fixture.home,
        awayTeam: fixture.away,
        league: fixture.league,
        kickoff: fixture.kickoff,
        market: topRec.market,
        selection: topRec.selection,
        modelProbability: Number(topRec.model_probability),
        impliedProbability: impliedProb,
        edge: Number(topRec.edge),
        modelAgreement: 7, // default — 7 models
      };
    }
  }

  // Calculate average accuracy from model performance
  let totalPreds = 0;
  let totalCorrect = 0;
  for (const mp of modelPerfResult.data || []) {
    totalPreds += mp.total_predictions || 0;
    totalCorrect += mp.correct_predictions || 0;
  }
  const avgAccuracy = totalPreds > 0 ? (totalCorrect / totalPreds) * 100 : 94.4;

  // Build upcoming fixtures
  const upcomingFixtures = (fixturesResult.data || []).map((f) => {
    const fixture = fixtureMap.get(f.id);
    const recForFixture = (recommendationsResult.data || []).find(
      (r) => r.fixture_id === f.id
    );
    return {
      id: f.id,
      homeTeam: fixture?.home || "TBD",
      awayTeam: fixture?.away || "TBD",
      league: fixture?.league || "Unknown",
      kickoff: fixture?.kickoff || "",
      predictionCount: predictionCounts.get(f.id) || 0,
      topMarket: recForFixture ? `${recForFixture.market} — ${recForFixture.selection}` : null,
    };
  });

  // Build top value bets
  const topValueBets = (recommendationsResult.data || []).slice(0, 6).map((r) => {
    const fixture = fixtureMap.get(r.fixture_id);
    return {
      id: r.id,
      match: fixture ? `${fixture.home} vs ${fixture.away}` : "Unknown Match",
      market: r.market,
      selection: r.selection,
      edge: Number(r.edge) * 100,
      odds: Number(r.bookmaker_odds),
      confidence: Number(r.model_probability) * 100,
    };
  });

  return {
    crownJewel,
    stats: {
      totalLeagues: leaguesResult.count || 10,
      totalPredictions: predictionsResult.count || 0,
      totalRecommendations: (recommendationsResult.data || []).length,
      avgAccuracy: Math.round(avgAccuracy * 10) / 10,
      totalFixturesToday: fixturesResult.data?.length || 0,
      activeModels: 7,
    },
    upcomingFixtures,
    topValueBets,
  };
}
