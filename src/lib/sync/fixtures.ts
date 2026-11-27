import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getAllTodayFixtures, type FootballFixture } from "@/lib/api/football";
import { normalizeTeamName as normalizeTeamKey } from "@/lib/football/team-normalizer";

const supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Provider tag written to fixtures.provider for API-Football sync rows. */
const PROVIDER = "api-football";

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
 * Confidence score (0..1) between two already-normalized team keys.
 * Uses the alias-aware normalizer so "Man City" == "Manchester City".
 */
function teamKeyScore(a: string, b: string): number {
  const ka = normalizeTeamKey(a) || a;
  const kb = normalizeTeamKey(b) || b;
  if (ka === kb) return 1;
  const at = new Set(ka.split(" ").filter(Boolean));
  const bt = new Set(kb.split(" ").filter(Boolean));
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  const union = at.size + bt.size - inter;
  const jaccard = union ? inter / union : 0;
  // substring containment is a strong signal ("real madrid" ⊂ "real madrid cf")
  const containment = ka.includes(kb) || kb.includes(ka) ? 0.4 : 0;
  return Math.min(1, jaccard + containment);
}

/** Minimum score for accepting a fuzzy ilike candidate. */
const FUZZY_THRESHOLD = 0.6;

/**
 * Get or create a team in Supabase.
 * Uses team_aliases first, then canonical_name, then a *scored* fuzzy match.
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

  if (alias?.canonical_name) {
    // Resolve the alias target to a team UUID — canonical_name is a name,
    // not an id (previously this returned the name string, corrupting
    // fixtures.home_team_id/away_team_id).
    const { data: aliasTeam } = await supabaseAdmin
      .from("teams")
      .select("id")
      .ilike("canonical_name", alias.canonical_name)
      .limit(1)
      .maybeSingle();

    if (aliasTeam) return aliasTeam.id;
    // Alias points at a name with no team row — fall through and create.
  }

  // 2. Check existing teams by canonical_name (case-insensitive exact)
  const { data: existingTeam } = await supabaseAdmin
    .from("teams")
    .select("id")
    .ilike("canonical_name", normalized)
    .limit(1)
    .maybeSingle();

  if (existingTeam) {
    return existingTeam.id;
  }

  // 3. Scored fuzzy match — only accept a candidate above the confidence
  //    threshold so unrelated teams sharing a prefix don't get merged.
  const { data: fuzzyTeams } = await supabaseAdmin
    .from("teams")
    .select("id, canonical_name")
    .ilike("canonical_name", `%${normalized.substring(0, 6)}%`)
    .limit(10);

  if (fuzzyTeams?.length) {
    let best: { id: string; canonical_name: string; score: number } | null = null;
    for (const t of fuzzyTeams) {
      const score = teamKeyScore(normalized, t.canonical_name || "");
      if (!best || score > best.score) {
        best = { id: t.id, canonical_name: t.canonical_name, score };
      }
    }

    if (best && best.score >= FUZZY_THRESHOLD) {
      // Add alias for future lookups
      await supabaseAdmin.from("team_aliases").upsert(
        {
          canonical_name: best.canonical_name,
          alias: normalized,
          source: "api-sync",
        },
        { onConflict: "alias" }
      );
      return best.id;
    }
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
 * Resolution order:
 *   1. league_external_ids mapping (provider + provider league id)
 *   2. exact name match
 *   3. create league + record the provider mapping
 */
async function getOrCreateLeague(
  name: string,
  country: string,
  providerExternalId?: string
): Promise<string> {
  // 1. Provider external id mapping
  if (providerExternalId) {
    const { data: mapped } = await supabaseAdmin
      .from("league_external_ids")
      .select("league_id")
      .eq("provider", PROVIDER)
      .eq("external_id", providerExternalId)
      .limit(1)
      .maybeSingle();

    if (mapped?.league_id) return mapped.league_id;
  }

  // 2. Check by name (case-insensitive)
  const { data: existing } = await supabaseAdmin
    .from("leagues")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Record the provider mapping for next time (best-effort)
    if (providerExternalId) {
      await supabaseAdmin
        .from("league_external_ids")
        .upsert(
          { league_id: existing.id, provider: PROVIDER, external_id: providerExternalId },
          { onConflict: "provider,external_id" }
        );
    }
    return existing.id;
  }

  // 3. Create
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

  if (providerExternalId) {
    await supabaseAdmin
      .from("league_external_ids")
      .upsert(
        { league_id: newLeague.id, provider: PROVIDER, external_id: providerExternalId },
        { onConflict: "provider,external_id" }
      );
  }

  return newLeague.id;
}

/**
 * Map API-Football status to our status enum
 */
function mapStatus(apiStatus: string): "scheduled" | "live" | "halftime" | "finished" | "postponed" | "cancelled" {
  const statusMap: Record<string, "scheduled" | "live" | "halftime" | "finished" | "postponed" | "cancelled"> = {
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
        const externalId = String(fixture.fixture.id);
        const providerLeagueId = String(fixture.league.id);

        // Get or create league first — teams reference it
        const leagueId = await getOrCreateLeague(
          fixture.league.name,
          fixture.league.country,
          providerLeagueId
        );

        // Get or create teams
        const homeTeamId = await getOrCreateTeam(
          fixture.teams.home.name,
          leagueId,
          fixture.league.country
        );
        const awayTeamId = await getOrCreateTeam(
          fixture.teams.away.name,
          leagueId,
          fixture.league.country
        );

        const kickoffTime = new Date(fixture.fixture.date).toISOString();
        const status = mapStatus(fixture.fixture.status.short);
        const homeScore = fixture.goals.home;
        const awayScore = fixture.goals.away;

        // Upsert fixture by (provider, external_id) — namespaced so a
        // colliding id from another provider can't match this row.
        const { data: existing } = await supabaseAdmin
          .from("fixtures")
          .select("id, status")
          .eq("provider", PROVIDER)
          .eq("external_id", externalId)
          .limit(1)
          .maybeSingle();

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
            provider: PROVIDER,
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
