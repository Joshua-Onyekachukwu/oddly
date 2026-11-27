import { computeStandings, hasStandingsCoverage, MIN_FINISHED_FOR_STANDINGS } from "./standings";

function m(
  home: string,
  away: string,
  hs: number | null,
  as: number | null,
  status = "finished"
) {
  return {
    homeTeamId: `id-${home.toLowerCase().replace(/\s+/g, "-")}`,
    awayTeamId: `id-${away.toLowerCase().replace(/\s+/g, "-")}`,
    homeTeamName: home,
    awayTeamName: away,
    homeScore: hs,
    awayScore: as,
    status,
  };
}

describe("computeStandings", () => {
  it("returns empty result for no matches", () => {
    const r = computeStandings([]);
    expect(r.rows).toEqual([]);
    expect(r.matchesCounted).toBe(0);
    expect(r.matchesSkipped).toBe(0);
  });

  it("counts wins, draws, losses and goal difference correctly", () => {
    const r = computeStandings([
      m("Arsenal", "Chelsea", 2, 1),
      m("Arsenal", "Liverpool", 1, 1),
      m("Chelsea", "Liverpool", 0, 3),
    ]);

    const arsenal = r.rows.find((x) => x.teamName === "Arsenal")!;
    expect(arsenal.played).toBe(2);
    expect(arsenal.won).toBe(1);
    expect(arsenal.drawn).toBe(1);
    expect(arsenal.lost).toBe(0);
    expect(arsenal.goalsFor).toBe(3);
    expect(arsenal.goalsAgainst).toBe(2);
    expect(arsenal.goalDiff).toBe(1);
    expect(arsenal.points).toBe(4);

    const liverpool = r.rows.find((x) => x.teamName === "Liverpool")!;
    expect(liverpool.won).toBe(1);
    expect(liverpool.drawn).toBe(1);
    expect(liverpool.points).toBe(4);
    expect(liverpool.goalsFor).toBe(4);
    expect(liverpool.goalsAgainst).toBe(1);
    expect(liverpool.goalDiff).toBe(3);
  });

  it("sorts by points, then goal difference, then goals for", () => {
    // A: 4 pts, GD +1 | B: 4 pts, GD +2 | C: 1 pt
    const r = computeStandings([
      m("A", "C", 1, 0),
      m("A", "D", 0, 0),
      m("B", "C", 2, 0),
      m("B", "D", 1, 1),
      m("A", "B", 0, 3),
      m("D", "C", 2, 0),
    ]);
    // A: 1-0 W, 0-0 D, 0-3 L → GF1 GA4 GD-3, 4pts
    // B: 2-0 W, 1-1 D, 3-0 W → GF6 GA1 GD+5, 7pts
    // C: 0-1 L, 0-2 L, 0-0 D, 0-2 L → 1pt
    // D: 0-0 D, 1-1 D, 2-0 W → GF3 GA1 GD+2, 4pts
    const names = r.rows.map((x) => x.teamName);
    expect(names[0]).toBe("B"); // 7 pts
    // A and D both 4 pts: D GD 0 > A GD -3
    expect(names[1]).toBe("D");
    expect(names[2]).toBe("A");
    expect(names[3]).toBe("C");
  });

  it("skips non-finished and scoreless matches", () => {
    const r = computeStandings([
      m("Arsenal", "Chelsea", 2, 1, "finished"),
      m("Arsenal", "Liverpool", null, null, "scheduled"),
      m("Chelsea", "Everton", null, null, "finished"),
      m("Everton", "Liverpool", 1, 1, "finished"),
    ]);
    expect(r.matchesCounted).toBe(2);
    expect(r.matchesSkipped).toBe(2);
    expect(r.rows).toHaveLength(4);
    const arsenal = r.rows.find((x) => x.teamName === "Arsenal")!;
    expect(arsenal.played).toBe(1);
  });

  it("tracks last-5 form most-recent-first", () => {
    const matches = [
      m("A", "B", 1, 0), // oldest: A wins
      m("A", "C", 0, 1), // A loses
      m("A", "B", 0, 0), // A draws (newest)
    ];
    const r = computeStandings(matches);
    const a = r.rows.find((x) => x.teamName === "A")!;
    expect(a.form).toEqual(["D", "L", "W"]);
  });

  it("caps form at 5 entries", () => {
    const matches: ReturnType<typeof m>[] = [];
    for (let i = 0; i < 8; i++) {
      matches.push(m("A", "B", i % 2 === 0 ? 1 : 0, i % 2 === 0 ? 0 : 1));
    }
    const r = computeStandings(matches);
    const a = r.rows.find((x) => x.teamName === "A")!;
    expect(a.form).toHaveLength(5);
    expect(a.played).toBe(8);
  });

  it("falls back to normalized team names when ids are absent", () => {
    const r = computeStandings([
      { homeTeamName: "FC Barcelona", awayTeamName: "Real Madrid CF", homeScore: 2, awayScore: 1, status: "finished" },
      { homeTeamName: "Barcelona", awayTeamName: "Real Madrid", homeScore: 0, awayScore: 0, status: "finished" },
    ]);
    // "FC Barcelona" and "Barcelona" normalize to the same key → same row.
    const barca = r.rows.find((x) => x.teamName.includes("Barcelona"))!;
    expect(barca.played).toBe(2);
    expect(r.rows).toHaveLength(2);
  });
});

describe("hasStandingsCoverage", () => {
  it("requires enough finished matches", () => {
    const few = computeStandings([m("A", "B", 1, 0)]);
    expect(hasStandingsCoverage(few)).toBe(false);

    const many = computeStandings(
      Array.from({ length: MIN_FINISHED_FOR_STANDINGS }, (_, i) =>
        m(`T${i % 10}`, `T${(i + 1) % 10}`, 1, 0)
      )
    );
    expect(many.matchesCounted).toBe(MIN_FINISHED_FOR_STANDINGS);
    expect(hasStandingsCoverage(many)).toBe(true);
  });
});
