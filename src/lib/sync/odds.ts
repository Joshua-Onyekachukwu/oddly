import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { BOOKMAKERS, type OddsFixture } from "@/lib/api/odds";

const supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || "";

// Sports to fetch odds for
const ODDS_SPORTS = [
  { key: "soccer_epl", league: "Premier League" },
  { key: "soccer_spain_la_liga", league: "La Liga" },
  { key: "soccer_germany_bundesliga", league: "Bundesliga" },
  { key: "soccer_italy_serie_a", league: "Serie A" },
  { key: "soccer_france_ligue_one", league: "Ligue 1" },
  { key: "soccer_netherlands_eredivisie", league: "Eredivisie" },
  { key: "soccer_portugal_primeira_liga", league: "Primeira Liga" },
  { key: "soccer_brazil_campeonato", league: "Brasileirão" },
  { key: "soccer_usa_mls", league: "MLS" },
  { key: "soccer_uefa_champs_league", league: "Champions League" },
];

/**
 * Normalize team name for matching between The Odds API and Supabase.
 */
function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(fc|cf|sc|ac|ssc|us|as|rc|rcd|cd|ud|sd|kf|ks|kk)\b\.?/g, "")
    .trim();
}

/**
 * Match an Odds API fixture to a Supabase fixture by team names.
 */
async function matchFixture(
  homeTeam: string,
  awayTeam: string,
  leagueName: string
): Promise<string | null> {
  const homeNormalized = normalizeTeamName(homeTeam);
  const awayNormalized = normalizeTeamName(awayTeam);

  // Try to find by team aliases first
  const { data: homeAlias } = await supabaseAdmin
    .from("team_aliases")
    .select("canonical_name")
    .eq("alias", homeNormalized)
    .single();

  const { data: awayAlias } = await supabaseAdmin
    .from("team_aliases")
    .select("canonical_name")
    .eq("alias", awayNormalized)
    .single();

  const homeName = homeAlias?.canonical_name || homeNormalized;
  const awayName = awayAlias?.canonical_name || awayNormalized;

  // Find fixture by team canonical names and league
  const { data: fixtures } = await supabaseAdmin
    .from("fixtures")
    .select(`
      id,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name),
      league:leagues(name)
    `)
    .eq("status", "scheduled")
    .gte("kickoff_time", new Date().toISOString())
    .limit(50);

  if (!fixtures) return null;

  for (const f of fixtures) {
    const dbHome = (f.home_team as unknown as { canonical_name: string })?.canonical_name;
    const dbAway = (f.away_team as unknown as { canonical_name: string })?.canonical_name;
    const dbLeague = (f.league as unknown as { name: string })?.name;

    if (
      dbHome === homeName &&
      dbAway === awayName
    ) {
      return f.id;
    }

    // Fuzzy match — check if either team name contains the other
    if (
      (dbHome?.includes(homeName) || homeName?.includes(dbHome)) &&
      (dbAway?.includes(awayName) || awayName?.includes(dbAway))
    ) {
      return f.id;
    }
  }

  return null;
}

/**
 * Fetch odds for a single sport from The Odds API.
 */
async function fetchOddsForSport(
  sportKey: string
): Promise<OddsFixture[]> {
  if (!THE_ODDS_API_KEY) {
    throw new Error("THE_ODDS_API_KEY not configured");
  }

  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=uk,eu&markets=h2h,totals&bookmakers=bet365,pinnacle,betway,1xbet`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Odds API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Save odds snapshots to Supabase for a single fixture.
 */
async function saveOddsSnapshots(
  fixtureId: string,
  fixture: OddsFixture
): Promise<number> {
  const snapshots: Array<{
    fixture_id: string;
    bookmaker: string;
    market: string;
    selection: string;
    odds: number;
    snapshot_time: string;
  }> = [];

  const now = new Date().toISOString();

  for (const bookmaker of fixture.bookmakers) {
    for (const market of bookmaker.markets) {
      // Map market keys
      let marketName = market.key;
      if (market.key === "h2h") marketName = "match_result";
      if (market.key === "totals") marketName = "over_under_2.5";

      for (const outcome of market.outcomes) {
        // Map outcome names
        let selection = outcome.name;
        if (outcome.name === fixture.home_team) selection = "home";
        else if (outcome.name === fixture.away_team) selection = "away";
        else if (outcome.name === "Draw") selection = "draw";
        else if (outcome.name === "Over") selection = "over";
        else if (outcome.name === "Under") selection = "under";

        // For totals, adjust market name based on point
        if (market.key === "totals" && outcome.point) {
          if (outcome.point === 2.5) {
            marketName = "over_under_2.5";
          } else if (outcome.point === 1.5) {
            marketName = "over_under_1.5";
          } else if (outcome.point === 3.5) {
            marketName = "over_under_3.5";
          }
        }

        snapshots.push({
          fixture_id: fixtureId,
          bookmaker: bookmaker.title.toLowerCase(),
          market: marketName,
          selection,
          odds: outcome.price,
          snapshot_time: now,
        });
      }
    }
  }

  if (snapshots.length === 0) return 0;

  // Delete old snapshots for this fixture (keep last hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from("odds_snapshots")
    .delete()
    .eq("fixture_id", fixtureId)
    .lt("snapshot_time", oneHourAgo);

  // Insert new snapshots
  const { error } = await supabaseAdmin
    .from("odds_snapshots")
    .insert(snapshots);

  if (error) {
    console.error("Failed to save odds snapshots:", error);
    return 0;
  }

  return snapshots.length;
}

/**
 * Sync odds for all tracked sports.
 * Fetches from The Odds API, matches to Supabase fixtures, saves snapshots.
 */
export async function syncAllOdds(): Promise<{
  totalSnapshots: number;
  matchedFixtures: number;
  unmatchedFixtures: number;
  sportsProcessed: number;
  errors: string[];
}> {
  let totalSnapshots = 0;
  let matchedFixtures = 0;
  let unmatchedFixtures = 0;
  let sportsProcessed = 0;
  const errors: string[] = [];

  for (const sport of ODDS_SPORTS) {
    try {
      const fixtures = await fetchOddsForSport(sport.key);
      sportsProcessed++;

      for (const fixture of fixtures) {
        try {
          // Match to Supabase fixture
          const supabaseFixtureId = await matchFixture(
            fixture.home_team,
            fixture.away_team,
            sport.league
          );

          if (supabaseFixtureId) {
            const count = await saveOddsSnapshots(supabaseFixtureId, fixture);
            totalSnapshots += count;
            matchedFixtures++;
          } else {
            unmatchedFixtures++;
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(
            `${fixture.home_team} vs ${fixture.away_team}: ${msg}`
          );
        }
      }

      // Rate limit — wait between sports (The Odds API has limits)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${sport.key}: ${msg}`);
      console.error(`Failed to fetch odds for ${sport.key}:`, error);
    }
  }

  return {
    totalSnapshots,
    matchedFixtures,
    unmatchedFixtures,
    sportsProcessed,
    errors,
  };
}

/**
 * Get odds API usage stats.
 */
export async function getOddsApiUsage(): Promise<{
  used: number;
  remaining: number;
  total: number;
}> {
  if (!THE_ODDS_API_KEY) {
    return { used: 0, remaining: 0, total: 0 };
  }

  try {
    const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${THE_ODDS_API_KEY}`;
    const response = await fetch(url);

    const used = parseInt(response.headers.get("x-requests-used") || "0");
    const remaining = parseInt(
      response.headers.get("x-requests-remaining") || "0"
    );

    return { used, remaining, total: used + remaining };
  } catch {
    return { used: 0, remaining: 0, total: 0 };
  }
}
