/**
 * Tests for per-league recalibration overrides in
 * worker/models/meta-ensemble.js (applyRecalibration / applyLeagueBias).
 *
 * The worker file is plain CommonJS outside the Next.js src tree; jest
 * roots are src/, so we require it by relative path.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  applyRecalibration,
  applyLeagueBias,
  findLeagueOverride,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require("../../../worker/models/meta-ensemble.js");

type OneXtwo = { home: number; draw: number; away: number };

function makeRefined(home = 0.4, draw = 0.3, away = 0.3) {
  return {
    oneXtwo: { home, draw, away } as OneXtwo,
    btts: { bttsYes: 0.5, bttsNo: 0.5 },
  };
}

const GLOBAL_RECAL = {
  theta: [1, 0, 0], // identity: q ∝ p (renormalized) — isolates league logic
  btts: { a: 1, b: 0 }, // identity Platt
};

describe("findLeagueOverride", () => {
  const recal = {
    league_overrides: {
      E0: { n: 2208, leagueName: "Premier League", bias: [0.3, -0.1], shrinkK: 200 },
    },
  };

  test("matches by leagueName case-insensitively", () => {
    expect(findLeagueOverride(recal, "premier league")).toBe(recal.league_overrides.E0);
    expect(findLeagueOverride(recal, "Premier League")).toBe(recal.league_overrides.E0);
  });

  test("matches by raw league code", () => {
    expect(findLeagueOverride(recal, "E0")).toBe(recal.league_overrides.E0);
  });

  test("returns null for unknown league / missing overrides", () => {
    expect(findLeagueOverride(recal, "La Liga")).toBeNull();
    expect(findLeagueOverride({}, "Premier League")).toBeNull();
    expect(findLeagueOverride(recal, undefined)).toBeNull();
    expect(findLeagueOverride(null, "Premier League")).toBeNull();
  });
});

describe("applyLeagueBias — shrinkage", () => {
  test("large n → strength → 1 (full fitted bias)", () => {
    const o = { home: 0.4, draw: 0.3, away: 0.3 };
    applyLeagueBias(o, { n: 100000, shrinkK: 200, bias: [1.0, 0.0] });
    // strength ≈ 0.998 → home logit +~1.0 → home share rises strongly
    expect(o.home).toBeGreaterThan(0.6);
    expect(Math.abs(o.home + o.draw + o.away - 1)).toBeLessThan(1e-9);
  });

  test("small n → strong shrinkage toward global (bias barely applied)", () => {
    const o = { home: 0.4, draw: 0.3, away: 0.3 };
    applyLeagueBias(o, { n: 50, shrinkK: 200, bias: [1.0, 0.0] });
    // strength = 50/250 = 0.2 → logit shift only ~0.2
    expect(o.home).toBeGreaterThan(0.4);
    expect(o.home).toBeLessThan(0.48);
  });

  test("n = 0 → no change", () => {
    const o = { home: 0.4, draw: 0.3, away: 0.3 };
    applyLeagueBias(o, { n: 0, shrinkK: 200, bias: [1.0, 0.0] });
    expect(o).toEqual({ home: 0.4, draw: 0.3, away: 0.3 });
  });

  test("missing/short bias → no change", () => {
    const o = { home: 0.4, draw: 0.3, away: 0.3 };
    applyLeagueBias(o, { n: 1000, shrinkK: 200 });
    applyLeagueBias(o, { n: 1000, shrinkK: 200, bias: [0.5] });
    expect(o).toEqual({ home: 0.4, draw: 0.3, away: 0.3 });
  });
});

describe("applyRecalibration with league_overrides", () => {
  const recal = {
    ...GLOBAL_RECAL,
    league_overrides: {
      E0: { n: 2208, leagueName: "Premier League", bias: [0.6, 0.0], shrinkK: 200 },
    },
  };

  test("known league gets boosted home prob vs unknown league", () => {
    const rPL = makeRefined();
    applyRecalibration(rPL, recal, "Premier League");
    const rOther = makeRefined();
    applyRecalibration(rOther, recal, "La Liga");
    // identity theta + identity btts → unknown league unchanged
    expect(rOther.oneXtwo.home).toBeCloseTo(0.4, 6);
    // Premier League: bias[0]=0.6, strength=2208/2408≈0.917 → home up
    expect(rPL.oneXtwo.home).toBeGreaterThan(0.4);
    expect(rPL.oneXtwo.home).toBeLessThan(0.7);
    expect(Math.abs(rPL.oneXtwo.home + rPL.oneXtwo.draw + rPL.oneXtwo.away - 1)).toBeLessThan(1e-9);
  });

  test("no leagueName → global calibration only", () => {
    const r = makeRefined();
    applyRecalibration(r, recal, undefined);
    expect(r.oneXtwo.home).toBeCloseTo(0.4, 6);
  });

  test("recal without league_overrides behaves as before", () => {
    const r = makeRefined(0.5, 0.25, 0.25);
    applyRecalibration(r, GLOBAL_RECAL, "Premier League");
    expect(r.oneXtwo.home).toBeCloseTo(0.5, 6);
    expect(r.oneXtwo.draw).toBeCloseTo(0.25, 6);
  });
});
