/**
 * ODDLY Player Importance Engine
 *
 * Computes a 0-1 importance score per (team, player) from available data
 * signals, replacing the manual 1-10 guesses previously stored in
 * player_injury_data.player_importance.
 *
 * Data tiers (best → worst):
 *   stats   — performance stats from data/player-stats.json
 *             (goals, assists, minutes, appearances, rating)
 *   history — absence records from data/injuries-suspensions.json
 *             (matches missed is a proxy for being a regular starter)
 *   neutral — nothing known; returns 0.5. Never fabricates.
 *
 * Scores are also exposed on the legacy 1-10 scale
 * (importance10 = round(score01 * 10, 1)) because consumers such as
 * ensemble.ts / feature-store-loader.js compute avgImp/5 and flag
 * is_key_player at >= 7.
 */

import { normalizeTeamName } from "../football/team-normalizer";

// ─── Types ────────────────────────────────────────────────────────────────

export interface PlayerStatRow {
  player_name?: string | null;
  team_name?: string | null;
  player_id?: number | null;
  team_id_api?: number | null;
  position?: string | null;
  goals?: number | null;
  assists?: number | null;
  appearances?: number | null;
  minutes?: number | null;
  rating?: number | null;
}

export interface AbsenceRecord {
  player_name?: string | null;
  team_name?: string | null;
  player_id?: number | null;
  team_id_api?: number | null;
  status?: string | null;
  fixture_date?: string | null;
}

export type Confidence = "stats" | "history" | "neutral";

export interface ImportanceResult {
  /** 0-1 importance score */
  score01: number;
  /** legacy 1-10 scale, round(score01*10, 1) */
  score10: number;
  confidence: Confidence;
  /** human-readable explanation of which signals fired */
  method: string;
  signals: {
    goals?: number;
    assists?: number;
    minutes?: number;
    appearances?: number;
    rating?: number | null;
    matchesMissed?: number;
    playerId?: number | null;
    position?: string | null;
  };
}

export interface PlayerIndex {
  /** player_id -> stat row */
  statsById: Map<number, PlayerStatRow>;
  /** `${normTeam}|${nameKey}` -> stat row */
  statsByName: Map<string, PlayerStatRow>;
  /** `${normTeam}|${nameKey}` -> { playerId, matchesMissed } */
  historyByName: Map<string, { playerId: number | null; matchesMissed: number; teamName: string }>;
  /** player_id -> { matchesMissed, teamName } */
  historyById: Map<number, { matchesMissed: number; teamName: string }>;
}

// ─── Name / team normalization ────────────────────────────────────────────

/** lowercase, strip accents + punctuation, collapse whitespace */
export function normalizeName(name: string | null | undefined): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Letters NFD doesn't decompose (Ø, Æ, ß, Đ, Ŋ, Ħ...) — map to ASCII.
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/đ/g, "d")
    .replace(/ð/g, "d")
    .replace(/þ/g, "th")
    .replace(/ł/g, "l")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fuzzy person key: last token + first initial.
 * Handles abbreviated stats names ("W. Saliba", "A. Isak") vs full injury
 * feed names ("William Saliba", "Alexander Isak") and multi-part surnames
 * ("Micky van de Ven" -> last token "ven", initial "m" on both sides).
 */
export function personKey(name: string | null | undefined): string {
  const parts = normalizeName(name).split(" ").filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  const first = (parts[0] || "")[0] || "";
  return `${last}|${first}`;
}

function normTeam(team: string | null | undefined): string {
  return normalizeTeamName(normalizeName(team));
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// ─── Index construction ───────────────────────────────────────────────────

/**
 * Build lookup indexes from raw player-stats and injury-history rows.
 * Pure function — safe to call with synthetic data in tests.
 */
export function buildPlayerIndex(
  statRows: PlayerStatRow[] = [],
  absenceRows: AbsenceRecord[] = []
): PlayerIndex {
  const statsById = new Map<number, PlayerStatRow>();
  const statsByName = new Map<string, PlayerStatRow>();

  for (const row of statRows) {
    const pid = row.player_id != null ? Number(row.player_id) : null;
    if (pid != null && Number.isFinite(pid)) statsById.set(pid, row);
    const key = `${normTeam(row.team_name)}|${personKey(row.player_name)}`;
    if (key !== "|" && !statsByName.has(key)) statsByName.set(key, row);
  }

  // Count absence records per player. Each row ≈ one match missed.
  const missedById = new Map<number, number>();
  const missedByNameKey = new Map<string, { playerId: number | null; matchesMissed: number; teamName: string }>();

  for (const row of absenceRows) {
    const pid = row.player_id != null ? Number(row.player_id) : null;
    if (pid != null && Number.isFinite(pid)) {
      missedById.set(pid, (missedById.get(pid) || 0) + 1);
    }
    const key = `${normTeam(row.team_name)}|${personKey(row.player_name)}`;
    if (key === "|") continue;
    const cur = missedByNameKey.get(key);
    if (cur) {
      cur.matchesMissed += 1;
      if (cur.playerId == null && pid != null) cur.playerId = pid;
    } else {
      missedByNameKey.set(key, {
        playerId: pid != null && Number.isFinite(pid) ? pid : null,
        matchesMissed: 1,
        teamName: row.team_name || "",
      });
    }
  }

  const historyById = new Map<number, { matchesMissed: number; teamName: string }>();
  // Recover team name per player_id from absence rows.
  const teamById = new Map<number, string>();
  for (const row of absenceRows) {
    const pid = row.player_id != null ? Number(row.player_id) : null;
    if (pid != null && Number.isFinite(pid) && row.team_name && !teamById.has(pid)) {
      teamById.set(pid, row.team_name);
    }
  }
  for (const [pid, missed] of missedById) {
    historyById.set(pid, { matchesMissed: missed, teamName: teamById.get(pid) || "" });
  }

  return { statsById, statsByName, historyByName: missedByNameKey, historyById };
}

// ─── Scoring ──────────────────────────────────────────────────────────────

/**
 * Performance score from a stats row. Absolute calibration so a player is
 * scored the same regardless of how many teammates have stats:
 *   - goal+assist output per 90 (0.9 G+A/90 ≈ elite)          40%
 *   - minutes played (3200 ≈ full season)                    30%
 *   - average rating ((r-6.2)/1.6)                           15%
 *   - appearances (34 ≈ full season)                         15%
 */
export function performanceScore(row: PlayerStatRow): { score: number; signals: ImportanceResult["signals"] } {
  const goals = num(row.goals);
  const assists = num(row.assists);
  const minutes = num(row.minutes);
  const appearances = num(row.appearances);
  const rating = row.rating != null ? Number(row.rating) : null;

  const contrib90 = minutes > 0 ? ((goals + assists) * 90) / minutes : 0;
  const contribScore = clamp01(contrib90 / 0.9);
  const minScore = clamp01(minutes / 3200);
  const ratingScore = rating != null ? clamp01((rating - 6.2) / 1.6) : 0.4;
  const appScore = clamp01(appearances / 34);

  const score =
    0.4 * contribScore + 0.3 * minScore + 0.15 * ratingScore + 0.15 * appScore;

  return {
    score,
    signals: {
      goals,
      assists,
      minutes,
      appearances,
      rating,
      playerId: row.player_id != null ? Number(row.player_id) : null,
      position: row.position || null,
    },
  };
}

/**
 * Regularity boost from absence history. Absence records are positive
 * evidence only: a player who misses many matches is very likely a regular
 * starter (starters' absences get reported; fringe players rarely appear in
 * injury feeds). They are NOT evidence of low importance — an ironman
 * starter with zero recorded absences is still a starter — so the score is
 * floored at the neutral 0.5 and only ever raises confidence above it.
 * Range: [0.5, 0.75] — a weak signal that must not dominate.
 */
export function regularityScore(matchesMissed: number): number {
  if (matchesMissed < 3) return 0.5; // too little evidence to move off neutral
  return 0.5 + 0.25 * clamp01(matchesMissed / 30);
}

const NEUTRAL = 0.5;

/**
 * Compute importance for one (team, player) pair.
 * Never throws on missing data — falls back to neutral 0.5.
 */
export function computeImportance(
  teamName: string | null | undefined,
  playerName: string | null | undefined,
  index: PlayerIndex
): ImportanceResult {
  const nteam = normTeam(teamName);
  const pkey = personKey(playerName);
  const nameLookup = `${nteam}|${pkey}`;

  // 1) Resolve identity via absence history (bridges abbreviated names and
  //    supplies player_id for the stats join).
  let hist = index.historyByName.get(nameLookup);
  let statRow: PlayerStatRow | undefined;
  let playerId: number | null = null;

  if (hist) {
    playerId = hist.playerId;
  }

  // 2) Stats lookup: by player_id first, then by name+team.
  if (playerId != null && index.statsById.has(playerId)) {
    statRow = index.statsById.get(playerId);
  }
  if (!statRow) {
    statRow = index.statsByName.get(nameLookup);
  }
  // If history gave a player_id but name lookup failed, try stats by that id.
  if (!statRow && playerId != null && index.statsById.has(playerId)) {
    statRow = index.statsById.get(playerId);
  }

  if (statRow) {
    const { score: perf, signals } = performanceScore(statRow);
    if (playerId == null) {
      playerId = statRow.player_id != null ? Number(statRow.player_id) : null;
    }
    // Stats already capture regularity via minutes/appearances — absence
    // history adds nothing here, so the score is pure performance.
    const score01 = clamp01(perf);
    return {
      score01,
      score10: Math.round(score01 * 100) / 10,
      confidence: "stats",
      method: "performance stats",
      signals: { ...signals, playerId },
    };
  }

  // 3) History-only: regularity proxy.
  if (hist && hist.matchesMissed > 0) {
    const score01 = regularityScore(hist.matchesMissed);
    return {
      score01,
      score10: Math.round(score01 * 100) / 10,
      confidence: "history",
      method: `absence regularity (${hist.matchesMissed} missed matches)`,
      signals: { matchesMissed: hist.matchesMissed, playerId },
    };
  }

  // 4) Nothing known — neutral, never fabricate.
  return {
    score01: NEUTRAL,
    score10: 5,
    confidence: "neutral",
    method: "no data — neutral",
    signals: {},
  };
}

/** Batch convenience: returns Map keyed by `${normTeam}|${personKey}`. */
export function computeImportanceBatch(
  rows: Array<{ team_name?: string | null; player_name?: string | null }>,
  index: PlayerIndex
): Map<string, ImportanceResult> {
  const out = new Map<string, ImportanceResult>();
  for (const r of rows) {
    const key = `${normTeam(r.team_name)}|${personKey(r.player_name)}`;
    if (key === "|") continue;
    if (!out.has(key)) {
      out.set(key, computeImportance(r.team_name, r.player_name, index));
    }
  }
  return out;
}
