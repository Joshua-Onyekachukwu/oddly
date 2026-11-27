/**
 * ODDLY Rollover monthly tracker metrics (spec §5) — pure computation.
 *
 * Consumes raw rollover_chains / rollover_picks rows (as returned by
 * Supabase) and returns the dashboard statistics. No DB, no I/O.
 *
 * Honesty notes:
 *  - All rows are user-entered / manually marked (rollover_picks.
 *    user_marked). There is no automated real-money settlement feed, so
 *    every figure produced here is PAPER / SIMULATED tracking — never
 *    verified real-money performance (spec §5 rules, §10).
 *  - Drawdown replays each chain's settled picks in day_number order.
 *    Manual "Bank 50%" withdrawals are NOT modeled inside the curve
 *    (banked_amount is reported separately), so drawdown reflects the
 *    pick-equity path only.
 *  - Streaks are computed over the user's settled picks ordered by
 *    settled_at — an approximation across chains, documented as such.
 */

// ─── Input row shapes (structural — match Supabase Row types) ──────────

export interface RolloverChainRow {
  id: string;
  starting_stake: number | null;
  current_balance: number | null;
  banked_amount: number | null;
  target_days: number | null;
  current_day: number | null;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface RolloverPickRow {
  id: string;
  chain_id: string | null;
  day_number: number | null;
  fixture_id?: string | null;
  market?: string | null;
  selection?: string | null;
  odds: number | null;
  model_probability: number | null;
  stake: number | null;
  potential_return: number | null;
  actual_return: number | null;
  result: string | null;
  settled_at: string | null;
}

// ─── Output ────────────────────────────────────────────────────────────

export interface RolloverStats {
  generatedAt: string;
  /** Always "paper" — no real-money settlement exists in the schema. */
  basis: "paper";
  month: string; // UTC "YYYY-MM"
  chains: {
    total: number;
    active: number;
    completed: number;
    broken: number;
    paused: number;
    startedThisMonth: number;
    completedThisMonth: number;
  };
  picks: {
    total: number;
    pending: number;
    won: number;
    lost: number;
    skipped: number;
    settled: number; // won + lost
    winRatePct: number | null; // won / settled * 100
  };
  bankroll: {
    /** Sum of starting_stake across all chains ever started. */
    totalStartingStake: number;
    /** Sum of current_balance across all chains. */
    totalCurrentBalance: number;
    /** Sum of banked_amount across all chains. */
    totalBanked: number;
    activeChains: number;
  };
  streaks: {
    currentWinStreak: number;
    currentLossStreak: number;
    maxWinStreak: number;
    maxLossStreak: number;
  };
  drawdown: {
    /** Largest peak-to-trough drop of any chain's pick-equity curve. */
    maxDrawdownAmount: number;
    /** Same, as % of the peak equity at that point. */
    maxDrawdownPct: number;
  };
  averages: {
    /** Mean odds over settled (won+lost) picks with a recorded odds. */
    avgOdds: number | null;
    /** Mean model_probability over settled picks with a recorded value. */
    avgModelProbability: number | null;
    settledPicksWithOdds: number;
  };
  monthly: {
    /** Picks settled 'won' in the current UTC month — the "successful
     *  rollovers" count used for target progress. */
    rolloverWins: number;
    /** Picks settled 'lost' this month. */
    rolloverLosses: number;
    /** Picks marked 'skipped' this month (not failures). */
    skippedDays: number;
    chainsCompleted: number;
    /** Spec ambition: ≥10 successful rollovers/month. */
    target: number;
    /** Spec stretch goal: 21/month. */
    stretchTarget: number;
    /** rolloverWins / target * 100, capped at 100. */
    progressPct: number;
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function num(v: number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function inMonth(iso: string | null | undefined, month: string): boolean {
  return typeof iso === "string" && iso.slice(0, 7) === month;
}

function round(v: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ─── Streaks ───────────────────────────────────────────────────────────

/**
 * Consecutive 'won'/'lost' runs over settled picks ordered by settled_at.
 * Returns current (trailing) and max streaks for both outcomes.
 */
function computeStreaks(picks: RolloverPickRow[]): RolloverStats["streaks"] {
  const seq = picks
    .filter((p) => p.result === "won" || p.result === "lost")
    .map((p) => ({ result: p.result as string, t: p.settled_at ?? "" }))
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
    .map((p) => p.result);

  let maxWin = 0;
  let maxLoss = 0;
  let curWin = 0;
  let curLoss = 0;
  for (const r of seq) {
    if (r === "won") {
      curWin++;
      curLoss = 0;
      if (curWin > maxWin) maxWin = curWin;
    } else {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLoss) maxLoss = curLoss;
    }
  }

  // Trailing streaks = whatever the running counters ended at.
  return {
    currentWinStreak: curWin,
    currentLossStreak: curLoss,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
  };
}

// ─── Drawdown ──────────────────────────────────────────────────────────

/**
 * Replay each chain's picks in day order and track peak-to-trough
 * equity drawdown. A 'won' pick resets balance to actual_return
 * (stake × odds); a 'lost' pick zeroes it (chain breaks); 'skipped'
 * and 'pending' picks leave balance unchanged.
 */
function computeDrawdown(
  chains: RolloverChainRow[],
  picks: RolloverPickRow[]
): RolloverStats["drawdown"] {
  const picksByChain = new Map<string, RolloverPickRow[]>();
  for (const p of picks) {
    if (!p.chain_id) continue;
    const arr = picksByChain.get(p.chain_id) ?? [];
    arr.push(p);
    picksByChain.set(p.chain_id, arr);
  }

  let maxDD = 0;
  let maxDDPct = 0;

  for (const chain of chains) {
    const chainPicks = (picksByChain.get(chain.id) ?? [])
      .filter((p) => p.result === "won" || p.result === "lost" || p.result === "skipped")
      .sort((a, b) => num(a.day_number) - num(b.day_number));
    if (chainPicks.length === 0) continue;

    let balance = num(chain.starting_stake);
    let peak = balance;
    for (const p of chainPicks) {
      if (p.result === "won") {
        const ret = num(p.actual_return);
        balance = ret > 0 ? ret : num(p.stake) * (num(p.odds) > 1 ? num(p.odds) : 1);
      } else if (p.result === "lost") {
        balance = 0;
      }
      // 'skipped' → balance unchanged
      if (balance > peak) peak = balance;
      const dd = peak - balance;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDPct = peak > 0 ? (dd / peak) * 100 : 0;
      }
    }
  }

  return { maxDrawdownAmount: round(maxDD, 2), maxDrawdownPct: round(maxDDPct, 2) };
}

// ─── Main ──────────────────────────────────────────────────────────────

export function computeRolloverStats(
  chains: RolloverChainRow[],
  picks: RolloverPickRow[],
  now: Date = new Date()
): RolloverStats {
  const month = now.toISOString().slice(0, 7);

  const chainCounts = { total: 0, active: 0, completed: 0, broken: 0, paused: 0 };
  let startedThisMonth = 0;
  let completedThisMonth = 0;
  let totalStartingStake = 0;
  let totalCurrentBalance = 0;
  let totalBanked = 0;

  for (const c of chains) {
    chainCounts.total++;
    const status = (c.status ?? "").toLowerCase();
    if (status === "active") chainCounts.active++;
    else if (status === "completed") chainCounts.completed++;
    else if (status === "broken") chainCounts.broken++;
    else if (status === "paused") chainCounts.paused++;

    if (inMonth(c.started_at, month)) startedThisMonth++;
    if (status === "completed" && inMonth(c.ended_at ?? c.started_at, month)) {
      completedThisMonth++;
    }

    totalStartingStake += num(c.starting_stake);
    totalCurrentBalance += num(c.current_balance);
    totalBanked += num(c.banked_amount);
  }

  const pickCounts = { total: 0, pending: 0, won: 0, lost: 0, skipped: 0 };
  let rolloverWins = 0;
  let rolloverLosses = 0;
  let skippedDays = 0;
  let oddsSum = 0;
  let probSum = 0;
  let withOdds = 0;
  let withProb = 0;

  for (const p of picks) {
    pickCounts.total++;
    const r = (p.result ?? "").toLowerCase();
    if (r === "pending") pickCounts.pending++;
    else if (r === "won") pickCounts.won++;
    else if (r === "lost") pickCounts.lost++;
    else if (r === "skipped") pickCounts.skipped++;

    const settled = r === "won" || r === "lost";
    if (settled) {
      if (inMonth(p.settled_at, month)) {
        if (r === "won") rolloverWins++;
        else rolloverLosses++;
      }
      const o = num(p.odds);
      if (o > 1) {
        oddsSum += o;
        withOdds++;
      }
      const pr = num(p.model_probability);
      if (pr > 0 && pr < 1) {
        probSum += pr;
        withProb++;
      }
    } else if (r === "skipped" && inMonth(p.settled_at, month)) {
      skippedDays++;
    }
  }

  const settled = pickCounts.won + pickCounts.lost;
  const TARGET = 10;
  const STRETCH = 21;

  return {
    generatedAt: now.toISOString(),
    basis: "paper",
    month,
    chains: {
      ...chainCounts,
      startedThisMonth,
      completedThisMonth,
    },
    picks: {
      ...pickCounts,
      settled,
      winRatePct: settled > 0 ? round((pickCounts.won / settled) * 100, 2) : null,
    },
    bankroll: {
      totalStartingStake: round(totalStartingStake, 2),
      totalCurrentBalance: round(totalCurrentBalance, 2),
      totalBanked: round(totalBanked, 2),
      activeChains: chainCounts.active,
    },
    streaks: computeStreaks(picks),
    drawdown: computeDrawdown(chains, picks),
    averages: {
      avgOdds: withOdds > 0 ? round(oddsSum / withOdds, 3) : null,
      avgModelProbability:
        withProb > 0 ? round(probSum / withProb, 4) : null,
      settledPicksWithOdds: withOdds,
    },
    monthly: {
      rolloverWins,
      rolloverLosses,
      skippedDays,
      chainsCompleted: completedThisMonth,
      target: TARGET,
      stretchTarget: STRETCH,
      progressPct: Math.min(100, round((rolloverWins / TARGET) * 100, 1)),
    },
  };
}
