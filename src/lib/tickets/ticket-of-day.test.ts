import {
  TICKET_OF_DAY_CONFIG,
  selectDailyTicket,
} from "./ticket-of-day";
import { RolloverCandidate } from "../rollover/engine";

// ─── Helpers ───────────────────────────────────────────────────────────

function cand(over: Partial<RolloverCandidate>): RolloverCandidate {
  return {
    fixtureId: "f1",
    fixtureLabel: "Team A vs Team B",
    market: "1x2",
    selection: "home",
    modelProbability: 0.85,
    odds: 1.5,
    leagueId: "league-1",
    ...over,
  };
}

// ─── Config ────────────────────────────────────────────────────────────

describe("TICKET_OF_DAY_CONFIG", () => {
  test("is stricter than the default rollover config", () => {
    expect(TICKET_OF_DAY_CONFIG.minLegs).toBe(2);
    expect(TICKET_OF_DAY_CONFIG.maxLegs).toBe(4);
    expect(TICKET_OF_DAY_CONFIG.minCombinedProbability).toBe(0.78);
    expect(TICKET_OF_DAY_CONFIG.minCombinedOdds).toBe(1.8);
    expect(TICKET_OF_DAY_CONFIG.maxCombinedOdds).toBe(2.4);
    expect(TICKET_OF_DAY_CONFIG.excludeSameFixture).toBe(true);
    expect(TICKET_OF_DAY_CONFIG.maxLegsPerLeague).toBe(2);
    expect(TICKET_OF_DAY_CONFIG.correlationDiscountEnabled).toBe(true);
  });
});

// ─── Qualified selection ───────────────────────────────────────────────

describe("selectDailyTicket — qualified", () => {
  test("returns a multi-leg ticket when legs clear the bars", () => {
    // 3 legs, distinct leagues: odds 1.28*1.30*1.27 ≈ 2.11 (in 1.8–2.4 band),
    // raw prob ≈ .94*.93*.94 = .821 ≥ .78
    const candidates = [
      cand({ fixtureId: "f1", leagueId: "L1", modelProbability: 0.94, odds: 1.28 }),
      cand({ fixtureId: "f2", leagueId: "L2", market: "ou", selection: "over_2.5", modelProbability: 0.93, odds: 1.3 }),
      cand({ fixtureId: "f3", leagueId: "L3", market: "btts", selection: "yes", modelProbability: 0.94, odds: 1.27 }),
    ];

    const result = selectDailyTicket(candidates);

    expect(result.status).toBe("qualified");
    if (result.status !== "qualified") return;
    expect(result.ticket.legCount).toBe(3);
    expect(result.ticket.combinedOdds).toBeGreaterThanOrEqual(1.8);
    expect(result.ticket.combinedOdds).toBeLessThanOrEqual(2.4);
    expect(result.ticket.adjustedProbability).toBeGreaterThanOrEqual(0.78);
    expect(result.stats.combinationsEvaluated).toBeGreaterThan(0);
  });

  test("picks the highest adjustedProbability ticket, not the highest EV", () => {
    // Four qualifying combos exist; the best by adjusted prob is A+D
    // (p .95*.90 = .855 vs B+D .837 and A+B+C .80).
    const candidates = [
      cand({ fixtureId: "A", leagueId: "L1", modelProbability: 0.95, odds: 1.3 }),
      cand({ fixtureId: "B", leagueId: "L2", modelProbability: 0.93, odds: 1.3 }),
      cand({ fixtureId: "C", leagueId: "L3", modelProbability: 0.9, odds: 1.35 }),
      cand({ fixtureId: "D", leagueId: "L4", modelProbability: 0.9, odds: 1.4 }),
    ];

    const result = selectDailyTicket(candidates);

    expect(result.status).toBe("qualified");
    if (result.status !== "qualified") return;
    const fixtureIds = result.ticket.legs.map((l) => l.fixtureId).sort();
    expect(fixtureIds).toEqual(["A", "D"]);
    expect(result.ticket.adjustedProbability).toBeGreaterThanOrEqual(0.78);
  });

  test("adjustedProbability is below the independence product for same-league legs", () => {
    // Same-league pair: raw .92*.92 = .8464; Fréchet-blended adjusted < raw.
    const candidates = [
      cand({ fixtureId: "f1", leagueId: "same-league", modelProbability: 0.92, odds: 1.5 }),
      cand({ fixtureId: "f2", leagueId: "same-league", modelProbability: 0.92, odds: 1.5 }),
    ];

    const result = selectDailyTicket(candidates);

    expect(result.status).toBe("qualified");
    if (result.status !== "qualified") return;
    expect(result.ticket.combinedOdds).toBeCloseTo(2.25, 3);
    expect(result.ticket.adjustedProbability).toBeLessThan(result.ticket.combinedProbability);
    expect(result.ticket.adjustedProbability).toBeGreaterThanOrEqual(0.78);
  });
});

// ─── Abstention ────────────────────────────────────────────────────────

describe("selectDailyTicket — abstention", () => {
  test("abstains when the best in-band combo misses the probability bar", () => {
    // Pair odds 1.5*1.5 = 2.25 (in band) but prob .75*.75 = .5625 < .70.
    const candidates = [
      cand({ fixtureId: "f1", leagueId: "L1", modelProbability: 0.75, odds: 1.5 }),
      cand({ fixtureId: "f2", leagueId: "L2", modelProbability: 0.75, odds: 1.5 }),
    ];

    const result = selectDailyTicket(candidates);

    expect(result.status).toBe("abstained");
    if (result.status !== "abstained") return;
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.closestMiss).not.toBeNull();
    expect(result.closestMiss!.legCount).toBe(2);
    expect(result.closestMiss!.combinedOdds).toBeCloseTo(2.25, 3);
    expect(result.closestMiss!.gateFailed).toBe("minCombinedProbability");
    expect(result.closestMiss!.summary).toContain("78%");
  });

  test("abstains honestly on empty input", () => {
    const result = selectDailyTicket([]);
    expect(result.status).toBe("abstained");
    if (result.status !== "abstained") return;
    expect(result.reason).toContain("No candidate");
    expect(result.closestMiss).toBeNull();
  });

  test("respects maxLegsPerLeague — same-league triple cannot qualify", () => {
    // Three same-league legs: the only in-band combo is the 3-leg
    // (1.3^3 = 2.197, prob .729) but maxLegsPerLeague = 2 blocks it;
    // pairs (1.69) are below the odds band.
    const candidates = [
      cand({ fixtureId: "f1", leagueId: "same", modelProbability: 0.9, odds: 1.3 }),
      cand({ fixtureId: "f2", leagueId: "same", modelProbability: 0.9, odds: 1.3 }),
      cand({ fixtureId: "f3", leagueId: "same", modelProbability: 0.9, odds: 1.3 }),
    ];

    const result = selectDailyTicket(candidates);

    expect(result.status).toBe("abstained");
    // Even the relaxed closest-miss run respects the league cap → null.
    if (result.status === "abstained") {
      expect(result.closestMiss).toBeNull();
    }
  });

  test("same-fixture legs are never combined", () => {
    // Two markets on ONE fixture can't form a ticket (excludeSameFixture).
    const candidates = [
      cand({ fixtureId: "f1", leagueId: "L1", modelProbability: 0.9, odds: 1.5 }),
      cand({ fixtureId: "f1", leagueId: "L1", market: "ou", selection: "over_2.5", modelProbability: 0.9, odds: 1.5 }),
      cand({ fixtureId: "f2", leagueId: "L2", modelProbability: 0.75, odds: 1.5 }),
    ];

    const result = selectDailyTicket(candidates);

    // Only cross-fixture combos allowed: f1(1x2)+f2 pair prob .675 < .70
    // and ou+f2 likewise; no 3-leg (same fixture). → abstain.
    expect(result.status).toBe("abstained");
  });
});
