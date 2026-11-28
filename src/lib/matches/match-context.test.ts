import {
  attachXGToMeetings,
  buildPredictedLineup,
  buildPredictionContext,
  countXGMatches,
  deriveH2HMeetings,
  findTeamProfile,
  groupInjuriesByTeam,
  joinInjuriesToImportance,
  summarizeOdds,
  type H2HFixtureRow,
  type InjuryRow,
  type ImportanceRow,
  type XGFeatureRow,
} from "./match-context";

// ─── deriveH2HMeetings ────────────────────────────────────────────────────

const HOME = "team-home";
const AWAY = "team-away";

function fx(partial: Partial<H2HFixtureRow>): H2HFixtureRow {
  return {
    id: "f1",
    home_team_id: HOME,
    away_team_id: AWAY,
    kickoff_time: "2025-01-01T00:00:00Z",
    status: "finished",
    home_score: 1,
    away_score: 0,
    ...partial,
  };
}

describe("deriveH2HMeetings", () => {
  it("returns finished meetings in either venue order, newest first", () => {
    const rows = [
      fx({ id: "old", kickoff_time: "2024-01-01T00:00:00Z", home_score: 2, away_score: 1 }),
      fx({ id: "new", kickoff_time: "2025-06-01T00:00:00Z", home_score: 0, away_score: 0 }),
      // swapped venue
      fx({ id: "swap", home_team_id: AWAY, away_team_id: HOME, kickoff_time: "2024-06-01T00:00:00Z" }),
      // not finished — excluded
      fx({ id: "sched", status: "scheduled", kickoff_time: "2026-01-01T00:00:00Z" }),
      // unrelated pairing — excluded
      fx({ id: "other", home_team_id: "x", away_team_id: "y", kickoff_time: "2025-01-01T00:00:00Z" }),
    ];
    const out = deriveH2HMeetings(rows, HOME, AWAY, 5);
    expect(out.map((m) => m.fixture_id)).toEqual(["new", "swap", "old"]);
    expect(out[1].home_team_id).toBe(AWAY);
  });

  it("respects the limit", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      fx({ id: `f${i}`, kickoff_time: `2025-0${(i % 9) + 1}-01T00:00:00Z` })
    );
    expect(deriveH2HMeetings(rows, HOME, AWAY, 5)).toHaveLength(5);
  });

  it("returns empty for no data", () => {
    expect(deriveH2HMeetings([], HOME, AWAY)).toEqual([]);
  });
});

// ─── attachXGToMeetings ───────────────────────────────────────────────────

describe("attachXGToMeetings", () => {
  const meetings = deriveH2HMeetings(
    [fx({ id: "m1" }), fx({ id: "m2", kickoff_time: "2024-01-01T00:00:00Z" })],
    HOME,
    AWAY
  );

  it("attaches xG when both sides have linked rows", () => {
    const rows: XGFeatureRow[] = [
      { fixture_id: "m1", team_name: "Home FC", team_name_normalized: "home fc", is_home: true, xg_for: 1.8, xg_against: 0.4 },
      { fixture_id: "m1", team_name: "Away FC", team_name_normalized: "away fc", is_home: false, xg_for: 0.6, xg_against: 2.1 },
    ];
    const { meetings: out, withXg } = attachXGToMeetings(meetings, rows, "home fc", "away fc");
    expect(withXg).toBe(1);
    expect(out[0].xg).toEqual({ home_for: 1.8, home_against: 0.4, away_for: 0.6, away_against: 2.1 });
    expect(out[1].xg).toBeNull();
  });

  it("falls back to normalized team-name matching when is_home missing", () => {
    const rows: XGFeatureRow[] = [
      { fixture_id: "m1", team_name: "Home FC", is_home: null, xg_for: 2.0, xg_against: 1.0 },
      { fixture_id: "m1", team_name: "Away FC", is_home: null, xg_for: 1.0, xg_against: 2.0 },
    ];
    const { meetings: out, withXg } = attachXGToMeetings(meetings, rows, "home fc", "away fc");
    expect(withXg).toBe(1);
    expect(out[0].xg?.home_for).toBe(2.0);
    expect(out[0].xg?.away_for).toBe(1.0);
  });

  it("leaves xg null when only one side has data", () => {
    const rows: XGFeatureRow[] = [
      { fixture_id: "m1", team_name: "Home FC", is_home: true, xg_for: 1.5, xg_against: 0.5 },
    ];
    const { meetings: out, withXg } = attachXGToMeetings(meetings, rows, "home fc", "away fc");
    expect(withXg).toBe(0);
    expect(out[0].xg).toBeNull();
  });
});

// ─── findTeamProfile / countXGMatches ─────────────────────────────────────

describe("findTeamProfile", () => {
  const profiles = [
    { team_name: "Wolverhampton Wanderers", attack_rating: 60 },
    { team_name: "Arsenal", attack_rating: 80 },
  ];
  it("matches through provider-name variants via normalizer", () => {
    expect(findTeamProfile(profiles, "Wolves")?.attack_rating).toBe(60);
    expect(findTeamProfile(profiles, "Arsenal")?.attack_rating).toBe(80);
  });
  it("returns null when absent", () => {
    expect(findTeamProfile(profiles, "Real Madrid")).toBeNull();
    expect(findTeamProfile(profiles, null)).toBeNull();
  });
});

describe("countXGMatches", () => {
  it("counts rows per normalized team key", () => {
    const rows = [
      { team_name: "Arsenal", team_name_normalized: "arsenal" },
      { team_name: "Arsenal", team_name_normalized: "arsenal" },
      { team_name: "Chelsea", team_name_normalized: "chelsea" },
      { team_name: "The Gunners", team_name_normalized: null }, // normalizes to arsenal via alias
    ];
    expect(countXGMatches(rows, "arsenal")).toBe(3);
    expect(countXGMatches(rows, "chelsea")).toBe(1);
  });
});

// ─── injuries join ────────────────────────────────────────────────────────

describe("joinInjuriesToImportance", () => {
  const injuries: InjuryRow[] = [
    { team_name: "Arsenal", player_name: "W. Saliba", status: "injured", injury_type: "knee", expected_return: "4 weeks", matches_missed: 2, player_importance: 8 },
    { team_name: "Arsenal", player_name: "Unknown Kid", status: "doubtful" },
  ];
  const importance: ImportanceRow[] = [
    { team_name: "Arsenal", player_name: "William Saliba", score_0_1: 0.82, score_1_10: 8.2, confidence: "stats", method: "performance stats" },
  ];

  it("joins importance via normalized person key", () => {
    const out = joinInjuriesToImportance(injuries, importance);
    expect(out).toHaveLength(2);
    const saliba = out.find((p) => p.player_name === "W. Saliba")!;
    expect(saliba.importance_score).toBeCloseTo(0.82);
    expect(saliba.importance_1_10).toBeCloseTo(8.2);
    expect(saliba.confidence).toBe("stats");
  });

  it("sorts by importance descending and falls back to legacy score", () => {
    const out = joinInjuriesToImportance(injuries, importance);
    expect(out[0].player_name).toBe("W. Saliba");
    const kid = out.find((p) => p.player_name === "Unknown Kid")!;
    expect(kid.importance_score).toBeNull();
    expect(kid.importance_1_10).toBeNull();
  });

  it("uses injury row's legacy player_importance when no importance match", () => {
    const out = joinInjuriesToImportance(
      [{ team_name: "Chelsea", player_name: "N. Jackson", status: "out", player_importance: 6.5 }],
      []
    );
    expect(out[0].importance_1_10).toBe(6.5);
    expect(out[0].importance_score).toBeNull();
  });
});

describe("groupInjuriesByTeam", () => {
  it("splits rows by normalized team name", () => {
    const rows: InjuryRow[] = [
      { team_name: "Arsenal", player_name: "A", status: "out" },
      { team_name: "The Gunners", player_name: "B", status: "out" }, // normalizes to arsenal
      { team_name: "Chelsea", player_name: "C", status: "out" },
    ];
    const g = groupInjuriesByTeam(rows, "arsenal", "chelsea");
    expect(g.home.map((r) => r.player_name)).toEqual(["A", "B"]);
    expect(g.away.map((r) => r.player_name)).toEqual(["C"]);
  });
});

// ─── buildPredictionContext ───────────────────────────────────────────────

describe("buildPredictionContext", () => {
  it("returns null with no rows", () => {
    expect(buildPredictionContext([])).toBeNull();
  });

  it("picks the latest row and extracts input_snapshot highlights", () => {
    const rows = [
      {
        id: "old",
        market: "1x2",
        selection: "home",
        model_probability: 0.5,
        created_at: "2025-01-01T00:00:00Z",
        input_snapshot: { home_elo: 1400 },
      },
      {
        id: "new",
        market: "1x2",
        selection: "home",
        model_probability: 0.55,
        model_version: "v2",
        confidence_tier: "HIGH",
        data_quality_score: 82,
        data_quality_breakdown: { verdict: "high", components: {} },
        created_at: "2025-02-01T00:00:00Z",
        input_snapshot: {
          home_elo: 1550,
          away_elo: 1480,
          home_form: ["W", "D", "W"],
          away_form: ["L", "W"],
          injury: { home_impact: 0.2 },
          league_gate: "include",
          captured_at: "2025-02-01T00:00:00Z",
        },
      },
    ];
    const ctx = buildPredictionContext(rows)!;
    expect(ctx.model_probability).toBe(0.55);
    expect(ctx.data_quality_verdict).toBe("high");
    expect(ctx.input?.home_elo).toBe(1550);
    expect(ctx.input?.away_elo).toBe(1480);
    expect(ctx.input?.league_gate).toBe("include");
    expect(ctx.input?.home_form).toEqual(["W", "D", "W"]);
  });

  it("handles missing input_snapshot gracefully", () => {
    const ctx = buildPredictionContext([{ market: "over_under", selection: "over", created_at: "2025-01-01" }])!;
    expect(ctx.input).toBeNull();
    expect(ctx.data_quality_verdict).toBeNull();
  });
});

// ─── summarizeOdds ────────────────────────────────────────────────────────

describe("summarizeOdds", () => {
  it("computes opening/latest odds and bookmaker count per market+selection", () => {
    const rows = [
      { market: "1x2", selection: "home", odds: 2.0, bookmaker: "A", snapshot_time: "2025-01-01T00:00:00Z" },
      { market: "1x2", selection: "home", odds: 1.8, bookmaker: "A", snapshot_time: "2025-01-03T00:00:00Z" },
      { market: "1x2", selection: "home", odds: 1.9, bookmaker: "B", snapshot_time: "2025-01-02T00:00:00Z" },
      { market: "1x2", selection: "away", odds: 3.5, bookmaker: "A", snapshot_time: "2025-01-01T00:00:00Z" },
    ];
    const out = summarizeOdds(rows);
    const home = out.find((o) => o.selection === "home")!;
    expect(home.opening_odds).toBe(2.0);
    // latest by snapshot_time is the 1.8 row (Jan 3)
    expect(home.latest_odds).toBe(1.8);
    expect(home.bookmakers).toBe(2);
    const away = out.find((o) => o.selection === "away")!;
    expect(away.latest_odds).toBe(3.5);
    expect(away.bookmakers).toBe(1);
  });

  it("returns empty for no snapshots", () => {
    expect(summarizeOdds([])).toEqual([]);
  });
});

// ─── buildPredictedLineup ────────────────────────────────────────────────

describe("buildPredictedLineup", () => {
  const NAMES = [
    "Bukayo Saka", "Martin Odegaard", "Declan Rice", "William Saliba",
    "Gabriel Magalhaes", "Ben White", "Takehiro Tomiyasu", "Aaron Ramsdale",
    "Gabriel Martinelli", "Kai Havertz", "Leandro Trossard", "Jurrien Timber",
    "Jurriën Timber", "Myles Lewis-Skelly", "Ethan Nwaneri",
  ];
  const squad = (n: number, team = "Arsenal"): ImportanceRow[] =>
    Array.from({ length: n }, (_, i) => ({
      team_name: team,
      player_name: NAMES[i % NAMES.length],
      score_1_10: Number((9 - i * 0.3).toFixed(1)),
      confidence: "high",
    }));

  it("returns null when the team has no importance rows", () => {
    expect(buildPredictedLineup([], "arsenal", [], "high" as never)).toBeNull();
    expect(buildPredictedLineup(squad(3, "Chelsea"), "arsenal", [])).toBeNull();
  });

  it("ranks by score_1_10 desc and caps starters at 11", () => {
    const lu = buildPredictedLineup(squad(15), "arsenal", [])!;
    expect(lu.starters).toHaveLength(11);
    // 15 rows but "Jurrien/Jurriën Timber" share a personKey → 14 candidates
    expect(lu.bench).toHaveLength(3);
    expect(lu.starters[0].player_name).toBe("Bukayo Saka");
    expect(lu.squad_size).toBe(14);
  });

  it("excludes injured and suspended players into unavailable", () => {
    const injuries = [
      { player_name: "Bukayo Saka", status: "injured", importance_1_10: 9.5 },
      { player_name: "Martin Odegaard", status: "suspended", importance_1_10: 9.2 },
    ];
    const lu = buildPredictedLineup(squad(15), "arsenal", injuries as any)!;
    expect(lu.starters.map((p) => p.player_name)).not.toContain("Bukayo Saka");
    expect(lu.starters.map((p) => p.player_name)).not.toContain("Martin Odegaard");
    expect(lu.starters[0].player_name).toBe("Declan Rice");
    expect(lu.unavailable.map((u) => u.player_name)).toEqual(["Bukayo Saka", "Martin Odegaard"]);
  });

  it("keeps doubtful players eligible but flags them", () => {
    const injuries = [
      { player_name: "Declan Rice", status: "doubtful", importance_1_10: 8.9 },
    ];
    const lu = buildPredictedLineup(squad(15), "arsenal", injuries as any)!;
    const p = lu.starters.find((pl) => pl.player_name === "Declan Rice");
    expect(p).toBeDefined();
    expect(p!.doubtful).toBe(true);
    expect(lu.unavailable).toHaveLength(0);
  });

  it("matches team names through normalization and person keys", () => {
    const rows: ImportanceRow[] = [
      { team_name: "Wolverhampton Wanderers", player_name: "R. Jimenez", score_1_10: 8 },
      { team_name: "Wolves", player_name: "T. Gomes", score_1_10: 7 },
      { team_name: "Arsenal", player_name: "B. Saka", score_1_10: 9 },
    ];
    const lu = buildPredictedLineup(rows, "wolves", [])!;
    expect(lu.starters.map((p) => p.player_name)).toEqual(["R. Jimenez", "T. Gomes"]);
  });

  // ── appearance-driven ranking ─────────────────────────────────────────

  const app = (
    player: string,
    pkey: string,
    team: string,
    date: string,
    starter = true
  ) => ({
    player_name: player,
    player_name_normalized: pkey,
    team_name_normalized: team,
    is_starter: starter,
    match_date: date,
  });

  it("prefers recent starters over higher-importance never-started players", () => {
    // Saka has the top importance score but never started; Nwaneri started
    // every recent match.
    const apps = [
      app("Ethan Nwaneri", "nwaneri|e", "arsenal", "2026-11-01"),
      app("Ethan Nwaneri", "nwaneri|e", "arsenal", "2026-11-08"),
      app("Ethan Nwaneri", "nwaneri|e", "arsenal", "2026-11-15"),
    ];
    const lu = buildPredictedLineup(squad(15), "arsenal", [], 11, 7, apps)!;
    expect(lu.lineup_basis).toBe("appearances");
    expect(lu.starters[0].player_name).toBe("Ethan Nwaneri");
    expect(lu.starters[0].recent_starts).toBe(3);
    // never-started players still fill remaining spots by importance
    expect(lu.starters.slice(1).map((p) => p.player_name)).toContain("Bukayo Saka");
    expect(lu.appearance_matches).toBe(3);
  });

  it("ranks by start frequency, then importance score", () => {
    const apps = [
      app("Kai Havertz", "havertz|k", "arsenal", "2026-11-01"),
      app("Kai Havertz", "havertz|k", "arsenal", "2026-11-08"),
      app("Kai Havertz", "havertz|k", "arsenal", "2026-11-15"),
      // Timber started twice — fewer than Havertz's three
      app("Jurriën Timber", "timber|j", "arsenal", "2026-11-01"),
      app("Jurriën Timber", "timber|j", "arsenal", "2026-11-08"),
    ];
    const lu = buildPredictedLineup(squad(15), "arsenal", [], 11, 7, apps)!;
    const names = lu.starters.map((p) => p.player_name);
    expect(names.indexOf("Kai Havertz")).toBeLessThan(names.indexOf("Jurriën Timber"));
    // both outrank never-started players
    expect(names.indexOf("Jurriën Timber")).toBeLessThan(names.indexOf("Bukayo Saka"));
  });

  it("includes appearance-only players missing from player_importance", () => {
    const apps = [
      app("New Signing", "signing|n", "arsenal", "2026-11-01"),
      app("New Signing", "signing|n", "arsenal", "2026-11-08"),
    ];
    const lu = buildPredictedLineup(squad(15), "arsenal", [], 11, 7, apps)!;
    expect(lu.starters[0].player_name).toBe("New Signing");
    expect(lu.starters[0].score_1_10).toBeNull();
    expect(lu.squad_size).toBe(15); // 14 unique importance keys + 1 appearance-only
  });

  it("only counts the last 10 distinct match dates", () => {
    // 11 matches: player A starts in the oldest only, player B in the 10 newest.
    const apps = [app("Bukayo Saka", "saka|b", "arsenal", "2025-01-01")];
    for (let i = 0; i < 10; i++) {
      apps.push(app("Myles Lewis-Skelly", "skelly|m", "arsenal", `2026-10-${String(i + 1).padStart(2, "0")}`));
    }
    const lu = buildPredictedLineup(squad(15), "arsenal", [], 11, 7, apps)!;
    expect(lu.appearance_matches).toBe(10);
    expect(lu.starters[0].player_name).toBe("Myles Lewis-Skelly");
    // Saka's single start is outside the window → importance order applies
    expect(lu.starters[0].recent_starts).toBe(10);
  });

  it("still applies injury exclusions to appearance-driven lineups", () => {
    const apps = [
      app("Ethan Nwaneri", "nwaneri|e", "arsenal", "2026-11-01"),
      app("Ethan Nwaneri", "nwaneri|e", "arsenal", "2026-11-08"),
    ];
    const injuries = [{ player_name: "Ethan Nwaneri", status: "injured" }];
    const lu = buildPredictedLineup(squad(15), "arsenal", injuries as any, 11, 7, apps)!;
    expect(lu.starters.map((p) => p.player_name)).not.toContain("Ethan Nwaneri");
    expect(lu.unavailable.map((u) => u.player_name)).toContain("Ethan Nwaneri");
  });

  it("resolves appearance team keys through APPEARANCE_TEAM_KEY_ALIASES", () => {
    // Our canonical "Hertha" normalizes to 'hertha', but StatsBomb rows are
    // stored under 'hertha berlin'.
    const rows: ImportanceRow[] = [
      { team_name: "Hertha", player_name: "A. Player", score_1_10: 8 },
      { team_name: "Hertha", player_name: "B. Player", score_1_10: 7 },
    ];
    const apps = [
      {
        player_name: "A. Player",
        player_name_normalized: "player|a",
        team_name_normalized: "hertha berlin",
        is_starter: true,
        match_date: "2026-11-01",
      },
    ];
    const lu = buildPredictedLineup(rows, "hertha", [], 11, 7, apps)!;
    expect(lu.lineup_basis).toBe("appearances");
    expect(lu.starters[0].player_name).toBe("A. Player");
    expect(lu.appearance_matches).toBe(1);
  });

  it("falls back to lineup_basis 'importance' with no usable appearances", () => {
    const apps = [
      // other team only
      app("Someone", "else|s", "chelsea", "2026-11-01"),
      // substitute appearance only (not a start)
      app("Jurrien Timber", "timber|j", "arsenal", "2026-11-01", false),
    ];
    const lu = buildPredictedLineup(squad(15), "arsenal", [], 11, 7, apps)!;
    expect(lu.lineup_basis).toBe("importance");
    expect(lu.starters[0].player_name).toBe("Bukayo Saka");
    // substitute-only + other-team rows yield no starter match dates
    expect(lu.appearance_matches).toBe(0);
  });
});
