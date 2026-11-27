import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { BOOKMAKERS, type OddsFixture } from "@/lib/api/odds";
import { normalizeTeamName as normalizeTeamKey } from "@/lib/football/team-normalizer";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const THE_ODDS_API_KEY = process.env.THE_ODDS_API_KEY || "";

/** Provider tag written to fixtures.provider for The Odds API rows. */
const PROVIDER = "the-odds-api";

/** Max kickoff-time drift allowed when matching an odds fixture to a DB fixture. */
const MATCH_WINDOW_MS = 3 * 60 * 60 * 1000; // ±3h

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
  const containment = ka.includes(kb) || kb.includes(ka) ? 0.4 : 0;
  return Math.min(1, jaccard + containment);
}

/** Minimum score for accepting a fuzzy ilike candidate. */
const FUZZY_THRESHOLD = 0.6;

/**
 * Get or create a league by provider external id, falling back to name.
 */
async function getOrCreateLeague(
  sportKey: string,
  name: string,
  country: string
): Promise<string> {
  // 1. Provider external id mapping (league_external_ids)
  const { data: mapped } = await supabaseAdmin
    .from("league_external_ids")
    .select("league_id")
    .eq("provider", PROVIDER)
    .eq("external_id", sportKey)
    .limit(1)
    .maybeSingle();

  if (mapped?.league_id) return mapped.league_id;

  // 2. Check by name (case-insensitive)
  const { data: existing } = await supabaseAdmin
    .from("leagues")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin.from("league_external_ids").upsert(
      { league_id: existing.id, provider: PROVIDER, external_id: sportKey },
      { onConflict: "provider,external_id" }
    );
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

  await supabaseAdmin.from("league_external_ids").upsert(
    { league_id: newLeague.id, provider: PROVIDER, external_id: sportKey },
    { onConflict: "provider,external_id" }
  );

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

  if (alias?.canonical_name) {
    // Resolve the alias target to a team UUID (canonical_name is a name).
    const { data: team } = await supabaseAdmin
      .from("teams")
      .select("id")
      .ilike("canonical_name", alias.canonical_name)
      .limit(1)
      .maybeSingle();
    if (team) return team.id;
  }

  // 2. Check existing teams by canonical_name (case-insensitive exact)
  const { data: existing } = await supabaseAdmin
    .from("teams")
    .select("id")
    .ilike("canonical_name", normalized)
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  // 3. Scored fuzzy match — only accept candidates above the threshold.
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
      await supabaseAdmin.from("team_aliases").upsert(
        {
          canonical_name: best.canonical_name,
          alias: normalized,
          source: "odds-api-sync",
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
 * Match an Odds API fixture to a Supabase fixture by team names,
 * constrained to the same league and a ±3h kickoff window so that
 * same-named fixtures in different competitions/dates can't mislink.
 * Returns fixture ID if found, null otherwise.
 */
async function matchFixture(
  homeTeam: string,
  awayTeam: string,
  commenceTime: string,
  leagueId: string | null
): Promise<string | null> {
  const homeNormalized = normalizeTeamName(homeTeam);
  const awayNormalized = normalizeTeamName(awayTeam);
  const kickoff = new Date(commenceTime);
  if (isNaN(kickoff.getTime())) return null;

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

  // Find candidate fixtures within the kickoff window (and league when known)
  const windowStart = new Date(kickoff.getTime() - MATCH_WINDOW_MS).toISOString();
  const windowEnd = new Date(kickoff.getTime() + MATCH_WINDOW_MS).toISOString();

  let query = supabaseAdmin
    .from("fixtures")
    .select(`
      id,
      kickoff_time,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name)
    `)
    .eq("status", "scheduled")
    .gte("kickoff_time", windowStart)
    .lte("kickoff_time", windowEnd)
    .order("kickoff_time", { ascending: true })
    .limit(100);

  if (leagueId) {
    query = query.eq("league_id", leagueId);
  }

  const { data: fixtures } = await query;

  if (!fixtures?.length) return null;

  // Score candidates: exact name match wins; closest kickoff breaks ties.
  let best: { id: string; delta: number; fuzzy: boolean } | null = null;

  for (const f of fixtures) {
    const dbHome = (f.home_team as unknown as { canonical_name: string })?.canonical_name;
    const dbAway = (f.away_team as unknown as { canonical_name: string })?.canonical_name;

    const exact = dbHome === homeName && dbAway === awayName;
    const fuzzy =
      !exact &&
      !!dbHome &&
      !!dbAway &&
      ((dbHome.includes(homeName) || homeName.includes(dbHome)) &&
        (dbAway.includes(awayName) || awayName.includes(dbAway)));

    if (!exact && !fuzzy) continue;

    const delta = Math.abs(new Date(f.kickoff_time).getTime() - kickoff.getTime());
    const cand = { id: f.id, delta, fuzzy };

    if (!best) {
      best = cand;
    } else if (exact && best.fuzzy) {
      best = cand; // exact beats fuzzy
    } else if (exact === best.fuzzy && delta < best.delta) {
      best = cand; // same match quality → closest kickoff
    }
  }

  return best?.id ?? null;
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
      provider: PROVIDER,
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

  // Retention: keep 30 days of snapshots per fixture so CLV, odds-movement
  // and market-history features remain computable. (Previously pruned to ~1h,
  // which destroyed all pre-match/closing history.)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from("odds_snapshots")
    .delete()
    .eq("fixture_id", fixtureId)
    .lt("snapshot_time", thirtyDaysAgo);

  // Dedupe: skip rows identical to the most recent stored snapshot for the
  // same fixture/bookmaker/market/selection. An unchanged price carries no
  // new information — "latest snapshot at or before T" still resolves to the
  // correct price — so this keeps history bounded to actual odds movements
  // instead of growing by a full batch every sync.
  const { data: recentRows } = await supabaseAdmin
    .from("odds_snapshots")
    .select("bookmaker, market, selection, odds")
    .eq("fixture_id", fixtureId)
    .order("snapshot_time", { ascending: false })
    .limit(1000);

  const latestByKey = new Map<string, number>();
  for (const row of recentRows || []) {
    const key = JSON.stringify([row.bookmaker, row.market, row.selection]);
    if (!latestByKey.has(key)) latestByKey.set(key, row.odds);
  }

  const changedSnapshots = snapshots.filter((s) => {
    const key = JSON.stringify([s.bookmaker, s.market, s.selection]);
    return latestByKey.get(key) !== s.odds;
  });

  if (changedSnapshots.length === 0) return 0;

  const { error } = await supabaseAdmin.from("odds_snapshots").insert(changedSnapshots);

  if (error) {
    console.error("Failed to save odds snapshots:", error);
    return 0;
  }

  return changedSnapshots.length;
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

      // Get or create league (resolved via league_external_ids first)
      let leagueId: string;
      try {
        leagueId = await getOrCreateLeague(sport.key, sport.league, sport.country);
      } catch (err) {
        errors.push(`${sport.league}: Failed to create league - ${err}`);
        continue;
      }

      for (const fixture of fixtures) {
        try {
          // Try to match existing fixture — constrained to same league and
          // a ±3h kickoff window to avoid mislinking same-named fixtures.
          let supabaseFixtureId = await matchFixture(
            fixture.home_team,
            fixture.away_team,
            fixture.commence_time,
            leagueId
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
