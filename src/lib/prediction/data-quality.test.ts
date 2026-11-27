import {
  scoreDataQuality,
  collectDataQuality,
  applyDataQualityToTier,
  probabilityTier,
  type DataQualitySignals,
} from "./data-quality";

const NOW = new Date("2026-03-01T12:00:00Z");
const KICKOFF = "2026-03-03T15:00:00Z"; // ~51h after NOW

function baseSignals(overrides: Partial<DataQualitySignals> = {}): DataQualitySignals {
  return {
    homeHistory: { matchesPlayed: 30, lastMatchAt: "2026-02-28T15:00:00Z" },
    awayHistory: { matchesPlayed: 25, lastMatchAt: "2026-03-01T15:00:00Z" },
    injury: {
      hasFixtureFeatures: true,
      freshnessHours: 12,
      confidence: 0.8,
      rawAvailabilityRows: 0,
    },
    odds: {
      snapshotCount: 20,
      lastSnapshotAt: "2026-03-01T10:00:00Z",
      distinctBookmakers: 3,
    },
    xg: {
      homeMatches: 4,
      awayMatches: 4,
      latestMatchDate: "2026-02-27",
    },
    lineup: { confirmed: false }, // no lineup source exists yet
    now: NOW,
    kickoffTime: KICKOFF,
    ...overrides,
  };
}

describe("scoreDataQuality", () => {
  it("returns a high verdict with rich, fresh inputs", () => {
    const dq = scoreDataQuality(baseSignals());
    expect(dq.score).toBeGreaterThanOrEqual(0.7);
    expect(dq.verdict).toBe("high");
    expect(dq.missing).not.toContain("odds_history");
    expect(dq.missing).not.toContain("injury_data");
    // Lineups have no source — must always be flagged missing.
    expect(dq.missing).toContain("confirmed_lineups");
    expect(dq.components.lineup_coverage).toBe(0);
  });

  it("is 'insufficient' when a team has zero finished history", () => {
    const dq = scoreDataQuality(
      baseSignals({ awayHistory: { matchesPlayed: 0, lastMatchAt: null } })
    );
    expect(dq.verdict).toBe("insufficient");
    expect(dq.missing).toContain("away_history");
    expect(dq.components.history_coverage).toBe(0);
  });

  it("is 'insufficient' when everything is missing", () => {
    const dq = scoreDataQuality(
      baseSignals({
        homeHistory: { matchesPlayed: 0, lastMatchAt: null },
        awayHistory: { matchesPlayed: 0, lastMatchAt: null },
        injury: { hasFixtureFeatures: false, freshnessHours: null, confidence: null, rawAvailabilityRows: 0 },
        odds: { snapshotCount: 0, lastSnapshotAt: null, distinctBookmakers: 0 },
        xg: { homeMatches: 0, awayMatches: 0, latestMatchDate: null },
        lineup: { confirmed: false },
      })
    );
    expect(dq.verdict).toBe("insufficient");
    expect(dq.score).toBeLessThan(0.25);
    expect(dq.missing).toEqual(
      expect.arrayContaining(["home_history", "away_history", "injury_data", "odds_history", "xg_data"])
    );
  });

  it("gives partial injury credit from raw availability rows", () => {
    const dq = scoreDataQuality(
      baseSignals({
        injury: { hasFixtureFeatures: false, freshnessHours: null, confidence: null, rawAvailabilityRows: 5 },
      })
    );
    expect(dq.components.injury_coverage).toBeCloseTo(0.3, 3);
    expect(dq.missing).toContain("injury_features");
  });

  it("decays odds coverage when snapshots are stale relative to kickoff", () => {
    const fresh = scoreDataQuality(baseSignals());
    const stale = scoreDataQuality(
      baseSignals({
        odds: {
          snapshotCount: 20,
          lastSnapshotAt: "2026-02-20T10:00:00Z", // ~9 days before kickoff
          distinctBookmakers: 3,
        },
      })
    );
    expect(stale.components.odds_coverage).toBeLessThan(fresh.components.odds_coverage);
    expect(stale.missing).toContain("stale_odds");
  });

  it("scores 'low'/'medium' for middling coverage", () => {
    const dq = scoreDataQuality(
      baseSignals({
        homeHistory: { matchesPlayed: 8, lastMatchAt: "2026-02-20T15:00:00Z" },
        awayHistory: { matchesPlayed: 6, lastMatchAt: "2026-02-21T15:00:00Z" },
        injury: { hasFixtureFeatures: false, freshnessHours: null, confidence: null, rawAvailabilityRows: 0 },
        odds: { snapshotCount: 3, lastSnapshotAt: "2026-03-01T10:00:00Z", distinctBookmakers: 1 },
        xg: { homeMatches: 0, awayMatches: 0, latestMatchDate: null },
      })
    );
    expect(["low", "medium"]).toContain(dq.verdict);
    expect(dq.missing).toEqual(
      expect.arrayContaining(["injury_data", "xg_data", "confirmed_lineups"])
    );
  });

  it("component scores stay within [0,1] and score is their weighted sum", () => {
    const dq = scoreDataQuality(baseSignals());
    for (const v of Object.values(dq.components)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    const weights = {
      history_coverage: 0.25,
      injury_coverage: 0.2,
      odds_coverage: 0.2,
      xg_coverage: 0.1,
      lineup_coverage: 0.1,
      freshness: 0.15,
    };
    const recomputed = Object.entries(weights).reduce(
      (acc, [k, w]) => acc + w * dq.components[k as keyof typeof weights],
      0
    );
    expect(dq.score).toBeCloseTo(Math.round(recomputed * 1000) / 1000, 3);
  });
});

describe("applyDataQualityToTier (abstention)", () => {
  const dq = (verdict: "high" | "medium" | "low" | "insufficient", score = 0.5) =>
    ({ score, components: {} as any, missing: [], verdict });

  it("insufficient forces LOW regardless of probability", () => {
    expect(applyDataQualityToTier("ELITE", dq("insufficient"))).toBe("LOW");
    expect(applyDataQualityToTier("HIGH", dq("insufficient"))).toBe("LOW");
  });

  it("low caps ELITE/HIGH at MEDIUM", () => {
    expect(applyDataQualityToTier("ELITE", dq("low"))).toBe("MEDIUM");
    expect(applyDataQualityToTier("HIGH", dq("low"))).toBe("MEDIUM");
    expect(applyDataQualityToTier("MEDIUM", dq("low"))).toBe("MEDIUM");
    expect(applyDataQualityToTier("LOW", dq("low"))).toBe("LOW");
  });

  it("medium/high verdicts leave the tier unchanged", () => {
    expect(applyDataQualityToTier("ELITE", dq("high"))).toBe("ELITE");
    expect(applyDataQualityToTier("HIGH", dq("medium"))).toBe("HIGH");
  });

  it("probabilityTier matches the SQL backfill bands", () => {
    expect(probabilityTier(0.75)).toBe("ELITE");
    expect(probabilityTier(0.65)).toBe("HIGH");
    expect(probabilityTier(0.55)).toBe("MEDIUM");
    expect(probabilityTier(0.4)).toBe("LOW");
  });
});

describe("collectDataQuality (mocked supabase)", () => {
  function mockSupabase(tables: Record<string, any[]>) {
    return {
      from: (table: string) => {
        const rows = tables[table] ?? [];
        const api: any = {
          _rows: rows,
          select: () => api,
          eq: () => api,
          in: () => api,
          or: () => api,
          gte: () => api,
          lte: () => api,
          order: () => api,
          limit: (n: number) => Promise.resolve({ data: api._rows.slice(0, n), error: null }),
        };
        // Make the chain thenable at every step: awaiting mid-chain resolves rows.
        api.then = (resolve: any) =>
          Promise.resolve({ data: api._rows, error: null }).then(resolve);
        return api;
      },
    };
  }

  const fixture = {
    id: "fx1",
    kickoff_time: KICKOFF,
    league_id: "lg1",
    home_team_id: "th",
    away_team_id: "ta",
    home_name: "Home FC",
    away_name: "Away FC",
  };

  it("produces a result per fixture and respects the 1000-row cap shape", async () => {
    const sb = mockSupabase({
      fixtures: [
        { home_team_id: "th", away_team_id: "tx", kickoff_time: "2026-02-20T00:00:00Z" },
        { home_team_id: "ta", away_team_id: "ty", kickoff_time: "2026-02-21T00:00:00Z" },
      ],
      fixture_injury_features: [
        { fixture_id: "fx1", confidence_score: 0.7, data_freshness_hours: 5, snapshot_date: "2026-02-28T00:00:00Z" },
      ],
      player_availability: [],
      odds_snapshots: [
        { fixture_id: "fx1", snapshot_time: "2026-03-01T09:00:00Z", bookmaker: "b1" },
      ],
      xg_features: [],
    });

    const map = await collectDataQuality([fixture], sb as any, NOW);
    expect(map.has("fx1")).toBe(true);
    const dq = map.get("fx1")!;
    // 1 finished match per team → 1/20 saturation.
    expect(dq.components.history_coverage).toBeCloseTo(0.05, 3);
    // Sparse history + thin odds → 'low' (not 'insufficient': both teams
    // do have some finished history).
    expect(dq.verdict).toBe("low");
    expect(dq.missing).toContain("confirmed_lineups");
  });

  it("returns an empty map for no fixtures without querying", async () => {
    const map = await collectDataQuality([], mockSupabase({}) as any, NOW);
    expect(map.size).toBe(0);
  });
});
