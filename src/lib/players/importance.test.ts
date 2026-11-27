import {
  buildPlayerIndex,
  computeImportance,
  normalizeName,
  performanceScore,
  personKey,
  regularityScore,
  type AbsenceRecord,
  type PlayerStatRow,
} from "./importance";

// ─── name normalization ───────────────────────────────────────────────────

describe("normalizeName / personKey", () => {
  it("strips accents, punctuation, case", () => {
    expect(normalizeName("Éder Militão")).toBe("eder militao");
    expect(normalizeName("M. Ødegaard")).toBe("m odegaard");
    expect(normalizeName("Son Heung-Min")).toBe("son heung min");
  });

  it("personKey uses last token + first initial (handles abbreviations)", () => {
    expect(personKey("W. Saliba")).toBe(personKey("William Saliba"));
    expect(personKey("A. Isak")).toBe(personKey("Alexander Isak"));
    expect(personKey("Micky van de Ven")).toBe(personKey("M. Van de Ven"));
    expect(personKey("Mohamed Salah")).toBe("salah|m");
  });
});

// ─── performanceScore ─────────────────────────────────────────────────────

describe("performanceScore", () => {
  it("scores an elite goalscorer near the top", () => {
    const row: PlayerStatRow = {
      player_name: "Mohamed Salah",
      team_name: "Liverpool",
      goals: 29,
      assists: 18,
      minutes: 3377,
      appearances: 38,
      rating: 7.8,
    };
    const { score } = performanceScore(row);
    // contrib90 = 47*90/3377 = 1.25 -> capped at 1.0 => 0.4
    // minutes 3377/3200 -> 1 => 0.3; rating (7.8-6.2)/1.6=1 => 0.15; apps 38/34 -> 1 => 0.15
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("scores a squad player mid-range", () => {
    const row: PlayerStatRow = {
      player_name: "X",
      team_name: "Y",
      goals: 2,
      assists: 3,
      minutes: 1500,
      appearances: 20,
      rating: 6.8,
    };
    const { score } = performanceScore(row);
    // contrib90 = 5*90/1500 = 0.3 -> 0.333*0.4 = 0.133
    // minutes 1500/3200 = 0.469*0.3 = 0.141; rating (6.8-6.2)/1.6=0.375*0.15=0.056; apps 20/34=0.588*0.15=0.088
    expect(score).toBeCloseTo(0.133 + 0.141 + 0.056 + 0.088, 2);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.6);
  });

  it("handles missing/zero minutes without NaN", () => {
    const { score, signals } = performanceScore({
      player_name: "Bench",
      team_name: "T",
      goals: 0,
      assists: 0,
      minutes: 0,
      appearances: 0,
      rating: null,
    });
    expect(Number.isFinite(score)).toBe(true);
    // all counting stats are 0; only the missing-rating neutral term (0.4 * 0.15)
    // contributes — a bench player must not score like a starter.
    expect(score).toBeCloseTo(0.06, 5);
    expect(signals.minutes).toBe(0);
  });
});

// ─── regularityScore ──────────────────────────────────────────────────────

describe("regularityScore", () => {
  it("floors at neutral 0.5 (absence data can't prove low importance)", () => {
    expect(regularityScore(0)).toBe(0.5);
    expect(regularityScore(1)).toBe(0.5);
    expect(regularityScore(2)).toBe(0.5);
  });

  it("only rises above neutral with real evidence, bounded at 0.75", () => {
    expect(regularityScore(3)).toBeGreaterThan(0.5);
    expect(regularityScore(30)).toBeCloseTo(0.75);
    expect(regularityScore(100)).toBeCloseTo(0.75); // clamped
    expect(regularityScore(15)).toBeGreaterThan(regularityScore(5));
    expect(regularityScore(15)).toBeLessThan(0.75);
  });
});

// ─── computeImportance tiers ──────────────────────────────────────────────

const statsRows: PlayerStatRow[] = [
  {
    player_name: "A. Isak",
    team_name: "Newcastle",
    player_id: 2864,
    goals: 23,
    assists: 6,
    minutes: 2769,
    appearances: 30,
    rating: 7.3,
  },
];

const absenceRows: AbsenceRecord[] = [
  { player_name: "W. Saliba", team_name: "Arsenal", player_id: 22090 },
  { player_name: "W. Saliba", team_name: "Arsenal", player_id: 22090 },
  { player_name: "W. Saliba", team_name: "Arsenal", player_id: 22090 },
  { player_name: "W. Saliba", team_name: "Arsenal", player_id: 22090 },
  { player_name: "B. Saka", team_name: "Arsenal", player_id: 1460 },
];

describe("computeImportance", () => {
  const index = buildPlayerIndex(statsRows, absenceRows);

  it("stats tier: full-name injury row matches abbreviated stats row via history player_id", () => {
    // "Alexander Isak" (injury feed) -> history has no Isak; stats name is
    // abbreviated "A. Isak". personKey matches last+initial directly.
    const res = computeImportance("Newcastle United", "Alexander Isak", index);
    expect(res.confidence).toBe("stats");
    expect(res.signals.goals).toBe(23);
    expect(res.score10).toBeGreaterThan(7);
  });

  it("history tier: abbreviated history name matches full injury name", () => {
    const res = computeImportance("Arsenal", "William Saliba", index);
    expect(res.confidence).toBe("history");
    expect(res.signals.matchesMissed).toBe(4);
    expect(res.score10).toBeCloseTo(regularityScore(4) * 10, 1);
    expect(res.score01).toBeGreaterThanOrEqual(0.5);
  });

  it("history tier: few absences stays at neutral (no demotion on weak evidence)", () => {
    const res = computeImportance("Arsenal", "Bukayo Saka", index);
    expect(res.confidence).toBe("history");
    expect(res.signals.matchesMissed).toBe(1);
    expect(res.score01).toBe(0.5);
  });

  it("stats tier ignores absence history (minutes already capture regularity)", () => {
    const idx2 = buildPlayerIndex(
      [
        {
          player_name: "B. Saka",
          team_name: "Arsenal",
          player_id: 1460,
          goals: 20,
          assists: 10,
          minutes: 3000,
          appearances: 35,
          rating: 7.6,
        },
      ],
      absenceRows
    );
    const res = computeImportance("Arsenal", "Bukayo Saka", idx2);
    expect(res.confidence).toBe("stats");
    expect(res.method).toBe("performance stats");
    // pure performanceScore of the stats row
    expect(res.score01).toBeCloseTo(performanceScore(idx2.statsById.get(1460)!).score, 5);
  });

  it("neutral tier: unknown player gets 0.5, never fabricated", () => {
    const res = computeImportance("Arsenal", "Totally Unknown Player", index);
    expect(res.confidence).toBe("neutral");
    expect(res.score01).toBe(0.5);
    expect(res.score10).toBe(5);
  });

  it("neutral tier: missing names do not throw", () => {
    const res = computeImportance(null, undefined, index);
    expect(res.confidence).toBe("neutral");
    expect(res.score01).toBe(0.5);
  });

  it("team name variants normalize (AFC Bournemouth vs Bournemouth)", () => {
    const idx = buildPlayerIndex(
      [
        {
          player_name: "J. Kluivert",
          team_name: "Bournemouth",
          goals: 12,
          assists: 6,
          minutes: 2356,
          appearances: 30,
          rating: 7.2,
        },
      ],
      []
    );
    const res = computeImportance("AFC Bournemouth", "Justin Kluivert", idx);
    expect(res.confidence).toBe("stats");
    expect(res.signals.goals).toBe(12);
  });
});
