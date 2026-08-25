import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * SLIM PREDICTIONS — write-only mutations for live data.
 *
 * All read queries now go through Supabase API routes.
 * Convex only stores:
 *   - livePick (current pick)
 *   - valuePicks (live value bets)
 *   - settlementFeed (last 500 settlements)
 *   - liveStats (counters)
 *   - teams/leagues (reference)
 */

// ─── Live Pick Mutations ──────────────────────────────────────

export const upsertLivePick = mutation({
  args: {
    fixtureId: v.string(),
    match: v.string(),
    market: v.string(),
    selection: v.string(),
    probability: v.number(),
    odds: v.number(),
    edge: v.number(),
    compositeScore: v.number(),
    confidenceTier: v.string(),
    decision: v.string(),
    clvSignal: v.optional(v.string()),
    leagueName: v.optional(v.string()),
    kickoffTime: v.string(),
    decidedAt: v.string(),
  },
  handler: async (ctx, args) => {
    // Delete old live picks (keep only latest)
    const existing = await ctx.db.query("livePick").order("desc").take(10);
    for (const old of existing) {
      await ctx.db.delete(old._id);
    }
    return await ctx.db.insert("livePick", args);
  },
});

// ─── Value Picks Mutations ────────────────────────────────────

export const upsertValuePicks = mutation({
  args: {
    picks: v.array(
      v.object({
        fixtureId: v.optional(v.string()),
        matchName: v.optional(v.string()),
        market: v.string(),
        selection: v.string(),
        modelProb: v.number(),
        bookmakerOdds: v.optional(v.number()),
        impliedProb: v.optional(v.number()),
        edge: v.optional(v.number()),
        ev: v.optional(v.number()),
        tier: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Clear old value picks
    const existing = await ctx.db.query("valuePicks").fullTableScan().take(500);
    for (const old of existing) {
      await ctx.db.delete(old._id);
    }
    // Insert new
    let count = 0;
    for (const pick of args.picks) {
      await ctx.db.insert("valuePicks", pick);
      count++;
    }
    return { count };
  },
});

// ─── Settlement Feed Mutations ────────────────────────────────

export const addSettlement = mutation({
  args: {
    fixtureId: v.string(),
    market: v.string(),
    selection: v.string(),
    modelProbability: v.number(),
    modelVersion: v.string(),
    result: v.string(),
    settledAt: v.string(),
    matchName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Keep only last 500 settlements
    const count = await ctx.db
      .query("settlementFeed")
      .withIndex("by_settled")
      .collect()
      .then((r) => r.length);

    if (count >= 500) {
      const oldest = await ctx.db
        .query("settlementFeed")
        .withIndex("by_settled")
        .order("asc")
        .take(count - 499);
      for (const old of oldest) {
        await ctx.db.delete(old._id);
      }
    }

    return await ctx.db.insert("settlementFeed", args);
  },
});

export const addSettlementBatch = mutation({
  args: {
    settlements: v.array(
      v.object({
        fixtureId: v.string(),
        market: v.string(),
        selection: v.string(),
        modelProbability: v.number(),
        modelVersion: v.string(),
        result: v.string(),
        settledAt: v.string(),
        matchName: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    let count = 0;
    for (const s of args.settlements) {
      await ctx.db.insert("settlementFeed", s);
      count++;
    }

    // Trim to 500
    const all = await ctx.db.query("settlementFeed").fullTableScan().take(600);
    if (all.length > 500) {
      const toDelete = all.slice(0, all.length - 500);
      for (const old of toDelete) {
        await ctx.db.delete(old._id);
      }
    }

    return { count };
  },
});

// ─── Live Stats Mutations ─────────────────────────────────────

export const updateLiveStats = mutation({
  args: {
    key: v.string(),
    value: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("liveStats")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.value,
        updatedAt: new Date().toISOString(),
      });
      return existing._id;
    }

    return await ctx.db.insert("liveStats", {
      key: args.key,
      value: args.value,
      updatedAt: new Date().toISOString(),
    });
  },
});

export const incrementLiveStats = mutation({
  args: {
    key: v.string(),
    delta: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("liveStats")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: existing.value + args.delta,
        updatedAt: new Date().toISOString(),
      });
      return existing._id;
    }

    return await ctx.db.insert("liveStats", {
      key: args.key,
      value: args.delta,
      updatedAt: new Date().toISOString(),
    });
  },
});

// ─── Reference Data Mutations ─────────────────────────────────

export const upsertTeam = mutation({
  args: {
    canonicalName: v.string(),
    country: v.optional(v.string()),
    leagueExternalId: v.optional(v.number()),
    logo: v.optional(v.string()),
    eloRating: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("teams")
      .withIndex("by_name", (q) => q.eq("canonicalName", args.canonicalName))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("teams", args);
  },
});

export const upsertLeague = mutation({
  args: {
    externalId: v.number(),
    name: v.string(),
    country: v.optional(v.string()),
    logo: v.optional(v.string()),
    isActive: v.boolean(),
    priority: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("leagues")
      .withIndex("by_externalId", (q) => q.eq("externalId", args.externalId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("leagues", args);
  },
});

// ─── Stats Query ──────────────────────────────────────────────

export const getStats = query({
  handler: async (ctx) => {
    const leagues = await ctx.db.query("leagues").fullTableScan().take(200);
    const teams = await ctx.db.query("teams").fullTableScan().take(1000);
    const valuePicks = await ctx.db.query("valuePicks").fullTableScan().take(500);
    const settlements = await ctx.db.query("settlementFeed").fullTableScan().take(500);
    const livePick = await ctx.db.query("livePick").order("desc").take(1);

    return {
      leagues: leagues.length,
      teams: teams.length,
      valuePicks: valuePicks.length,
      settlements: settlements.length,
      hasLivePick: livePick.length > 0,
      note: "Slim schema — historical data in Supabase",
    };
  },
});
