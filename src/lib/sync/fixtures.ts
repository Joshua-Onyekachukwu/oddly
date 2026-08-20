import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getAllTodayFixtures, LEAGUE_IDS, type FootballFixture } from "@/lib/api/football";

const supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Normalize a team name for matching:
 * - lowercase
 * - trim whitespace
 * - remove common suffixes
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
 * Get or create a team in Supabase.
 * Uses canonical_name for matching, falls back to team_aliases.
 */
async function getOrCreateTeam(
  name: string,
  leagueId: number,
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
    return alias.canonical_name;
  }

  // 2. Check existing teams by canonical_name (exact or fuzzy)
  const { data: existingTeam } = await supabaseAdmin
    .from("teams")
    .select("id")
    .eq("canonical_name", normalized)
    .single();

  if (existingTeam) {
    return existingTeam.id;
  }

  // 3. Try fuzzy match — search for partial match
  const { data: fuzzyTeams } = await supabaseAdmin
    .from("teams")
    .select("id, canonical_name")
    .ilike("canonical_name", `%${normalized.substring(0, 6)}%`)
    .limit(1);

  if (fuzzyTeams?.length) {
    // Add alias for future lookups
    await supabaseAdmin.from("team_aliases").upsert(
      {
        canonical_name: fuzzyTeams[0].canonical_name,
        alias: normalized,
        source: "api-sync",
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

  if (error) {
    console.error(`Failed to create team "${name}":`, error);
    throw error;
  }

  // Also add the original name as an alias
  await supabaseAdmin.from("team_aliases").upsert(
    {
      canonical_name: normalized,
      alias: name.toLowerCase().trim(),
      source: "api-sync",
    },
    { onConflict: "alias" }
  );

  return newTeam.id;
}

/**
 * Get or create a league in Supabase.
 */
async function getOrCreateLeague(
  name: string,
  country: string
): Promise<string> {
  // Check by name
  const { data: existing } = await supabaseAdmin
    .from("leagues")
    .select("id")
    .eq("name", name)
    .single();

  if (existing) return existing.id;

  // Create
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
 * Map API-Football status to our status enum
 */
function mapStatus(apiStatus: string): string {
  const statusMap: Record<string, string> = {
    NS: "scheduled",
    "1H": "live",
    HT: "halftime",
    "2H": "live",
    ET: "live",
    P: "live",
    BT: "live",
    FT: "finished",
    PST: "postponed",
    CANC: "cancelled",
    AWD: "finished",
    wo: "finished",
  };
  return statusMap[apiStatus] || "scheduled";
}

/**
 * Sync today's fixtures from API-Football to Supabase.
 * Creates teams, leagues, and fixtures as needed.
 */
export async function syncTodayFixtures(): Promise<{
  total: number;
  created: number;
  updated: number;
  errors: string[];
}> {
  let total = 0;
  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  // Fetch all fixtures from tracked leagues
  const allFixtures = await getAllTodayFixtures();
  total = allFixtures.length;

  // Process in batches to avoid overwhelming Supabase
  const batchSize = 20;
  for (let i = 0; i < allFixtures.length; i += batchSize) {
    const batch = allFixtures.slice(i, i + batchSize);

    for (const fixture of batch) {
      try {
        // Get or create teams
        const homeTeamId = await getOrCreateTeam(
          fixture.teams.home.name,
          fixture.league.id,
          fixture.league.country
        );
        const awayTeamId = await getOrCreateTeam(
          fixture.teams.away.name,
          fixture.league.id,
          fixture.league.country
        );

        // Get or create league
        const leagueId = await getOrCreateLeague(
          fixture.league.name,
          fixture.league.country
        );

        const externalId = String(fixture.fixture.id);
        const kickoffTime = new Date(fixture.fixture.date).toISOString();
        const status = mapStatus(fixture.fixture.status.short);
        const homeScore = fixture.goals.home;
        const awayScore = fixture.goals.away;

        // Upsert fixture by external_id
        const { data: existing } = await supabaseAdmin
          .from("fixtures")
          .select("id, status")
          .eq("external_id", externalId)
          .single();

        if (existing) {
          // Update status and score if changed
          if (
            existing.status !== status ||
            homeScore !== null ||
            awayScore !== null
          ) {
            await supabaseAdmin
              .from("fixtures")
              .update({
                status,
                home_score: homeScore,
                away_score: awayScore,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existing.id);
            updated++;
          }
        } else {
          // Create new fixture
          await supabaseAdmin.from("fixtures").insert({
            external_id: externalId,
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            league_id: leagueId,
            kickoff_time: kickoffTime,
            status,
            home_score: homeScore,
            away_score: awayScore,
            is_featured: false,
          });
          created++;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(
          `${fixture.teams.home.name} vs ${fixture.teams.away.name}: ${msg}`
        );
        console.error("Fixture sync error:", error);
      }
    }

    // Small delay between batches
    if (i + batchSize < allFixtures.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return { total, created, updated, errors };
}
