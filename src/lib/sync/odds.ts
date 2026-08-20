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
  { key: "soccer_epl", league: "Premier League", country: "England" },
  { key: "soccer_spain_la_liga", league: "La Liga", country: "Spain" },
  { key: "soccer_germany_bundesliga", league: "Bundesliga", country: "Germany" },
  { key: "soccer_italy_serie_a", league: "Serie A", country: "Italy" },
  { key: "soccer_france_ligue_one", league: "Ligue 1", country: "France" },
  { key: "soccer_netherlands_eredivisie", league: "Eredivisie", country: "Netherlands" },
  { key: "soccer_portugal_primeira_liga", league: "Primeira Liga", country: "Portugal" },
  { key: "soccer_brazil_campeonato", league: "Brasileirão", country: "Brazil" },
  { key: "soccer_usa_mls", league: "MLS", country: "USA" },
  { key: "soccer_uefa_champs_league", league: "Champions League", country: "Europe" },
];

/**
 * Normalize team name for matching.
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
 * Get or create a league by name.
 */
async function getOrCreateLeague(name: string, country: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("leagues")
    .select("id")
    .eq("name", name)
    .single();

  if (existing) return existing.id;

  const { data: newLeague, error } = await supabaseAdmin
    .from("leagues")
    .insert({
      name,
      country: country || null,
      sport: "football",
      is_active: true,
      priority: 5,
    })
    .select("id")
    .single();

  if (error) throw error;
  return newLeague.id;
}

/**
 * Get or create a team by name. Uses team_aliases for matching.
 */
async function getOrCreateTeam(
  name: string,
  leagueId: string,
  country: string
): Promise<string> {
  const normalized = normalizeTeamName(name);

  // 1. Check team_aliases
  const { data: alias } = await supabaseAdmin
    .from("team_aliases")
    .select("canonical_name")
    .eq("alias", normalized)
    .single();

  if (alias) {
    // Get the actual team ID
    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("id")
      .eq("canonical_name", alias.canonical_name)
      .single();
    if (team) return team.id;
  }

  // 2. Check existing teams by canonical_name
  const { data: existing } = await supabaseAdmin
    .from("teams")
    .select("id")
    .eq("canonical_name", normalized)
    .single();

  if (existing) return existing.id;

  // 3. Fuzzy match
  const { data: fuzzyTeams } = await supabaseAdmin
    .from("teams")
    .select("id, canonical_name")
    .ilike("canonical_name", `%${normalized.substring(0, 6)}%`)
    .limit(1);

  if (fuzzyTeams?.length) {
    await supabaseAdmin.from("team_aliases").upsert(
      {
        canonical_name: fuzzyTeams[0].canonical_name,
        alias: normalized,
        source: "odds-api-sync",
      },
      { onConflict: "alias" }
    );
    return fuzzyTeams[0].id;
  }

  // 4. Create new team
  const { data: newTeam, error } = await supabaseAdmin
    .from("teams")
    .insert({
      canonical_name: normalized,
      country: country || null,
      league_id: leagueId,
    })
    .select("id")
    .single();

  if (error) throw error;

  // Add original name as alias
  await supabaseAdmin.from("team_aliases").upsert(
    {
      canonical_name: normalized,
      alias: name.toLowerCase().trim(),
      source: "odds-api-sync",
    },
    { onConflict: "alias" }
  );

  return newTeam.id;
}

/**
 * Match an Odds API fixture to a Supabase fixture by team names.
 * Returns fixture ID if found, null otherwise.
 */
async function matchFixture(
  homeTeam: string,
  awayTeam: string
): Promise<string | null> {
  const homeNormalized = normalizeTeamName(homeTeam);
  const awayNormalized = normalizeTeamName(awayTeam);

  // Check team aliases
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

  // Find fixture by team canonical names
  const { data: fixtures } = await supabaseAdmin
    .from("fixtures")
    .select(`
      id,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name)
    `)
    .eq("status", "scheduled")
    .gte("kickoff_time", new Date().toISOString())
    .limit(100);

  if (!fixtures) return null;

  for (const f of fixtures) {
    const dbHome = (f.home_team as unknown as { canonical_name: string })?.canonical_name;
    const dbAway = (f.away_team as unknown as { canonical_name: string })?.canonical_name;

    if (dbHome === homeName && dbAway === awayName) {
      return f.id;
    }

    // Fuzzy match
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
 * Create a fixture from Odds API data.
 */
async function createFixtureFromOdds(
  fixture: OddsFixture,
  leagueId: string,
  country: string
): Promise<string> {
  const homeTeamId = await getOrCreateTeam(fixture.home_team, leagueId, country);
  const awayTeamId = await getOrCreateTeam(fixture.away_team, leagueId, country);

  const { data, error } = await supabaseAdmin
    .from("fixtures")
    .insert({
      external_id: fixture.id,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      league_id: leagueId,
      kickoff_time: fixture.commence_time,
      status: "scheduled",
      is_featured: false,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
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
      let marketName = market.key;
      if (market.key === "h2h") marketName = "match_result";
      if (market.key === "totals") marketName = "over_under_2.5";

      for (const outcome of market.outcomes) {
        let selection = outcome.name;
        if (outcome.name === fixture.home_team) selection = "home";
        else if (outcome.name === fixture.away_team) selection = "away";
        else if (outcome.name === "Draw") selection = "draw";
        else if (outcome.name === "Over") selection = "over";
        else if (outcome.name === "Under") selection = "under";

        if (market.key === "totals" && outcome.point) {
          if (outcome.point === 2.5) marketName = "over_under_2.5";
          else if (outcome.point === 1.5) marketName = "over_under_1.5";
          else if (outcome.point === 3.5) marketName = "over_under_3.5";
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

  const { error } = await supabaseAdmin.from("odds_snapshots").insert(snapshots);

  if (error) {
    console.error("Failed to save odds snapshots:", error);
    return 0;
  }

  return snapshots.length;
}

/**
 * Fetch odds for a single sport from The Odds API.
 */
async function fetchOddsForSport(sportKey: string): Promise<OddsFixture[]> {
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
 * Sync odds for all tracked sports.
 * Creates fixtures from Odds API data if they don't exist,
 * then saves odds snapshots.
 */
export async function syncAllOdds(): Promise<{
  totalSnapshots: number;
  matchedFixtures: number;
  createdFixtures: number;
  unmatchedFixtures: number;
  sportsProcessed: number;
  errors: string[];
}> {
  let totalSnapshots = 0;
  let matchedFixtures = 0;
  let createdFixtures = 0;
  let unmatchedFixtures = 0;
  let sportsProcessed = 0;
  const errors: string[] = [];

  for (const sport of ODDS_SPORTS) {
    try {
      const fixtures = await fetchOddsForSport(sport.key);
      sportsProcessed++;

      // Get or create league
      let leagueId: string;
      try {
        leagueId = await getOrCreateLeague(sport.league, sport.country);
      } catch (err) {
        errors.push(`${sport.league}: Failed to create league - ${err}`);
        continue;
      }

      for (const fixture of fixtures) {
        try {
          // Try to match existing fixture
          let supabaseFixtureId = await matchFixture(
            fixture.home_team,
            fixture.away_team
          );

          // If no match, create fixture from Odds API data
          if (!supabaseFixtureId) {
            try {
              supabaseFixtureId = await createFixtureFromOdds(
                fixture,
                leagueId,
                sport.country
              );
              createdFixtures++;
            } catch (err) {
              errors.push(
                `${fixture.home_team} vs ${fixture.away_team}: Failed to create fixture - ${err}`
              );
              unmatchedFixtures++;
              continue;
            }
          } else {
            matchedFixtures++;
          }

          // Save odds snapshots
          const count = await saveOddsSnapshots(supabaseFixtureId, fixture);
          totalSnapshots += count;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          errors.push(
            `${fixture.home_team} vs ${fixture.away_team}: ${msg}`
          );
        }
      }

      // Rate limit between sports
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
    createdFixtures,
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
