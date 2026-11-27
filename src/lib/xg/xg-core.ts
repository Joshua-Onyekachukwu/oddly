/**
 * ODDLY xG Core — pure functions, no I/O, no imports.
 *
 * Shared by:
 *   - scripts/ingest-xg.js        (Understat JSON → xg_features rows)
 *   - src/lib/xg/team-xg.ts       (xg_features rows → rolling team profiles)
 *   - src/lib/xg/xg-core.test.ts  (jest)
 *
 * Keeping this dependency-free lets plain-node scripts transpile it with
 * `typescript.transpileModule` exactly like team-normalizer.ts.
 */

// ── Types ────────────────────────────────────────────────────────────────

/** Raw match record shape from data/understat-xg.json `matches[]`. */
export interface UnderstatXGMatch {
  external_id?: string | number;
  home?: string;
  away?: string;
  home_xg?: number | null;
  away_xg?: number | null;
  home_scored?: number | null;
  away_scored?: number | null;
  date?: string; // "YYYY-MM-DD HH:mm:ss" (UTC)
  is_result?: boolean;
  league?: string; // code, e.g. "EPL"
  league_name?: string; // e.g. "Premier League"
  season?: number | string;
}

/** One team's line in a match — maps 1:1 to an xg_features row. */
export interface TeamXGRow {
  teamName: string; // raw provider name
  teamKey: string; // normalizeTeamName(teamName)
  opponent: string;
  opponentKey: string;
  isHome: boolean;
  xgFor: number;
  xgAgainst: number;
  xgDiff: number;
  matchDate: string; // ISO date "YYYY-MM-DD"
  league: string | null;
  season: string | null;
  externalId: string | null;
}

/** Per-team match history entry used for rolling computations. */
export interface TeamMatchXG {
  date: string; // ISO date or timestamp, compared lexically/numerically
  isHome: boolean;
  xgFor: number;
  xgAgainst: number;
}

export interface RollingXG {
  sampleSize: number; // matches used (after window + asOf filtering)
  windowSize: number;
  xgForAvg: number | null;
  xgAgainstAvg: number | null;
  xgDiff: number | null;
  homeXgForAvg: number | null;
  awayXgForAvg: number | null;
  homeXgAgainstAvg: number | null;
  awayXgAgainstAvg: number | null;
  last5XgForAvg: number | null;
  last5XgAgainstAvg: number | null;
  dataThrough: string | null; // newest match date included
}

// ── Mapping: provider match → per-team rows ─────────────────────────────

function toDateOnly(dateStr: string | undefined | null): string | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const m = dateStr.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert one provider match record into up to two TeamXGRow entries
 * (one per team). Returns [] when xG or a team name is missing — callers
 * should log/count these as skipped rather than forcing bad rows in.
 *
 * `normalize` is injected so this module stays import-free; pass
 * normalizeTeamName from src/lib/football/team-normalizer.
 */
export function understatMatchToTeamRows(
  match: UnderstatXGMatch,
  normalize: (name: string) => string
): TeamXGRow[] {
  const homeXg = toNum(match.home_xg);
  const awayXg = toNum(match.away_xg);
  const matchDate = toDateOnly(match.date);
  if (homeXg === null || awayXg === null || !matchDate) return [];
  if (!match.home || !match.away) return [];

  const homeKey = normalize(match.home);
  const awayKey = normalize(match.away);
  const externalId =
    match.external_id !== undefined && match.external_id !== null
      ? String(match.external_id)
      : null;
  const league = match.league_name || match.league || null;
  const season = match.season !== undefined && match.season !== null ? String(match.season) : null;

  const mk = (
    teamName: string,
    teamKey: string,
    opponent: string,
    opponentKey: string,
    isHome: boolean,
    xgFor: number,
    xgAgainst: number
  ): TeamXGRow => ({
    teamName,
    teamKey,
    opponent,
    opponentKey,
    isHome,
    xgFor,
    xgAgainst,
    xgDiff: xgFor - xgAgainst,
    matchDate,
    league,
    season,
    externalId,
  });

  return [
    mk(match.home, homeKey, match.away, awayKey, true, homeXg, awayXg),
    mk(match.away, awayKey, match.home, homeKey, false, awayXg, homeXg),
  ];
}

/**
 * Convert an array of provider matches into flat TeamXGRow[] and report
 * how many matches were skipped (missing xG/date/teams).
 */
export function understatMatchesToRows(
  matches: UnderstatXGMatch[],
  normalize: (name: string) => string
): { rows: TeamXGRow[]; skipped: number } {
  const rows: TeamXGRow[] = [];
  let skipped = 0;
  for (const m of matches) {
    const r = understatMatchToTeamRows(m, normalize);
    if (r.length === 0) skipped++;
    else rows.push(...r);
  }
  return { rows, skipped };
}

// ── Rolling computation ──────────────────────────────────────────────────

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

/**
 * Compute rolling xG profile from a team's match history.
 *
 * - Rows are sorted by date ascending; only matches with date <= asOf
 *   are considered (pass asOf to avoid look-ahead bias).
 * - Only the most recent `window` matches are used.
 * - Home/away splits are computed over the windowed sample.
 * - Returns null when there is no usable history (caller treats as
 *   "no xG data" → features stay neutral).
 */
export function computeRollingXG(
  matches: TeamMatchXG[],
  opts: { window?: number; asOf?: string | null } = {}
): RollingXG | null {
  const window = opts.window && opts.window > 0 ? Math.floor(opts.window) : 10;
  const asOf = opts.asOf || null;

  const usable = matches
    .filter(
      (m) =>
        typeof m.xgFor === "number" &&
        typeof m.xgAgainst === "number" &&
        Number.isFinite(m.xgFor) &&
        Number.isFinite(m.xgAgainst) &&
        (!asOf || String(m.date) <= String(asOf))
    )
    .slice()
    .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));

  if (usable.length === 0) return null;

  const windowed = usable.slice(-window);
  const last5 = usable.slice(-5);
  const home = windowed.filter((m) => m.isHome);
  const away = windowed.filter((m) => !m.isHome);

  const xgForAvg = avg(windowed.map((m) => m.xgFor));
  const xgAgainstAvg = avg(windowed.map((m) => m.xgAgainst));

  return {
    sampleSize: windowed.length,
    windowSize: window,
    xgForAvg,
    xgAgainstAvg,
    xgDiff: xgForAvg !== null && xgAgainstAvg !== null ? xgForAvg - xgAgainstAvg : null,
    homeXgForAvg: avg(home.map((m) => m.xgFor)),
    awayXgForAvg: avg(away.map((m) => m.xgFor)),
    homeXgAgainstAvg: avg(home.map((m) => m.xgAgainst)),
    awayXgAgainstAvg: avg(away.map((m) => m.xgAgainst)),
    last5XgForAvg: avg(last5.map((m) => m.xgFor)),
    last5XgAgainstAvg: avg(last5.map((m) => m.xgAgainst)),
    dataThrough: String(windowed[windowed.length - 1].date),
  };
}

/**
 * Group flat TeamXGRow[] into per-team match histories keyed by teamKey.
 * Output feeds computeRollingXG per team.
 */
export function groupTeamMatches(rows: TeamXGRow[]): Map<string, TeamMatchXG[]> {
  const map = new Map<string, TeamMatchXG[]>();
  for (const r of rows) {
    let list = map.get(r.teamKey);
    if (!list) {
      list = [];
      map.set(r.teamKey, list);
    }
    list.push({ date: r.matchDate, isHome: r.isHome, xgFor: r.xgFor, xgAgainst: r.xgAgainst });
  }
  return map;
}
