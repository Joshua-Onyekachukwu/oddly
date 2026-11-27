/**
 * Tests for src/lib/sync/odds.ts — specifically the market/selection
 * normalization inside saveOddsSnapshots(), exercised end-to-end through
 * syncAllOdds() with a mocked Supabase client and mocked fetch.
 *
 * The mapping under test (saveOddsSnapshots, lines ~255-285):
 *   market "h2h"    → "match_result"
 *   market "totals" → "over_under_2.5" (or _1.5/_3.5 by outcome.point)
 *   outcome home/away team name → "home"/"away", "Draw" → "draw",
 *   "Over"/"Under" → "over"/"under"
 *   bookmaker title → lowercased
 * Plus the dedupe rule: rows identical to the latest stored snapshot are
 * skipped.
 */

const mockState: {
  client: any;
  recentSnapshots: any[];
  matchFixtures: any[];
  teamInsertCount: number;
  oddsInserts: any[][];
} = {
  client: null,
  recentSnapshots: [],
  matchFixtures: [],
  teamInsertCount: 0,
  oddsInserts: [],
};

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => mockState.client),
}));

// ─── Chainable Supabase query mock ─────────────────────────────────────
// Each .from(table) returns a thenable query builder. Method calls are
// recorded; terminal .single() resolves {data: <one>} and awaiting the
// builder resolves {data: <many>} via per-table handlers.

type Handler = (ops: string[], kind: "one" | "many", args: any[][]) => any;

const handlers: Record<string, Handler> = {
  leagues: (ops, kind) =>
    kind === "one"
      ? ops.includes("insert")
        ? { data: { id: "league-1" }, error: null }
        : { data: null, error: null } // no existing league → insert path
      : { data: [], error: null },

  teams: (ops, kind) => {
    if (kind === "one") {
      if (ops.includes("insert")) {
        mockState.teamInsertCount++;
        return { data: { id: `team-${mockState.teamInsertCount}` }, error: null };
      }
      return { data: null, error: null }; // no alias/exact match
    }
    return { data: [], error: null }; // ilike fuzzy match → nothing
  },

  team_aliases: (_ops, kind) =>
    kind === "one" ? { data: null, error: null } : { data: null, error: null },

  fixtures: (ops, kind) => {
    if (kind === "one") {
      if (ops.includes("insert")) return { data: { id: "fixture-1" }, error: null };
      return { data: null, error: null };
    }
    // matchFixture's .select(...).eq().gte().limit(100) list query
    return { data: mockState.matchFixtures, error: null };
  },

  odds_snapshots: (ops, kind, args) => {
    if (ops.includes("insert")) {
      // args = per-method argument lists; grab the insert() payload
      const idx = ops.indexOf("insert");
      mockState.oddsInserts.push(args[idx][0]);
      return { data: null, error: null };
    }
    if (ops.includes("select")) {
      return { data: mockState.recentSnapshots, error: null };
    }
    return { data: null, error: null }; // delete().eq().lt()
  },
};

function makeQuery(table: string) {
  const ops: string[] = [];
  const callArgs: any[][] = [];
  let terminalKind: "one" | "many" | null = null;

  const resolve = () =>
    (handlers[table] || (() => ({ data: null, error: null })))(
      ops,
      terminalKind || "many",
      callArgs
    );

  const q: any = {
    single() {
      terminalKind = "one";
      return Promise.resolve(resolve());
    },
    maybeSingle() {
      terminalKind = "one";
      return Promise.resolve(resolve());
    },
    then(onFulfilled: any, onRejected: any) {
      terminalKind = terminalKind || "many";
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
  };

  const methods = [
    "select", "eq", "neq", "ilike", "in", "gte", "gt", "lt", "lte",
    "order", "limit", "not", "is", "insert", "update", "delete", "upsert",
    "or", "contains", "match", "returns", "throwOnError",
  ];
  for (const m of methods) {
    q[m] = (...args: any[]) => {
      ops.push(m);
      callArgs.push(args);
      return q;
    };
  }
  return q;
}

function installSupabaseMock() {
  mockState.client = { from: (table: string) => makeQuery(table) };
}

// ─── Fixtures / fetch mock ─────────────────────────────────────────────

const ODDS_FIXTURE = {
  id: "odds-fixture-1",
  sport_key: "soccer_epl",
  sport_title: "Premier League",
  commence_time: "2025-06-01T15:00:00Z",
  home_team: "Home FC",
  away_team: "Away United",
  bookmakers: [
    {
      key: "bet365",
      title: "Bet365",
      last_update: "2025-05-30T10:00:00Z",
      markets: [
        {
          key: "h2h",
          last_update: "2025-05-30T10:00:00Z",
          outcomes: [
            { name: "Home FC", price: 1.9 },
            { name: "Draw", price: 3.4 },
            { name: "Away United", price: 4.2 },
          ],
        },
        {
          key: "totals",
          last_update: "2025-05-30T10:00:00Z",
          outcomes: [
            { name: "Over", price: 1.95, point: 2.5 },
            { name: "Under", price: 1.85, point: 2.5 },
            { name: "Over", price: 2.6, point: 3.5 },
            { name: "Under", price: 1.5, point: 1.5 },
          ],
        },
      ],
    },
  ],
};

let syncAllOdds: any;
let mapOutcomeToSnapshot: any;

beforeAll(() => {
  process.env.THE_ODDS_API_KEY = "test-odds-key";
  installSupabaseMock();
  // Require AFTER env + supabase mock are in place — the module reads
  // THE_ODDS_API_KEY and creates the supabase client at import time.
  const mod = require("./odds");
  syncAllOdds = mod.syncAllOdds;
  mapOutcomeToSnapshot = mod.mapOutcomeToSnapshot;
});

beforeEach(() => {
  mockState.recentSnapshots = [];
  mockState.matchFixtures = [];
  mockState.teamInsertCount = 0;
  mockState.oddsInserts = [];
  jest.restoreAllMocks();
  delete process.env.ODDS_MARKETS;
  delete process.env.ODDS_EXTRA_MARKETS;
  delete process.env.ODDS_EXTRA_CREDIT_BUDGET;
  delete process.env.ODDS_EXTRA_MAX_EVENTS;
  delete process.env.ODDS_QUOTA_RESERVE;
});

function jsonResponse(body: any, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (k: string) => headers[k] ?? null },
  } as any;
}

// Routes fetch calls by URL:
//   /v4/sports/ (list)      → usage headers only (free endpoint)
//   /events/{id}/odds       → EXTRA_ODDS_EVENT fixture
//   /odds/                  → first sport returns ODDS_FIXTURE, rest 429
function mockFetchOnce(extraEvent?: any) {
  let bulkCalls = 0;
  global.fetch = jest.fn(async (url: any) => {
    const u = String(url);
    if (u.includes("/events/")) {
      if (extraEvent) return jsonResponse(extraEvent);
      return { ok: false, status: 500, text: async () => "no event" } as any;
    }
    if (/\/v4\/sports\/\?/.test(u)) {
      // usage probe — does not consume quota
      return jsonResponse([], {
        "x-requests-used": "10",
        "x-requests-remaining": "490",
      });
    }
    if (u.includes("/odds/")) {
      bulkCalls++;
      if (bulkCalls === 1) return jsonResponse([ODDS_FIXTURE]);
      return { ok: false, status: 429, text: async () => "rate limited" } as any;
    }
    return { ok: false, status: 404, text: async () => "?" } as any;
  }) as any;
  return global.fetch as any;
}

describe("syncAllOdds — market/selection normalization", () => {
  test("h2h → match_result, totals → over_under_<line>, selections canonicalized", async () => {
    mockFetchOnce();
    const res = await syncAllOdds();

    expect(res.sportsProcessed).toBe(1);
    expect(res.createdFixtures).toBe(1);
    expect(res.errors.length).toBeGreaterThan(0); // remaining sports 429

    const rows = mockState.oddsInserts.flat();
    expect(rows.length).toBe(7); // 3 h2h + 4 totals

    const byKey = (market: string, selection: string) =>
      rows.find((r) => r.market === market && r.selection === selection);

    // h2h market mapping + selection mapping
    expect(byKey("match_result", "home")).toBeTruthy();
    expect(byKey("match_result", "draw")).toBeTruthy();
    expect(byKey("match_result", "away")).toBeTruthy();
    expect(byKey("match_result", "home")!.odds).toBe(1.9);

    // totals → over_under_<point>
    expect(byKey("over_under_2.5", "over")).toBeTruthy();
    expect(byKey("over_under_2.5", "under")).toBeTruthy();
    expect(byKey("over_under_3.5", "over")).toBeTruthy();
    expect(byKey("over_under_1.5", "under")).toBeTruthy();

    // bookmaker lowercased, fixture_id set, snapshot_time present
    for (const r of rows) {
      expect(r.bookmaker).toBe("bet365");
      expect(r.fixture_id).toBe("fixture-1");
      expect(r.snapshot_time).toBeTruthy();
    }

    // Raw market keys must NOT leak through
    expect(rows.some((r) => r.market === "h2h")).toBe(false);
    expect(rows.some((r) => r.market === "totals")).toBe(false);
  });

  test("dedupe: unchanged odds vs latest snapshot are not re-inserted", async () => {
    // Latest stored snapshot already has every row at the same odds →
    // changedSnapshots is empty → no insert, returns 0 snapshots.
    mockState.recentSnapshots = [
      { bookmaker: "bet365", market: "match_result", selection: "home", odds: 1.9 },
      { bookmaker: "bet365", market: "match_result", selection: "draw", odds: 3.4 },
      { bookmaker: "bet365", market: "match_result", selection: "away", odds: 4.2 },
      { bookmaker: "bet365", market: "over_under_2.5", selection: "over", odds: 1.95 },
      { bookmaker: "bet365", market: "over_under_2.5", selection: "under", odds: 1.85 },
      { bookmaker: "bet365", market: "over_under_3.5", selection: "over", odds: 2.6 },
      { bookmaker: "bet365", market: "over_under_1.5", selection: "under", odds: 1.5 },
    ];

    mockFetchOnce();
    const res = await syncAllOdds();

    expect(res.totalSnapshots).toBe(0);
    expect(mockState.oddsInserts.flat().length).toBe(0);
  });

  test("changed odds ARE inserted when price moved", async () => {
    // Same keys but one price differs → only changed rows inserted.
    mockState.recentSnapshots = [
      { bookmaker: "bet365", market: "match_result", selection: "home", odds: 2.1 }, // was 2.1, now 1.9 → changed
      { bookmaker: "bet365", market: "match_result", selection: "draw", odds: 3.4 },  // unchanged
      { bookmaker: "bet365", market: "match_result", selection: "away", odds: 4.2 },  // unchanged
      // totals rows absent from history → all treated as new
    ];

    mockFetchOnce();
    const res = await syncAllOdds();

    const rows = mockState.oddsInserts.flat();
    // 1 changed h2h + 4 totals (no history) = 5
    expect(res.totalSnapshots).toBe(5);
    const homeRow = rows.find((r) => r.market === "match_result" && r.selection === "home");
    expect(homeRow.odds).toBe(1.9);
    expect(rows.some((r) => r.selection === "draw" && r.market === "match_result")).toBe(false);
  });
});

// ─── Additional markets (btts / double_chance / draw_no_bet) ──────────
// These are NOT served by the bulk /odds endpoint (422 INVALID_MARKET) —
// they come from the per-event /events/{id}/odds endpoint. Shape below is
// copied from a live soccer_epl probe.

const EXTRA_EVENT = {
  id: "odds-fixture-1",
  sport_key: "soccer_epl",
  sport_title: "EPL",
  commence_time: "2025-06-01T15:00:00Z",
  home_team: "Home FC",
  away_team: "Away United",
  bookmakers: [
    {
      key: "pinnacle",
      title: "Pinnacle",
      markets: [
        {
          key: "btts",
          last_update: "2025-05-30T10:00:00Z",
          outcomes: [
            { name: "Yes", price: 1.67 },
            { name: "No", price: 2.3 },
          ],
        },
        {
          key: "double_chance",
          last_update: "2025-05-30T10:00:00Z",
          outcomes: [
            { name: "Away United or Draw", price: 1.59 },   // x2
            { name: "Home FC or Draw", price: 1.44 },      // 1x
            { name: "Away United or Home FC", price: 1.35 },// 12
          ],
        },
        {
          key: "draw_no_bet",
          last_update: "2025-05-30T10:00:00Z",
          outcomes: [
            { name: "Away United", price: 2.14 },  // away
            { name: "Home FC", price: 1.76 },      // home
          ],
        },
      ],
    },
  ],
};

describe("syncAllOdds — additional markets (per-event pass)", () => {
  test("btts/double_chance/draw_no_bet land in odds_snapshots with joinable names", async () => {
    mockFetchOnce(EXTRA_EVENT);
    const res = await syncAllOdds();

    expect(res.extraMarkets).toEqual(["btts", "double_chance", "draw_no_bet"]);
    expect(res.extraEventsEnriched).toBe(1);

    const rows = mockState.oddsInserts.flat();
    const byKey = (market: string, selection: string) =>
      rows.find((r) => r.market === market && r.selection === selection);

    // BTTS → market "btts", selections yes/no (toOddsKey + canonicalMarket join)
    expect(byKey("btts", "yes")!.odds).toBe(1.67);
    expect(byKey("btts", "no")!.odds).toBe(2.3);

    // Double chance → market "double_chance", selections 1x/x2/12
    expect(byKey("double_chance", "1x")!.odds).toBe(1.44);
    expect(byKey("double_chance", "x2")!.odds).toBe(1.59);
    expect(byKey("double_chance", "12")!.odds).toBe(1.35);

    // Draw no bet → market "draw_no_bet", selections home/away
    expect(byKey("draw_no_bet", "home")!.odds).toBe(1.76);
    expect(byKey("draw_no_bet", "away")!.odds).toBe(2.14);

    // Quota metadata is reported
    expect(res.markets).toEqual(["h2h", "totals"]);
    expect(res.estimatedCreditsUsed).toBeGreaterThan(0);
    expect(res.creditsRemaining).toBe(490);
  });

  test("ODDS_EXTRA_MARKETS='' disables the per-event pass", async () => {
    process.env.ODDS_EXTRA_MARKETS = "";
    const fetchMock = mockFetchOnce(EXTRA_EVENT);
    const res = await syncAllOdds();

    expect(res.extraMarkets).toEqual([]);
    expect(res.extraEventsEnriched).toBe(0);
    // No /events/ calls were made
    const urls = (fetchMock.mock.calls as any[][]).map((c) => String(c[0]));
    expect(urls.some((u: string) => u.includes("/events/"))).toBe(false);
  });

  test("credit budget 0 skips all extra-market events", async () => {
    process.env.ODDS_EXTRA_CREDIT_BUDGET = "0";
    mockFetchOnce(EXTRA_EVENT);
    const res = await syncAllOdds();

    expect(res.extraEventsEnriched).toBe(0);
    expect(res.extraEventsSkipped).toBe(1);
    // bulk snapshots still written
    expect(res.totalSnapshots).toBe(7);
  });

  test("quota reserve stops enrichment when remaining is low", async () => {
    process.env.ODDS_QUOTA_RESERVE = "495"; // remaining=490 → 490-6 <= 495
    mockFetchOnce(EXTRA_EVENT);
    const res = await syncAllOdds();

    expect(res.extraEventsEnriched).toBe(0);
    expect(res.extraEventsSkipped).toBe(1);
  });
});

describe("mapOutcomeToSnapshot — unit mapping", () => {
  const fixture = { home_team: "Home FC", away_team: "Away United" };

  test("btts Yes/No → yes/no", () => {
    expect(mapOutcomeToSnapshot("btts", { name: "Yes", price: 1.5 }, fixture))
      .toEqual({ market: "btts", selection: "yes" });
    expect(mapOutcomeToSnapshot("btts", { name: "No", price: 2.5 }, fixture))
      .toEqual({ market: "btts", selection: "no" });
  });

  test("double_chance team-or-X names → 1x/x2/12", () => {
    expect(mapOutcomeToSnapshot("double_chance", { name: "Home FC or Draw", price: 1.4 }, fixture))
      .toEqual({ market: "double_chance", selection: "1x" });
    expect(mapOutcomeToSnapshot("double_chance", { name: "Away United or Draw", price: 1.6 }, fixture))
      .toEqual({ market: "double_chance", selection: "x2" });
    expect(mapOutcomeToSnapshot("double_chance", { name: "Home FC or Away United", price: 1.3 }, fixture))
      .toEqual({ market: "double_chance", selection: "12" });
    // unrecognised shape → skipped, not written as junk
    expect(mapOutcomeToSnapshot("double_chance", { name: "Something weird", price: 9 }, fixture))
      .toBeNull();
  });

  test("draw_no_bet team names → home/away", () => {
    expect(mapOutcomeToSnapshot("draw_no_bet", { name: "Home FC", price: 1.8 }, fixture))
      .toEqual({ market: "draw_no_bet", selection: "home" });
    expect(mapOutcomeToSnapshot("draw_no_bet", { name: "Away United", price: 2.1 }, fixture))
      .toEqual({ market: "draw_no_bet", selection: "away" });
  });

  test("totals any half-line → over_under_<point>", () => {
    expect(mapOutcomeToSnapshot("totals", { name: "Over", price: 1.9, point: 2.75 }, fixture))
      .toEqual({ market: "over_under_2.75", selection: "over" });
    expect(mapOutcomeToSnapshot("totals", { name: "Under", price: 1.9, point: 3.5 }, fixture))
      .toEqual({ market: "over_under_3.5", selection: "under" });
  });
});
