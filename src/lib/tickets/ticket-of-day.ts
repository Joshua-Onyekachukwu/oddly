/**
 * Ticket of the Day — daily high-confidence multi-leg accumulator.
 *
 * Pure selection logic (no DB, no I/O) on top of the rollover engine
 * (src/lib/rollover/engine.ts). Where the rollover recommendation returns
 * up to `topTickets` ~2.00-band tickets, this module picks THE single
 * best ticket for the day under a stricter, probability-first config and
 * — critically — supports HONEST ABSTENTION: when nothing clears the
 * combined-probability bar, the result says so plainly instead of
 * forcing a ticket.
 *
 * Selection rule:
 *   1. buildRolloverTickets with TICKET_OF_DAY_CONFIG
 *   2. rank surviving tickets by adjustedProbability desc, then adjustedEv desc
 *   3. qualified → return the top ticket
 *      abstained → re-run with the probability floor relaxed to 0 purely
 *                  to identify the closest near-miss (highest-probability
 *                  in-band combination that failed the floor), then
 *                  report the abstention reason.
 */

import {
  DEFAULT_ROLLOVER_CONFIG,
  RolloverCandidate,
  RolloverEngineConfig,
  RolloverEngineResult,
  RolloverTicket,
  buildRolloverTickets,
} from "../rollover/engine";

/**
 * Ticket-of-day thresholds — based on DEFAULT_ROLLOVER_CONFIG but tuned
 * for a single high-confidence daily accumulator:
 *   - 2–4 legs (a real accumulator, not a single pick)
 *   - wider odds band 1.80–2.40 around the 2.00 target so multi-leg
 *     tickets can actually qualify
 *   - the abstention bar: combined (correlation-adjusted) probability
 *     must be >= 0.70 — roughly "7-in-10 the ticket wins"
 *   - per-leg probability >= 0.60, per-leg EV >= -0.02 (hair-trigger
 *     negative allowed per leg since the TICKET is probability-gated;
 *     EV is still reported honestly)
 *   - same-fixture legs excluded, max 2 legs per league, correlation
 *     discounting kept on
 */
export const TICKET_OF_DAY_CONFIG: RolloverEngineConfig = {
  ...DEFAULT_ROLLOVER_CONFIG,
  targetCombinedOdds: 2.0,
  minCombinedOdds: 1.8,
  maxCombinedOdds: 2.4,
  minLegs: 2,
  maxLegs: 4,
  minLegProbability: 0.6,
  minLegEv: -0.02,
  minCombinedProbability: 0.78,
  topTickets: 10,
  excludeSameFixture: true,
  maxLegsPerLeague: 2,
  correlationDiscountEnabled: true,
};

/** Which gate the closest near-miss combination failed. */
export type DailyTicketMissGate =
  | "minCombinedProbability"
  | "no_combinations_in_band"
  | "no_qualified_candidates"
  | "no_candidates";

/** Description of the best near-miss when the day abstains. */
export interface DailyTicketClosestMiss {
  legCount: number;
  combinedOdds: number;
  /** Correlation-adjusted joint probability of the near-miss ticket. */
  adjustedProbability: number;
  /** Raw independence product for transparency. */
  combinedProbability: number;
  gateFailed: DailyTicketMissGate;
  /** One-line human summary, e.g. "3-leg @1.95 reached 64.2% — below the 70% bar". */
  summary: string;
}

/** Scan stats surfaced to API/UI for transparency. */
export interface DailyTicketStats {
  combinationsEvaluated: number;
  qualifiedCount: number;
  engineReason: RolloverEngineResult["reason"];
}

export type DailyTicketSelection =
  | {
      status: "qualified";
      ticket: RolloverTicket;
      closestMiss: DailyTicketClosestMiss | null;
      stats: DailyTicketStats;
    }
  | {
      status: "abstained";
      /** Plain-language reason the day produced no ticket. */
      reason: string;
      closestMiss: DailyTicketClosestMiss | null;
      stats: DailyTicketStats;
    };

function statsOf(result: RolloverEngineResult): DailyTicketStats {
  return {
    combinationsEvaluated: result.combinationsEvaluated,
    qualifiedCount: result.qualifiedCount,
    engineReason: result.reason,
  };
}

/**
 * Find the closest near-miss: the highest-adjusted-probability in-band
 * combination that exists once the combined-probability floor is lifted.
 * Returns null when not even the relaxed engine produced an in-band combo
 * (the blocker is then odds formation / leg qualification, not the bar).
 */
function findClosestMiss(
  candidates: RolloverCandidate[],
  config: RolloverEngineConfig,
  primaryReason: RolloverEngineResult["reason"]
): DailyTicketClosestMiss | null {
  const gateFailed: DailyTicketMissGate =
    primaryReason === "no_qualified_candidates"
      ? "no_qualified_candidates"
      : primaryReason === "no_candidates"
        ? "no_candidates"
        : "no_combinations_in_band";

  // Lift ONLY the probability floor — every other gate (per-leg
  // probability, per-leg EV, odds band, same-fixture/league rules,
  // correlation discount) stays identical, so the near-miss is a ticket
  // that genuinely reached the odds band but missed the confidence bar.
  const relaxed = buildRolloverTickets(candidates, {
    ...config,
    minCombinedProbability: 0,
  });
  if (relaxed.tickets.length === 0) return null;

  const best = [...relaxed.tickets].sort(
    (a, b) =>
      b.adjustedProbability - a.adjustedProbability ||
      b.adjustedEv - a.adjustedEv
  )[0];

  const failedProbFloor = best.adjustedProbability < config.minCombinedProbability;
  const gate: DailyTicketMissGate = failedProbFloor
    ? "minCombinedProbability"
    : gateFailed;

  return {
    legCount: best.legCount,
    combinedOdds: best.combinedOdds,
    adjustedProbability: best.adjustedProbability,
    combinedProbability: best.combinedProbability,
    gateFailed: gate,
    summary:
      `${best.legCount}-leg @${best.combinedOdds.toFixed(2)} reached ` +
      `${(best.adjustedProbability * 100).toFixed(1)}% combined probability` +
      (failedProbFloor
        ? ` — below the ${(config.minCombinedProbability * 100).toFixed(0)}% bar`
        : " — did not clear the odds band"),
  };
}

/**
 * Select THE daily ticket of the day.
 *
 * @param candidates  RolloverCandidate[] from fetchRolloverCandidates
 * @param config      Optional partial overrides merged onto
 *                    TICKET_OF_DAY_CONFIG (used by tests).
 */
export function selectDailyTicket(
  candidates: RolloverCandidate[],
  config?: Partial<RolloverEngineConfig>
): DailyTicketSelection {
  const merged: RolloverEngineConfig = { ...TICKET_OF_DAY_CONFIG, ...config };
  const result = buildRolloverTickets(candidates, merged);

  if (result.tickets.length > 0) {
    // Single best ticket: highest correlation-adjusted probability first
    // (the confidence bar), then highest adjusted EV as tiebreak.
    const best = [...result.tickets].sort(
      (a, b) =>
        b.adjustedProbability - a.adjustedProbability ||
        b.adjustedEv - a.adjustedEv
    )[0];
    return {
      status: "qualified",
      ticket: best,
      closestMiss: null,
      stats: statsOf(result),
    };
  }

  return {
    status: "abstained",
    reason: result.message,
    closestMiss: findClosestMiss(candidates, merged, result.reason),
    stats: statsOf(result),
  };
}
