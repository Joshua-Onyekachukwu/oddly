import {
  computeLeagueGate,
  calibrationGap,
  brierScore,
  accuracy,
  GATE_MIN_SETTLED,
  GATE_MIN_SETTLED_STRONG,
  type SettledPredictionRow,
  type LeagueGateInput,
} from "./competition-gate";

/** Build n settled rows with given accuracy and (optionally) fixed prob. */
function rows(n: number, acc: number, prob = 0.6): SettledPredictionRow[] {
  const out: SettledPredictionRow[] = [];
  const correctCount = Math.round(n * acc);
  for (let i = 0; i < n; i++) {
    out.push({ market: "1X2", modelProbability: prob, correct: i < correctCount });
  }
  return out;
}

function input(partial: Partial<LeagueGateInput>): LeagueGateInput {
  return {
    leagueKey: "league-1",
    baselineAccuracy: 0.55,
    settled: [],
    ...partial,
  };
}

describe("metrics", () => {
  it("computes accuracy and brier", () => {
    const r = rows(10, 0.6, 0.6);
    expect(accuracy(r)).toBeCloseTo(0.6);
    // correct: (0.6-1)^2=0.16 x6 ; wrong: 0.6^2=0.36 x4 => (0.96+1.44)/10=0.24
    expect(brierScore(r)).toBeCloseTo(0.24);
  });

  it("calibration gap is ~0 for perfectly calibrated buckets", () => {
    // 10 predictions at p=0.5, 5 correct -> bucket avg pred .5, obs .5
    const r: SettledPredictionRow[] = Array.from({ length: 10 }, (_, i) => ({
      market: "1X2",
      modelProbability: 0.5,
      correct: i < 5,
    }));
    expect(calibrationGap(r)).toBeCloseTo(0);
  });

  it("calibration gap detects overconfidence", () => {
    // p=0.9 but only 50% correct -> gap ~0.4
    const r = rows(20, 0.5, 0.9);
    const gap = calibrationGap(r)!;
    expect(gap).toBeGreaterThan(0.3);
  });
});

describe("computeLeagueGate verdicts", () => {
  it("n < 10 → insufficient", () => {
    const res = computeLeagueGate(input({ settled: rows(GATE_MIN_SETTLED - 1, 0.9) }));
    expect(res.verdict).toBe("insufficient");
  });

  it("n in [10,30) → watch regardless of accuracy", () => {
    const res = computeLeagueGate(
      input({ settled: rows(GATE_MIN_SETTLED_STRONG - 1, 0.9) })
    );
    expect(res.verdict).toBe("watch");
  });

  it("n>=30, accuracy at baseline, calibrated → trusted", () => {
    // baseline 0.55; league acc ~0.60, probs spread so calibration ok.
    // Per prob level, correct count ≈ p*n → near-zero calibration gap.
    const r: SettledPredictionRow[] = [];
    for (const p of [0.4, 0.5, 0.6, 0.7, 0.8]) {
      for (let i = 0; i < 12; i++) {
        r.push({ market: "1X2", modelProbability: p, correct: i < Math.round(p * 12) });
      }
    }
    const res = computeLeagueGate(input({ settled: r }));
    // accuracy ~0.556 vs baseline 0.55 → within 5pp; calibration gap small
    expect(res.verdict).toBe("trusted");
  });

  it("n>=30, accuracy >10pp below baseline → exclude", () => {
    const res = computeLeagueGate(
      input({ settled: rows(GATE_MIN_SETTLED_STRONG, 0.4, 0.55) }) // acc .40 vs .55
    );
    expect(res.verdict).toBe("exclude");
    expect(res.reasons.join(" ")).toMatch(/below baseline/);
  });

  it("n>=30, terrible calibration → exclude", () => {
    // acc equals baseline but wildly overconfident probs
    const r: SettledPredictionRow[] = [];
    for (let i = 0; i < 60; i++) {
      r.push({ market: "1X2", modelProbability: 0.95, correct: i % 2 === 0 }); // 50% acc at p=.95
    }
    const res = computeLeagueGate(input({ settled: r, baselineAccuracy: 0.5 }));
    expect(res.verdict).toBe("exclude");
    expect(res.calibrationGap).toBeGreaterThan(0.2);
  });

  it("n>=30, slightly below baseline → watch", () => {
    // acc 0.50 vs baseline 0.55 → -5pp, at boundary of trusted tolerance
    const res = computeLeagueGate(
      input({ settled: rows(GATE_MIN_SETTLED_STRONG, 0.48, 0.55) })
    );
    expect(["watch", "trusted"]).toContain(res.verdict);
    // make it clearly watch: acc .50 → delta -0.05 is >= -0.05 so could be trusted if calibrated
    // use acc .47 → -8pp: not trusted (>5pp), not exclude (<10pp) → watch
    const res2 = computeLeagueGate(
      input({ settled: rows(GATE_MIN_SETTLED_STRONG, 0.47, 0.55) })
    );
    expect(res2.verdict).toBe("watch");
  });

  it("reports per-market metrics and coverage", () => {
    const r: SettledPredictionRow[] = [
      ...rows(15, 0.6, 0.6).map((x) => ({ ...x, market: "1X2" })),
      ...rows(15, 0.5, 0.5).map((x) => ({ ...x, market: "O/U 2.5" })),
    ];
    const res = computeLeagueGate(
      input({
        settled: r,
        coverage: { finishedFixtures: 100, oddsCoveredFixtures: 80, injuryCoveredFixtures: 40 },
      })
    );
    expect(res.sampleSize).toBe(30);
    expect(res.perMarket["1X2"].n).toBe(15);
    expect(res.perMarket["O/U 2.5"].n).toBe(15);
    expect(res.coverage.oddsCoverage).toBeCloseTo(0.8);
    expect(res.coverage.injuryCoverage).toBeCloseTo(0.4);
  });
});
