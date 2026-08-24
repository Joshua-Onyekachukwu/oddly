import { query } from "./_generated/server";
import { v } from "convex/values";

// ─── Real-time Predictions ──────────────────────────────────────

/**
 * Subscribe to the latest settled predictions.
 * Use with useQuery(api.realtime.getLatestPredictions, { limit: 50 }).
 */
export const getLatestPredictions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);

    // Use take() to stay under 32K read limit
    const correct = await ctx.db
      .query("predictions")
      .withIndex("by_result", (q) => q.eq("result", "correct"))
      .take(limit);

    const wrong = await ctx.db
      .query("predictions")
      .withIndex("by_result", (q) => q.eq("result", "wrong"))
      .take(limit);

    const all = [...correct, ...wrong]
      .sort((a, b) => {
        if (a.settledAt && b.settledAt) {
          return b.settledAt.localeCompare(a.settledAt);
        }
        return b.modelProbability - a.modelProbability;
      })
      .slice(0, limit);

    return all;
  },
});

/**
 * Subscribe to real-time odds for a specific fixture.
 * Use with useQuery(api.realtime.getOddsForFixture, { fixtureId: "xxx" }).
 */
export const getOddsForFixture = query({
  args: {
    fixtureId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("odds")
      .withIndex("by_fixture", (q) => q.eq("fixtureId", args.fixtureId))
      .take(100);
  },
});

/**
 * Subscribe to odds snapshots grouped by fixture.
 * Useful for odds comparison dashboard.
 */
export const getOddsComparison = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);

    const allOdds = await ctx.db.query("odds").fullTableScan().take(limit * 5);

    // Group by fixture
    const byFixture: Record<string, typeof allOdds> = {};
    for (const o of allOdds) {
      if (!byFixture[o.fixtureId]) byFixture[o.fixtureId] = [];
      byFixture[o.fixtureId].push(o);
    }

    return Object.entries(byFixture)
      .slice(0, limit)
      .map(([fixtureId, odds]) => ({
        fixtureId,
        odds: odds.map((o) => ({
          bookmaker: o.bookmaker,
          market: o.market,
          selection: o.selection,
          odds: o.odds,
          impliedProb: o.impliedProb,
          timestamp: o.timestamp,
        })),
      }));
  },
});

/**
 * Subscribe to value picks by tier or market.
 * Use with useQuery(api.realtime.getValuePicksLive, { tier: "ELITE" }).
 */
export const getValuePicksLive = query({
  args: {
    tier: v.optional(v.string()),
    market: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);

    if (args.tier) {
      const results = await ctx.db
        .query("valuePicks")
        .withIndex("by_tier", (q) => q.eq("tier", args.tier!))
        .take(limit);
      return results.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
    }

    if (args.market) {
      const results = await ctx.db
        .query("valuePicks")
        .withIndex("by_market", (q) => q.eq("market", args.market!))
        .take(limit);
      return results.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
    }

    // Fallback: limited scan sorted by edge
    const results = await ctx.db
      .query("valuePicks")
      .fullTableScan()
      .take(limit);
    return results.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
  },
});

/**
 * Subscribe to settlement updates — recent settled predictions.
 */
export const getSettlementUpdates = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);

    const correct = await ctx.db
      .query("predictions")
      .withIndex("by_result", (q) => q.eq("result", "correct"))
      .take(limit);

    const wrong = await ctx.db
      .query("predictions")
      .withIndex("by_result", (q) => q.eq("result", "wrong"))
      .take(limit);

    return [...correct, ...wrong]
      .sort((a, b) => {
        if (a.settledAt && b.settledAt) {
          return b.settledAt.localeCompare(a.settledAt);
        }
        return 0;
      })
      .slice(0, limit);
  },
});

/**
 * Live stats summary — lightweight query that stays under read limits.
 */
export const getLiveStats = query({
  handler: async (ctx) => {
    // Sample-based approach: count in small batches to avoid 32K limit
    let totalCorrect = 0;
    let totalWrong = 0;

    // Count correct predictions in batches
    const correctBatch = await ctx.db
      .query("predictions")
      .withIndex("by_result", (q) => q.eq("result", "correct"))
      .take(1000);
    totalCorrect = correctBatch.length;

    const wrongBatch = await ctx.db
      .query("predictions")
      .withIndex("by_result", (q) => q.eq("result", "wrong"))
      .take(1000);
    totalWrong = wrongBatch.length;

    const total = totalCorrect + totalWrong;
    const accuracy = total > 0 ? totalCorrect / total : 0;

    return {
      totalPredictions: total,
      correct: totalCorrect,
      wrong: totalWrong,
      accuracy: Math.round(accuracy * 1000) / 10,
      lastUpdated: new Date().toISOString(),
    };
  },
});

/**
 * Get settlement summary by market.
 */
export const getSettlementByMarket = query({
  handler: async (ctx) => {
    const markets = [
      "home_win",
      "draw",
      "away_win",
      "over_2_5",
      "under_2_5",
      "btts_yes",
      "btts_no",
      "over_1_5",
      "under_3_5",
    ];

    const results = [];

    for (const market of markets) {
      const correct = await ctx.db
        .query("predictions")
        .withIndex("by_market", (q) => q.eq("market", market))
        .take(1000);

      // Count correct within this market
      const totalCorrect = correct.filter(
        (p) => p.result === "correct",
      ).length;
      const totalWrong = correct.filter((p) => p.result === "wrong").length;
      const total = totalCorrect + totalWrong;

      if (total > 0) {
        results.push({
          market,
          total,
          correct: totalCorrect,
          accuracy: Math.round((totalCorrect / total) * 1000) / 10,
        });
      }
    }

    return results.sort((a, b) => b.total - a.total);
  },
});
