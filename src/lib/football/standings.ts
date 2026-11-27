/**
 * ODDLY Standings computation — pure functions, no DB access.
 *
 * Derives a league table from finished fixtures (3 pts win / 1 pt draw /
 * 0 pts loss, sorted by points → goal difference → goals for).
 *
 * Input rows are expected to be already sorted by kickoff_time ascending so
 * the per-team `form` array reflects the most recent results (last 5 kept).
 */

import { normalizeTeamName } from "./team-normalizer";

export type FormResult = "W" | "D" | "L";

export interface StandingMatchInput {
  /** Stable team identifier when available (teams.id). */
  homeTeamId?: string | null;
  awayTeamId?: string | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  status?: string | null;
}

export interface StandingRow {
  /** teams.id when known, otherwise the normalized team name. */
  teamKey: string;
  teamId: string | null;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** Last 5 results, most recent first. */
  form: FormResult[];
}

export interface StandingsResult {
  rows: StandingRow[];
  /** Number of finished matches that contributed. */
  matchesCounted: number;
  /** Finished matches skipped (missing scores / unknown teams). */
  matchesSkipped: number;
}

/**
 * Minimum number of finished matches (counted once per fixture) before a
 * derived table is considered meaningful. Below this we surface a
 * "limited coverage" note instead of presenting a possibly misleading table.
 */
export const MIN_FINISHED_FOR_STANDINGS = 60;

function isFinished(m: StandingMatchInput): boolean {
  return (m.status ?? "").toLowerCase() === "finished";
}

function teamKey(id: string | null | undefined, name: string | null | undefined): string {
  if (id) return `id:${id}`;
  const n = normalizeTeamName(name || "");
  return n ? `name:${n}` : "";
}

interface MutableRow {
  teamKey: string;
  teamId: string | null;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  form: FormResult[];
}

function ensureRow(map: Map<string, MutableRow>, key: string, id: string | null, name: string): MutableRow {
  let row = map.get(key);
  if (!row) {
    row = {
      teamKey: key,
      teamId: id,
      teamName: name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      form: [],
    };
    map.set(key, row);
  }
  // Prefer a real UUID + nicer display name if we see one later.
  if (!row.teamId && id) row.teamId = id;
  if (row.teamName === "" || row.teamName === name) {
    if (name && name !== row.teamName) row.teamName = name;
  }
  return row;
}

/**
 * Compute standings from finished fixtures. Non-finished rows and rows
 * without numeric scores are skipped and counted in `matchesSkipped`.
 *
 * Pass matches ordered by kickoff ascending for correct `form` ordering.
 */
export function computeStandings(matches: StandingMatchInput[]): StandingsResult {
  const map = new Map<string, MutableRow>();
  let matchesCounted = 0;
  let matchesSkipped = 0;

  for (const m of matches) {
    if (!isFinished(m)) {
      matchesSkipped += 1;
      continue;
    }
    const hs = m.homeScore;
    const as = m.awayScore;
    if (typeof hs !== "number" || typeof as !== "number" || !Number.isFinite(hs) || !Number.isFinite(as)) {
      matchesSkipped += 1;
      continue;
    }

    const hKey = teamKey(m.homeTeamId, m.homeTeamName);
    const aKey = teamKey(m.awayTeamId, m.awayTeamName);
    if (!hKey || !aKey || hKey === aKey) {
      matchesSkipped += 1;
      continue;
    }

    const home = ensureRow(map, hKey, m.homeTeamId ?? null, m.homeTeamName || "Unknown");
    const away = ensureRow(map, aKey, m.awayTeamId ?? null, m.awayTeamName || "Unknown");

    home.played += 1;
    away.played += 1;
    home.goalsFor += hs;
    home.goalsAgainst += as;
    away.goalsFor += as;
    away.goalsAgainst += hs;

    let homeForm: FormResult;
    let awayForm: FormResult;
    if (hs > as) {
      home.won += 1;
      away.lost += 1;
      homeForm = "W";
      awayForm = "L";
    } else if (hs < as) {
      away.won += 1;
      home.lost += 1;
      homeForm = "L";
      awayForm = "W";
    } else {
      home.drawn += 1;
      away.drawn += 1;
      homeForm = "D";
      awayForm = "D";
    }

    // Matches arrive oldest → newest, so unshift keeps most-recent first.
    home.form.unshift(homeForm);
    away.form.unshift(awayForm);
    if (home.form.length > 5) home.form.length = 5;
    if (away.form.length > 5) away.form.length = 5;

    matchesCounted += 1;
  }

  const rows: StandingRow[] = [...map.values()]
    .map((r) => ({
      teamKey: r.teamKey,
      teamId: r.teamId,
      teamName: r.teamName,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalDiff: r.goalsFor - r.goalsAgainst,
      points: r.won * 3 + r.drawn,
      form: r.form,
    }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.teamName.localeCompare(b.teamName);
    });

  return { rows, matchesCounted, matchesSkipped };
}

/**
 * True when the derived table has enough finished-match coverage to be
 * presented as a standings table rather than a partial snapshot.
 */
export function hasStandingsCoverage(result: StandingsResult): boolean {
  return result.rows.length >= 2 && result.matchesCounted >= MIN_FINISHED_FOR_STANDINGS;
}
