import { query } from "./_generated/server";
import { v } from "convex/values";

/**
 * SLIM REALTIME QUERIES — reads only from lightweight tables.
 *
 * All heavy analytics (599K predictions, calibration, market breakdown)
 * now live in Supabase API routes.
 *
 * Convex is used only for:
 *   - Live pick of the day
 *   - Value picks (real-time subscription)
 *   - Settlement feed (last 500)
 *   - Live stats counters
 */

/** Get the current live pick — single lightweight document. */
export const getLivePick = query({
  handler: async (ctx) => {
    const picks = await ctx.db.query("livePick").order("desc").take(1);
    return picks[0] ?? null;
  },
});

/** Subscribe to value picks — small table, filters by tier. */
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

    const results = await ctx.db.query("valuePicks").fullTableScan().take(limit);
    return results.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0));
  },
});

/** Get recent settlements — small table (capped at 500 docs). */
export const getSettlementUpdates = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);
    return await ctx.db
      .query("settlementFeed")
      .withIndex("by_settled")
      .order("desc")
      .take(limit);
  },
});

/** Get live stats — reads from counter table (tiny). */
export const getLiveStats = query({
  handler: async (ctx) => {
    const statsRows = await ctx.db.query("liveStats").fullTableScan().take(50);
    const stats: Record<string, number> = {};
    for (const row of statsRows) {
      stats[row.key] = row.value;
    }
    return {
      totalPredictions: stats.totalSettled ?? 0,
      correct: stats.correct ?? 0,
      wrong: stats.wrong ?? 0,
      accuracy: stats.totalSettled > 0
        ? Math.round((stats.correct / stats.totalSettled) * 1000) / 10
        : 0,
      lastUpdated: stats.lastUpdated
        ? new Date(stats.lastUpdated).toISOString()
        : new Date().toISOString(),
    };
  },
});

/** Settlement by market — reads from settlementFeed (capped). */
export const getSettlementByMarket = query({
  handler: async (ctx) => {
    const feed = await ctx.db.query("settlementFeed").fullTableScan().take(500);
    const byMarket: Record<string, { total: number; correct: number }> = {};

    for (const p of feed) {
      if (!byMarket[p.market]) byMarket[p.market] = { total: 0, correct: 0 };
      byMarket[p.market].total++;
      if (p.result === "correct") byMarket[p.market].correct++;
    }

    return Object.entries(byMarket)
      .map(([market, stats]) => ({
        market,
        total: stats.total,
        correct: stats.correct,
        accuracy: Math.round((stats.correct / stats.total) * 1000) / 10,
      }))
      .sort((a, b) => b.total - a.total);
  },
});

/** Get leagues — lightweight reference. */
export const getLeagues = query({
  handler: async (ctx) => {
    return await ctx.db.query("leagues").fullTableScan().take(200);
  },
});

/** Get teams — lightweight reference. */
export const getTeams = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("teams").fullTableScan().take(args.limit ?? 1000);
  },
});
