/**
 * Leakage-guard tests for worker/models/market-feature.js.
 *
 * The Odds API syncs match_result + over_under odds into odds_snapshots with
 * snapshot_time = when the price was observed. Opening odds (earliest
 * snapshot per selection, strictly before kickoff) are legitimately
 * available pre-match; CLOSING odds are not. These tests prove that
 * post-kickoff snapshots can never influence the computed features.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mf = require("../../../worker/models/market-feature.js");

const KICKOFF = "2026-05-01T19:00:00Z";
const KICKOFF_MS = new Date(KICKOFF).getTime();
const H = 3600_000;

function snap(hoursBeforeKickoff: number, market: string, selection: string, odds: number, bookmaker = "bet365") {
  return {
    fixture_id: "fx1",
    bookmaker,
    market,
    selection,
    odds,
    snapshot_time: new Date(KICKOFF_MS - hoursBeforeKickoff * H).toISOString(),
  };
}

// A full opening-odds board: home 2.00 / draw 3.40 / away 3.60
// implied raw: 0.500 / 0.294 / 0.278 → devigged ≈ 0.467 / 0.275 / 0.259
const OPENING_1X2 = [
  snap(48, "match_result", "home", 2.0),
  snap(48, "match_result", "draw", 3.4),
  snap(48, "match_result", "away", 3.6),
];

describe("computeOpeningOddsFeatures — devigging", () => {
  test("devigs opening 1X2 odds into probabilities summing to 1", () => {
    const f = mf.computeOpeningOddsFeatures(OPENING_1X2, KICKOFF);
    expect(f.hasMarketOdds).toBe(true);
    const sum = f.marketImpliedHome + f.marketImpliedDraw + f.marketImpliedAway;
    expect(sum).toBeCloseTo(1, 6);
    // home is favourite
    expect(f.marketImpliedHome).toBeGreaterThan(f.marketImpliedDraw);
    expect(f.marketImpliedHome).toBeGreaterThan(f.marketImpliedAway);
    expect(f.marketImpliedHome).toBeCloseTo(0.5 / (0.5 + 1 / 3.4 + 1 / 3.6), 4);
  });

  test("devigs over_under lines", () => {
    const rows = [
      ...OPENING_1X2,
      snap(48, "over_under_2.5", "over", 1.9),
      snap(48, "over_under_2.5", "under", 1.95),
    ];
    const f = mf.computeOpeningOddsFeatures(rows, KICKOFF);
    expect(f.marketImpliedOver2_5).toBeCloseTo((1 / 1.9) / (1 / 1.9 + 1 / 1.95), 4);
    expect(f.marketTotals["2.5"].under).toBeCloseTo(1 - f.marketImpliedOver2_5, 6);
  });

  test("averages multiple bookmakers at the same earliest timestamp", () => {
    const rows = [
      snap(48, "match_result", "home", 2.0, "bet365"),
      snap(48, "match_result", "home", 2.2, "pinnacle"),
      snap(48, "match_result", "draw", 3.4),
      snap(48, "match_result", "away", 3.6),
    ];
    const f = mf.computeOpeningOddsFeatures(rows, KICKOFF);
    // home odds averaged → 2.1
    expect(f.marketImpliedHome).toBeCloseTo(
      (1 / 2.1) / (1 / 2.1 + 1 / 3.4 + 1 / 3.6),
      4
    );
  });
});

describe("computeOpeningOddsFeatures — LEAKAGE GUARDS", () => {
  test("closing odds (snapshot after kickoff) are completely ignored", () => {
    // Opening board at T-48h, then a dramatic line move at T+2h (post-kickoff)
    // that would flip the favourite if it leaked in.
    const rows = [
      ...OPENING_1X2,
      { fixture_id: "fx1", bookmaker: "bet365", market: "match_result", selection: "home", odds: 8.0, snapshot_time: new Date(KICKOFF_MS + 2 * H).toISOString() },
      { fixture_id: "fx1", bookmaker: "bet365", market: "match_result", selection: "away", odds: 1.2, snapshot_time: new Date(KICKOFF_MS + 2 * H).toISOString() },
    ];
    const f = mf.computeOpeningOddsFeatures(rows, KICKOFF);
    // Must equal the opening-only computation exactly.
    const fOpen = mf.computeOpeningOddsFeatures(OPENING_1X2, KICKOFF);
    expect(f.marketImpliedHome).toBe(fOpen.marketImpliedHome);
    expect(f.marketImpliedAway).toBe(fOpen.marketImpliedAway);
    expect(f.marketImpliedHome).toBeGreaterThan(f.marketImpliedAway);
  });

  test("snapshot exactly AT kickoff is excluded (strict <)", () => {
    const rows = OPENING_1X2.map((r) => ({
      ...r,
      snapshot_time: new Date(KICKOFF_MS).toISOString(), // == kickoff
    }));
    const f = mf.computeOpeningOddsFeatures(rows, KICKOFF);
    expect(f.hasMarketOdds).toBe(false);
  });

  test("fixture whose ONLY snapshots are post-kickoff yields no feature", () => {
    const rows = [
      { fixture_id: "fx1", bookmaker: "bet365", market: "match_result", selection: "home", odds: 2.0, snapshot_time: new Date(KICKOFF_MS + H).toISOString() },
      { fixture_id: "fx1", bookmaker: "bet365", market: "match_result", selection: "draw", odds: 3.4, snapshot_time: new Date(KICKOFF_MS + H).toISOString() },
      { fixture_id: "fx1", bookmaker: "bet365", market: "match_result", selection: "away", odds: 3.6, snapshot_time: new Date(KICKOFF_MS + H).toISOString() },
    ];
    const f = mf.computeOpeningOddsFeatures(rows, KICKOFF);
    expect(f.hasMarketOdds).toBe(false);
    expect(mf.fromFeatures(f)).toBeNull();
  });

  test("missing kickoff → no market feature (cannot prove pre-match)", () => {
    for (const bad of [undefined, null, "", "not-a-date"]) {
      const f = mf.computeOpeningOddsFeatures(OPENING_1X2, bad as any);
      expect(f.hasMarketOdds).toBe(false);
    }
  });

  test("later (but still pre-kickoff) odds do not override the opening price", () => {
    // Steam move at T-1h must NOT replace the T-48h opening price.
    const rows = [
      ...OPENING_1X2,
      snap(1, "match_result", "home", 1.5), // much shorter — still pre-kickoff
      snap(1, "match_result", "away", 6.0),
    ];
    const f = mf.computeOpeningOddsFeatures(rows, KICKOFF);
    const fOpen = mf.computeOpeningOddsFeatures(OPENING_1X2, KICKOFF);
    expect(f.marketImpliedHome).toBe(fOpen.marketImpliedHome);
  });

  test("in-play only partial board (missing a selection) → no 1X2 feature", () => {
    const rows = OPENING_1X2.filter((r) => r.selection !== "draw");
    const f = mf.computeOpeningOddsFeatures(rows, KICKOFF);
    expect(f.marketImpliedHome).toBeUndefined();
    expect(f.hasMarketOdds).toBe(false);
  });

  test("invalid odds (<=1.0, NaN) are rejected", () => {
    const rows = [
      snap(48, "match_result", "home", 1.0),
      snap(48, "match_result", "draw", NaN),
      snap(48, "match_result", "away", 3.6),
    ];
    const f = mf.computeOpeningOddsFeatures(rows, KICKOFF);
    expect(f.hasMarketOdds).toBe(false);
  });
});

describe("blend1x2 / fromFeatures", () => {
  test("blend is convex and preserves sum=1", () => {
    const model = { home: 0.5, draw: 0.3, away: 0.2 };
    const market = { home: 0.6, draw: 0.25, away: 0.15 };
    const b = mf.blend1x2(model, market, 0.5);
    expect(b.home).toBeCloseTo(0.55, 6);
    expect(b.home + b.draw + b.away).toBeCloseTo(1, 6);
  });

  test("weight 0 returns model unchanged; weight 1 returns market", () => {
    const model = { home: 0.5, draw: 0.3, away: 0.2 };
    const market = { home: 0.6, draw: 0.25, away: 0.15 };
    expect(mf.blend1x2(model, market, 0)).toEqual(model);
    const b1 = mf.blend1x2(model, market, 1);
    expect(b1.home).toBeCloseTo(0.6, 6);
  });
});
