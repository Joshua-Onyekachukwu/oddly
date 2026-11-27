import {
  computeRolloverStats,
  RolloverChainRow,
  RolloverPickRow,
} from "./stats";

// Coverage for spec §5 monthly tracker metrics.

function chain(over: Partial<RolloverChainRow>): RolloverChainRow {
  return {
    id: "c1",
    starting_stake: 1000,
    current_balance: 1000,
    banked_amount: 0,
    target_days: 30,
    current_day: 0,
    status: "active",
    started_at: "2026-10-01T00:00:00Z",
    ended_at: null,
    ...over,
  };
}

function pick(over: Partial<RolloverPickRow>): RolloverPickRow {
  return {
    id: "p1",
    chain_id: "c1",
    day_number: 1,
    odds: 2.0,
    model_probability: 0.55,
    stake: 1000,
    potential_return: 2000,
    actual_return: null,
    result: "pending",
    settled_at: null,
    ...over,
  };
}

const NOW = new Date("2026-10-15T12:00:00Z"); // month = 2026-10

describe("computeRolloverStats — empty input", () => {
  test("no chains, no picks → honest zeros", () => {
    const s = computeRolloverStats([], [], NOW);
    expect(s.basis).toBe("paper");
    expect(s.month).toBe("2026-10");
    expect(s.chains.total).toBe(0);
    expect(s.picks.total).toBe(0);
    expect(s.picks.winRatePct).toBeNull();
    expect(s.streaks.currentWinStreak).toBe(0);
    expect(s.drawdown.maxDrawdownAmount).toBe(0);
    expect(s.monthly.rolloverWins).toBe(0);
    expect(s.monthly.progressPct).toBe(0);
  });
});

describe("computeRolloverStats — chains & picks", () => {
  test("counts chains by status and picks by result", () => {
    const chains = [
      chain({ id: "c1", status: "active" }),
      chain({ id: "c2", status: "completed", ended_at: "2026-10-10T00:00:00Z" }),
      chain({ id: "c3", status: "broken", started_at: "2026-09-15T00:00:00Z", ended_at: "2026-09-20T00:00:00Z" }),
    ];
    const picks = [
      pick({ id: "p1", chain_id: "c1", result: "won", actual_return: 2000, settled_at: "2026-10-02T00:00:00Z" }),
      pick({ id: "p2", chain_id: "c1", result: "lost", actual_return: 0, settled_at: "2026-10-03T00:00:00Z" }),
      pick({ id: "p3", chain_id: "c1", result: "pending" }),
      pick({ id: "p4", chain_id: "c2", result: "skipped", settled_at: "2026-10-05T00:00:00Z" }),
      pick({ id: "p5", chain_id: "c2", result: "won", actual_return: 1900, settled_at: "2026-10-06T00:00:00Z" }),
    ];
    const s = computeRolloverStats(chains, picks, NOW);

    expect(s.chains.total).toBe(3);
    expect(s.chains.active).toBe(1);
    expect(s.chains.completed).toBe(1);
    expect(s.chains.broken).toBe(1);
    expect(s.chains.startedThisMonth).toBe(2); // c1, c2 started in Oct; c3 Sep
    expect(s.chains.completedThisMonth).toBe(1);

    expect(s.picks.total).toBe(5);
    expect(s.picks.won).toBe(2);
    expect(s.picks.lost).toBe(1);
    expect(s.picks.pending).toBe(1);
    expect(s.picks.skipped).toBe(1);
    expect(s.picks.settled).toBe(3);
    expect(s.picks.winRatePct).toBeCloseTo((2 / 3) * 100, 1);
  });

  test("bankroll totals aggregate honestly", () => {
    const chains = [
      chain({ id: "c1", starting_stake: 1000, current_balance: 2000, banked_amount: 500 }),
      chain({ id: "c2", starting_stake: 500, current_balance: 0, banked_amount: 0, status: "broken" }),
    ];
    const s = computeRolloverStats(chains, [], NOW);
    expect(s.bankroll.totalStartingStake).toBe(1500);
    expect(s.bankroll.totalCurrentBalance).toBe(2000);
    expect(s.bankroll.totalBanked).toBe(500);
    expect(s.bankroll.activeChains).toBe(1);
  });
});

describe("computeRolloverStats — streaks", () => {
  test("current and max win/loss streaks over settled sequence", () => {
    const chains = [chain({})];
    const picks = [
      pick({ id: "a", result: "won", settled_at: "2026-10-01T00:00:00Z" }),
      pick({ id: "b", result: "won", settled_at: "2026-10-02T00:00:00Z" }),
      pick({ id: "c", result: "lost", settled_at: "2026-10-03T00:00:00Z" }),
      pick({ id: "d", result: "won", settled_at: "2026-10-04T00:00:00Z" }),
      pick({ id: "e", result: "won", settled_at: "2026-10-05T00:00:00Z" }),
      pick({ id: "f", result: "won", settled_at: "2026-10-06T00:00:00Z" }),
    ];
    const s = computeRolloverStats(chains, picks, NOW);
    expect(s.streaks.currentWinStreak).toBe(3);
    expect(s.streaks.currentLossStreak).toBe(0);
    expect(s.streaks.maxWinStreak).toBe(3);
    expect(s.streaks.maxLossStreak).toBe(1);
  });

  test("trailing loss streak reported when last pick lost", () => {
    const chains = [chain({})];
    const picks = [
      pick({ id: "a", result: "won", settled_at: "2026-10-01T00:00:00Z" }),
      pick({ id: "b", result: "lost", settled_at: "2026-10-02T00:00:00Z" }),
      pick({ id: "c", result: "lost", settled_at: "2026-10-03T00:00:00Z" }),
    ];
    const s = computeRolloverStats(chains, picks, NOW);
    expect(s.streaks.currentLossStreak).toBe(2);
    expect(s.streaks.currentWinStreak).toBe(0);
    expect(s.streaks.maxLossStreak).toBe(2);
  });
});

describe("computeRolloverStats — drawdown", () => {
  test("replays pick equity: win → actual_return, loss → 0", () => {
    const chains = [
      chain({ id: "c1", starting_stake: 1000, current_balance: 0, status: "broken" }),
    ];
    const picks = [
      // D1: stake 1000 @2.0 → return 2000 (peak)
      pick({ id: "a", day_number: 1, result: "won", stake: 1000, odds: 2.0, actual_return: 2000 }),
      // D2: stake 2000 @2.0 → return 4000 (new peak)
      pick({ id: "b", day_number: 2, result: "won", stake: 2000, odds: 2.0, actual_return: 4000 }),
      // D3: lost → balance 0 → drawdown 4000 (100%)
      pick({ id: "c", day_number: 3, result: "lost", stake: 4000, odds: 2.0, actual_return: 0 }),
    ];
    const s = computeRolloverStats(chains, picks, NOW);
    expect(s.drawdown.maxDrawdownAmount).toBe(4000);
    expect(s.drawdown.maxDrawdownPct).toBe(100);
  });

  test("partial drawdown without full loss", () => {
    const chains = [
      chain({ id: "c1", starting_stake: 1000, current_balance: 1500, status: "active" }),
    ];
    const picks = [
      pick({ id: "a", day_number: 1, result: "won", stake: 1000, odds: 2.0, actual_return: 2000 }),
      // banked-style manual reduction isn't modeled; simulate a smaller win:
      pick({ id: "b", day_number: 2, result: "won", stake: 1000, odds: 1.5, actual_return: 1500 }),
    ];
    const s = computeRolloverStats(chains, picks, NOW);
    // peak 2000 → trough 1500 → dd 500 = 25%
    expect(s.drawdown.maxDrawdownAmount).toBe(500);
    expect(s.drawdown.maxDrawdownPct).toBe(25);
  });

  test("skipped picks leave balance unchanged", () => {
    const chains = [chain({ id: "c1", starting_stake: 1000 })];
    const picks = [
      pick({ id: "a", day_number: 1, result: "won", stake: 1000, odds: 2.0, actual_return: 2000 }),
      pick({ id: "b", day_number: 2, result: "skipped" }),
      pick({ id: "c", day_number: 3, result: "lost", stake: 2000, odds: 2.0, actual_return: 0 }),
    ];
    const s = computeRolloverStats(chains, picks, NOW);
    expect(s.drawdown.maxDrawdownAmount).toBe(2000);
    expect(s.picks.skipped).toBe(1);
  });
});

describe("computeRolloverStats — averages & monthly targets", () => {
  test("averages over settled picks only", () => {
    const chains = [chain({})];
    const picks = [
      pick({ id: "a", result: "won", odds: 2.0, model_probability: 0.5, settled_at: "2026-10-01T00:00:00Z" }),
      pick({ id: "b", result: "lost", odds: 2.5, model_probability: 0.6, settled_at: "2026-10-02T00:00:00Z" }),
      pick({ id: "c", result: "pending", odds: 9.9, model_probability: 0.9 }), // excluded
      pick({ id: "d", result: "won", odds: null, model_probability: null, settled_at: "2026-10-03T00:00:00Z" }),
    ];
    const s = computeRolloverStats(chains, picks, NOW);
    expect(s.averages.settledPicksWithOdds).toBe(2);
    expect(s.averages.avgOdds).toBeCloseTo(2.25, 3);
    expect(s.averages.avgModelProbability).toBeCloseTo(0.55, 4);
  });

  test("monthly progress counts this-month wins vs 10/21 targets", () => {
    const chains = [chain({})];
    const picks = [
      // 3 wins this month, 1 loss this month, 1 win LAST month (excluded)
      ...Array.from({ length: 3 }, (_, i) =>
        pick({
          id: `w${i}`,
          result: "won",
          settled_at: `2026-10-0${i + 1}T00:00:00Z`,
        })
      ),
      pick({ id: "l1", result: "lost", settled_at: "2026-10-05T00:00:00Z" }),
      pick({ id: "old", result: "won", settled_at: "2026-09-30T23:00:00Z" }),
      pick({ id: "skip1", result: "skipped", settled_at: "2026-10-06T00:00:00Z" }),
    ];
    const s = computeRolloverStats(chains, picks, NOW);
    expect(s.monthly.rolloverWins).toBe(3);
    expect(s.monthly.rolloverLosses).toBe(1);
    expect(s.monthly.skippedDays).toBe(1);
    expect(s.monthly.target).toBe(10);
    expect(s.monthly.stretchTarget).toBe(21);
    expect(s.monthly.progressPct).toBe(30);
  });
});
