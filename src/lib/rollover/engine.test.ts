import {
  DEFAULT_ROLLOVER_CONFIG,
  RolloverCandidate,
  RolloverEngineConfig,
  buildRolloverTickets,
  canonicalMarket,
  expectedValue,
  impliedProbability,
  probabilityEdge,
  probabilityToOdds,
  qualifyCandidate,
  qualifyCandidates,
} from "./engine";

// ─── Helpers ───────────────────────────────────────────────────────────

function cand(over: Partial<RolloverCandidate>): RolloverCandidate {
  return {
    fixtureId: "f1",
    market: "1x2",
    selection: "home",
    modelProbability: 0.6,
    odds: 1.8,
    ...over,
  };
}

// ─── Probability ↔ odds conversion ─────────────────────────────────────

describe("probability ↔ odds conversion", () => {
  test("impliedProbability is 1/o", () => {
    expect(impliedProbability(2.0)).toBeCloseTo(0.5, 10);
    expect(impliedProbability(1.5)).toBeCloseTo(1 / 1.5, 10);
    expect(impliedProbability(1)).toBe(0);
  });

  test("probabilityToOdds is 1/p", () => {
    expect(probabilityToOdds(0.5)).toBeCloseTo(2.0, 10);
    expect(probabilityToOdds(0.6)).toBeCloseTo(1 / 0.6, 10);
    expect(probabilityToOdds(0)).toBe(Infinity);
  });

  test("round-trips: p = 1/o ⇒ fair odds = o", () => {
    const o = 2.0;
    const p = impliedProbability(o);
    expect(probabilityToOdds(p)).toBeCloseTo(o, 10);
  });
});

// ─── EV / edge ─────────────────────────────────────────────────────────

describe("EV and edge math", () => {
  test("expectedValue = p*o - 1", () => {
    // p=0.6, o=1.8 → 1.08 - 1 = +0.08
    expect(expectedValue(0.6, 1.8)).toBeCloseTo(0.08, 10);
    // p=0.5, o=2.0 → 0
    expect(expectedValue(0.5, 2.0)).toBeCloseTo(0, 10);
    // negative EV
    expect(expectedValue(0.4, 2.0)).toBeCloseTo(-0.2, 10);
  });

  test("probabilityEdge = p - 1/o", () => {
    expect(probabilityEdge(0.6, 1.8)).toBeCloseTo(0.6 - 1 / 1.8, 10);
  });
});

// ─── canonicalMarket ───────────────────────────────────────────────────

describe("canonicalMarket", () => {
  test("normalizes case and aliases", () => {
    expect(canonicalMarket("1X2")).toBe("1x2");
    expect(canonicalMarket("H2H")).toBe("1x2");
    expect(canonicalMarket("OU")).toBe("ou");
    expect(canonicalMarket("Over_Under")).toBe("ou");
    expect(canonicalMarket("BTTS")).toBe("btts");
    expect(canonicalMarket("DC")).toBe("dc");
    expect(canonicalMarket("DNB")).toBe("dnb");
  });
});

// ─── Qualification ─────────────────────────────────────────────────────

describe("qualifyCandidate", () => {
  test("passes a strong candidate", () => {
    const reasons = qualifyCandidate(cand({}), DEFAULT_ROLLOVER_CONFIG);
    expect(reasons).toEqual([]);
  });

  test("rejects probability below per-market minimum", () => {
    // OU market requires p >= 0.55 by default
    const c = cand({ market: "ou", selection: "under_2.5", modelProbability: 0.52, odds: 2.0 });
    expect(c.modelProbability * c.odds - 1).toBeGreaterThan(0.03); // passes EV
    const reasons = qualifyCandidate(c, DEFAULT_ROLLOVER_CONFIG);
    expect(reasons.some((r) => r.startsWith("probability_below_min"))).toBe(true);
  });

  test("rejects negative / thin EV", () => {
    // p=0.55, o=1.8 → EV = -0.01 < 0.03
    const c = cand({ modelProbability: 0.55, odds: 1.8 });
    const reasons = qualifyCandidate(c, DEFAULT_ROLLOVER_CONFIG);
    expect(reasons.some((r) => r.startsWith("ev_below_min"))).toBe(true);
  });

  test("rejects disallowed market", () => {
    const c = cand({ market: "correct_score", selection: "2-1", modelProbability: 0.9, odds: 1.5 });
    const reasons = qualifyCandidate(c, DEFAULT_ROLLOVER_CONFIG);
    expect(reasons.some((r) => r.startsWith("market_not_allowed"))).toBe(true);
  });

  test("rejects invalid inputs without throwing", () => {
    expect(qualifyCandidate(cand({ odds: 1.0 }), DEFAULT_ROLLOVER_CONFIG)).toContain("invalid_odds");
    expect(qualifyCandidate(cand({ modelProbability: 0 }), DEFAULT_ROLLOVER_CONFIG)).toContain("invalid_probability");
    expect(qualifyCandidate(cand({ fixtureId: "" }), DEFAULT_ROLLOVER_CONFIG)).toContain("missing_fixture_id");
  });

  test("model disagreement gate", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      maxModelDisagreement: 0.2,
    };
    expect(
      qualifyCandidate(cand({ modelDisagreement: 0.1 }), cfg)
    ).toEqual([]);
    expect(
      qualifyCandidate(cand({ modelDisagreement: 0.5 }), cfg).some((r) => r.startsWith("model_disagreement"))
    ).toBe(true);
    expect(
      qualifyCandidate(cand({ modelDisagreement: null }), cfg).some((r) => r === "model_disagreement_missing")
    ).toBe(true);
  });
});

describe("qualifyCandidates", () => {
  test("splits qualified vs rejected and sorts by EV desc", () => {
    const { qualified, rejected } = qualifyCandidates(
      [
        cand({ fixtureId: "a", odds: 1.7, modelProbability: 0.62 }), // EV .054
        cand({ fixtureId: "b", odds: 2.0, modelProbability: 0.55 }), // EV .10
        cand({ fixtureId: "c", odds: 1.3, modelProbability: 0.6 }),  // EV -.22 reject
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(qualified).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect(qualified[0].fixtureId).toBe("b"); // higher EV first
    expect(qualified[0].impliedProbability).toBeCloseTo(0.5, 10);
    expect(qualified[0].edge).toBeCloseTo(0.55 - 0.5, 10);
    expect(qualified[0].expectedValue).toBeCloseTo(0.1, 10);
  });
});

// ─── Combination builder ───────────────────────────────────────────────

describe("buildRolloverTickets", () => {
  test("empty input is honest: no_candidates", () => {
    const res = buildRolloverTickets([], DEFAULT_ROLLOVER_CONFIG);
    expect(res.tickets).toEqual([]);
    expect(res.reason).toBe("no_candidates");
  });

  test("all-rejected input is honest: no_qualified_candidates", () => {
    const res = buildRolloverTickets(
      [cand({ odds: 1.4, modelProbability: 0.6 })], // EV = -0.16 → rejected
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.reason).toBe("no_qualified_candidates");
    expect(res.tickets).toEqual([]);
    expect(res.rejected.length).toBe(1);
  });

  test("finds a two-leg ticket inside the 1.90–2.10 band", () => {
    // Two fixtures, each ~sqrt(2) ≈ 1.42 odds with p=0.72 → EV each = 0.0224...
    // need EV >= 0.03 → use p=0.73: 0.73*1.42-1 = 0.0366 ✓
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", market: "btts", selection: "no", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f2", market: "ou", selection: "under_2.5", modelProbability: 0.73, odds: 1.42 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.reason).toBe("ok");
    expect(res.tickets.length).toBeGreaterThan(0);
    const t = res.tickets[0];
    expect(t.legCount).toBe(2);
    expect(t.combinedOdds).toBeCloseTo(2.0164, 3);
    expect(t.combinedOdds).toBeGreaterThanOrEqual(1.9);
    expect(t.combinedOdds).toBeLessThanOrEqual(2.1);
    expect(t.combinedProbability).toBeCloseTo(0.73 * 0.73, 6);
    expect(t.combinedEv).toBeCloseTo(0.73 * 0.73 * 2.0164 - 1, 3);
  });

  test("same-fixture legs are never combined", () => {
    // Two legs on f1 — must not appear together in any ticket.
    // Only cross-fixture combo f1(ou)+f2 lands in band: 1.45*1.42 = 2.059.
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", market: "1x2", selection: "home", modelProbability: 0.65, odds: 1.6 }),
        cand({ fixtureId: "f1", market: "ou", selection: "under_2.5", modelProbability: 0.72, odds: 1.45 }),
        cand({ fixtureId: "f2", market: "btts", selection: "no", modelProbability: 0.75, odds: 1.42 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.tickets.length).toBeGreaterThan(0);
    for (const t of res.tickets) {
      const fixtureIds = t.legs.map((l) => l.fixtureId);
      expect(new Set(fixtureIds).size).toBe(fixtureIds.length);
    }
  });

  test("band filtering: combos outside 1.90–2.10 are rejected", () => {
    // f1×f2 = 1.45*1.45 = 2.1025 → just ABOVE the band, must be excluded.
    // f1×f3 = 1.45*1.42 = 2.059 and f2×f3 = 2.059 → inside the band.
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", modelProbability: 0.72, odds: 1.45 }),
        cand({ fixtureId: "f2", modelProbability: 0.72, odds: 1.45 }),
        cand({ fixtureId: "f3", modelProbability: 0.73, odds: 1.42 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.reason).toBe("ok");
    expect(res.tickets.length).toBeGreaterThan(0);
    for (const t of res.tickets) {
      expect(t.combinedOdds).toBeGreaterThanOrEqual(1.9);
      expect(t.combinedOdds).toBeLessThanOrEqual(2.1);
      const ids = t.legs.map((l) => l.fixtureId).sort();
      // the out-of-band f1+f2 pair must never appear
      expect(ids).not.toEqual(["f1", "f2"]);
    }
  });

  test("no combination in band → honest empty result", () => {
    // All legs ~1.1 odds: best case (4 legs, maxLegs) = 1.4641 < 1.90
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "a", modelProbability: 0.95, odds: 1.1 }),
        cand({ fixtureId: "b", modelProbability: 0.95, odds: 1.1 }),
        cand({ fixtureId: "c", modelProbability: 0.95, odds: 1.1 }),
        cand({ fixtureId: "d", modelProbability: 0.95, odds: 1.1 }),
        cand({ fixtureId: "e", modelProbability: 0.95, odds: 1.1 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.tickets).toEqual([]);
    expect(res.reason).toBe("no_combinations_in_band");
    expect(res.qualifiedCount).toBe(5);
    expect(res.message).toMatch(/no ticket/i);
  });

  test("combined-probability floor rejects thin tickets", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      minCombinedProbability: 0.9, // absurdly high → nothing passes
    };
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f2", modelProbability: 0.73, odds: 1.42 }),
      ],
      cfg
    );
    expect(res.tickets).toEqual([]);
    expect(res.reason).toBe("no_combinations_in_band");
    expect(res.message).toMatch(/probability/i);
  });

  test("EV ranking: higher score ticket ranks first", () => {
    // Construct two disjoint qualifying combos:
    //  - 2 legs @1.42 p=.73 → combOdds 2.0164, combP .5329, EV .0728, score .0388
    //  - 1 leg @2.0  p=.55 → combOdds 2.0,    combP .55,   EV .10,   score .055
    // Single leg must rank first (higher EV × prob).
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f2", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f3", modelProbability: 0.55, odds: 2.0 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.reason).toBe("ok");
    expect(res.tickets[0].legCount).toBe(1);
    expect(res.tickets[0].legs[0].fixtureId).toBe("f3");
    expect(res.tickets[0].score).toBeGreaterThan(res.tickets[1].score);
  });

  test("maxLegs is respected", () => {
    const cfg: RolloverEngineConfig = { ...DEFAULT_ROLLOVER_CONFIG, maxLegs: 2 };
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "a", modelProbability: 0.9, odds: 1.2 }),
        cand({ fixtureId: "b", modelProbability: 0.9, odds: 1.2 }),
        cand({ fixtureId: "c", modelProbability: 0.9, odds: 1.2 }),
        cand({ fixtureId: "d", modelProbability: 0.9, odds: 1.2 }),
      ],
      cfg
    );
    // 4 legs @1.2 → 2.0736 in band, but maxLegs=2 → pairs are 1.44 < 1.9
    expect(res.tickets).toEqual([]);
    expect(res.reason).toBe("no_combinations_in_band");
  });

  test("minLegs=1 allows single-leg ~2.0 tickets", () => {
    const res = buildRolloverTickets(
      [cand({ fixtureId: "solo", modelProbability: 0.55, odds: 2.0 })],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.reason).toBe("ok");
    expect(res.tickets[0].legCount).toBe(1);
    expect(res.tickets[0].combinedOdds).toBeCloseTo(2.0, 6);
    expect(res.tickets[0].combinedProbability).toBeCloseTo(0.55, 6);
  });

  test("legs carry full per-leg breakdown for UI", () => {
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", fixtureLabel: "A vs B", market: "btts", selection: "no", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f2", fixtureLabel: "C vs D", market: "ou", selection: "under_2.5", modelProbability: 0.73, odds: 1.42 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    const t = res.tickets[0];
    expect(t.rationale.length).toBeGreaterThan(0);
    for (const leg of t.legs) {
      expect(leg.fixtureLabel).toBeTruthy();
      expect(leg.impliedProbability).toBeGreaterThan(0);
      expect(leg.edge).toBeDefined();
      expect(leg.expectedValue).toBeGreaterThan(0);
    }
  });
});
