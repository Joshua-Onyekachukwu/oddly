import {
  DEFAULT_ROLLOVER_CONFIG,
  RolloverCandidate,
  RolloverEngineConfig,
  buildRolloverTickets,
  canonicalMarket,
  generateRolloverRecommendation,
  impliedProbability,
  qualifyCandidate,
} from "./engine";

// Edge-case coverage complementing engine.test.ts:
// league soft-correlation cap, excludeSameFixture toggle, combination
// budget abort, data-quality gate, allowedMarkets=null, band boundaries,
// and confirmation that there is NO probability correlation discount
// (combinedProbability is a plain product — documented assumption).

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

// ─── canonicalMarket — extended aliases ────────────────────────────────

describe("canonicalMarket — additional aliases", () => {
  test("maps remaining alias vocabulary", () => {
    expect(canonicalMarket("both_teams_to_score")).toBe("btts");
    expect(canonicalMarket("double_chance")).toBe("dc");
    expect(canonicalMarket("draw_no_bet")).toBe("dnb");
    expect(canonicalMarket("home_goals")).toBe("homegoals");
    expect(canonicalMarket("away_goals")).toBe("awaygoals");
    expect(canonicalMarket("  BTTS  ")).toBe("btts");
  });

  test("unknown markets pass through lowercased (then fail allow-list)", () => {
    expect(canonicalMarket("Correct_Score")).toBe("correct_score");
  });
});

// ─── qualifyCandidate — gates not covered in engine.test.ts ────────────

describe("qualifyCandidate — data quality & market-list gates", () => {
  test("minDataQualityScore rejects low/null scores when enabled", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      minDataQualityScore: 50,
    };
    expect(qualifyCandidate(cand({ dataQualityScore: 80 }), cfg)).toEqual([]);
    expect(
      qualifyCandidate(cand({ dataQualityScore: 30 }), cfg).some((r) =>
        r.startsWith("data_quality_below_min")
      )
    ).toBe(true);
    expect(
      qualifyCandidate(cand({ dataQualityScore: null }), cfg).some(
        (r) => r === "data_quality_missing"
      )
    ).toBe(true);
  });

  test("data quality gate is off by default (null scores pass)", () => {
    expect(
      qualifyCandidate(cand({ dataQualityScore: null }), DEFAULT_ROLLOVER_CONFIG)
    ).toEqual([]);
  });

  test("allowedMarkets: null disables the allow-list", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      allowedMarkets: null,
    };
    // correct_score is normally market_not_allowed; with null it only needs
    // to pass prob/EV floors.
    const c = cand({
      market: "correct_score",
      selection: "2-1",
      modelProbability: 0.9,
      odds: 1.5,
    });
    expect(qualifyCandidate(c, cfg)).toEqual([]);
    expect(
      qualifyCandidate(c, DEFAULT_ROLLOVER_CONFIG).some((r) =>
        r.startsWith("market_not_allowed")
      )
    ).toBe(true);
  });

  test("excludedMarkets beats allowedMarkets", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      allowedMarkets: null,
      excludedMarkets: ["1x2"],
    };
    const reasons = qualifyCandidate(cand({}), cfg);
    expect(reasons).toContain("market_excluded:1x2");
  });
});

// ─── buildRolloverTickets — edge cases ─────────────────────────────────

describe("buildRolloverTickets — edge cases", () => {
  test("null/undefined input treated as no_candidates", () => {
    // @ts-expect-error intentional misuse
    expect(buildRolloverTickets(null).reason).toBe("no_candidates");
    // @ts-expect-error intentional misuse
    expect(buildRolloverTickets(undefined).reason).toBe("no_candidates");
  });

  test("single-leg ticket exactly at band edges", () => {
    // odds 1.90 → in band (>= minCombinedOdds); p must clear EV + prob floors.
    // p=0.55, o=1.9 → EV = 0.045 ≥ 0.03 ✓, combinedP 0.55 ≥ 0.45 ✓
    const lo = buildRolloverTickets(
      [cand({ fixtureId: "lo", modelProbability: 0.55, odds: 1.9 })],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(lo.reason).toBe("ok");
    expect(lo.tickets[0].combinedOdds).toBeCloseTo(1.9, 6);

    // odds 2.10 → in band (<= maxCombinedOdds)
    const hi = buildRolloverTickets(
      [cand({ fixtureId: "hi", modelProbability: 0.55, odds: 2.1 })],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(hi.reason).toBe("ok");
    expect(hi.tickets[0].combinedOdds).toBeCloseTo(2.1, 6);

    // odds 2.11 → just outside → honest empty
    const out = buildRolloverTickets(
      [cand({ fixtureId: "out", modelProbability: 0.55, odds: 2.11 })],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(out.tickets).toEqual([]);
    expect(out.reason).toBe("no_combinations_in_band");
  });

  test("excludeSameFixture=false allows same-fixture legs to combine", () => {
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
    expect(res.reason).toBe("ok");
    const twoLeg = res.tickets.find((t) => t.legCount === 2);
    expect(twoLeg).toBeTruthy();
    expect(twoLeg!.legs.every((l) => l.fixtureId === "f1")).toBe(true);
  });

  test("maxLegsPerLeague caps same-league legs (soft correlation)", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      maxLegsPerLeague: 1,
    };
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", leagueId: "L1", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f2", leagueId: "L1", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f3", leagueId: "L2", modelProbability: 0.73, odds: 1.42 }),
      ],
      cfg
    );
    expect(res.reason).toBe("ok");
    for (const t of res.tickets) {
      if (t.legCount === 2) {
        const leagues = t.legs.map((l) => l.leagueId);
        // f1+f2 (both L1) must never appear together
        expect(leagues.sort()).not.toEqual(["L1", "L1"]);
      }
    }
    // f1+f3 and f2+f3 (cross-league) are allowed
    expect(
      res.tickets.some(
        (t) =>
          t.legCount === 2 &&
          t.legs.map((l) => l.leagueId).sort().join(",") === "L1,L2"
      )
    ).toBe(true);
  });

  test("NO correlation discount: combinedProbability is a plain product", () => {
    // Even for same-league legs the engine assumes independence —
    // combinedProbability = Π pᵢ with no shrinkage. This is the documented
    // "optimistic" accumulator assumption; assert it explicitly.
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "f1", leagueId: "L1", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "f2", leagueId: "L1", modelProbability: 0.73, odds: 1.42 }),
      ],
      DEFAULT_ROLLOVER_CONFIG // maxLegsPerLeague null → uncapped
    );
    const t = res.tickets.find((x) => x.legCount === 2);
    expect(t).toBeTruthy();
    expect(t!.combinedProbability).toBeCloseTo(0.73 * 0.73, 6);
  });

  test("maxCombinationsEvaluated aborts the search safely", () => {
    const cfg: RolloverEngineConfig = {
      ...DEFAULT_ROLLOVER_CONFIG,
      maxCombinationsEvaluated: 1,
      topTickets: 5,
    };
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "a", modelProbability: 0.9, odds: 1.2 }),
        cand({ fixtureId: "b", modelProbability: 0.9, odds: 1.2 }),
        cand({ fixtureId: "c", modelProbability: 0.9, odds: 1.2 }),
        cand({ fixtureId: "d", modelProbability: 0.9, odds: 1.2 }),
      ],
      cfg
    );
    // Must terminate (no hang) and still return a well-formed result.
    expect(res.combinationsEvaluated).toBeLessThanOrEqual(1);
    expect(["ok", "no_combinations_in_band"]).toContain(res.reason);
  });

  test("minLegs=2 excludes single-leg tickets even when they'd qualify", () => {
    const cfg: RolloverEngineConfig = { ...DEFAULT_ROLLOVER_CONFIG, minLegs: 2 };
    const res = buildRolloverTickets(
      [cand({ fixtureId: "solo", modelProbability: 0.55, odds: 2.0 })],
      cfg
    );
    expect(res.tickets).toEqual([]);
    expect(res.reason).toBe("no_combinations_in_band");
  });

  test("generateRolloverRecommendation merges partial config over defaults", () => {
    const res = generateRolloverRecommendation(
      [cand({ fixtureId: "solo", modelProbability: 0.55, odds: 2.0 })],
      { maxLegs: 1 }
    );
    expect(res.reason).toBe("ok");
    expect(res.tickets[0].legCount).toBe(1);
    // unspecified fields keep defaults (minCombinedOdds still 1.9)
    expect(res.tickets[0].combinedOdds).toBeCloseTo(2.0, 6);
  });

  test("rejected candidates carry reasons through to the result", () => {
    const res = buildRolloverTickets(
      [
        cand({ fixtureId: "good", modelProbability: 0.73, odds: 1.42 }),
        cand({ fixtureId: "bad", market: "correct_score", selection: "2-1", modelProbability: 0.9, odds: 5.0 }),
      ],
      DEFAULT_ROLLOVER_CONFIG
    );
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].candidate.fixtureId).toBe("bad");
    expect(res.rejected[0].reasons.some((r) => r.startsWith("market_not_allowed"))).toBe(true);
  });
});

// ─── impliedProbability sanity on engine inputs ────────────────────────

describe("impliedProbability edge inputs", () => {
  test("odds <= 1 yields 0 (never reached — qualifyCandidate rejects first)", () => {
    expect(impliedProbability(1)).toBe(0);
    expect(impliedProbability(0.5)).toBe(0);
    expect(impliedProbability(-2)).toBe(0);
  });
});
