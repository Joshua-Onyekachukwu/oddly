/**
 * Data-quality scoring for predictions.
 *
 * Audit requirement: every prediction must carry an honest assessment of the
 * data it was produced from, and the system must abstain (via confidence_tier
 * caps — never by suppressing rows) when data is insufficient.
 *
 * Two layers:
 *  - `scoreDataQuality`        — pure scorer over pre-fetched signals (unit-testable)
 *  - `collectDataQuality`      — batched PostgREST collector for a set of fixtures
 *  - `applyDataQualityToTier`  — abstention rules mapping (probability tier, verdict)
 *                                → stored confidence_tier
 */

import { normalizeTeamName } from "@/lib/football/team-normalizer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DataQualityVerdict = "high" | "medium" | "low" | "insufficient";

export interface DataQualityComponents {
  history_coverage: number; // 0-1  finished-match history depth for both teams
  injury_coverage: number; // 0-1  injury/availability feature coverage
  odds_coverage: number; // 0-1  odds snapshot volume + freshness
  xg_coverage: number; // 0-1  expected-goals feature coverage
  lineup_coverage: number; // 0-1  confirmed lineup availability
  freshness: number; // 0-1  recency of the freshest inputs
}

export interface DataQualityResult {
  score: number; // 0-1 weighted composite
  components: DataQualityComponents;
  missing: string[]; // machine-readable list of absent/degraded inputs
  verdict: DataQualityVerdict;
}

/** Per-team history signal (finished matches involving the team). */
export interface TeamHistorySignal {
  matchesPlayed: number;
  lastMatchAt: string | null; // ISO kickoff of most recent finished match
}

export interface InjurySignal {
  /** fixture_injury_features row exists for this fixture (both teams). */
  hasFixtureFeatures: boolean;
  /** data_freshness_hours from the features row, if present. */
  freshnessHours: number | null;
  /** confidence_score from the features row, if present. */
  confidence: number | null;
  /** Raw player_availability rows for either team (fallback signal). */
  rawAvailabilityRows: number;
}

export interface OddsSignal {
  snapshotCount: number;
  lastSnapshotAt: string | null;
  distinctBookmakers: number;
}

export interface XgSignal {
  homeMatches: number; // xg_features rows for home team inside window
  awayMatches: number;
  latestMatchDate: string | null;
}

export interface LineupSignal {
  confirmed: boolean; // confirmed lineups published for this fixture
}

export interface DataQualitySignals {
  homeHistory: TeamHistorySignal;
  awayHistory: TeamHistorySignal;
  injury: InjurySignal;
  odds: OddsSignal;
  xg: XgSignal;
  lineup: LineupSignal;
  now: Date;
  kickoffTime: string; // ISO
}

// ---------------------------------------------------------------------------
// Scoring rubric
// ---------------------------------------------------------------------------

/** Component weights — sum to 1.0. */
export const DATA_QUALITY_WEIGHTS: Record<keyof DataQualityComponents, number> = {
  history_coverage: 0.25,
  injury_coverage: 0.2,
  odds_coverage: 0.2,
  xg_coverage: 0.1,
  lineup_coverage: 0.1,
  freshness: 0.15,
};

/** Finished matches (min across both teams) needed for full history credit. */
const HISTORY_SATURATION = 20;
/** Odds snapshots needed for full volume credit. */
const ODDS_SATURATION = 12;
/** xG rows (both teams combined) needed for full credit. */
const XG_SATURATION = 6;
/** Recency horizons (hours) used by the freshness component. */
const FRESHNESS_HORIZON_HOURS = 24 * 30; // 30 days
/** Odds are expected to move up to ~4 days before kickoff. */
const ODDS_FRESHNESS_HORIZON_HOURS = 24 * 4;
/** Injury features older than a week lose most credit. */
const INJURY_STALE_HOURS = 24 * 7;
/** xG older than ~6 weeks is mostly irrelevant. */
const XG_WINDOW_DAYS = 45;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const hoursBetween = (fromIso: string | null, to: Date): number | null => {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (to.getTime() - t) / 3_600_000);
};

function scoreHistory(s: DataQualitySignals): { value: number; missing: string[] } {
  const missing: string[] = [];
  const minPlayed = Math.min(s.homeHistory.matchesPlayed, s.awayHistory.matchesPlayed);
  if (s.homeHistory.matchesPlayed === 0) missing.push("home_history");
  if (s.awayHistory.matchesPlayed === 0) missing.push("away_history");
  return { value: clamp01(minPlayed / HISTORY_SATURATION), missing };
}

function scoreInjury(s: DataQualitySignals): { value: number; missing: string[] } {
  const missing: string[] = [];
  const sig = s.injury;
  if (sig.hasFixtureFeatures) {
    const conf = sig.confidence != null ? clamp01(sig.confidence) : 0.6;
    // Freshness decays linearly to zero at INJURY_STALE_HOURS.
    const ageH = sig.freshnessHours ?? INJURY_STALE_HOURS;
    const freshFactor = clamp01(1 - ageH / INJURY_STALE_HOURS);
    const value = clamp01((0.5 + 0.5 * conf) * (0.4 + 0.6 * freshFactor));
    if (freshFactor < 0.25) missing.push("stale_injury_features");
    return { value, missing };
  }
  if (sig.rawAvailabilityRows > 0) {
    // Raw player_availability rows exist but no computed features yet.
    missing.push("injury_features");
    return { value: 0.3, missing };
  }
  missing.push("injury_data");
  return { value: 0, missing };
}

function scoreOdds(s: DataQualitySignals): { value: number; missing: string[] } {
  const missing: string[] = [];
  const sig = s.odds;
  if (sig.snapshotCount === 0 || !sig.lastSnapshotAt) {
    missing.push("odds_history");
    return { value: 0, missing };
  }
  const volume = clamp01(sig.snapshotCount / ODDS_SATURATION);
  const bookmakerBonus = sig.distinctBookmakers >= 2 ? 1 : 0.8;
  // Age of the latest snapshot relative to kickoff (odds must precede kickoff
  // to be usable; snapshots after kickoff are worthless for pre-match prediction).
  const kickoff = new Date(s.kickoffTime).getTime();
  const lastTs = new Date(sig.lastSnapshotAt).getTime();
  const ageBeforeKickoffH =
    Number.isFinite(kickoff) && Number.isFinite(lastTs)
      ? Math.max(0, (kickoff - lastTs) / 3_600_000)
      : null;
  const freshFactor =
    ageBeforeKickoffH == null
      ? 0
      : clamp01(1 - ageBeforeKickoffH / ODDS_FRESHNESS_HORIZON_HOURS);
  const value = clamp01(volume * bookmakerBonus * (0.4 + 0.6 * freshFactor));
  if (freshFactor < 0.25) missing.push("stale_odds");
  return { value, missing };
}

function scoreXg(s: DataQualitySignals): { value: number; missing: string[] } {
  const missing: string[] = [];
  const total = s.xg.homeMatches + s.xg.awayMatches;
  if (total === 0) {
    missing.push("xg_data");
    return { value: 0, missing };
  }
  const volume = clamp01(total / XG_SATURATION);
  // Recency of the newest xG row relative to kickoff.
  const kickoff = new Date(s.kickoffTime).getTime();
  const latest = s.xg.latestMatchDate ? new Date(s.xg.latestMatchDate).getTime() : NaN;
  const ageDays =
    Number.isFinite(kickoff) && Number.isFinite(latest)
      ? Math.max(0, (kickoff - latest) / 86_400_000)
      : XG_WINDOW_DAYS;
  const freshFactor = clamp01(1 - ageDays / XG_WINDOW_DAYS);
  if (freshFactor < 0.25) missing.push("stale_xg_data");
  return { value: clamp01(volume * (0.4 + 0.6 * freshFactor)), missing };
}

function scoreFreshness(s: DataQualitySignals): { value: number; missing: string[] } {
  // Worst-case staleness across the freshest signal of each available input.
  const agesH: number[] = [];

  const histAge = Math.min(
    hoursBetween(s.homeHistory.lastMatchAt, s.now) ?? Infinity,
    hoursBetween(s.awayHistory.lastMatchAt, s.now) ?? Infinity
  );
  if (Number.isFinite(histAge)) agesH.push(histAge);

  if (s.injury.hasFixtureFeatures && s.injury.freshnessHours != null) {
    agesH.push(s.injury.freshnessHours);
  }

  const oddsAge = hoursBetween(s.odds.lastSnapshotAt, s.now);
  if (oddsAge != null) agesH.push(oddsAge);

  if (agesH.length === 0) return { value: 0, missing: ["stale_data"] };

  // Freshness = freshest input's recency (min age), decayed over 30 days.
  const freshestAgeH = Math.min(...agesH);
  const value = clamp01(1 - freshestAgeH / FRESHNESS_HORIZON_HOURS);
  if (value < 0.25) return { value, missing: ["stale_data"] };
  return { value, missing: [] };
}

/**
 * Pure scorer — all inputs must be pre-fetched (see collectDataQuality).
 */
export function scoreDataQuality(s: DataQualitySignals): DataQualityResult {
  const scorers: Array<() => { value: number; missing: string[] }> = [
    () => scoreHistory(s),
    () => scoreInjury(s),
    () => scoreOdds(s),
    () => scoreXg(s),
    () => ({
      value: s.lineup.confirmed ? 1 : 0,
      missing: s.lineup.confirmed ? [] : ["confirmed_lineups"],
    }),
    () => scoreFreshness(s),
  ];

  const components = {} as DataQualityComponents;
  const missing = new Set<string>();
  let score = 0;
  const keys = Object.keys(DATA_QUALITY_WEIGHTS) as Array<keyof DataQualityComponents>;

  scorers.forEach((fn, i) => {
    const { value, missing: m } = fn();
    const key = keys[i];
    components[key] = Math.round(value * 1000) / 1000;
    for (const item of m) missing.add(item);
    score += DATA_QUALITY_WEIGHTS[key] * value;
  });

  score = Math.round(score * 1000) / 1000;

  const minHistory = Math.min(s.homeHistory.matchesPlayed, s.awayHistory.matchesPlayed);
  let verdict: DataQualityVerdict;
  if (minHistory === 0 || score < 0.25) {
    verdict = "insufficient";
  } else if (score < 0.45) {
    verdict = "low";
  } else if (score < 0.7) {
    verdict = "medium";
  } else {
    verdict = "high";
  }

  return { score, components, missing: [...missing].sort(), verdict };
}

// ---------------------------------------------------------------------------
// Abstention rules
// ---------------------------------------------------------------------------

/**
 * Base confidence tier from model probability — same bands as the
 * add-confidence-tier.sql backfill (ELITE ≥ .70, HIGH ≥ .60, MEDIUM ≥ .50).
 */
export function probabilityTier(modelProbability: number): string {
  if (modelProbability >= 0.7) return "ELITE";
  if (modelProbability >= 0.6) return "HIGH";
  if (modelProbability >= 0.5) return "MEDIUM";
  return "LOW";
}

const TIER_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, ELITE: 3 };

/**
 * Apply data-quality abstention caps to a probability-derived tier.
 * Predictions are ALWAYS recorded — quality is metadata, not a gate.
 *
 *  - verdict 'insufficient' → forced 'LOW' (no usable data at all)
 *  - verdict 'low'          → capped at 'MEDIUM'
 *  - 'medium'/'high'        → unchanged
 */
export function applyDataQualityToTier(baseTier: string, dq: DataQualityResult): string {
  const base = (baseTier || "LOW").toUpperCase();
  if (dq.verdict === "insufficient") return "LOW";
  if (dq.verdict === "low") {
    return TIER_RANK[base] > TIER_RANK.MEDIUM ? "MEDIUM" : base;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Batched collector
// ---------------------------------------------------------------------------

export interface QualityFixtureInput {
  id: string;
  kickoff_time: string;
  league_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_name: string | null;
  away_name: string | null;
}

interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
}

const CHUNK = 25; // PostgREST 1000-row cap safety (matches predict route)
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const daysAgoISO = (days: number, from: Date) =>
  new Date(from.getTime() - days * 86_400_000).toISOString();

/**
 * Collect data-quality signals for a batch of fixtures using a small number
 * of chunked queries (safe for the ~45-fixture cron window).
 */
export async function collectDataQuality(
  fixtures: QualityFixtureInput[],
  supabase: SupabaseLike,
  now: Date = new Date()
): Promise<Map<string, DataQualityResult>> {
  const results = new Map<string, DataQualityResult>();
  if (!fixtures.length) return results;

  const fixtureIds = fixtures.map((f) => f.id);
  const teamIds = [
    ...new Set(
      fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]).filter(Boolean) as string[]
    ),
  ];
  const teamNames = [
    ...new Set(
      fixtures
        .flatMap((f) => [f.home_name, f.away_name])
        .filter(Boolean)
        .map((n) => norm(n))
    ),
  ];

  // --- 1. Finished-match history per team -------------------------------
  // One query: all finished fixtures involving any of our teams, newest first.
  // 1000-row cap is acceptable — history credit saturates at 20 matches/team.
  const historyByTeam = new Map<string, TeamHistorySignal>();
  if (teamIds.length) {
    const { data: histRows, error: histErr } = await supabase
      .from("fixtures")
      .select("home_team_id, away_team_id, kickoff_time")
      .eq("status", "finished")
      .or(
        `home_team_id.in.(${teamIds.join(",")}),away_team_id.in.(${teamIds.join(",")})`
      )
      .order("kickoff_time", { ascending: false })
      .limit(1000);
    if (histErr) {
      console.error("[DATA-QUALITY] history query error:", histErr.message);
    }
    for (const row of histRows || []) {
      for (const tid of [row.home_team_id, row.away_team_id]) {
        if (!tid) continue;
        const cur = historyByTeam.get(tid);
        if (cur) {
          cur.matchesPlayed += 1; // rows are newest-first; first seen = latest
        } else {
          historyByTeam.set(tid, {
            matchesPlayed: 1,
            lastMatchAt: row.kickoff_time ?? null,
          });
        }
      }
    }
  }

  // --- 2. fixture_injury_features (latest snapshot ≤ now per fixture) ---
  const injuryByFixture = new Map<
    string,
    { confidence: number | null; freshnessHours: number | null }
  >();
  for (let i = 0; i < fixtureIds.length; i += CHUNK) {
    const { data: rows, error } = await supabase
      .from("fixture_injury_features")
      .select("fixture_id, confidence_score, data_freshness_hours, snapshot_date")
      .in("fixture_id", fixtureIds.slice(i, i + CHUNK))
      .lte("snapshot_date", now.toISOString())
      .order("snapshot_date", { ascending: false });
    if (error) {
      console.error("[DATA-QUALITY] injury features query error:", error.message);
      continue;
    }
    for (const r of rows || []) {
      if (injuryByFixture.has(r.fixture_id)) continue; // newest first
      injuryByFixture.set(r.fixture_id, {
        confidence: r.confidence_score != null ? Number(r.confidence_score) : null,
        freshnessHours:
          r.data_freshness_hours != null ? Number(r.data_freshness_hours) : null,
      });
    }
  }

  // --- 3. Raw player_availability counts per team (fallback signal) -----
  const availabilityByTeam = new Map<string, number>();
  if (teamNames.length) {
    const { data: paRows, error: paErr } = await supabase
      .from("player_availability")
      .select("team_name")
      .in("team_name", teamNames)
      .in("status", ["injured", "suspended", "doubtful", "out"])
      .limit(1000);
    if (paErr) {
      console.error("[DATA-QUALITY] player_availability query error:", paErr.message);
    }
    for (const r of paRows || []) {
      const key = norm(r.team_name);
      availabilityByTeam.set(key, (availabilityByTeam.get(key) ?? 0) + 1);
    }
  }

  // --- 4. Odds snapshots: count + latest + bookmakers per fixture --------
  const oddsByFixture = new Map<
    string,
    { count: number; last: string | null; bookmakers: Set<string> }
  >();
  for (let i = 0; i < fixtureIds.length; i += 8) {
    const { data: rows, error } = await supabase
      .from("odds_snapshots")
      .select("fixture_id, snapshot_time, bookmaker")
      .in("fixture_id", fixtureIds.slice(i, i + 8))
      .order("snapshot_time", { ascending: false })
      .limit(1000);
    if (error) {
      console.error("[DATA-QUALITY] odds query error:", error.message);
      continue;
    }
    for (const r of rows || []) {
      const cur =
        oddsByFixture.get(r.fixture_id) ??
        { count: 0, last: null, bookmakers: new Set<string>() };
      cur.count += 1;
      if (!cur.last && r.snapshot_time) cur.last = r.snapshot_time;
      if (r.bookmaker) cur.bookmakers.add(r.bookmaker);
      oddsByFixture.set(r.fixture_id, cur);
    }
  }

  // --- 5. xG features: recent rows matched by normalized team name --------
  const xgByTeam = new Map<string, { count: number; latest: string | null }>();
  {
    const { data: xgRows, error: xgErr } = await supabase
      .from("xg_features")
      .select("team_name, match_date")
      .gte("match_date", daysAgoISO(90, now))
      .order("match_date", { ascending: false })
      .limit(1000);
    if (xgErr) {
      console.error("[DATA-QUALITY] xg query error:", xgErr.message);
    }
    for (const r of xgRows || []) {
      const key = normalizeTeamName(String(r.team_name ?? "")) || norm(r.team_name);
      if (!key) continue;
      const cur = xgByTeam.get(key) ?? { count: 0, latest: null };
      cur.count += 1;
      if (!cur.latest && r.match_date) cur.latest = r.match_date;
      xgByTeam.set(key, cur);
    }
  }

  // --- 6. Score each fixture ----------------------------------------------
  for (const f of fixtures) {
    const homeKey = normalizeTeamName(f.home_name ?? "") || norm(f.home_name);
    const awayKey = normalizeTeamName(f.away_name ?? "") || norm(f.away_name);

    const homeHist =
      historyByTeam.get(f.home_team_id ?? "") ?? { matchesPlayed: 0, lastMatchAt: null };
    const awayHist =
      historyByTeam.get(f.away_team_id ?? "") ?? { matchesPlayed: 0, lastMatchAt: null };

    const injuryFeat = injuryByFixture.get(f.id);
    const homeAvail = availabilityByTeam.get(homeKey) ?? 0;
    const awayAvail = availabilityByTeam.get(awayKey) ?? 0;

    const odds = oddsByFixture.get(f.id);
    const homeXg = xgByTeam.get(homeKey);
    const awayXg = xgByTeam.get(awayKey);
    const xgLatest = [homeXg?.latest, awayXg?.latest]
      .filter(Boolean)
      .sort()
      .pop() ?? null;

    // Count xG rows inside each fixture's own 45-day pre-kickoff window.
    const kickoffMs = new Date(f.kickoff_time).getTime();
    const inWindow = (latest: string | null, count: number) => {
      if (!latest || !count) return 0;
      const ageDays = (kickoffMs - new Date(latest).getTime()) / 86_400_000;
      return ageDays >= 0 && ageDays <= XG_WINDOW_DAYS ? count : 0;
    };

    const signals: DataQualitySignals = {
      homeHistory: homeHist,
      awayHistory: awayHist,
      injury: {
        hasFixtureFeatures: !!injuryFeat,
        freshnessHours: injuryFeat?.freshnessHours ?? null,
        confidence: injuryFeat?.confidence ?? null,
        rawAvailabilityRows: homeAvail + awayAvail,
      },
      odds: {
        snapshotCount: odds?.count ?? 0,
        lastSnapshotAt: odds?.last ?? null,
        distinctBookmakers: odds?.bookmakers.size ?? 0,
      },
      xg: {
        homeMatches: inWindow(homeXg?.latest ?? null, homeXg?.count ?? 0),
        awayMatches: inWindow(awayXg?.latest ?? null, awayXg?.count ?? 0),
        latestMatchDate: xgLatest,
      },
      lineup: { confirmed: false }, // no confirmed-lineup source exists yet
      now,
      kickoffTime: f.kickoff_time,
    };

    results.set(f.id, scoreDataQuality(signals));
  }

  return results;
}
