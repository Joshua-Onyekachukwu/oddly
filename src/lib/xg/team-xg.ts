/**
 * ODDLY Team xG Profiles
 *
 * Reads per-match xG history from the `xg_features` table (populated by
 * scripts/ingest-xg.js from Understat open data) and exposes rolling
 * per-team xG profiles for the prediction pipeline.
 *
 * ── INTEGRATION POINT (follow-up, requires editing files we may not touch) ──
 *
 * Path A — worker/meta-ensemble (recommended, no ensemble.ts change needed):
 *   worker/models/feature-store-loader.js buildFeatures() already maps
 *   team_feature_profiles.avg_xg / avg_xga / xg_last5 / home_xg / away_xg
 *   into features.homeXG, homeXGA, homeXGLast5, homeXGHome, ... which
 *   worker/models/market-goals.js consumes (lines ~81-103).
 *   scripts/ingest-xg.js --profiles already refreshes those columns from
 *   xg_features, so this path is live once ingest has run.
 *
 * Path B — src/lib/models/ensemble.ts (TS path used by cron routes):
 *   predictMatchEnsemble() builds `features` via buildFeatures() which has
 *   NO xG inputs today. To wire xG in, a follow-up should:
 *     1. call getTeamXGProfiles([homeName, awayName], { asOf: matchKickoff })
 *        near the injury block (~line 435),
 *     2. extend buildFeatures' `extras` param + returned object with e.g.
 *        homeXGForAvg / homeXGAgainstAvg / homeXGLast5 / awayXGForAvg ...,
 *     3. ensure meta-ensemble market models read the new keys (they already
 *        tolerate missing keys — null → neutral).
 *   Until then this module is the lookup the follow-up will call.
 *
 * Matching: rows are stored with team_name_normalized = normalizeTeamName()
 * at ingest time. Lookups normalize the incoming name the same way, so
 * provider variants ("Athletic Club", "Wolverhampton Wanderers", "AS Roma")
 * resolve to the same key as fixtures canonical_name ("Athletic Bilbao",
 * "Wolves", "Roma").
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { normalizeTeamName } from "@/lib/football/team-normalizer";
import {
  computeRollingXG,
  groupTeamMatches,
  RollingXG,
  TeamMatchXG,
  TeamXGRow,
} from "./xg-core";

// ── Types ────────────────────────────────────────────────────────────────

export interface TeamXGProfile extends RollingXG {
  teamName: string; // normalized key actually found in xg_features
  requestedName: string;
  hasData: boolean;
}

export interface XGProfileOptions {
  /** Rolling window in matches (default 10). */
  window?: number;
  /** Only count matches on/before this ISO date (prevents look-ahead). */
  asOf?: string | null;
  /** Optional pre-built client (scripts/tests); defaults to service client. */
  client?: SupabaseClient;
}

// ── DB access ────────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );
  }
  return _client;
}

interface XGFeatureRow {
  team_name: string;
  team_name_normalized: string | null;
  match_date: string | null;
  is_home: boolean | null;
  xg_for: number | string | null;
  xg_against: number | string | null;
  opponent: string | null;
  league: string | null;
  season: string | null;
  match_external_id: string | null;
  source: string | null;
  fixture_id: string | null;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toTeamXGRow(r: XGFeatureRow): TeamXGRow | null {
  const xgFor = num(r.xg_for);
  const xgAgainst = num(r.xg_against);
  if (xgFor === null || xgAgainst === null || !r.match_date) return null;
  const teamName = r.team_name_normalized || r.team_name;
  const teamKey = r.team_name_normalized || normalizeTeamName(r.team_name);
  return {
    teamName: r.team_name,
    teamKey,
    opponent: r.opponent || "",
    opponentKey: "",
    isHome: r.is_home === true,
    xgFor,
    xgAgainst,
    xgDiff: xgFor - xgAgainst,
    matchDate: String(r.match_date).slice(0, 10),
    league: r.league,
    season: r.season,
    externalId: r.match_external_id,
  };
}

const SELECT_COLS =
  "team_name, team_name_normalized, match_date, is_home, xg_for, xg_against, " +
  "opponent, league, season, match_external_id, source, fixture_id";

/**
 * Fetch raw xg_features rows for one normalized team key.
 * Falls back to exact team_name match for rows ingested before the
 * team_name_normalized column existed.
 */
async function fetchRowsForKey(
  client: SupabaseClient,
  teamKey: string,
  rawName?: string
): Promise<XGFeatureRow[]> {
  const { data, error } = await client
    .from("xg_features")
    .select(SELECT_COLS)
    .eq("team_name_normalized", teamKey)
    .not("match_date", "is", null)
    .order("match_date", { ascending: true })
    .limit(2000);
  if (error) throw new Error(`xg_features query failed: ${error.message}`);
  if ((data || []).length > 0) return data as unknown as XGFeatureRow[];

  if (rawName) {
    const { data: d2, error: e2 } = await client
      .from("xg_features")
      .select(SELECT_COLS)
      .eq("team_name", rawName)
      .not("match_date", "is", null)
      .order("match_date", { ascending: true })
      .limit(2000);
    if (e2) throw new Error(`xg_features fallback query failed: ${e2.message}`);
    return (d2 || []) as unknown as XGFeatureRow[];
  }
  return [];
}

function profileFromMatches(
  requestedName: string,
  teamKey: string,
  matches: TeamMatchXG[],
  opts: XGProfileOptions
): TeamXGProfile {
  const rolling = computeRollingXG(matches, { window: opts.window ?? 10, asOf: opts.asOf ?? null });
  if (!rolling) {
    return {
      ...emptyRolling(),
      teamName: teamKey,
      requestedName,
      hasData: false,
    };
  }
  return {
    ...rolling,
    teamName: teamKey,
    requestedName,
    hasData: true,
  };
}

function emptyRolling(): RollingXG {
  return {
    sampleSize: 0,
    windowSize: 10,
    xgForAvg: null,
    xgAgainstAvg: null,
    xgDiff: null,
    homeXgForAvg: null,
    awayXgForAvg: null,
    homeXgAgainstAvg: null,
    awayXgAgainstAvg: null,
    last5XgForAvg: null,
    last5XgAgainstAvg: null,
    dataThrough: null,
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Get the rolling xG profile for a single team.
 * Never throws on missing data — returns hasData:false so callers can
 * fall back to neutral features.
 */
export async function getTeamXGProfile(
  teamName: string,
  opts: XGProfileOptions = {}
): Promise<TeamXGProfile> {
  const teamKey = normalizeTeamName(teamName);
  if (!teamKey) {
    return { ...emptyRolling(), teamName: "", requestedName: teamName, hasData: false };
  }
  const client = opts.client ?? getClient();
  try {
    const rows = await fetchRowsForKey(client, teamKey, teamName);
    const matchesByTeam = groupTeamMatches(
      rows.map(toTeamXGRow).filter((r): r is TeamXGRow => r !== null)
    );
    return profileFromMatches(teamName, teamKey, matchesByTeam.get(teamKey) || [], opts);
  } catch (e: any) {
    console.warn(`[xg] getTeamXGProfile(${teamName}) failed:`, e?.message || e);
    return { ...emptyRolling(), teamName: teamKey, requestedName: teamName, hasData: false };
  }
}

/**
 * Batch variant — one DB round-trip for many teams. Returns a Map keyed by
 * the normalized team key. Teams with no xG history are absent from the map
 * (callers should treat absence as hasData:false).
 */
export async function getTeamXGProfiles(
  teamNames: string[],
  opts: XGProfileOptions = {}
): Promise<Map<string, TeamXGProfile>> {
  const result = new Map<string, TeamXGProfile>();
  const keyToNames = new Map<string, string[]>();
  for (const name of teamNames) {
    const key = normalizeTeamName(name);
    if (!key) continue;
    if (!keyToNames.has(key)) keyToNames.set(key, []);
    keyToNames.get(key)!.push(name);
  }
  if (keyToNames.size === 0) return result;

  const client = opts.client ?? getClient();
  const keys = [...keyToNames.keys()];
  try {
    const { data, error } = await client
      .from("xg_features")
      .select(SELECT_COLS)
      .in("team_name_normalized", keys)
      .not("match_date", "is", null)
      .order("match_date", { ascending: true })
      .limit(50000);
    if (error) throw new Error(error.message);

    const rows = ((data || []) as unknown as XGFeatureRow[])
      .map(toTeamXGRow)
      .filter((r): r is TeamXGRow => r !== null);
    const byTeam = groupTeamMatches(rows);

    for (const [key, names] of keyToNames) {
      const profile = profileFromMatches(names[0], key, byTeam.get(key) || [], opts);
      result.set(key, profile);
      for (const n of names) result.set(normalizeTeamName(n), profile);
    }
  } catch (e: any) {
    console.warn("[xg] getTeamXGProfiles failed:", e?.message || e);
  }
  return result;
}
