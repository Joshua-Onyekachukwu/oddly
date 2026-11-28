/**
 * Shared candidate fetcher for the rollover engine.
 *
 * Extracted from src/app/api/v1/rollover/recommendation/route.ts so the
 * ticket-of-the-day route (src/app/api/v1/ticket-of-the-day/route.ts) can
 * reuse the exact same candidate assembly without duplicating the
 * fixtures → predictions → odds_snapshots → recommendations pipeline.
 *
 * Pipeline (behavior identical to the original inline route code):
 *   1. Fixtures with kickoff_time inside [windowFrom, windowTo]
 *      (status scheduled|live).
 *   2. Latest prediction per (fixture, canonical market, normalized
 *      selection).
 *   3. Latest odds_snapshots per fixture+market+selection within a
 *      12h freshness window — BEST decimal odds across bookmakers.
 *   4. recommendations.bookmaker_odds as fallback when no snapshot odds.
 *   5. Assemble RolloverCandidate[] (only rows with usable probability
 *      AND odds > 1 survive).
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { RolloverCandidate, canonicalMarket } from "./engine";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Odds older than this are ignored (freshness gate). */
export const ODDS_MAX_AGE_HOURS = 12;
/** PostgREST row cap per query. */
const ROW_LIMIT = 1000;

// ─── Market/selection normalization for odds ↔ prediction matching ────

function normKey(s: string): string {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Build the set of odds-map keys that could correspond to a
 * (market, selection) pair from `predictions`. Covers naming drift
 * between The Odds API snapshots and ensemble market keys.
 */
function oddsKeyVariants(market: string, selection: string): string[] {
  const m = canonicalMarket(market);
  const s = normKey(selection);
  const keys = new Set<string>();

  const marketAliases: Record<string, string[]> = {
    "1x2": ["1x2", "h2h"],
    ou: ["ou", "over_under", "totals", "total_goals", "ou_"],
    btts: ["btts", "both_teams_to_score"],
    dc: ["dc", "double_chance"],
    dnb: ["dnb", "draw_no_bet"],
    homegoals: ["homegoals", "home_goals"],
    awaygoals: ["awaygoals", "away_goals"],
  };
  const markets = marketAliases[m] ?? [m];

  // Selection aliases for common odds-feed spellings
  const selAliases: Record<string, string[]> = {
    home: ["home", "1"],
    draw: ["draw", "x"],
    away: ["away", "2"],
    yes: ["yes"],
    no: ["no"],
    "1x": ["1x", "1_x"],
    x2: ["x2", "x_2"],
    "12": ["12", "1_2"],
  };

  for (const mk of markets) {
    for (const sv of selAliases[s] ?? [s]) {
      keys.add(`${mk}|${sv}`);
      // Some feeds store market inside selection or vice versa
      keys.add(`${mk}|${s}`);
    }
    keys.add(`${m}|${s}`);
  }
  return [...keys];
}

// ─── Row shapes (loose — joined relations and numeric columns vary) ────

export interface RolloverFixtureRow {
  id: string;
  kickoff_time: string | null;
  league_id: string | null;
  status: string | null;
  home?: { canonical_name?: string | null } | { canonical_name?: string | null }[] | null;
  away?: { canonical_name?: string | null } | { canonical_name?: string | null }[] | null;
}

export interface RolloverPredictionRow {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  model_probability: number | string | null;
  model_disagreement: number | string | null;
  data_quality_score: number | string | null;
  created_at?: string | null;
  result?: string | null;
}

export interface RolloverCandidateBundle {
  /** Assembled engine candidates (probability + odds > 1 verified). */
  candidates: RolloverCandidate[];
  /** Fixtures inside the window (status scheduled|live). */
  fixtures: RolloverFixtureRow[];
  /** Latest prediction per (fixture, market, selection) seen. */
  latestPreds: RolloverPredictionRow[];
  /** fixtureId → fixture row (for label/kickoff lookups). */
  fixtureById: Map<string, RolloverFixtureRow>;
  /** Candidates that survived the odds-resolution step. */
  candidatesWithOdds: number;
}

/**
 * Fetch and assemble rollover candidates for fixtures whose kickoff_time
 * falls inside [windowFrom, windowTo]. Never throws on empty results —
 * returns empty arrays/maps so callers decide how to report "no data".
 * Query errors are thrown (callers wrap in try/catch → 500).
 */
export async function fetchRolloverCandidates(
  windowFrom: Date,
  windowTo: Date
): Promise<RolloverCandidateBundle> {
  // 1. Upcoming fixtures in window
  const { data: fixturesRaw, error: fixErr } = await supabaseAdmin
    .from("fixtures")
    .select(
      `id, kickoff_time, league_id, status,
       home:teams!fixtures_home_team_id_fkey(canonical_name),
       away:teams!fixtures_away_team_id_fkey(canonical_name)`
    )
    .gte("kickoff_time", windowFrom.toISOString())
    .lte("kickoff_time", windowTo.toISOString())
    .in("status", ["scheduled", "live"])
    .order("kickoff_time", { ascending: true })
    .limit(ROW_LIMIT);

  if (fixErr) {
    console.error("[ROLLOVER] fixture query failed:", fixErr.message);
    throw new Error(`Failed to load fixtures: ${fixErr.message}`);
  }

  const fixtures = (fixturesRaw ?? []) as unknown as RolloverFixtureRow[];
  if (fixtures.length === 0) {
    return {
      candidates: [],
      fixtures: [],
      latestPreds: [],
      fixtureById: new Map(),
      candidatesWithOdds: 0,
    };
  }

  const fixtureIds = fixtures.map((f) => f.id);
  const fixtureById = new Map(fixtures.map((f) => [f.id, f]));

  // 2. Predictions for those fixtures (latest per fixture+market+selection)
  const { data: preds } = await supabaseAdmin
    .from("predictions")
    .select(
      "id, fixture_id, market, selection, model_probability, model_disagreement, data_quality_score, created_at, result"
    )
    .in("fixture_id", fixtureIds)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT * 5);

  // Keep only the newest prediction per normalized (fixture, market, selection)
  const seenPred = new Set<string>();
  const latestPreds: RolloverPredictionRow[] = [];
  for (const p of (preds ?? []) as unknown as RolloverPredictionRow[]) {
    const key = `${p.fixture_id}|${canonicalMarket(p.market)}|${normKey(p.selection)}`;
    if (seenPred.has(key)) continue;
    seenPred.add(key);
    latestPreds.push(p);
  }

  // 3. Odds: latest snapshot per fixture+market+selection within freshness
  //    window; take the BEST (max) decimal odds across bookmakers.
  const oddsCutoff = new Date(Date.now() - ODDS_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data: oddsRows } = await supabaseAdmin
    .from("odds_snapshots")
    .select("fixture_id, market, selection, odds, snapshot_time, bookmaker")
    .in("fixture_id", fixtureIds)
    .gte("snapshot_time", oddsCutoff)
    .order("snapshot_time", { ascending: false })
    .limit(ROW_LIMIT * 5);

  // odds map: key = fixtureId|market|selection(normalized) → best odds.
  // Group all rows per key and take MAX decimal odds across bookmakers
  // (best available price, per plan §3 assumptions).
  const oddsMap = new Map<string, { odds: number; bookmaker: string | null }>();
  const oddsGroups = new Map<string, { odds: number; bookmaker: string | null }[]>();
  for (const o of oddsRows ?? []) {
    const key = `${o.fixture_id}|${canonicalMarket(o.market)}|${normKey(o.selection)}`;
    const arr = oddsGroups.get(key) ?? [];
    arr.push({ odds: Number(o.odds), bookmaker: (o as any).bookmaker ?? null });
    oddsGroups.set(key, arr);
  }
  for (const [key, arr] of oddsGroups) {
    const best = arr.reduce((a, b) => (b.odds > a.odds ? b : a));
    oddsMap.set(key, best);
  }

  // 4. Recommendations fallback: rows already carry matched bookmaker_odds
  const { data: recs } = await supabaseAdmin
    .from("recommendations")
    .select("fixture_id, market, selection, bookmaker_odds, model_probability, created_at")
    .in("fixture_id", fixtureIds)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  const recOdds = new Map<string, number>();
  for (const r of recs ?? []) {
    const key = `${r.fixture_id}|${canonicalMarket(r.market)}|${normKey(r.selection)}`;
    if (!recOdds.has(key)) recOdds.set(key, Number(r.bookmaker_odds));
  }

  // 5. Assemble candidates
  const candidates: RolloverCandidate[] = [];
  let withOdds = 0;

  for (const p of latestPreds) {
    const prob = Number(p.model_probability);
    if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) continue;

    const fixture = fixtureById.get(p.fixture_id);
    if (!fixture) continue;

    // Resolve odds: exact normalized key first, then alias variants
    let odds: number | null = null;
    let bookmaker: string | null = null;
    const directKey = `${p.fixture_id}|${canonicalMarket(p.market)}|${normKey(p.selection)}`;
    const direct = oddsMap.get(directKey);
    if (direct) {
      odds = direct.odds;
      bookmaker = direct.bookmaker;
    } else {
      for (const variant of oddsKeyVariants(p.market, p.selection)) {
        const [mk, sv] = variant.split("|");
        const hit = oddsMap.get(`${p.fixture_id}|${mk}|${sv}`);
        if (hit) { odds = hit.odds; bookmaker = hit.bookmaker; break; }
      }
    }
    if (odds == null) {
      const recOddsVal = recOdds.get(directKey);
      if (recOddsVal && recOddsVal > 1) odds = recOddsVal;
    }
    if (odds == null || !(odds > 1)) continue;
    withOdds++;

    const homeRel = Array.isArray(fixture.home) ? fixture.home[0] : fixture.home;
    const awayRel = Array.isArray(fixture.away) ? fixture.away[0] : fixture.away;
    const home = homeRel?.canonical_name ?? "Home";
    const away = awayRel?.canonical_name ?? "Away";

    candidates.push({
      fixtureId: p.fixture_id,
      fixtureLabel: `${home} vs ${away}`,
      kickoffTime: fixture.kickoff_time ?? undefined,
      market: p.market,
      selection: p.selection,
      modelProbability: prob,
      odds,
      bookmaker,
      modelDisagreement: p.model_disagreement != null ? Number(p.model_disagreement) : null,
      dataQualityScore: p.data_quality_score != null ? Number(p.data_quality_score) : null,
      leagueId: fixture.league_id,
      sourceId: p.id,
    });
  }

  return {
    candidates,
    fixtures,
    latestPreds,
    fixtureById,
    candidatesWithOdds: withOdds,
  };
}
