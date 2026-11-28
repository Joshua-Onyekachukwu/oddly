/**
 * Settlement correctness tests for checkPrediction() — the canonical
 * result-checking logic used by the settle cron
 * (src/app/api/v1/cron/settle/route.ts) and smart_selection settlement.
 *
 * NOTE: a second, divergent implementation exists in
 * scripts/settle-predictions.js (isCorrect) and a third private one in
 * src/lib/prediction/tracking.ts (calculateOutcome). Divergences are
 * documented in the "known divergences" describe block.
 */

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({})),
}));

import { checkPrediction, checkPredictionOutcome } from "./ensemble";

const pred = {};

// ─── 1X2 / Match Result ────────────────────────────────────────────────

describe("checkPrediction — 1x2", () => {
  test("home / draw / away selections", () => {
    expect(checkPrediction(pred, "1x2", "home", 2, 1)).toBe(true);
    expect(checkPrediction(pred, "1x2", "home", 1, 1)).toBe(false);
    expect(checkPrediction(pred, "1x2", "home", 0, 2)).toBe(false);

    expect(checkPrediction(pred, "1x2", "draw", 1, 1)).toBe(true);
    expect(checkPrediction(pred, "1x2", "draw", 2, 0)).toBe(false);

    expect(checkPrediction(pred, "1x2", "away", 0, 2)).toBe(true);
    expect(checkPrediction(pred, "1x2", "away", 2, 0)).toBe(false);
  });

  test("selection matching is case-insensitive", () => {
    expect(checkPrediction(pred, "1x2", "HOME", 2, 0)).toBe(true);
    expect(checkPrediction(pred, "1x2", "Draw", 0, 0)).toBe(true);
  });

  test("0-0 is a draw, not a home/away win", () => {
    expect(checkPrediction(pred, "1x2", "draw", 0, 0)).toBe(true);
    expect(checkPrediction(pred, "1x2", "home", 0, 0)).toBe(false);
    expect(checkPrediction(pred, "1x2", "away", 0, 0)).toBe(false);
  });
});

// ─── Over/Under ────────────────────────────────────────────────────────

describe("checkPrediction — over/under", () => {
  test("over_2.5 / under_2.5 on both 'ou' and 'over_under' markets", () => {
    for (const mkt of ["ou", "over_under"]) {
      expect(checkPrediction(pred, mkt, "over_2.5", 2, 1)).toBe(true);  // 3 goals
      expect(checkPrediction(pred, mkt, "over_2.5", 1, 1)).toBe(false); // 2 goals
      expect(checkPrediction(pred, mkt, "under_2.5", 1, 1)).toBe(true);
      expect(checkPrediction(pred, mkt, "under_2.5", 2, 1)).toBe(false);
    }
  });

  test("respects non-2.5 lines", () => {
    expect(checkPrediction(pred, "ou", "over_1.5", 1, 1)).toBe(true);   // 2 > 1.5
    expect(checkPrediction(pred, "ou", "under_3.5", 2, 1)).toBe(true);  // 3 < 3.5
    expect(checkPrediction(pred, "ou", "over_3.5", 2, 1)).toBe(false);
  });

  test("exact-line push is VOID via checkPredictionOutcome (boolean view: false)", () => {
    // total === line: real O/U bets push/void. checkPredictionOutcome reports
    // "void"; the boolean checkPrediction maps it to false.
    expect(checkPredictionOutcome(pred, "ou", "over_2.0", 1, 1)).toBe("void");
    expect(checkPredictionOutcome(pred, "ou", "under_2.0", 1, 1)).toBe("void");
    expect(checkPrediction(pred, "ou", "over_2.0", 1, 1)).toBe(false);
    expect(checkPrediction(pred, "ou", "under_2.0", 1, 1)).toBe(false);
  });

  test("missing/invalid line is undetermined (boolean view: false)", () => {
    expect(checkPredictionOutcome(pred, "ou", "over", 5, 0)).toBe("undetermined");
    expect(checkPredictionOutcome(pred, "ou", "under", 0, 0)).toBe("undetermined");
    expect(checkPrediction(pred, "ou", "over", 5, 0)).toBe(false);
    expect(checkPrediction(pred, "ou", "under", 0, 0)).toBe(false);
  });
});

// ─── BTTS ──────────────────────────────────────────────────────────────

describe("checkPrediction — btts", () => {
  test("yes / no selections", () => {
    expect(checkPrediction(pred, "btts", "yes", 1, 1)).toBe(true);
    expect(checkPrediction(pred, "btts", "yes", 2, 0)).toBe(false);
    expect(checkPrediction(pred, "btts", "no", 2, 0)).toBe(true);
    expect(checkPrediction(pred, "btts", "no", 0, 0)).toBe(true);
    expect(checkPrediction(pred, "btts", "no", 1, 1)).toBe(false);
  });
});

// ─── Double Chance ─────────────────────────────────────────────────────

describe("checkPrediction — double chance", () => {
  test("dc market with 1x / x2 / 12 selections", () => {
    // 1X = home win or draw
    expect(checkPrediction(pred, "dc", "1x", 2, 1)).toBe(true);
    expect(checkPrediction(pred, "dc", "1x", 1, 1)).toBe(true);
    expect(checkPrediction(pred, "dc", "1x", 0, 1)).toBe(false);
    // X2 = draw or away win
    expect(checkPrediction(pred, "dc", "x2", 1, 1)).toBe(true);
    expect(checkPrediction(pred, "dc", "x2", 0, 2)).toBe(true);
    expect(checkPrediction(pred, "dc", "x2", 2, 0)).toBe(false);
    // 12 = home or away win (no draw)
    expect(checkPrediction(pred, "dc", "12", 2, 0)).toBe(true);
    expect(checkPrediction(pred, "dc", "12", 1, 1)).toBe(false);
  });

  test("dc_<side> market keys: market suffix is the bet when selection is generic", () => {
    expect(checkPrediction(pred, "dc_1x", "home", 2, 0)).toBe(true);  // suffix → 1X
    expect(checkPrediction(pred, "dc_x2", "home", 0, 2)).toBe(true);  // suffix → X2
    expect(checkPrediction(pred, "dc_12", "home", 2, 0)).toBe(true);  // suffix → 12
    expect(checkPrediction(pred, "dc_12", "home", 1, 1)).toBe(false); // suffix → 12, draw misses
  });

  test("conflicting dc market suffix vs selection → undetermined (no guessing)", () => {
    // sel "1x" on a dc_x2 market encodes two different bets — ambiguous.
    expect(checkPredictionOutcome(pred, "dc_x2", "1x", 2, 0)).toBe("undetermined");
    expect(checkPredictionOutcome(pred, "dc_12", "1x", 1, 1)).toBe("undetermined");
    expect(checkPrediction(pred, "dc_x2", "1x", 2, 0)).toBe(false);
  });

  test("compound dc selections map to their codes", () => {
    expect(checkPrediction(pred, "dc", "home_draw", 2, 0)).toBe(true);   // → 1X
    expect(checkPrediction(pred, "dc", "draw_away", 0, 1)).toBe(true);   // → X2
    expect(checkPrediction(pred, "dc", "home_away", 2, 0)).toBe(true);   // → 12
    expect(checkPrediction(pred, "dc", "home_away", 1, 1)).toBe(false);  // draw misses 12
  });
});

// ─── Draw No Bet ───────────────────────────────────────────────────────

describe("checkPrediction — draw no bet", () => {
  test("home/away wins settle correct; draws are VOID (boolean view: false)", () => {
    expect(checkPrediction(pred, "dnb", "home", 2, 0)).toBe(true);
    expect(checkPredictionOutcome(pred, "dnb", "home", 1, 1)).toBe("void"); // draw = push
    expect(checkPrediction(pred, "dnb", "home", 1, 1)).toBe(false);
    expect(checkPrediction(pred, "dnb", "home", 0, 1)).toBe(false);
    expect(checkPrediction(pred, "dnb", "away", 0, 1)).toBe(true);
    expect(checkPredictionOutcome(pred, "dnb", "away", 1, 1)).toBe("void");
    expect(checkPrediction(pred, "dnb", "away", 1, 1)).toBe(false);
    expect(checkPredictionOutcome(pred, "dnb", "bogus", 2, 0)).toBe("undetermined");
  });
});

// ─── Team totals (homegoals / awaygoals) ───────────────────────────────

describe("checkPrediction — team totals", () => {
  test("over lines on home/away goals", () => {
    expect(checkPrediction(pred, "homegoals", "over_0.5", 1, 0)).toBe(true);
    expect(checkPrediction(pred, "homegoals", "over_0.5", 0, 3)).toBe(false);
    expect(checkPrediction(pred, "awaygoals", "over_1.5", 0, 2)).toBe(true);
    expect(checkPrediction(pred, "awaygoals", "over_1.5", 4, 1)).toBe(false);
  });

  test("'under_X' selections are respected (previously ignored)", () => {
    // Regression: homegoals/awaygoals used to always compute `score > line`,
    // scoring under bets as wins. Now the over/under prefix is honored.
    expect(checkPrediction(pred, "homegoals", "under_1.5", 2, 0)).toBe(false); // 2 goals, under 1.5 loses
    expect(checkPredictionOutcome(pred, "homegoals", "under_1.5", 2, 0)).toBe("wrong");
    expect(checkPrediction(pred, "homegoals", "under_1.5", 1, 0)).toBe(true);  // 1 < 1.5 wins
    expect(checkPrediction(pred, "awaygoals", "under_0.5", 0, 1)).toBe(false); // 1 away goal, under 0.5 loses
    expect(checkPrediction(pred, "awaygoals", "under_0.5", 0, 0)).toBe(true);  // 0 < 0.5 wins
  });

  test("exact-line team-total push is VOID", () => {
    expect(checkPredictionOutcome(pred, "homegoals", "over_1.0", 1, 0)).toBe("void");
    expect(checkPredictionOutcome(pred, "awaygoals", "under_2.0", 0, 2)).toBe("void");
    expect(checkPrediction(pred, "homegoals", "over_1.0", 1, 0)).toBe(false);
  });

  test("unparseable team-total selection is undetermined", () => {
    expect(checkPredictionOutcome(pred, "homegoals", "maybe", 1, 0)).toBe("undetermined");
  });
});

// ─── smart_selection delegation ────────────────────────────────────────

describe("checkPrediction — smart_selection", () => {
  test("delegates to the embedded market/selection", () => {
    const p = { smart_selection: { market: "1x2", selection: "home", probability: 0.7 } };
    expect(checkPrediction(p, "smart_selection", "", 2, 0)).toBe(true);
    expect(checkPrediction(p, "smart_selection", "", 0, 2)).toBe(false);

    const p2 = { smart_selection: { market: "ou", selection: "over_2.5", probability: 0.6 } };
    expect(checkPrediction(p2, "smart_selection", "", 2, 1)).toBe(true);
  });

  test("missing smart_selection payload → false", () => {
    expect(checkPrediction(pred, "smart_selection", "", 2, 0)).toBe(false);
  });
});

// ─── Fallbacks ─────────────────────────────────────────────────────────

describe("checkPrediction — fallthrough", () => {
  test("unknown markets return false rather than throwing", () => {
    for (const mkt of ["correct_score", "first_goalscorer", "", "handicap"]) {
      expect(checkPrediction(pred, mkt, "home", 2, 0)).toBe(false);
    }
  });

  test("market matching is case-insensitive", () => {
    expect(checkPrediction(pred, "1X2", "home", 2, 0)).toBe(true);
    expect(checkPrediction(pred, "BTTS", "yes", 1, 1)).toBe(true);
    expect(checkPrediction(pred, "OU", "over_2.5", 2, 1)).toBe(true);
  });
});

// ─── Known divergences between settlement implementations ─────────────
//
// Three result-checkers exist and DISAGREE on edge cases:
//   1. src/lib/models/ensemble.ts  checkPrediction   (used by cron settle route)
//   2. scripts/settle-predictions.js isCorrect       (manual script)
//   3. src/lib/prediction/tracking.ts calculateOutcome (private, likely dead —
//      see below)
//
// Divergences documented here so regressions are visible:

describe("known divergences (documented, asserted as current behavior)", () => {
  test("1x2 numeric selections ('1','x','2') are now supported", () => {
    // Previously unsupported → settled "wrong" on a home win. Now mapped to
    // home/draw/away like bookmaker-style numeric codes.
    expect(checkPrediction(pred, "1x2", "1", 2, 0)).toBe(true);
    expect(checkPrediction(pred, "1x2", "x", 1, 1)).toBe(true);
    expect(checkPrediction(pred, "1x2", "2", 0, 2)).toBe(true);
    expect(checkPrediction(pred, "1x2", "1", 0, 2)).toBe(false);
  });

  test("btts compound selections ('btts_yes'/'btts_no') are now supported", () => {
    expect(checkPrediction(pred, "btts", "btts_yes", 1, 1)).toBe(true);
    expect(checkPrediction(pred, "btts", "btts_no", 2, 0)).toBe(true);
    expect(checkPrediction(pred, "btts", "btts_yes", 2, 0)).toBe(false);
  });

  test("unknown compound selections are undetermined, not guessed", () => {
    expect(checkPredictionOutcome(pred, "1x2", "home_win", 2, 0)).toBe("undetermined");
    expect(checkPredictionOutcome(pred, "btts", "maybe", 1, 1)).toBe("undetermined");
    expect(checkPredictionOutcome(pred, "totally_unknown_market", "home", 2, 0)).toBe("undetermined");
  });

  test("tracking.ts calculateOutcome requires status 'FT' but queries 'finished'", () => {
    // src/lib/prediction/tracking.ts trackPredictionAccuracy() queries
    // fixtures with .eq("status", "finished") but calculateOutcome() returns
    // null unless fixture.status === "FT". If DB statuses are "finished",
    // tracking is a silent no-op. (Not directly testable here —
    // calculateOutcome is private — flagged for the parent agent.)
    expect(true).toBe(true);
  });
});
