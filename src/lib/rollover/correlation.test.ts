import {
  DEFAULT_ROLLOVER_CONFIG,
  RolloverCandidate,
  RolloverEngineConfig,
  adjustedJointProbability,
  buildRolloverTickets,
  deriveRolloverDecision,
  legPairCorrelationWeight,
} from "./engine";

// Coverage for spec §2 (correlation-aware combined probability) and
// spec §4 (QUALIFIED / WAIT / SKIP daily decision).
//
// The correlation model blends the independence product toward the
// Fréchet lower bound max(0, Σp − (n−1)) by λ = correlated-pair weight
// mass / C(n,2). See adjustedJointProbability in engine.ts.

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

// Minimal leg shape accepted by adjustedJointProbability
function leg(p: number, fixtureId: string, leagueId?: string | null) {
  return { modelProbability: p, fixtureId, leagueId: leagueId ?? null };
}

// ─── legPairCorrelationWeight ──────────────────────────────────────────

describe("legPairCorrelationWeight", () => {
  test("same fixture beats same league", () => {
    const cfg = DEFAULT_ROLLOVER_CONFIG;
    expect(
      legPairCorrelationWeight(
        { fixtureId: "f1", leagueId: "L1" },
        { fixtureId: "f1", leagueId: "L1" },
        cfg
      )
    ).toBe(cfg.sameFixtureCorrelationWeight);
  });

  test("same league different fixture → league weight", () => {
    expect(
      legPairCorrelationWeight(
        { fixtureId: "f1", leagueId: "L1" },
        { fixtureId: "f2", leagueId: "L1" },
        DEFAULT_ROLLOVER_CONFIG
      )
    ).toBe(DEFAULT_ROLLOVER_CONFIG.sameLeagueCorrelationWeight);
  });

  test("different leagues / missing league → independent (0)", () => {
    const cfg = DEFAULT_ROLLOVER_CONFIG;
    expect(
      legPairCorrelationWeight(
        { fixtureId: "f1", leagueId: "L1" },
        { fixtureId: "f2", leagueId: "L2" },
        cfg
      )
    ).toBe(0);
    expect(
      legPairCorrelationWeight(
        { fixtureId: "f1", leagueId: null },
        { fixtureId: "f2", leagueId: "L1" },
        cfg
      )
    ).toBe(0);
    expect(
      legPairCorrelationWeight(
        { fixtureId: "f1", leagueId: null },
        { fixtureId: "f2", leagueId: null },
        cfg
      )
    ).toBe(0);
  });
});

// ─── adjustedJointProbability ──────────────────────────────────────────

describe("adjustedJointProbability", () => {
  test("independent legs: equals the plain product", () => {
    const legs = [leg(0.7, "f1", "L1"), leg(0.6, "f2", "L2")];
    expect(adjustedJointProbability(legs, DEFAULT_ROLLOVER_CONFIG)).toBeCloseTo(
      0.42,
      10
    );
  });

  test("same-league legs score LOWER than independence (Fréchet blend)", () => {
    // p=0.73 ×2 → pInd=0.5329, lower=max(0,1.46−1)=0.46, λ=0.4
    // adj = 0.5329 − 0.4×(0.5329−0.46) = 0.50486
    const legs = [leg(0.73, "f1", "L1"), leg(0.73, "f2", "L1")];
    const pInd = 0.73 * 0.73;
    const adj = adjustedJointProbability(legs, DEFAULT_ROLLOVER_CONFIG);
    expect(adj).toBeLessThan(pInd);
    expect(adj).toBeCloseTo(pInd - 0.4 * (pInd - 0.46), 10);
  });

  test("same-fixture pair is priced at the full worst case (λ=1)", () => {
    // p=0.73 ×2 same fixture → adj = lower bound = 0.46
    const legs = [leg(0.73, "f1", "L1"), leg(0.73, "f1", "L1")];
    const adj = adjustedJointProbability(legs, DEFAULT_ROLLOVER_CONFIG);
    expect(adj).toBeCloseTo(0.46, 10);
    expect(adj).toBeLessThan(
      adjustedJointProbability([leg(0.73, "f1", "L1"), leg(0.73, "f2", "L1")], DEFAULT_ROLLOVER_CONFIG)
    );
  });

  test("λ normalizes by pair count: 3 same-league legs → λ=0.4", () => {
    // p=0.6 ×3 → pInd=0.216, lower=max(0,1.8−2)=0, mass=3×0.4=1.2, pairs=3 → λ=0.4
    const legs = [leg(0.6, "f1", "L1"), leg(0.6, "f2", "L1"), leg(0.6, "f3", "L1")];
    const adj = adjustedJointProbability(legs, DEFAULT_ROLLOVER_CONFIG);
    expect(adj).toBeCloseTo(0.216 - 0.4 * 0.216, 10);
  });

  test("correlationDiscountEnabled=false restores independence", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      correlationDiscountEnabled: false,
    };
    const legs = [leg(0.73, "f1", "L1"), leg(0.73, "f2", "L1")];
    expect(adjustedJointProbability(legs, cfg)).toBeCloseTo(0.73 * 0.73, 10);
  });

  test("zero weights → independence even for same fixture", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      sameFixtureCorrelationWeight: 0,
      sameLeagueCorrelationWeight: 0,
    };
    const legs = [leg(0.7, "f1", "L1"), leg(0.7, "f1", "L1")];
    expect(adjustedJointProbability(legs, cfg)).toBeCloseTo(0.49, 10);
  });

  test("single leg is never discounted", () => {
    expect(adjustedJointProbability([leg(0.7, "f1", "L1")], DEFAULT_ROLLOVER_CONFIG)).toBeCloseTo(0.7, 10);
  });

  test("never exceeds the independence product or the min marginal", () => {
    // Pathological marginals where pInd < Fréchet lower bound:
    // p=[0.99,0.5,0.5] → product 0.2475 < lower 0.99. Even fully
    // correlated (λ=1) the result must not exceed the product.
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      sameLeagueCorrelationWeight: 1,
      sameFixtureCorrelationWeight: 1,
    };
    const legs = [leg(0.99, "f1", "L1"), leg(0.5, "f2", "L1"), leg(0.5, "f3", "L1")];
    const adj = adjustedJointProbability(legs, cfg);
    expect(adj).toBeLessThanOrEqual(0.99 * 0.5 * 0.5 + 1e-12);
    expect(adj).toBeGreaterThanOrEqual(0);
    expect(adj).toBeLessThanOrEqual(0.5); // ≤ min marginal
  });
});

// ─── Ticket-level correlation effects ──────────────────────────────────

describe("buildRolloverTickets — correlation adjustment", () => {
  const pair = [
    cand({ fixtureId: "f1", leagueId: "L1", modelProbability: 0.73, odds: 1.42 }),
    cand({ fixtureId: "f2", leagueId: "L1", modelProbability: 0.73, odds: 1.42 }),
  ];

  test("ticket reports adjustedProbability < combinedProbability for same-league legs", () => {
    const res = buildRolloverTickets(pair, DEFAULT_ROLLOVER_CONFIG);
    expect(res.reason).toBe("ok");
    const t = res.tickets.find((x) => x.legCount === 2);
    expect(t).toBeTruthy();
    expect(t!.combinedProbability).toBeCloseTo(0.73 * 0.73, 6);
    expect(t!.adjustedProbability!).toBeLessThan(t!.combinedProbability);
    // correlationFactor = adjusted / product
    expect(t!.correlationFactor!).toBeCloseTo(
      t!.adjustedProbability! / t!.combinedProbability,
      6
    );
    expect(t!.adjustedEv!).toBeLessThan(t!.combinedEv);
    expect(t!.rationale.some((r) => r.includes("correlation-adjusted"))).toBe(true);
  });

  test("cross-league legs are unaffected (λ = 0)", () => {
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", leagueId: "L1", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f2", leagueId: "L2", modelProbability: 0.73, odds: 1.42 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    const t = res.tickets.find((x) => x.legCount === 2);
    expect(t!.adjustedProbability).toBeCloseTo(t!.combinedProbability, 10);
    expect(t!.correlationFactor).toBeCloseTo(1, 10);
    expect(t!.adjustedEv).toBeCloseTo(t!.combinedEv, 10);
    expect(t!.score).toBeCloseTo(t!.adjustedEv! * t!.adjustedProbability!, 6);
  });

  test("correlated legs score strictly lower than identical independent legs", () => {
    const correlated = buildRolloverTickets(pair, DEFAULT_ROLLOVER_CONFIG);
    const independent = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", leagueId: "L1", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f2", leagueId: "L2", modelProbability: 0.73, odds: 1.42 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    const tc = correlated.tickets.find((x) => x.legCount === 2)!;
    const ti = independent.tickets.find((x) => x.legCount === 2)!;
    expect(tc.adjustedProbability!).toBeLessThan(ti.adjustedProbability!);
    expect(tc.score).toBeLessThan(ti.score);
  });

  test("minCombinedProbability floor applies to the ADJUSTED probability", () => {
    // product = 0.5329, adjusted ≈ 0.5049. Floor 0.52 sits between them.
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      minCombinedProbability: 0.52,
    };
    const res = buildRolloverTickets(pair, cfg);
    expect(res.tickets).toEqual([]);
    expect(res.reason).toBe("no_combinations_in_band");

    // Same floor with discount disabled → product passes → ticket exists.
    const cfgOff: RolloverEngineConfig = {
      ...cfg,
      correlationDiscountEnabled: false,
    };
    const resOff = buildRolloverTickets(pair, cfgOff);
    expect(resOff.reason).toBe("ok");
  });

  test("same-fixture legs discounted when excludeSameFixture=false", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      excludeSameFixture: false,
    };
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", market: "btts", selection: "no", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f1", market: "ou", selection: "under_2.5", modelProbability: 0.73, odds: 1.42 }),
      ],
      cfg
    );
    const t = res.tickets.find((x) => x.legCount === 2);
    expect(t).toBeTruthy();
    // λ=1 → adjusted = Fréchet lower bound = 0.73+0.73−1 = 0.46
    expect(t!.adjustedProbability).toBeCloseTo(0.46, 6);
    expect(t!.correlationFactor!).toBeLessThan(1);
  });
});

// ─── Daily decision (spec §4) ──────────────────────────────────────────

describe("deriveRolloverDecision / buildRolloverTickets decision", () => {
  test("tickets exist → qualified", () => {
    const res = buildRolloverTickets(
      [cand({ fixtureId: "solo", modelProbability: 0.55, odds: 2.0 })],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.reason).toBe("ok");
    expect(res.decision).toBe("qualified");
  });

  test("empty input → skip", () => {
    const res = buildRolloverTickets([], DEFAULT_ROLLOVER_CONFIG);
    expect(res.decision).toBe("skip");
  });

  test("all rejected on merit thresholds → skip", () => {
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "a", market: "correct_score", selection: "2-1", modelProbability: 0.9, odds: 5.0 }),
        cand({ fixtureId: "b", modelProbability: 0.4, odds: 2.5 }), // EV negative + low p
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.reason).toBe("no_qualified_candidates");
    expect(res.decision).toBe("skip");
  });

  test("rejections caused by missing data gates → wait", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      maxModelDisagreement: 0.2,
      minDataQualityScore: 50,
    };
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "a", modelDisagreement: null, dataQualityScore: null, modelProbability: 0.9, odds: 1.5 }),
      ],
      cfg
    );
    expect(res.reason).toBe("no_qualified_candidates");
    expect(res.rejected[0].reasons).toContain("model_disagreement_missing");
    expect(res.decision).toBe("wait");
  });

  test("invalid odds (no reliable price) → wait", () => {
    const res = buildRolloverTickets(
      [cand({ fixtureId: "a", odds: 1.0, modelProbability: 0.9 })],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.decision).toBe("wait");
  });

  test("qualified legs but no in-band combo → wait (rescan may realign odds)", () => {
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
    expect(res.reason).toBe("no_combinations_in_band");
    expect(res.qualifiedCount).toBe(5);
    expect(res.decision).toBe("wait");
  });

  test("deriveRolloverDecision unit checks", () => {
    expect(
      deriveRolloverDecision({ reason: "ok", qualifiedCount: 3, tickets: [{} as any], rejected: [] })
    ).toBe("qualified");
    expect(
      deriveRolloverDecision({ reason: "no_candidates", qualifiedCount: 0, tickets: [], rejected: [] })
    ).toBe("skip");
    expect(
      deriveRolloverDecision({
        reason: "no_qualified_candidates",
        qualifiedCount: 0,
        tickets: [],
        rejected: [{ candidate: cand({}), reasons: ["ev_below_min:0.01<0.03"] }],
      })
    ).toBe("skip");
    expect(
      deriveRolloverDecision({
        reason: "no_qualified_candidates",
        qualifiedCount: 0,
        tickets: [],
        rejected: [{ candidate: cand({}), reasons: ["data_quality_missing"] }],
      })
    ).toBe("wait");
  });
});
