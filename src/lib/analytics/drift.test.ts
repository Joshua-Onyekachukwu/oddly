import {
  computeDrift,
  groupDriftSamples,
  normalCdf,
  DRIFT_MIN_WINDOW_N,
  type DriftSample,
} from "./drift";

const NOW = new Date("2026-12-20T00:00:00Z");

function sample(daysAgo: number, prob: number, correct: boolean, mv = "v1", market = "1X2"): DriftSample {
  return {
    modelVersion: mv,
    market,
    probability: prob,
    correct,
    settledAt: new Date(NOW.getTime() - daysAgo * 86400000).toISOString(),
  };
}

/** n samples uniformly `daysAgo` days back. */
function window(daysAgo: number, n: number, prob: number, acc: number): DriftSample[] {
  const out: DriftSample[] = [];
  for (let i = 0; i < n; i++) out.push(sample(daysAgo, prob, i < Math.round(n * acc)));
  return out;
}

describe("normalCdf", () => {
  it("approximates standard normal", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });
});

describe("computeDrift", () => {
  it("insufficient_data when windows are small", () => {
    const samples = [
      ...window(10, DRIFT_MIN_WINDOW_N - 1, 0.6, 0.6), // recent, too small
      ...window(60, 200, 0.6, 0.6), // prior ok
    ];
    const res = computeDrift(samples, NOW);
    expect(res.driftStatus).toBe("insufficient_data");
    expect(res.pValue).toBeNull();
  });

  it("stable when windows are identical", () => {
    const samples = [
      ...window(10, 100, 0.6, 0.6),
      ...window(60, 200, 0.6, 0.6),
    ];
    const res = computeDrift(samples, NOW);
    expect(res.driftStatus).toBe("stable");
    expect(res.brierDelta).toBeCloseTo(0, 5);
  });

  it("drift_suspected when recent Brier is significantly worse", () => {
    // prior: well-calibrated p=.6 acc .6 → brier ~0.24ish but deterministic .24
    // recent: same predictions but acc drops to .3 → brier much worse
    const prior = window(60, 200, 0.6, 0.6);
    const recent = window(10, 100, 0.6, 0.3);
    const res = computeDrift([...recent, ...prior], NOW);
    expect(res.driftStatus).toBe("drift_suspected");
    expect(res.brierDelta).toBeGreaterThan(0);
    expect(res.pValue).not.toBeNull();
    expect(res.pValue!).toBeLessThan(0.05);
  });

  it("improvement is not drift_suspected (only deterioration alerts)", () => {
    const prior = window(60, 200, 0.6, 0.4); // bad prior
    const recent = window(10, 100, 0.6, 0.7); // better recent
    const res = computeDrift([...recent, ...prior], NOW);
    expect(res.brierDelta).toBeLessThan(0);
    expect(res.driftStatus).not.toBe("drift_suspected");
  });

  it("small-sample noise stays stable/watch, never drift_suspected", () => {
    // n=50 each, modest difference → underpowered
    const samples = [
      ...window(10, 50, 0.55, 0.5),
      ...window(60, 50, 0.55, 0.55),
    ];
    const res = computeDrift(samples, NOW);
    expect(["stable", "watch"]).toContain(res.driftStatus);
  });
});

describe("groupDriftSamples", () => {
  it("groups by model_version + market and drops unsettled rows", () => {
    const groups = groupDriftSamples([
      { model_version: "v1", market: "1X2", model_probability: 0.6, result: "correct", settled_at: "2026-12-01" },
      { model_version: "v1", market: "1X2", model_probability: 0.4, result: "wrong", settled_at: "2026-12-02" },
      { model_version: "v1", market: "O/U", model_probability: 0.5, result: "correct", settled_at: "2026-12-03" },
      { model_version: "v1", market: "1X2", model_probability: 0.5, result: "pending", settled_at: null },
      { model_version: null, market: null, model_probability: null, result: "correct", settled_at: null },
    ]);
    expect(groups.size).toBe(2);
    expect(groups.get("v1::1X2")!.length).toBe(2);
    expect(groups.get("v1::O/U")!.length).toBe(1);
  });
});
