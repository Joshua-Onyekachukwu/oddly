/**
 * ODDLY 2-Odds Daily Rollover Engine
 *
 * Pure functions — no DB, no I/O. Given candidate selections (model
 * probability + bookmaker odds for upcoming fixtures), this module:
 *
 *   1. QUALIFIES each selection against explicit thresholds
 *      (probability, EV, model disagreement, data quality, market allow-list).
 *   2. BUILDS combinations of 1..maxLegs selections whose combined decimal
 *      odds land inside the target band (~2.00).
 *   3. Scores tickets by correlation-adjusted probability × edge and
 *      returns the best.
 *
 * Honesty rule: if nothing qualifies we return an empty result with a
 * machine-readable reason. We NEVER force a ~2.00 ticket.
 *
 * Correlation rule: by default two legs may never come from the same fixture
 * (same-match legs are not independent — e.g. "over 2.5" and "BTTS yes"
 * share outcomes). When same-fixture legs ARE allowed (excludeSameFixture:
 * false) or legs share a league, the combined probability is shaded
 * toward the Fréchet lower bound by a configurable correlation weight
 * (see adjustedJointProbability) — a conservative stand-in until
 * empirical joint frequencies exist.
 *
 * Decision rule (spec §4): every run ends in an explicit daily decision —
 * "qualified" (tickets exist), "wait" (promising candidates blocked by
 * missing/stale data or odds that a rescan may fix), or "skip" (nothing
 * meets the minimums; skipped days are not failures).
 *
 * See docs/ODDLY-ROLLOVER-ENGINE-SPEC.md and docs/ROLLOVER-STRATEGY-PLAN.md.
 */

// ─── Types ─────────────────────────────────────────────────────────────

/** Raw candidate selection fed into the engine. */
export interface RolloverCandidate {
  /** Stable fixture identifier (uuid or any string). */
  fixtureId: string;
  /** Human label, e.g. "Arsenal vs Chelsea". */
  fixtureLabel?: string;
  kickoffTime?: string;
  /** Market key as stored in `predictions.market` (any case). */
  market: string;
  /** Selection key as stored in `predictions.selection` (any case). */
  selection: string;
  /** Calibrated model probability, 0..1. */
  modelProbability: number;
  /** Best available decimal odds (> 1). */
  odds: number;
  bookmaker?: string | null;
  /** Max disagreement between sub-models, 0..1 (lower = better agreement). */
  modelDisagreement?: number | null;
  /** Data quality score, typically 0..100 (higher = better). */
  dataQualityScore?: number | null;
  /** Source row id (prediction_id / recommendation_id) for traceability. */
  sourceId?: string | null;
  /** League id — used only for the optional soft-correlation cap. */
  leagueId?: string | null;
}

/** A candidate that passed qualification, with derived metrics. */
export interface QualifiedLeg {
  fixtureId: string;
  fixtureLabel?: string;
  kickoffTime?: string;
  market: string;
  selection: string;
  modelProbability: number;
  odds: number;
  bookmaker?: string | null;
  sourceId?: string | null;
  leagueId?: string | null;
  /** 1 / odds — bookmaker implied probability (includes margin). */
  impliedProbability: number;
  /** p - 1/o — probability edge over the market. */
  edge: number;
  /** p*o - 1 — expected value per unit stake. */
  expectedValue: number;
}

export interface RejectedCandidate {
  candidate: RolloverCandidate;
  reasons: string[];
}

export interface RolloverTicket {
  /** Deterministic id derived from leg fixture/market/selection keys. */
  id: string;
  legs: QualifiedLeg[];
  legCount: number;
  combinedOdds: number;
  /**
   * Π pᵢ — combined model probability under the INDEPENDENCE assumption.
   * Kept for transparency/back-compat; NOT used for gating, EV or score.
   */
  combinedProbability: number;
  /**
   * Correlation-aware joint probability (spec §2): the independence
   * product blended toward the Fréchet lower bound by the correlated
   * pair weights. THIS is the value used for the
   * minCombinedProbability floor, combined EV and ranking score.
   */
  adjustedProbability: number;
  /**
   * Fractional haircut applied to the independence product:
   * adjustedProbability / combinedProbability (1 = no correlated pairs).
   */
  correlationFactor: number;
  /** Π pᵢ × Π oᵢ - 1 — EV under the independence assumption (legacy field). */
  combinedEv: number;
  /** adjustedProbability × combinedOdds - 1 — correlation-aware EV. */
  adjustedEv: number;
  /**
   * Ranking score = adjustedEv × adjustedProbability.
   * Rewards both edge and confidence; a high-EV low-probability ticket
   * ranks below a slightly lower-EV high-probability ticket. Correlated
   * tickets score strictly lower than identical independent ones.
   */
  score: number;
  /** Human/machine-readable explanation of why this ticket qualified. */
  rationale: string[];
}

/**
 * Daily decision (spec §4):
 *   "qualified" — at least one ticket was built
 *   "wait"      — candidates exist but the run is blocked by missing or
 *                 stale data / odds that a rescan (new fixtures, odds
 *                 updates, lineup confirmations) may resolve
 *   "skip"      — nothing meets the minimums. Skipped days are NOT
 *                 failures; the honest default when in doubt.
 */
export type RolloverDecision = "qualified" | "wait" | "skip";

export interface RolloverEngineResult {
  tickets: RolloverTicket[];
  /** Candidates that survived qualification. */
  qualifiedCount: number;
  /** Total combinations evaluated during the search. */
  combinationsEvaluated: number;
  /**
   * "ok"                      — tickets found
   * "no_candidates"           — input was empty
   * "no_qualified_candidates" — every candidate failed a threshold
   * "no_combinations_in_band" — qualified legs exist but no combination
   *                            landed inside the odds band (or all were
   *                            below minCombinedProbability)
   */
  reason: "ok" | "no_candidates" | "no_qualified_candidates" | "no_combinations_in_band";
  /** Explicit daily decision derived from reason + rejection signals. */
  decision: RolloverDecision;
  message: string;
  /** Per-candidate rejection reasons, for UI/debug transparency. */
  rejected: RejectedCandidate[];
}

// ─── Configuration ─────────────────────────────────────────────────────

export interface RolloverEngineConfig {
  /** Target combined decimal odds (the product's ~2.00 ticket). */
  targetCombinedOdds: number;
  /** Acceptable combined-odds band [min, max]. */
  minCombinedOdds: number;
  maxCombinedOdds: number;
  /** Combination size bounds. */
  minLegs: number;
  maxLegs: number;
  /** Global floor for per-leg model probability. */
  minLegProbability: number;
  /** Per-leg minimum expected value (p*o - 1). 0.03 = +3%. */
  minLegEv: number;
  /** Combined-probability floor: ticket must imply >= this win rate. */
  minCombinedProbability: number;
  /** Markets allowed into the engine (canonical lowercase keys). null = all. */
  allowedMarkets: string[] | null;
  /** Markets always excluded (canonical lowercase keys). */
  excludedMarkets: string[];
  /**
   * Per-market minimum model probability overrides.
   * Higher bars for thin/volatile markets; lower for stable ones.
   */
  minProbabilityByMarket: Record<string, number>;
  /** Reject legs whose sub-model disagreement exceeds this (0..1). */
  maxModelDisagreement: number | null;
  /** Reject legs whose data quality score is below this (0..100). */
  minDataQualityScore: number | null;
  /** Hard cap on evaluated combinations (safety valve). */
  maxCombinationsEvaluated: number;
  /** How many ranked tickets to return. */
  topTickets: number;
  /**
   * Same-fixture legs are never allowed (perfect correlation on shared
   * outcomes) unless excludeSameFixture is false. Same-league same-day
   * legs are a SOFT correlation — capped by maxLegsPerLeague when set
   * (null = uncapped) and always discounted by the pairwise factors
   * below.
   */
  excludeSameFixture: boolean;
  maxLegsPerLeague: number | null;
  /**
   * Correlation-aware probability discount (spec §2). When true, the
   * combined probability used for gating / EV / score is blended toward
   * the Fréchet lower bound by sameFixtureCorrelationWeight /
   * sameLeagueCorrelationWeight. The raw product is still reported as
   * `combinedProbability`.
   */
  correlationDiscountEnabled: boolean;
  /**
   * Correlation weight contributed by each leg pair sharing a fixtureId.
   * Only reachable when excludeSameFixture is false. Range 0..1; 1 means
   * a same-fixture pair is priced at the full worst-case (Fréchet lower
   * bound) joint probability. Default 1.0 — same-match legs are the most
   * correlated thing the engine can see.
   */
  sameFixtureCorrelationWeight: number;
  /**
   * Correlation weight contributed by each leg pair sharing a leagueId
   * (different fixtures). Milder than same-fixture. Range 0..1.
   * Default 0.4.
   */
  sameLeagueCorrelationWeight: number;
}

/**
 * Default thresholds — initial values per ROLLOVER-STRATEGY-PLAN §2.
 * "Thresholds are fitted on walk-forward history, never guessed" — these
 * are starting points to be tuned by worker/rollover-backtest.js.
 */
export const DEFAULT_ROLLOVER_CONFIG: RolloverEngineConfig = {
  targetCombinedOdds: 2.0,
  minCombinedOdds: 1.9,
  maxCombinedOdds: 2.1,
  minLegs: 1,
  maxLegs: 4,
  minLegProbability: 0.5,
  minLegEv: 0.03,
  minCombinedProbability: 0.45,
  // Prefer high-probability, liquid markets. `null` would allow everything.
  allowedMarkets: ["1x2", "ou", "btts", "dc", "dnb", "homegoals", "awaygoals"],
  excludedMarkets: [],
  minProbabilityByMarket: {
    "1x2": 0.5,        // plan: ≥0.50 for 1X2 incl. longshots
    ou: 0.55,          // plan: ≥0.55 for O/U
    btts: 0.5,
    dc: 0.55,
    dnb: 0.55,
    homegoals: 0.55,
    awaygoals: 0.55,
  },
  // Off by default: model_disagreement is often NULL in predictions.
  // Enable once backtest shows the gate helps (worker/rollover-backtest.js).
  maxModelDisagreement: null,
  minDataQualityScore: null, // quality score scale varies; off by default
  maxCombinationsEvaluated: 2_000_000,
  topTickets: 5,
  excludeSameFixture: true,
  maxLegsPerLeague: null,
  correlationDiscountEnabled: true,
  sameFixtureCorrelationWeight: 1.0,
  sameLeagueCorrelationWeight: 0.4,
};

// ─── Helpers ───────────────────────────────────────────────────────────

/** Canonical market key: lowercase, common aliases unified. */
export function canonicalMarket(market: string): string {
  const m = (market || "").toLowerCase().trim();
  const aliases: Record<string, string> = {
    "1x2": "1x2", h2h: "1x2", "1x2_": "1x2",
    ou: "ou", over_under: "ou", totals: "ou", total_goals: "ou",
    btts: "btts", both_teams_to_score: "btts",
    dc: "dc", double_chance: "dc",
    dnb: "dnb", draw_no_bet: "dnb",
    homegoals: "homegoals", home_goals: "homegoals",
    awaygoals: "awaygoals", away_goals: "awaygoals",
  };
  return aliases[m] ?? m;
}

/** Decimal odds → implied probability. */
export function impliedProbability(odds: number): number {
  return odds > 1 ? 1 / odds : 0;
}

/** Model probability → fair decimal odds. */
export function probabilityToOdds(probability: number): number {
  return probability > 0 ? 1 / probability : Infinity;
}

/** Expected value of a unit stake: p*o - 1. */
export function expectedValue(probability: number, odds: number): number {
  return probability * odds - 1;
}

/** Probability edge over the market: p - 1/o. */
export function probabilityEdge(probability: number, odds: number): number {
  return probability - impliedProbability(odds);
}

// ─── Correlation-aware combined probability (spec §2) ──────────────────

/**
 * Correlation weight between two legs (0 = treated as independent).
 *   same fixtureId              → sameFixtureCorrelationWeight
 *   same leagueId, diff fixture → sameLeagueCorrelationWeight
 *   otherwise                   → 0
 * Legs with missing leagueId are treated as independent — we never
 * guess a league we don't know.
 */
export function legPairCorrelationWeight(
  a: Pick<QualifiedLeg, "fixtureId" | "leagueId">,
  b: Pick<QualifiedLeg, "fixtureId" | "leagueId">,
  config: RolloverEngineConfig = DEFAULT_ROLLOVER_CONFIG
): number {
  if (a.fixtureId === b.fixtureId) return config.sameFixtureCorrelationWeight;
  if (a.leagueId != null && a.leagueId === b.leagueId) {
    return config.sameLeagueCorrelationWeight;
  }
  return 0;
}

/**
 * Correlation-aware joint probability of a combination's legs winning.
 *
 * Method (documented assumption, pending empirical joint frequencies —
 * spec §11 step 1):
 *
 *   pInd   = Π pᵢ                              (independence product)
 *   lower  = max(0, Σ pᵢ − (n−1))              (Fréchet lower bound —
 *             the worst-case joint probability consistent with the
 *             marginals, i.e. maximally adverse dependence)
 *   λ      = min(1, Σ_pairs weight(pair) / C(n,2))
 *   adjusted = pInd − λ × (pInd − lower)
 *
 * The result is a convex blend between the independence estimate and
 * the worst-case joint probability. λ measures what fraction of
 * "possible dependence" the ticket's leg pairs actually carry: a fully
 * same-fixture ticket approaches the lower bound, a fully cross-league
 * ticket stays at independence. This is deliberately CONSERVATIVE —
 * without joint outcome data we cannot estimate the sign or magnitude
 * of dependence, so unknown correlation is treated as a risk discount
 * on the win probability (which lowers EV and can push a ticket below
 * the probability floor). Correlated tickets therefore always score
 * LOWER than identical independent ones. When
 * worker/rollover-backtest.js accumulates settled joint frequencies
 * this should be replaced by a Gaussian-copula / empirical estimate.
 *
 * The result is clamped to [0, min(pInd, min pᵢ)]: never above the
 * independence product and never above the least likely leg.
 */
export function adjustedJointProbability(
  legs: Pick<QualifiedLeg, "modelProbability" | "fixtureId" | "leagueId">[],
  config: RolloverEngineConfig = DEFAULT_ROLLOVER_CONFIG
): number {
  const pIndependence = legs.reduce((acc, l) => acc * l.modelProbability, 1);
  if (!config.correlationDiscountEnabled || legs.length < 2) {
    return pIndependence;
  }

  const n = legs.length;
  const totalPairs = (n * (n - 1)) / 2;
  let weightMass = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      weightMass += legPairCorrelationWeight(legs[i], legs[j], config);
    }
  }
  const lambda = Math.min(1, weightMass / totalPairs);
  if (lambda <= 0) return pIndependence;

  const sumP = legs.reduce((acc, l) => acc + l.modelProbability, 0);
  const lowerBound = Math.max(0, sumP - (n - 1));

  const raw = pIndependence - lambda * (pIndependence - lowerBound);
  const upperBound = Math.min(pIndependence, ...legs.map((l) => l.modelProbability));
  return Math.min(Math.max(raw, 0), upperBound);
}

// ─── Daily decision (spec §4) ──────────────────────────────────────────

/**
 * Rejection reason codes that indicate missing/unverifiable DATA rather
 * than a genuine quality failure — a rescan (new fixtures, odds updates,
 * lineup confirmations) may resolve them, so they map to WAIT.
 */
function isMissingDataReason(reason: string): boolean {
  const code = reason.split(":")[0];
  return (
    code.endsWith("_missing") ||
    code === "invalid_odds" ||
    code === "invalid_probability" ||
    code === "missing_fixture_id"
  );
}

/**
 * Derive the explicit daily decision (QUALIFIED / WAIT / SKIP).
 *
 *   tickets exist                          → "qualified"
 *   no candidates supplied                 → "skip"  (nothing evaluated)
 *   all candidates rejected on merit       → "skip"  (evaluated; nothing
 *                                                  meets minimums)
 *   rejections include missing-data gates  → "wait"  (promising but
 *                                                  unverifiable today)
 *   qualified legs exist but no ~2.00 combo→ "wait"  (qualified selections
 *                                                  exist; the blocker is
 *                                                  odds-band/prob-floor —
 *                                                  rescan triggers apply)
 */
export function deriveRolloverDecision(
  result: Pick<RolloverEngineResult, "reason" | "qualifiedCount" | "tickets" | "rejected">
): RolloverDecision {
  if (result.tickets.length > 0) return "qualified";
  if (result.reason === "no_candidates") return "skip";
  if (result.reason === "no_qualified_candidates") {
    const hasMissingData = result.rejected.some((r) =>
      r.reasons.some(isMissingDataReason)
    );
    return hasMissingData ? "wait" : "skip";
  }
  // no_combinations_in_band: qualified legs exist — the day is blocked on
  // price formation / probability floor, not on absent candidates.
  return result.qualifiedCount > 0 ? "wait" : "skip";
}

function round(v: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ─── Stage 1+2: Qualification ──────────────────────────────────────────

/**
 * Qualify a single candidate. Returns null when it passes, otherwise a
 * list of human-readable rejection reasons (empty input is never thrown).
 */
export function qualifyCandidate(
  cand: RolloverCandidate,
  config: RolloverEngineConfig = DEFAULT_ROLLOVER_CONFIG
): string[] {
  const reasons: string[] = [];

  // Basic sanity
  if (!cand.fixtureId) reasons.push("missing_fixture_id");
  if (!Number.isFinite(cand.modelProbability) || cand.modelProbability <= 0 || cand.modelProbability >= 1) {
    reasons.push("invalid_probability");
  }
  if (!Number.isFinite(cand.odds) || cand.odds <= 1) {
    reasons.push("invalid_odds");
  }
  if (reasons.length > 0) return reasons; // can't evaluate further

  const market = canonicalMarket(cand.market);
  const p = cand.modelProbability;
  const o = cand.odds;

  // Market allow/exclude lists
  if (config.excludedMarkets.map(canonicalMarket).includes(market)) {
    reasons.push(`market_excluded:${market}`);
  }
  if (config.allowedMarkets && !config.allowedMarkets.map(canonicalMarket).includes(market)) {
    reasons.push(`market_not_allowed:${market}`);
  }

  // Probability floor: global + per-market override (whichever is higher)
  const minP = Math.max(
    config.minLegProbability,
    config.minProbabilityByMarket[market] ?? 0
  );
  if (p < minP) reasons.push(`probability_below_min:${p.toFixed(3)}<${minP}`);

  // EV floor
  const ev = expectedValue(p, o);
  if (ev < config.minLegEv) reasons.push(`ev_below_min:${ev.toFixed(4)}<${config.minLegEv}`);

  // Optional quality gates
  if (config.maxModelDisagreement != null) {
    if (cand.modelDisagreement == null) {
      reasons.push("model_disagreement_missing");
  } else if (cand.modelDisagreement > config.maxModelDisagreement) {
      reasons.push(`model_disagreement_too_high:${cand.modelDisagreement}>${config.maxModelDisagreement}`);
    }
  }
  if (config.minDataQualityScore != null) {
    if (cand.dataQualityScore == null) {
      reasons.push("data_quality_missing");
    } else if (cand.dataQualityScore < config.minDataQualityScore) {
      reasons.push(`data_quality_below_min:${cand.dataQualityScore}<${config.minDataQualityScore}`);
    }
  }

  return reasons;
}

/**
 * Run qualification over a candidate pool.
 * Returns qualified legs (with derived metrics, sorted by EV desc for
 * deterministic combination search) plus the rejected list for audit.
 */
export function qualifyCandidates(
  candidates: RolloverCandidate[],
  config: RolloverEngineConfig = DEFAULT_ROLLOVER_CONFIG
): { qualified: QualifiedLeg[]; rejected: RejectedCandidate[] } {
  const qualified: QualifiedLeg[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const cand of candidates) {
    const reasons = qualifyCandidate(cand, config);
    if (reasons.length > 0) {
      rejected.push({ candidate: cand, reasons });
      continue;
    }
    qualified.push({
      fixtureId: cand.fixtureId,
      fixtureLabel: cand.fixtureLabel,
      kickoffTime: cand.kickoffTime,
      market: canonicalMarket(cand.market),
      selection: (cand.selection || "").toLowerCase(),
      modelProbability: cand.modelProbability,
      odds: cand.odds,
      bookmaker: cand.bookmaker ?? null,
      sourceId: cand.sourceId ?? null,
      leagueId: cand.leagueId ?? null,
      impliedProbability: impliedProbability(cand.odds),
      edge: probabilityEdge(cand.modelProbability, cand.odds),
      expectedValue: expectedValue(cand.modelProbability, cand.odds),
    });
  }

  // Deterministic order: highest EV first (search + output stability)
  qualified.sort((a, b) => b.expectedValue - a.expectedValue || b.modelProbability - a.modelProbability);
  return { qualified, rejected };
}

// ─── Stage 3: Combination builder ──────────────────────────────────────

interface ComboAccum {
  legs: QualifiedLeg[];
  combinedOdds: number;
  combinedProbability: number;
  fixtureIds: Set<string>;
  leagueIds: Map<string, number>;
}

function ticketId(legs: QualifiedLeg[]): string {
  return legs
    .map((l) => `${l.fixtureId}:${l.market}:${l.selection}`)
    .sort()
    .join("|");
}

function buildTicket(legs: QualifiedLeg[], config: RolloverEngineConfig): RolloverTicket {
  const combinedOdds = legs.reduce((acc, l) => acc * l.odds, 1);
  const combinedProbability = legs.reduce((acc, l) => acc * l.modelProbability, 1);
  const adjustedProbability = adjustedJointProbability(legs, config);
  const correlationFactor =
    combinedProbability > 0 ? adjustedProbability / combinedProbability : 1;
  const combinedEv = combinedProbability * combinedOdds - 1;
  const adjustedEv = adjustedProbability * combinedOdds - 1;
  const score = adjustedEv * adjustedProbability;

  const rationale: string[] = [];
  for (const l of legs) {
    rationale.push(
      `${l.fixtureLabel ?? l.fixtureId} ${l.market} ${l.selection}: ` +
      `p=${(l.modelProbability * 100).toFixed(1)}% @ ${l.odds.toFixed(2)} ` +
      `(EV ${(l.expectedValue * 100).toFixed(1)}%)`
    );
  }
  rationale.push(
    `Combined: ${legs.length} legs, odds ${combinedOdds.toFixed(2)}, ` +
    `prob ${(adjustedProbability * 100).toFixed(1)}%` +
    (correlationFactor < 0.999
      ? ` (correlation-adjusted from ${(combinedProbability * 100).toFixed(1)}%)`
      : "") +
    `, EV ${(adjustedEv * 100).toFixed(1)}%`
  );

  return {
    id: ticketId(legs),
    legs: legs.map((l) => ({ ...l })),
    legCount: legs.length,
    combinedOdds: round(combinedOdds, 4),
    combinedProbability: round(combinedProbability, 6),
    adjustedProbability: round(adjustedProbability, 6),
    correlationFactor: round(correlationFactor, 6),
    combinedEv: round(combinedEv, 6),
    adjustedEv: round(adjustedEv, 6),
    score: round(score, 8),
    rationale,
  };
}

/**
 * Build the day's ~2.00-odds tickets.
 *
 * Search strategy: depth-first enumeration over index-ordered subsets of
 * the qualified pool (each set visited once, no permutations). Pruning:
 * once accumulated combined odds exceed maxCombinedOdds we stop extending
 * that branch — every leg has odds > 1 so odds only grow.
 *
 * Honest outcomes:
 *   - no candidates              → reason "no_candidates"
 *   - all candidates rejected    → reason "no_qualified_candidates"
 *   - qualified but nothing fits → reason "no_combinations_in_band"
 */
export function buildRolloverTickets(
  candidates: RolloverCandidate[],
  config: RolloverEngineConfig = DEFAULT_ROLLOVER_CONFIG
): RolloverEngineResult {
  if (!candidates || candidates.length === 0) {
    return {
      tickets: [], qualifiedCount: 0, combinationsEvaluated: 0,
      reason: "no_candidates",
      decision: "skip",
      message: "No candidate selections supplied — nothing to build a ticket from.",
      rejected: [],
    };
  }

  const { qualified, rejected } = qualifyCandidates(candidates, config);
  if (qualified.length === 0) {
    const decision = deriveRolloverDecision({
      reason: "no_qualified_candidates",
      qualifiedCount: 0,
      tickets: [],
      rejected,
    });
    return {
      tickets: [], qualifiedCount: 0, combinationsEvaluated: 0,
      reason: "no_qualified_candidates",
      decision,
      message: `All ${candidates.length} candidates failed qualification — ` +
        (decision === "wait"
          ? "missing or unverifiable data; re-scan when lineups/odds update."
          : "no ticket today."),
      rejected,
    };
  }

  const tickets: RolloverTicket[] = [];
  let inBand = 0;
  let belowProbFloor = 0;
  let evaluated = 0;
  let aborted = false;

  const n = qualified.length;
  const accum: ComboAccum = {
    legs: [],
    combinedOdds: 1,
    combinedProbability: 1,
    fixtureIds: new Set(),
    leagueIds: new Map(),
  };

  function dfs(start: number) {
    if (aborted) return;
    if (evaluated >= config.maxCombinationsEvaluated) { aborted = true; return; }

    // Record current combination if it meets size bounds
    if (accum.legs.length >= config.minLegs) {
      evaluated++;
      if (
        accum.combinedOdds >= config.minCombinedOdds &&
        accum.combinedOdds <= config.maxCombinedOdds
      ) {
        inBand++;
        // Gate on the CORRELATION-ADJUSTED probability (spec §2) — the
        // independence product alone is not honest for correlated legs.
        if (adjustedJointProbability(accum.legs, config) >= config.minCombinedProbability) {
          tickets.push(buildTicket(accum.legs, config));
        } else {
          belowProbFloor++;
        }
      }
    }

    if (accum.legs.length >= config.maxLegs) return;

    for (let i = start; i < n; i++) {
      const leg = qualified[i];

      // Same-fixture exclusion (hard correlation)
      if (config.excludeSameFixture && accum.fixtureIds.has(leg.fixtureId)) continue;

      // League soft-correlation cap
      const leagueKey = leg.leagueId ?? undefined;
      if (
        config.maxLegsPerLeague != null &&
        leagueKey &&
        (accum.leagueIds.get(leagueKey) ?? 0) >= config.maxLegsPerLeague
      ) {
        continue;
      }

      const nextOdds = accum.combinedOdds * leg.odds;
      // Prune: odds only increase, so this branch can never come back into band
      if (nextOdds > config.maxCombinedOdds) continue;

      // Also prune hopeless probability? A leg's p is fixed; combined prob
      // only shrinks — if already below floor at max size it stays below, but
      // smaller combos are already recorded, so no extra prune needed.

      accum.legs.push(leg);
      accum.combinedOdds = nextOdds;
      accum.combinedProbability *= leg.modelProbability;
      accum.fixtureIds.add(leg.fixtureId);
      if (leagueKey) accum.leagueIds.set(leagueKey, (accum.leagueIds.get(leagueKey) ?? 0) + 1);

      dfs(i + 1);

      accum.legs.pop();
      accum.combinedOdds /= leg.odds;
      accum.combinedProbability /= leg.modelProbability;
      accum.fixtureIds.delete(leg.fixtureId);
      if (leagueKey) {
        const c = (accum.leagueIds.get(leagueKey) ?? 1) - 1;
        if (c <= 0) accum.leagueIds.delete(leagueKey); else accum.leagueIds.set(leagueKey, c);
      }

      if (aborted) return;
    }
  }

  dfs(0);

  // Rank: score desc, then higher combined probability, then fewer legs
  tickets.sort(
    (a, b) =>
      b.score - a.score ||
      b.combinedProbability - a.combinedProbability ||
      a.legCount - b.legCount
  );

  const top = tickets.slice(0, config.topTickets);

  let reason: RolloverEngineResult["reason"];
  let message: string;
  if (top.length > 0) {
    reason = "ok";
    message = `Found ${tickets.length} qualifying combination(s) in the ` +
      `${config.minCombinedOdds}–${config.maxCombinedOdds} odds band; returning top ${top.length}.`;
  } else if (inBand === 0) {
    reason = "no_combinations_in_band";
    message =
      `No combination of the ${qualified.length} qualified selections lands ` +
      `inside the ${config.minCombinedOdds}–${config.maxCombinedOdds} odds band. ` +
      `Honest result: no ticket today.`;
  } else {
    reason = "no_combinations_in_band";
    message =
      `${inBand} combination(s) hit the odds band but all had correlation-` +
      `adjusted probability below the ${config.minCombinedProbability} floor ` +
      `(${belowProbFloor} rejected). Honest result: no ticket today.`;
  }

  const partial: Pick<
    RolloverEngineResult,
    "reason" | "qualifiedCount" | "tickets" | "rejected"
  > = { reason, qualifiedCount: qualified.length, tickets: top, rejected };

  return {
    tickets: top,
    qualifiedCount: qualified.length,
    combinationsEvaluated: evaluated,
    reason,
    decision: deriveRolloverDecision(partial),
    message,
    rejected,
  };
}

/**
 * Convenience wrapper: qualify + build in one call.
 * Alias kept explicit so callers read clearly at API boundaries.
 */
export function generateRolloverRecommendation(
  candidates: RolloverCandidate[],
  config?: Partial<RolloverEngineConfig>
): RolloverEngineResult {
  return buildRolloverTickets(candidates, { ...DEFAULT_ROLLOVER_CONFIG, ...config });
}
