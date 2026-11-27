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

// ─── Markets & quota budget ────────────────────────────────────────────
//
// The Odds API quota model: each request costs
//   [unique markets returned] × [regions specified]  credits.
// The bulk /sports/{sport}/odds endpoint only accepts FEATURED markets —
// btts / double_chance / draw_no_bet are rejected with
// 422 INVALID_MARKET ("Markets not supported by this endpoint"). They are
// "additional markets" that must be fetched per event via
// /sports/{sport}/events/{eventId}/odds (verified 2025-… live probe:
// 3 markets × uk,eu cost 3 credits for one EPL event).
//
// Quota math for this sync (10 sports, regions=uk,eu → 2 regions):
//   bulk featured:  |markets| × 2 credits per sport  → h2h,totals = 4/sport = 40/run
//   extra markets:  up to |extra| × 2 credits per event (only markets the
//                   bookmakers actually return are billed; observed ~3/event)
//
// Env knobs:
//   ODDS_MARKETS            comma list, featured markets for the bulk call.
//                           Default "h2h,totals" (anything else 422s).
//   ODDS_EXTRA_MARKETS      comma list, additional markets fetched per event.
//                           Default "btts,double_chance,draw_no_bet".
//                           Set to "" to disable the per-event pass entirely.
//   ODDS_EXTRA_CREDIT_BUDGET  max *estimated* credits the extra-market pass
//                           may spend per run. Default 60 (~10-20 events).
//   ODDS_EXTRA_MAX_EVENTS   hard cap on per-event calls per run. Default 50.
//   ODDS_QUOTA_RESERVE      stop extra-market calls once the API reports
//                           x-requests-remaining <= this. Default 50 — keeps
//                           headroom for other consumers of the 500/mo key.

const ODDS_REGIONS = ["uk", "eu"];
const REGIONS_PARAM = ODDS_REGIONS.join(",");
const BOOKMAKERS_PARAM = "bet365,pinnacle,betway,1xbet";

/** Markets accepted by the bulk /odds endpoint for soccer. */
const FEATURED_MARKETS = ["h2h", "totals"] as const;
/** "Additional markets" — only via the per-event odds endpoint. */
const EXTRA_MARKETS = ["btts", "double_chance", "draw_no_bet"] as const;

function parseMarketList(
  envValue: string | undefined,
  allowed: readonly string[],
  fallback: readonly string[]
): string[] {
  if (envValue === undefined) return [...fallback];
  const requested = envValue
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  // Empty string → user explicitly disabled the list.
  if (requested.length === 0) return [];
  const valid = new Set(allowed as readonly string[]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of requested) {
    if (valid.has(m) && !seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Featured (bulk endpoint) markets for this run. Never empty — the bulk
 *  pass is the core sync; an empty ODDS_MARKETS falls back to defaults. */
export function getFeaturedMarkets(): string[] {
  const markets = parseMarketList(process.env.ODDS_MARKETS, FEATURED_MARKETS, FEATURED_MARKETS);
  return markets.length ? markets : [...FEATURED_MARKETS];
}

/** Additional (per-event endpoint) markets for this run. */
export function getExtraMarkets(): string[] {
  return parseMarketList(
    process.env.ODDS_EXTRA_MARKETS,
    EXTRA_MARKETS,
    EXTRA_MARKETS
  );
}

function getExtraCreditBudget(): number {
  return intEnv("ODDS_EXTRA_CREDIT_BUDGET", 60);
}
function getExtraMaxEvents(): number {
  return intEnv("ODDS_EXTRA_MAX_EVENTS", 50);
}
function getQuotaReserve(): number {
  return intEnv("ODDS_QUOTA_RESERVE", 50);
}

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
 * Map one API outcome to canonical (market, selection) names used in
 * odds_snapshots. The names are chosen so the recommendation joins resolve:
 *   - ensemble.ts toOddsKey()          (predictions → odds_snapshots)
 *   - rollover/recommendation route    (canonicalMarket + normKey aliases)
 *   - nvidia/prediction-engine.ts      (`${market}_${selection}` raw key)
 *
 * Stored market keys are the API market keys for the new markets
 * ("btts", "double_chance", "draw_no_bet") — canonicalMarket() maps them to
 * btts/dc/dnb, matching the `predictions.market` values the ensemble writes.
 *
 * Verified against live API responses (soccer_epl, 2026-11 fixture):
 *   btts           outcomes "Yes" / "No"
 *   double_chance  outcomes "<Team> or Draw" / "<TeamA> or <TeamB>"
 *   draw_no_bet    outcomes are team names (home/away only, no draw)
 */
export function mapOutcomeToSnapshot(
  marketKey: string,
  outcome: { name: string; price: number; point?: number },
  fixture: Pick<OddsFixture, "home_team" | "away_team">
): { market: string; selection: string } | null {
  const home = fixture.home_team;
  const away = fixture.away_team;

  // ── Market name ──
  let marketName: string;
  switch (marketKey) {
    case "h2h":
      marketName = "match_result";
      break;
    case "totals": {
      // over_under_<line> for any half-goal line the API returns
      // (observed: 1.5 / 2.5 / 3.5; toOddsKey accepts 0.5–4.5).
      const point = typeof outcome.point === "number" ? outcome.point : 2.5;
      marketName = `over_under_${point}`;
      break;
    }
    case "btts":
    case "double_chance":
    case "draw_no_bet":
      // Store the API key verbatim — canonicalMarket() aliases these to
      // btts / dc / dnb, the same canonical markets predictions use.
      marketName = marketKey;
      break;
    default:
      // Unknown market (e.g. spreads if ever requested): keep raw key so the
      // data is still captured rather than silently dropped.
      marketName = marketKey;
  }

  // ── Selection name ──
  let selection: string | null = null;
  const rawName = outcome.name;

  if (marketKey === "btts") {
    const n = rawName.toLowerCase();
    if (n === "yes" || n === "no") selection = n;
  } else if (marketKey === "double_chance") {
    selection = mapDoubleChanceSelection(rawName, home, away);
  } else {
    // h2h / totals / draw_no_bet / unknown: team names → home/away/draw,
    // "Over"/"Under" → over/under (totals), otherwise keep raw name.
    if (rawName === home) selection = "home";
    else if (rawName === away) selection = "away";
    else if (rawName === "Draw") selection = "draw";
    else if (rawName === "Over") selection = "over";
    else if (rawName === "Under") selection = "under";
    else if (rawName === "Yes") selection = "yes";
    else if (rawName === "No") selection = "no";
    else selection = rawName;
  }

  if (!selection) return null;
  return { market: marketName, selection };
}

/**
 * Double-chance outcome names from The Odds API look like
 * "<Away> or Draw", "<Home> or Draw", "<Away> or <Home>".
 * Canonical selections (matching predictions + toOddsKey + selAliases):
 *   home-or-draw → "1x", draw-or-away → "x2", either-team → "12".
 */
function mapDoubleChanceSelection(
  name: string,
  homeTeam: string,
  awayTeam: string
): string | null {
  const n = name.toLowerCase();
  const hasDraw = n.includes("draw");
  const hasHome = n.includes(homeTeam.toLowerCase());
  const hasAway = n.includes(awayTeam.toLowerCase());

  if (hasDraw && hasHome) return "1x";
  if (hasDraw && hasAway) return "x2";
  if (!hasDraw && hasHome && hasAway) return "12";

  // Fallback for shorthand spellings some books may use.
  const compact = n.replace(/[^a-z0-9]/g, "");
  if (compact === "1x" || compact === "homedraw" || compact === "homeordraw") return "1x";
  if (compact === "x2" || compact === "drawaway" || compact === "draworaway") return "x2";
  if (compact === "12" || compact === "homeaway" || compact === "homeoraway") return "12";

  return null; // unrecognised shape — skip rather than write an unjoinable row
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
      for (const outcome of market.outcomes) {
        const mapped = mapOutcomeToSnapshot(market.key, outcome, fixture);
        if (!mapped) continue;

        snapshots.push({
          fixture_id: fixtureId,
          bookmaker: bookmaker.title.toLowerCase(),
          market: mapped.market,
          selection: mapped.selection,
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

interface OddsApiResult {
  fixtures: OddsFixture[];
  /** Credits billed for this call, from x-requests-last (null if absent). */
  creditsUsed: number | null;
  /** Credits remaining after this call, from x-requests-remaining. */
  creditsRemaining: number | null;
}

function readUsageHeaders(response: Response): {
  creditsUsed: number | null;
  creditsRemaining: number | null;
} {
  const last = response.headers?.get("x-requests-last");
  const remaining = response.headers?.get("x-requests-remaining");
  return {
    creditsUsed: last === null ? null : parseInt(last, 10),
    creditsRemaining: remaining === null ? null : parseInt(remaining, 10),
  };
}

/**
 * Fetch odds for a single sport from The Odds API (bulk endpoint —
 * featured markets only).
 */
async function fetchOddsForSport(
  sportKey: string,
  markets: string[]
): Promise<OddsApiResult> {
  if (!THE_ODDS_API_KEY) {
    throw new Error("THE_ODDS_API_KEY not configured");
  }

  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=${REGIONS_PARAM}&markets=${markets.join(",")}&bookmakers=${BOOKMAKERS_PARAM}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Odds API error ${response.status}: ${errorText}`);
  }

  const fixtures: OddsFixture[] = await response.json();
  return { fixtures, ...readUsageHeaders(response) };
}

/**
 * Fetch "additional markets" (btts / double_chance / draw_no_bet) for a
 * single event. These markets are NOT accepted by the bulk /odds endpoint
 * (422 INVALID_MARKET) — they require this per-event endpoint.
 *
 * Cost: up to markets.length × regions credits, but only markets the
 * bookmakers actually return are billed, and empty responses are free.
 */
async function fetchEventOdds(
  sportKey: string,
  eventId: string,
  markets: string[]
): Promise<OddsApiResult> {
  if (!THE_ODDS_API_KEY) {
    throw new Error("THE_ODDS_API_KEY not configured");
  }

  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds/?apiKey=${THE_ODDS_API_KEY}&regions=${REGIONS_PARAM}&markets=${markets.join(",")}&bookmakers=${BOOKMAKERS_PARAM}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Odds API error ${response.status}: ${errorText}`);
  }

  const event = (await response.json()) as OddsFixture;
  return { fixtures: [event], ...readUsageHeaders(response) };
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
  /** Quota/market metadata for this run (see quota math comment above). */
  markets: string[];
  extraMarkets: string[];
  estimatedCreditsUsed: number;
  extraCreditsUsed: number;
  creditsRemaining: number | null;
  extraEventsEnriched: number;
  extraEventsSkipped: number;
  errors: string[];
}> {
  let totalSnapshots = 0;
  let matchedFixtures = 0;
  let createdFixtures = 0;
  let unmatchedFixtures = 0;
  let sportsProcessed = 0;
  const errors: string[] = [];

  const featuredMarkets = getFeaturedMarkets();
  const extraMarkets = getExtraMarkets();

  // Estimated bulk cost: featured markets × regions, per sport request.
  // (API bills per unique market returned × regions; we budget on the
  // requested count — conservative when a market has no coverage.)
  const bulkCreditsPerSport = featuredMarkets.length * ODDS_REGIONS.length;
  let estimatedCreditsUsed = 0;

  // Events awaiting the additional-markets (per-event) pass.
  const pendingEvents: Array<{
    sportKey: string;
    fixture: OddsFixture;
    supabaseFixtureId: string;
  }> = [];

  // Quota state for the extra-market pass. Seeded from the free /sports
  // endpoint (does not count against quota) and refined from
  // x-requests-remaining headers on every odds response.
  let creditsRemaining: number | null = null;
  try {
    const usage = await getOddsApiUsage();
    if (usage.total > 0) creditsRemaining = usage.remaining;
  } catch {
    // Non-fatal — fall back to the per-run budget alone.
  }

  for (const sport of ODDS_SPORTS) {
    try {
      const { fixtures, creditsUsed, creditsRemaining: rem } =
        await fetchOddsForSport(sport.key, featuredMarkets);
      sportsProcessed++;
      estimatedCreditsUsed += creditsUsed ?? bulkCreditsPerSport;
      if (rem !== null) creditsRemaining = rem;

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

          pendingEvents.push({ sportKey: sport.key, fixture, supabaseFixtureId });
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

  // ── Phase 2: additional markets (btts / double_chance / draw_no_bet) ──
  // These are only available per event. Quota-aware:
  //   - per-run credit budget (ODDS_EXTRA_CREDIT_BUDGET, default 60)
  //   - hard stop when the API reports remaining <= ODDS_QUOTA_RESERVE (50)
  //   - hard cap on event calls (ODDS_EXTRA_MAX_EVENTS, default 50)
  //   - soonest kickoffs first — nearest fixtures matter most for
  //     upcoming predictions/recommendations.
  let extraCreditsUsed = 0;
  let extraEventsEnriched = 0;
  let extraEventsSkipped = 0;

  if (extraMarkets.length > 0 && pendingEvents.length > 0) {
    const creditBudget = getExtraCreditBudget();
    const maxEvents = getExtraMaxEvents();
    const quotaReserve = getQuotaReserve();
    // Worst-case estimate per event: markets × regions. The API only bills
    // markets actually returned (observed ~3 credits/event for all three),
    // so this is conservative.
    const estCreditsPerEvent = extraMarkets.length * ODDS_REGIONS.length;

    const ordered = [...pendingEvents].sort(
      (a, b) =>
        new Date(a.fixture.commence_time).getTime() -
        new Date(b.fixture.commence_time).getTime()
    );

    for (const pending of ordered) {
      if (extraEventsEnriched >= maxEvents) {
        extraEventsSkipped += ordered.length - extraEventsEnriched;
        break;
      }
      if (extraCreditsUsed + estCreditsPerEvent > creditBudget) {
        extraEventsSkipped += ordered.length - extraEventsEnriched;
        break;
      }
      if (
        creditsRemaining !== null &&
        creditsRemaining - estCreditsPerEvent <= quotaReserve
      ) {
        extraEventsSkipped += ordered.length - extraEventsEnriched;
        break;
      }

      try {
        const { fixtures, creditsUsed, creditsRemaining: rem } =
          await fetchEventOdds(pending.sportKey, pending.fixture.id, extraMarkets);
        if (rem !== null) creditsRemaining = rem;
        extraCreditsUsed += creditsUsed ?? estCreditsPerEvent;

        for (const eventFixture of fixtures) {
          const count = await saveOddsSnapshots(
            pending.supabaseFixtureId,
            eventFixture
          );
          totalSnapshots += count;
        }
        extraEventsEnriched++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // A failed event call bills nothing; keep going but don't spam errors.
        console.warn(
          `[ODDS] extra-market fetch failed for ${pending.fixture.id}: ${msg}`
        );
      }
    }
  } else if (extraMarkets.length > 0) {
    extraEventsSkipped = pendingEvents.length;
  }

  return {
    totalSnapshots,
    matchedFixtures,
    createdFixtures,
    unmatchedFixtures,
    sportsProcessed,
    markets: featuredMarkets,
    extraMarkets,
    estimatedCreditsUsed,
    extraCreditsUsed,
    creditsRemaining,
    extraEventsEnriched,
    extraEventsSkipped,
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
