import {
  understatMatchToTeamRows,
  understatMatchesToRows,
  computeRollingXG,
  groupTeamMatches,
  TeamMatchXG,
} from "./xg-core";
import { normalizeTeamName } from "@/lib/football/team-normalizer";

// Identity normalizer keeps tests focused on mapping logic; a second suite
// uses the real normalizer for provider-name → canonical-key mapping.
const id = (s: string) => s.toLowerCase();

describe("understatMatchToTeamRows", () => {
  const match = {
    external_id: "28778",
    home: "Liverpool",
    away: "Bournemouth",
    home_xg: 2.33007,
    away_xg: 1.57303,
    home_scored: 4,
    away_scored: 2,
    date: "2025-08-15 19:00:00",
    is_result: true,
    league: "EPL",
    league_name: "Premier League",
    season: 2025,
  };

  it("produces one row per team with correct for/against orientation", () => {
    const rows = understatMatchToTeamRows(match, id);
    expect(rows).toHaveLength(2);
    const [home, away] = rows;
    expect(home.teamName).toBe("Liverpool");
    expect(home.isHome).toBe(true);
    expect(home.xgFor).toBeCloseTo(2.33007);
    expect(home.xgAgainst).toBeCloseTo(1.57303);
    expect(home.xgDiff).toBeCloseTo(2.33007 - 1.57303);
    expect(away.teamName).toBe("Bournemouth");
    expect(away.isHome).toBe(false);
    expect(away.xgFor).toBeCloseTo(1.57303);
    expect(away.xgAgainst).toBeCloseTo(2.33007);
    expect(home.opponent).toBe("Bournemouth");
    expect(away.opponent).toBe("Liverpool");
  });

  it("normalizes dates to YYYY-MM-DD and stringifies ids/seasons", () => {
    const [row] = understatMatchToTeamRows(match, id);
    expect(row.matchDate).toBe("2025-08-15");
    expect(row.externalId).toBe("28778");
    expect(row.season).toBe("2025");
    expect(row.league).toBe("Premier League"); // prefers league_name
  });

  it("returns [] when xG is missing rather than fabricating rows", () => {
    expect(understatMatchToTeamRows({ ...match, home_xg: null }, id)).toEqual([]);
    expect(understatMatchToTeamRows({ ...match, away_xg: undefined }, id)).toEqual([]);
    expect(understatMatchToTeamRows({ ...match, date: "" }, id)).toEqual([]);
    expect(understatMatchToTeamRows({ ...match, home: "" }, id)).toEqual([]);
  });
});

describe("understatMatchesToRows", () => {
  it("maps all matches and counts skips", () => {
    const { rows, skipped } = understatMatchesToRows(
      [
        { external_id: "1", home: "A", away: "B", home_xg: 1, away_xg: 0.5, date: "2025-01-01 20:00:00" },
        { external_id: "2", home: "C", away: "D", home_xg: null, away_xg: 1, date: "2025-01-02 20:00:00" },
      ],
      id
    );
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(1);
  });
});

describe("computeRollingXG", () => {
  const hist: TeamMatchXG[] = [
    { date: "2025-01-01", isHome: true, xgFor: 1.0, xgAgainst: 2.0 },
    { date: "2025-01-08", isHome: false, xgFor: 3.0, xgAgainst: 0.0 },
    { date: "2025-01-15", isHome: true, xgFor: 2.0, xgAgainst: 1.0 },
  ];

  it("returns null for empty history (neutral fallback)", () => {
    expect(computeRollingXG([])).toBeNull();
    expect(computeRollingXG([{ date: "2025-01-01", isHome: true, xgFor: NaN, xgAgainst: 1 }])).toBeNull();
  });

  it("averages over the window and splits home/away", () => {
    const p = computeRollingXG(hist, { window: 10 })!;
    expect(p.sampleSize).toBe(3);
    expect(p.xgForAvg).toBeCloseTo(2.0);
    expect(p.xgAgainstAvg).toBeCloseTo(1.0);
    expect(p.xgDiff).toBeCloseTo(1.0);
    expect(p.homeXgForAvg).toBeCloseTo(1.5); // matches 1 & 3
    expect(p.awayXgForAvg).toBeCloseTo(3.0);
    expect(p.homeXgAgainstAvg).toBeCloseTo(1.5);
    expect(p.awayXgAgainstAvg).toBeCloseTo(0.0);
    expect(p.dataThrough).toBe("2025-01-15");
  });

  it("respects the window (most recent N matches)", () => {
    const p = computeRollingXG(hist, { window: 2 })!;
    expect(p.sampleSize).toBe(2);
    expect(p.xgForAvg).toBeCloseTo(2.5); // matches 2 & 3
    expect(p.last5XgForAvg).toBeCloseTo(2.0); // last5 still sees all 3
  });

  it("respects asOf cutoff (no look-ahead)", () => {
    const p = computeRollingXG(hist, { window: 10, asOf: "2025-01-10" })!;
    expect(p.sampleSize).toBe(2);
    expect(p.dataThrough).toBe("2025-01-08");
    expect(computeRollingXG(hist, { asOf: "2024-12-31" })).toBeNull();
  });

  it("sorts unsorted input by date", () => {
    const p = computeRollingXG([hist[2], hist[0], hist[1]], { window: 10 })!;
    expect(p.dataThrough).toBe("2025-01-15");
    expect(p.xgForAvg).toBeCloseTo(2.0);
  });
});

describe("groupTeamMatches", () => {
  it("groups rows by teamKey into per-team histories", () => {
    const { rows } = understatMatchesToRows(
      [
        { external_id: "1", home: "A", away: "B", home_xg: 1, away_xg: 0.5, date: "2025-01-01 20:00:00" },
        { external_id: "2", home: "B", away: "A", home_xg: 2, away_xg: 0.5, date: "2025-01-08 20:00:00" },
      ],
      id
    );
    const g = groupTeamMatches(rows);
    expect(g.get("a")).toHaveLength(2);
    expect(g.get("b")).toHaveLength(2);
    // Team A: home at match1 (xgFor 1.0), away at match2 (xgFor 0.5)
    const p = computeRollingXG(g.get("a")!, { window: 10 })!;
    expect(p.xgForAvg).toBeCloseTo(0.75);
    expect(p.xgAgainstAvg).toBeCloseTo(1.25);
    expect(p.homeXgForAvg).toBeCloseTo(1);
    expect(p.awayXgForAvg).toBeCloseTo(0.5);
  });
});

describe("provider name → normalized key mapping", () => {
  it("maps Understat names onto fixture canonical keys", () => {
    // Understat uses different spellings than fixtures canonical_name;
    // both must collapse to the same normalized key.
    const pairs: [string, string][] = [
      ["Athletic Club", "Athletic Bilbao"],
      ["Wolverhampton Wanderers", "Wolves"],
      ["AS Roma", "Roma"],
      ["RasenBallsport Leipzig", "RB Leipzig"],
      ["Mainz 05", "fsv mainz 05"],
      ["FC Cologne", "1.  köln"],
      ["St. Pauli", "St Pauli"],
      ["Borussia M.Gladbach", "M'gladbach"],
      ["FC Heidenheim", "Heidenheim"],
      ["AC Milan", "AC Milan"],
      ["Paris Saint Germain", "Paris Saint-Germain"],
      ["Alaves", "Alavés"],
    ];
    for (const [understat, canonical] of pairs) {
      expect(normalizeTeamName(understat)).toBe(normalizeTeamName(canonical));
    }
  });
});
