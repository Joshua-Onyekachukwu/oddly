/**
 * Match context helpers — shared by the match detail page
 * (src/app/(dashboard)/matches/[id]/page.tsx) and the public fixture API
 * (src/app/api/v1/fixtures/[id]/route.ts).
 *
 * Everything here is honest-empty-state safe: sections return null/[] when
 * the underlying tables have no rows for this fixture, and nothing is
 * fabricated. `lineups` are PREDICTED (top-11 by player importance minus
 * reported absences) — official lineups publish ~1h before kickoff and are
 * never guessed at.
 */

import { normalizeTeamName } from "@/lib/football/team-normalizer";
import { normalizeName, personKey } from "@/lib/players/importance";

// ── Row shapes (loose — tables are untyped or partially typed) ────────────

export interface ContextTeam {
  id: string;
  canonical_name: string | null;
}

export interface TeamProfileRow {
  team_name: string;
  league?: string | null;
  attack_rating?: number | null;
  defense_rating?: number | null;
  goals_for_per_game?: number | null;
  goals_against_per_game?: number | null;
  win_rate?: number | null;
  home_win_rate?: number | null;
  away_win_rate?: number | null;
  avg_xg?: number | null;
  avg_xga?: number | null;
  xg_last5?: number | null;
  home_xg?: number | null;
  away_xg?: number | null;
  npxg_ratio?: number | null;
  avg_ppda?: number | null;
  xg_source?: string | null;
  data_season?: string | null;
  last_updated?: string | null;
}

export interface H2HFixtureRow {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  kickoff_time: string | null;
  status: string | null;
  home_score: number | null;
  away_score: number | null;
}

export interface XGFeatureRow {
  fixture_id: string | null;
  team_name?: string | null;
  team_name_normalized?: string | null;
  is_home?: boolean | null;
  xg_for?: number | null;
  xg_against?: number | null;
  match_date?: string | null;
}

export interface H2HMeeting {
  fixture_id: string;
  kickoff_time: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_score: number | null;
  away_score: number | null;
  /** null when no xg_features rows are linked to this meeting. */
  xg: {
    home_for: number;
    home_against: number;
    away_for: number;
    away_against: number;
  } | null;
}

export interface InjuryRow {
  team_name: string;
  player_name: string | null;
  status: string | null;
  injury_type?: string | null;
  expected_return?: string | null;
  matches_missed?: number | null;
  player_importance?: number | null; // legacy 1-10 scale on injury row
  fetched_at?: string | null;
}

export interface ImportanceRow {
  team_name: string;
  player_name: string;
  score_0_1?: number | null;
  score_1_10?: number | null;
  confidence?: string | null;
  method?: string | null;
}

export interface InjuryEntry {
  player_name: string;
  status: string | null;
  injury_type: string | null;
  expected_return: string | null;
  matches_missed: number | null;
  /** 0-1 importance score from player_importance when matched, else null. */
  importance_score: number | null;
  /** legacy 1-10 score (player_importance when matched, else injury row). */
  importance_1_10: number | null;
  confidence: string | null;
  method: string | null;
}

export interface PredictionContextRow {
  id?: string;
  market?: string | null;
  selection?: string | null;
  model_probability?: number | null;
  model_version?: string | null;
  confidence_tier?: string | null;
  data_quality_score?: number | null;
  data_quality_breakdown?: unknown;
  input_snapshot?: unknown;
  created_at?: string | null;
}

export interface OddsSnapshotRow {
  bookmaker?: string | null;
  market?: string | null;
  selection?: string | null;
  odds?: number | null;
  snapshot_time?: string | null;
  captured_at?: string | null;
}

export interface OddsMarketSummary {
  market: string;
  selection: string;
  opening_odds: number | null;
  latest_odds: number | null;
  bookmakers: number;
}

export interface AppearanceRow {
  player_name?: string | null;
  /** personKey(player_name) as stored by the ingest script. */
  player_name_normalized?: string | null;
  team_name_normalized?: string | null;
  is_starter?: boolean | null;
  match_date?: string | null;
  minutes_played?: number | null;
  position?: string | null;
}

export interface PredictedLineupPlayer {
  player_name: string;
  /** 1-10 importance score when known. */
  score_1_10: number | null;
  confidence: string | null;
  /** true when injury feed lists the player as doubtful/questionable/likely. */
  doubtful: boolean;
  /** number of recent starts found in player_appearances (0 = importance-only). */
  recent_starts: number;
}

export interface PredictedLineupAbsent {
  player_name: string;
  status: string | null;
  importance_1_10: number | null;
}

export type LineupBasis = "appearances" | "importance";

export interface PredictedLineup {
  /** Top `xiSize` available players — NOT an official XI. */
  starters: PredictedLineupPlayer[];
  bench: PredictedLineupPlayer[];
  /** Players excluded by injury/suspension status. */
  unavailable: PredictedLineupAbsent[];
  /** Total tracked squad candidates (importance ∪ appearances). */
  squad_size: number;
  /**
   * 'appearances' when recent starter data drove the ranking;
   * 'importance' when only player_importance scores were available.
   */
  lineup_basis: LineupBasis;
  /** distinct match dates of appearance data considered (0 when none). */
  appearance_matches: number;
  /** newest match_date among the considered appearances (ISO date or null). */
  appearance_latest_date: string | null;
}

export interface MatchContext {
  team_profiles: {
    home: (TeamProfileRow & { team_key: string; xg_matches: number }) | null;
    away: (TeamProfileRow & { team_key: string; xg_matches: number }) | null;
  };
  h2h: {
    meetings: H2HMeeting[];
    /** number of meetings that had linked xG data */
    with_xg: number;
  };
  injuries: {
    home: InjuryEntry[];
    away: InjuryEntry[];
    /** true when the feed may be truncated (hit the row cap) */
    truncated: boolean;
  };
  prediction_context: {
    market: string | null;
    selection: string | null;
    model_probability: number | null;
    model_version: string | null;
    confidence_tier: string | null;
    data_quality_score: number | null;
    data_quality_verdict: string | null;
    data_quality_breakdown: unknown;
    input: {
      home_elo: number | null;
      away_elo: number | null;
      home_form: unknown;
      away_form: unknown;
      injury: unknown;
      league_gate: string | null;
      captured_at: string | null;
    } | null;
  } | null;
  odds_summary: OddsMarketSummary[];
  /** Predicted XIs from recent starter appearances, else importance-ranked. */
  lineups: {
    home: PredictedLineup | null;
    away: PredictedLineup | null;
  };
}

// ── Pure helpers (unit-tested) ────────────────────────────────────────────

const FINISHED_STATUSES = new Set(["finished", "ft", "full time", "completed"]);

/**
 * Derive head-to-head meetings between two teams from the fixtures table.
 * Returns up to `limit` finished meetings, most recent first, in either
 * venue order (home/away swapped when the teams met at the other ground).
 */
export function deriveH2HMeetings(
  rows: H2HFixtureRow[],
  homeTeamId: string,
  awayTeamId: string,
  limit = 5
): H2HMeeting[] {
  return rows
    .filter((r) => {
      if (!r.id || r.id === "") return false;
      const status = (r.status || "").toLowerCase();
      if (!FINISHED_STATUSES.has(status)) return false;
      const pair =
        (r.home_team_id === homeTeamId && r.away_team_id === awayTeamId) ||
        (r.home_team_id === awayTeamId && r.away_team_id === homeTeamId);
      return pair;
    })
    .sort((a, b) => String(b.kickoff_time || "").localeCompare(String(a.kickoff_time || "")))
    .slice(0, limit)
    .map((r) => ({
      fixture_id: r.id,
      kickoff_time: r.kickoff_time,
      home_team_id: r.home_team_id,
      away_team_id: r.away_team_id,
      home_score: r.home_score ?? null,
      away_score: r.away_score ?? null,
      xg: null,
    }));
}

/**
 * Attach xG figures to H2H meetings from xg_features rows linked via
 * fixture_id. Each meeting needs one row per side; home side is resolved by
 * is_home when present, else by matching normalized team names to the
 * meeting's home/away team keys.
 */
export function attachXGToMeetings(
  meetings: H2HMeeting[],
  xgRows: XGFeatureRow[],
  homeTeamKey: string,
  awayTeamKey: string
): { meetings: H2HMeeting[]; withXg: number } {
  const byFixture = new Map<string, XGFeatureRow[]>();
  for (const row of xgRows) {
    if (!row.fixture_id) continue;
    const list = byFixture.get(row.fixture_id) || [];
    list.push(row);
    byFixture.set(row.fixture_id, list);
  }

  let withXg = 0;
  const out = meetings.map((m) => {
    const rows = byFixture.get(m.fixture_id) || [];
    if (rows.length === 0) return m;

    const rowKey = (r: XGFeatureRow) =>
      r.team_name_normalized || normalizeTeamName(r.team_name || "");

    const homeRow =
      rows.find((r) => r.is_home === true) ||
      rows.find((r) => rowKey(r) === homeTeamKey) ||
      null;
    const awayRow =
      rows.find((r) => r.is_home === false && r !== homeRow) ||
      rows.find((r) => r !== homeRow && rowKey(r) === awayTeamKey) ||
      (rows.length === 2 && homeRow ? rows.find((r) => r !== homeRow)! : null);

    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const hf = homeRow ? num(homeRow.xg_for) : null;
    const ha = homeRow ? num(homeRow.xg_against) : null;
    const af = awayRow ? num(awayRow.xg_for) : null;
    const aa = awayRow ? num(awayRow.xg_against) : null;

    if (hf == null || af == null) return m;
    withXg += 1;
    return {
      ...m,
      xg: {
        home_for: hf,
        home_against: ha ?? 0,
        away_for: af,
        away_against: aa ?? 0,
      },
    };
  });

  return { meetings: out, withXg };
}

/**
 * Find a team_feature_profiles row for a team by normalized name.
 * `profiles` should already be a bounded candidate set (the table is matched
 * in memory because provider names differ across sources).
 */
export function findTeamProfile<T extends { team_name?: string | null }>(
  profiles: T[],
  teamName: string | null | undefined
): T | null {
  const key = normalizeTeamName(teamName || "");
  if (!key) return null;
  return profiles.find((p) => normalizeTeamName(p.team_name || "") === key) || null;
}

/** Count xg_features rows per normalized team key. */
export function countXGMatches(
  rows: Array<{ team_name?: string | null; team_name_normalized?: string | null }>,
  teamKey: string
): number {
  return rows.filter(
    (r) => (r.team_name_normalized || normalizeTeamName(r.team_name || "")) === teamKey
  ).length;
}

/**
 * Join player_injury_data rows to player_importance scores.
 * Importance is keyed by `${normalizedTeam}|${personKey(player)}`; falls back
 * to the injury row's own legacy 1-10 player_importance when no match.
 * Sorted by effective importance descending.
 */
export function joinInjuriesToImportance(
  injuries: InjuryRow[],
  importanceRows: ImportanceRow[]
): InjuryEntry[] {
  const impByKey = new Map<string, ImportanceRow>();
  for (const row of importanceRows) {
    const key = `${normalizeTeamName(row.team_name || "")}|${personKey(row.player_name)}`;
    if (key !== "|" && !impByKey.has(key)) impByKey.set(key, row);
  }

  const out: InjuryEntry[] = [];
  for (const inj of injuries) {
    const name = (inj.player_name || "").trim();
    if (!name) continue;
    const key = `${normalizeTeamName(inj.team_name || "")}|${personKey(name)}`;
    const imp = impByKey.get(key) || null;

    const score01 =
      imp?.score_0_1 != null ? Number(imp.score_0_1) : null;
    const legacy =
      imp?.score_1_10 != null
        ? Number(imp.score_1_10)
        : inj.player_importance != null
          ? Number(inj.player_importance)
          : null;

    out.push({
      player_name: name,
      status: inj.status ?? null,
      injury_type: inj.injury_type ?? null,
      expected_return: inj.expected_return ?? null,
      matches_missed: inj.matches_missed ?? null,
      importance_score:
        score01 != null && Number.isFinite(score01) ? score01 : null,
      importance_1_10:
        legacy != null && Number.isFinite(legacy) ? legacy : null,
      confidence: imp?.confidence ?? null,
      method: imp?.method ?? null,
    });
  }

  out.sort(
    (a, b) =>
      (b.importance_score ?? b.importance_1_10 ?? -1) -
      (a.importance_score ?? a.importance_1_10 ?? -1)
  );
  return out;
}

/** Split injury rows into home/away groups by normalized team name. */
export function groupInjuriesByTeam(
  injuries: InjuryRow[],
  homeTeamKey: string,
  awayTeamKey: string
): { home: InjuryRow[]; away: InjuryRow[] } {
  const home: InjuryRow[] = [];
  const away: InjuryRow[] = [];
  for (const row of injuries) {
    const key = normalizeTeamName(row.team_name || "");
    if (key === homeTeamKey) home.push(row);
    else if (key === awayTeamKey) away.push(row);
  }
  return { home, away };
}

const LINEUP_OUT_STATUSES = /injur|suspend|out/i;
const LINEUP_DOUBT_STATUSES = /doubtful|questionable|maybe|touch.*go/i;

const CONFIDENCE_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  med: 2,
  low: 1,
};

/** How many of a team's most recent appearance match_dates to consider. */
export const LINEUP_APPEARANCE_MATCHES = 10;

/**
 * Supplementary team-key aliases for player_appearances lookups.
 *
 * `team_name_normalized` is produced by normalizeTeamName() at ingest time,
 * but a handful of StatsBomb club names resolve to a different key than our
 * canonical team names (the shared alias table lives in
 * src/lib/football/team-normalizer.ts and covers the common cases). These
 * entries map OUR normalized key → the key StatsBomb rows were stored under,
 * and are applied ONLY to appearance lookups — never to importance/injury
 * matching.
 */
export const APPEARANCE_TEAM_KEY_ALIASES: Record<string, string> = {
  "deportivo la coruna": "rc deportivo la coruna",
  "real racing club de santander": "racing santander",
  "sp gijon": "sporting gijon",
  valladolid: "real valladolid",
  zaragoza: "real zaragoza",
  cordoba: "cordoba cf",
  darmstadt: "darmstadt 98",
  hannover: "hannover 96",
  hertha: "hertha berlin",
};

/** Resolve a fixture team key to the key used in player_appearances. */
export function appearanceTeamKey(teamKey: string): string {
  return APPEARANCE_TEAM_KEY_ALIASES[teamKey] || teamKey;
}

interface LineupCandidate {
  player_name: string;
  score: number; // 1-10 scale, -1 when unknown
  confidence: string | null;
  /** recent starts found in player_appearances */
  starts: number;
  last_start_date: string;
  importance_row: ImportanceRow | null;
}

/**
 * Build a PREDICTED lineup for one team.
 *
 * Ranking prefers ACTUAL recent starters: when `appearanceRows` contains
 * player_appearances rows for this team, players are ordered by start
 * frequency over the team's last `LINEUP_APPEARANCE_MATCHES` match dates,
 * then by player_importance score. Players with no recorded starts fall back
 * to pure importance order for the remaining spots. When no appearance data
 * exists the function degrades to the original importance-only ranking.
 *
 * This is explicitly NOT an official lineup — it is the model's best guess
 * of the most likely starting XI given recent selections, squad importance
 * and the current availability feed. Players flagged doubtful/questionable/
 * likely in the injury feed remain eligible but are marked `doubtful: true`.
 *
 * Returns null when the team has neither importance rows nor appearances.
 */
export function buildPredictedLineup(
  importanceRows: ImportanceRow[],
  teamKey: string,
  injuryEntries: InjuryEntry[],
  xiSize = 11,
  benchSize = 7,
  appearanceRows: AppearanceRow[] = []
): PredictedLineup | null {
  const squad = importanceRows.filter(
    (r) => normalizeTeamName(r.team_name || "") === teamKey && r.player_name
  );

  // ── Recent starter stats from player_appearances ──────────────────────
  // Keep only this team's rows (via the appearance-specific key alias),
  // then restrict to the last N distinct match_dates so stale seasons
  // can't dominate the ranking.
  const appTeamKey = appearanceTeamKey(teamKey);
  const teamAppearances = appearanceRows.filter(
    (a) =>
      a.team_name_normalized === appTeamKey &&
      a.is_starter === true &&
      (a.player_name_normalized || personKey(a.player_name))
  );
  const dates = [...new Set(teamAppearances.map((a) => a.match_date || ""))]
    .filter(Boolean)
    .sort()
    .reverse();
  const recentDates = new Set(dates.slice(0, LINEUP_APPEARANCE_MATCHES));
  const recentApps = teamAppearances.filter(
    (a) => !a.match_date || recentDates.has(a.match_date)
  );

  // starts per personKey + display name from the most recent appearance
  const startStats = new Map<
    string,
    { starts: number; lastDate: string; name: string }
  >();
  for (const a of recentApps) {
    const key = a.player_name_normalized || personKey(a.player_name);
    if (!key || key === "|") continue;
    const cur = startStats.get(key) || { starts: 0, lastDate: "", name: "" };
    cur.starts += 1;
    const d = a.match_date || "";
    if (d >= cur.lastDate) {
      cur.lastDate = d;
      cur.name = a.player_name || cur.name;
    }
    startStats.set(key, cur);
  }

  // ── Merge importance squad + appearance-only players ──────────────────
  const scoreOf = (r: ImportanceRow | null): number => {
    if (!r) return -1;
    if (r.score_1_10 != null && Number.isFinite(Number(r.score_1_10)))
      return Number(r.score_1_10);
    if (r.score_0_1 != null && Number.isFinite(Number(r.score_0_1)))
      return Number(r.score_0_1) * 10;
    return -1;
  };

  const candidates = new Map<string, LineupCandidate>();
  for (const r of squad) {
    const key = personKey(r.player_name);
    if (!key || key === "|") continue;
    candidates.set(key, {
      player_name: r.player_name,
      score: scoreOf(r),
      confidence: r.confidence ?? null,
      starts: 0,
      last_start_date: "",
      importance_row: r,
    });
  }
  for (const [key, st] of startStats) {
    const cur = candidates.get(key);
    if (cur) {
      cur.starts = st.starts;
      cur.last_start_date = st.lastDate;
    } else {
      candidates.set(key, {
        player_name: st.name || key,
        score: -1,
        confidence: null,
        starts: st.starts,
        last_start_date: st.lastDate,
        importance_row: null,
      });
    }
  }

  if (candidates.size === 0) return null;

  const injByKey = new Map<string, InjuryEntry>();
  for (const e of injuryEntries) {
    injByKey.set(personKey(e.player_name), e);
  }

  const toPlayer = (c: LineupCandidate, doubtful: boolean): PredictedLineupPlayer => ({
    player_name: c.player_name,
    score_1_10: c.score >= 0 ? c.score : null,
    confidence: c.confidence,
    doubtful,
    recent_starts: c.starts,
  });

  const eligible: LineupCandidate[] = [];
  const unavailable: PredictedLineupAbsent[] = [];

  for (const c of candidates.values()) {
    const inj = injByKey.get(personKey(c.player_name)) || null;
    const status = (inj?.status || "").toLowerCase();
    if (status && LINEUP_OUT_STATUSES.test(status) && !LINEUP_DOUBT_STATUSES.test(status)) {
      unavailable.push({
        player_name: c.player_name,
        status: inj?.status ?? null,
        importance_1_10: c.score >= 0 ? c.score : null,
      });
      continue;
    }
    eligible.push(c);
  }

  // Start frequency first, then importance score; never-started players keep
  // pure importance order. Ties: confidence rank, then recent activity.
  eligible.sort((a, b) => {
    if (b.starts !== a.starts) return b.starts - a.starts;
    const d = b.score - a.score;
    if (d !== 0) return d;
    const cr =
      (CONFIDENCE_RANK[(b.confidence || "").toLowerCase()] || 0) -
      (CONFIDENCE_RANK[(a.confidence || "").toLowerCase()] || 0);
    if (cr !== 0) return cr;
    return b.last_start_date.localeCompare(a.last_start_date);
  });

  const isDoubtful = (c: LineupCandidate) => {
    const inj = injByKey.get(personKey(c.player_name));
    return !!inj && LINEUP_DOUBT_STATUSES.test((inj.status || "").toLowerCase());
  };

  const starters = eligible.slice(0, xiSize);
  const lineup_basis: LineupBasis =
    recentApps.length > 0 && starters.some((c) => c.starts > 0)
      ? "appearances"
      : "importance";

  return {
    starters: starters.map((c) => toPlayer(c, isDoubtful(c))),
    bench: eligible.slice(xiSize, xiSize + benchSize).map((c) => toPlayer(c, isDoubtful(c))),
    unavailable: unavailable.sort(
      (a, b) => (b.importance_1_10 ?? -1) - (a.importance_1_10 ?? -1)
    ),
    squad_size: candidates.size,
    lineup_basis,
    appearance_matches: recentDates.size,
    appearance_latest_date:
      recentApps
        .map((a) => a.match_date || "")
        .filter(Boolean)
        .sort()
        .pop() || null,
  };
}

/**
 * Build the prediction-context payload from the newest prediction row for a
 * fixture. All prediction rows for a fixture share the same input_snapshot /
 * data-quality breakdown, so the latest row is representative.
 */
export function buildPredictionContext(
  rows: PredictionContextRow[]
): MatchContext["prediction_context"] {
  if (!rows || rows.length === 0) return null;
  const latest = [...rows].sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
  )[0];

  const snap = (latest.input_snapshot || null) as Record<string, any> | null;
  const dq = (latest.data_quality_breakdown || snap?.data_quality || null) as
    | Record<string, any>
    | null;

  const input = snap
    ? {
        home_elo: snap.home_elo ?? null,
        away_elo: snap.away_elo ?? null,
        home_form: snap.home_form ?? null,
        away_form: snap.away_form ?? null,
        injury: snap.injury ?? null,
        league_gate: snap.league_gate ?? null,
        captured_at: snap.captured_at ?? null,
      }
    : null;

  return {
    market: latest.market ?? null,
    selection: latest.selection ?? null,
    model_probability: latest.model_probability ?? null,
    model_version: latest.model_version ?? null,
    confidence_tier: latest.confidence_tier ?? null,
    data_quality_score: latest.data_quality_score ?? null,
    data_quality_verdict: dq?.verdict ?? null,
    data_quality_breakdown: latest.data_quality_breakdown ?? dq ?? null,
    input,
  };
}

/**
 * Summarize odds snapshots: per (market, selection) report opening odds,
 * latest odds and distinct bookmaker count. Rows are sorted by snapshot_time;
 * ties/missing timestamps fall back to captured_at then array order.
 */
export function summarizeOdds(
  rows: OddsSnapshotRow[]
): OddsMarketSummary[] {
  const timeOf = (r: OddsSnapshotRow) =>
    r.snapshot_time || r.captured_at || "";

  const groups = new Map<string, OddsSnapshotRow[]>();
  for (const r of rows) {
    const market = r.market || "unknown";
    const selection = r.selection || "";
    const key = `${market}|${selection}`;
    const list = groups.get(key) || [];
    list.push(r);
    groups.set(key, list);
  }

  const out: OddsMarketSummary[] = [];
  for (const [key, list] of groups) {
    const [market, selection] = key.split("|");
    const sorted = [...list].sort((a, b) => timeOf(a).localeCompare(timeOf(b)));
    const oddsVals = sorted
      .map((r) => Number(r.odds))
      .filter((n) => Number.isFinite(n));
    const bookmakers = new Set(
      sorted.map((r) => r.bookmaker).filter(Boolean)
    ).size;
    out.push({
      market,
      selection,
      opening_odds: oddsVals.length ? oddsVals[0] : null,
      latest_odds: oddsVals.length ? oddsVals[oddsVals.length - 1] : null,
      bookmakers,
    });
  }

  out.sort((a, b) => a.market.localeCompare(b.market) || a.selection.localeCompare(b.selection));
  return out;
}

// ── DB fetch orchestration ────────────────────────────────────────────────

const PROFILE_COLS =
  "team_name, league, attack_rating, defense_rating, goals_for_per_game, " +
  "goals_against_per_game, win_rate, home_win_rate, away_win_rate, avg_xg, " +
  "avg_xga, xg_last5, home_xg, away_xg, npxg_ratio, avg_ppda, xg_source, " +
  "data_season, last_updated";

const INJURY_COLS =
  "team_name, player_name, status, injury_type, expected_return, " +
  "player_importance, matches_missed, fetched_at";

const IMPORTANCE_COLS =
  "team_name, player_name, score_0_1, score_1_10, confidence, method";

const PREDICTION_COLS =
  "id, market, selection, model_probability, model_version, " +
  "confidence_tier, data_quality_score, data_quality_breakdown, " +
  "input_snapshot, created_at";

const ODDS_COLS = "bookmaker, market, selection, odds, snapshot_time";

const XG_COLS =
  "fixture_id, team_name, team_name_normalized, is_home, xg_for, xg_against, match_date";

const H2H_COLS =
  "id, home_team_id, away_team_id, kickoff_time, status, home_score, away_score";

const APPEARANCE_COLS =
  "player_name, player_name_normalized, team_name_normalized, is_starter, " +
  "match_date, minutes_played, position";

/** Bound on player_appearances rows fetched per fixture context. */
const APPEARANCE_SCAN_LIMIT = 400;

const INJURY_SCAN_LIMIT = 10000;
const PROFILE_SCAN_LIMIT = 5000;
const IMPORTANCE_SCAN_LIMIT = 10000;
const ODDS_SCAN_LIMIT = 2000;

interface FixtureLike {
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
}

/**
 * Fetch all match-context sections for a fixture. Never throws — each
 * section degrades to null/[] on query failure so the page/API still render.
 *
 * `supabase` may be the server client or anon client; untyped tables
 * (player_importance, xg_features extra cols) are cast through `any`,
 * matching existing codebase conventions.
 */
export async function fetchMatchContext(
  supabase: any,
  fixture: FixtureLike
): Promise<MatchContext> {
  const empty: MatchContext = {
    team_profiles: { home: null, away: null },
    h2h: { meetings: [], with_xg: 0 },
    injuries: { home: [], away: [], truncated: false },
    prediction_context: null,
    odds_summary: [],
    lineups: { home: null, away: null },
  };

  const homeId = fixture.home_team_id;
  const awayId = fixture.away_team_id;
  if (!homeId || !awayId) return empty;

  // Team names (needed for normalized matching across sources).
  const { data: teams } = await supabase
    .from("teams")
    .select("id, canonical_name")
    .in("id", [homeId, awayId]);
  const homeTeam = ((teams || []) as ContextTeam[]).find((t) => t.id === homeId) || null;
  const awayTeam = ((teams || []) as ContextTeam[]).find((t) => t.id === awayId) || null;
  const homeKey = normalizeTeamName(homeTeam?.canonical_name || "");
  const awayKey = normalizeTeamName(awayTeam?.canonical_name || "");

  // ── Parallel fetches ──────────────────────────────────────────────────
  const [profilesRes, h2hRes, xgCountRes, impRes, predRes, oddsRes, appRes] =
    await Promise.all([
      supabase
        .from("team_feature_profiles")
        .select(PROFILE_COLS)
        .limit(PROFILE_SCAN_LIMIT),
      supabase
        .from("fixtures")
        .select(H2H_COLS)
        .eq("status", "finished")
        .neq("id", fixture.id)
        .or(
          `and(home_team_id.eq.${homeId},away_team_id.eq.${awayId}),` +
            `and(home_team_id.eq.${awayId},away_team_id.eq.${homeId})`
        )
        .order("kickoff_time", { ascending: false })
        .limit(5),
      // Lean scan — only team keys are needed for the xG coverage counts.
      supabase
        .from("xg_features")
        .select("team_name, team_name_normalized")
        .not("match_date", "is", null)
        .limit(50000),
      supabase
        .from("player_importance")
        .select(IMPORTANCE_COLS)
        .limit(IMPORTANCE_SCAN_LIMIT),
      supabase
        .from("predictions")
        .select(PREDICTION_COLS)
        .eq("fixture_id", fixture.id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("odds_snapshots")
        .select(ODDS_COLS)
        .eq("fixture_id", fixture.id)
        .order("snapshot_time", { ascending: true })
        .limit(ODDS_SCAN_LIMIT),
      // Recent lineup appearances for both teams — bounded scan ordered by
      // date so buildPredictedLineup sees each team's most recent matches.
      // appearanceTeamKey maps our canonical keys onto StatsBomb's stored keys.
      supabase
        .from("player_appearances")
        .select(APPEARANCE_COLS)
        .in("team_name_normalized", [
          appearanceTeamKey(homeKey),
          appearanceTeamKey(awayKey),
        ].filter(Boolean))
        .order("match_date", { ascending: false })
        .limit(APPEARANCE_SCAN_LIMIT),
    ]);

  // ── Team profiles ─────────────────────────────────────────────────────
  const profiles = (profilesRes.data || []) as TeamProfileRow[];
  const profileRows = (xgCountRes.data || []) as Array<{
    team_name?: string | null;
    team_name_normalized?: string | null;
  }>;
  const homeProfile = findTeamProfile(profiles, homeTeam?.canonical_name);
  const awayProfile = findTeamProfile(profiles, awayTeam?.canonical_name);
  const team_profiles = {
    home: homeProfile
      ? { ...homeProfile, team_key: homeKey, xg_matches: countXGMatches(profileRows, homeKey) }
      : null,
    away: awayProfile
      ? { ...awayProfile, team_key: awayKey, xg_matches: countXGMatches(profileRows, awayKey) }
      : null,
  };

  // ── H2H + linked xG ───────────────────────────────────────────────────
  const meetings = deriveH2HMeetings(
    (h2hRes.data || []) as H2HFixtureRow[],
    homeId,
    awayId,
    5
  );
  let h2h = { meetings, with_xg: 0 };
  if (meetings.length > 0) {
    const fixtureIds = meetings.map((m) => m.fixture_id);
    const { data: xgRows } = await supabase
      .from("xg_features")
      .select(XG_COLS)
      .in("fixture_id", fixtureIds);
    const attached = attachXGToMeetings(
      meetings,
      (xgRows || []) as XGFeatureRow[],
      homeKey,
      awayKey
    );
    h2h = { meetings: attached.meetings, with_xg: attached.withXg };
  }

  // ── Injuries joined to importance ─────────────────────────────────────
  // ilike first per team (cheap path), full normalized scan as fallback —
  // same strategy as the team detail page.
  let injuryRows: InjuryRow[] = [];
  let truncated = false;
  const ilikeParts = [homeTeam?.canonical_name, awayTeam?.canonical_name]
    .filter((n): n is string => Boolean(n))
    .map((n) => `team_name.ilike.%${n}%`);
  if (ilikeParts.length > 0) {
    const { data } = await supabase
      .from("player_injury_data")
      .select(INJURY_COLS)
      .or(ilikeParts.join(","))
      .limit(500);
    injuryRows = (data || []) as InjuryRow[];
  }
  if (injuryRows.length === 0) {
    const { data } = await supabase
      .from("player_injury_data")
      .select(INJURY_COLS)
      .limit(INJURY_SCAN_LIMIT);
    truncated = ((data || []) as InjuryRow[]).length >= INJURY_SCAN_LIMIT;
    injuryRows = ((data || []) as InjuryRow[]);
  }
  // Keep only rows whose normalized team name matches one of the two
  // fixture teams — ilike can pull in unrelated name variants.
  injuryRows = injuryRows.filter((r) => {
    const key = normalizeTeamName(r.team_name || "");
    return key === homeKey || key === awayKey;
  });

  const grouped = groupInjuriesByTeam(injuryRows, homeKey, awayKey);
  const importanceRows = (impRes.data || []) as ImportanceRow[];
  const injuries = {
    home: joinInjuriesToImportance(grouped.home, importanceRows),
    away: joinInjuriesToImportance(grouped.away, importanceRows),
    truncated,
  };

  // ── Prediction context ────────────────────────────────────────────────
  const prediction_context = buildPredictionContext(
    (predRes.data || []) as PredictionContextRow[]
  );

  // ── Odds summary ──────────────────────────────────────────────────────
  const odds_summary = summarizeOdds((oddsRes.data || []) as OddsSnapshotRow[]);

  // ── Predicted lineups (recent starters → importance fallback) ─────────
  const appHomeKey = appearanceTeamKey(homeKey);
  const appAwayKey = appearanceTeamKey(awayKey);
  const appearanceRows = ((appRes.data || []) as AppearanceRow[]).filter(
    (a) => a.team_name_normalized === appHomeKey || a.team_name_normalized === appAwayKey
  );
  const lineups = {
    home: buildPredictedLineup(
      importanceRows,
      homeKey,
      injuries.home,
      11,
      7,
      appearanceRows.filter((a) => a.team_name_normalized === appHomeKey)
    ),
    away: buildPredictedLineup(
      importanceRows,
      awayKey,
      injuries.away,
      11,
      7,
      appearanceRows.filter((a) => a.team_name_normalized === appAwayKey)
    ),
  };

  return {
    team_profiles,
    h2h,
    injuries,
    prediction_context,
    odds_summary,
    lineups,
  };
}
