import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// ─── Predictions Queries ────────────────────────────────────────

export const getHistoricalPredictions = query({
  args: {
    market: v.optional(v.string()),
    limit: v.optional(v.number()),
    result: v.optional(v.string()),
    minProb: v.optional(v.number()),
    maxProb: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query("predictions").fullTableScan();

    if (args.result) {
      q = ctx.db.query("predictions").withIndex("by_result", (q) => q.eq("result", args.result!));
    } else if (args.market) {
      q = ctx.db.query("predictions").withIndex("by_market", (q) => q.eq("market", args.market!));
    }

    let results = await q.collect();

    if (args.minProb) results = results.filter((r) => r.modelProbability >= args.minProb!);
    if (args.maxProb) results = results.filter((r) => r.modelProbability <= args.maxProb!);
    if (args.market && !args.result) results = results.filter((r) => r.market === args.market);

    return results.slice(0, args.limit ?? 10000);
  },
});

export const getMarketAccuracy = query({
  handler: async (ctx) => {
    const correct = await ctx.db
      .query("predictions")
      .withIndex("by_result", (q) => q.eq("result", "correct"))
      .collect();
    const wrong = await ctx.db
      .query("predictions")
      .withIndex("by_result", (q) => q.eq("result", "wrong"))
      .collect();

    const all = [...correct, ...wrong];
    const byMarket: Record<string, { total: number; correct: number }> = {};

    for (const p of all) {
      if (!byMarket[p.market]) byMarket[p.market] = { total: 0, correct: 0 };
      byMarket[p.market].total++;
      if (p.result === "correct") byMarket[p.market].correct++;
    }

    return Object.entries(byMarket)
      .map(([market, stats]) => ({
        market,
        total: stats.total,
        correct: stats.correct,
        accuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  },
});

export const getCalibrationBuckets = query({
  handler: async (ctx) => {
    const settled = await ctx.db
      .query("predictions")
      .fullTableScan()
      .filter((q) =>
        q.or(q.eq("result", "correct"), q.eq("result", "wrong"))
      )
      .collect();

    const buckets: Record<string, { total: number; correct: number; sumProb: number }> = {};

    for (const p of settled) {
      let bucket: string;
      if (p.modelProbability < 0.5) bucket = "40-49%";
      else if (p.modelProbability < 0.55) bucket = "50-54%";
      else if (p.modelProbability < 0.6) bucket = "55-59%";
      else if (p.modelProbability < 0.65) bucket = "60-64%";
      else if (p.modelProbability < 0.7) bucket = "65-69%";
      else if (p.modelProbability < 0.75) bucket = "70-74%";
      else if (p.modelProbability < 0.8) bucket = "75-79%";
      else if (p.modelProbability < 0.85) bucket = "80-84%";
      else if (p.modelProbability < 0.9) bucket = "85-89%";
      else bucket = "90%+";

      if (!buckets[bucket]) buckets[bucket] = { total: 0, correct: 0, sumProb: 0 };
      buckets[bucket].total++;
      if (p.result === "correct") buckets[bucket].correct++;
      buckets[bucket].sumProb += p.modelProbability;
    }

    return Object.entries(buckets)
      .map(([bucket, stats]) => ({
        bucket,
        total: stats.total,
        correct: stats.correct,
        actualAccuracy: stats.total > 0 ? Math.round((stats.correct / stats.total) * 1000) / 10 : 0,
        avgPredicted: stats.total > 0 ? Math.round((stats.sumProb / stats.total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => a.avgPredicted - b.avgPredicted);
  },
});

// ─── Fixtures Queries ───────────────────────────────────────────

export const getUpcomingFixtures = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fixtures")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .order("asc")
      .collect()
      .then((r) => r.slice(0, args.limit ?? 500));
  },
});

// ─── Teams Queries ──────────────────────────────────────────────

export const getTeamByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("teams")
      .withIndex("by_name", (q) => q.eq("canonicalName", args.name))
      .collect();
    return results[0] ?? null;
  },
});

// ─── xG Features Queries ────────────────────────────────────────

export const getXgByTeam = query({
  args: { teamName: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("xgFeatures")
      .withIndex("by_team", (q) => q.eq("teamName", args.teamName))
      .collect();
    return results[0] ?? null;
  },
});

// ─── Referee Queries ────────────────────────────────────────────

export const getRefereeByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("refereeProfiles")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .collect();
    return results[0] ?? null;
  },
});

export const getRefereeRanking = query({
  args: {
    sortBy: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let refs = await ctx.db.query("refereeProfiles").fullTableScan().collect();

    const sortBy = (args.sortBy ?? "matchesOfficiated") as keyof typeof refs[0];
    refs.sort((a, b) => {
      const aVal = typeof a[sortBy] === "number" ? (a[sortBy] as number) : 0;
      const bVal = typeof b[sortBy] === "number" ? (b[sortBy] as number) : 0;
      return bVal - aVal;
    });

    return refs.slice(0, args.limit ?? 50);
  },
});

// ─── Value Picks Queries ────────────────────────────────────────

export const getValuePicks = query({
  args: {
    tier: v.optional(v.string()),
    market: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db.query("valuePicks").fullTableScan();

    if (args.tier) {
      q = ctx.db.query("valuePicks").withIndex("by_tier", (q) => q.eq("tier", args.tier!));
    } else if (args.market) {
      q = ctx.db.query("valuePicks").withIndex("by_market", (q) => q.eq("market", args.market!));
    }

    let results = await q.collect();

    if (args.market && !args.tier) {
      results = results.filter((r) => r.market === args.market);
    }

    return results.slice(0, args.limit ?? 100);
  },
});

// ─── Mutations (Write Operations) ──────────────────────────────

export const archivePrediction = mutation({
  args: {
    fixtureId: v.string(),
    market: v.string(),
    selection: v.string(),
    modelProbability: v.number(),
    confidenceLower: v.optional(v.number()),
    confidenceUpper: v.optional(v.number()),
    modelVersion: v.string(),
    poissonProb: v.optional(v.number()),
    eloProb: v.optional(v.number()),
    regressionProb: v.optional(v.number()),
    xgAdjustedProb: v.optional(v.number()),
    bookmakerOdds: v.optional(v.number()),
    impliedProbability: v.optional(v.number()),
    edge: v.optional(v.number()),
    result: v.optional(v.string()),
    actualOutcome: v.optional(v.string()),
    settledAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("predictions", args);
  },
});

export const archiveBatch = mutation({
  args: {
    predictions: v.array(
      v.object({
        fixtureId: v.string(),
        market: v.string(),
        selection: v.string(),
        modelProbability: v.number(),
        modelVersion: v.string(),
        result: v.optional(v.string()),
        actualOutcome: v.optional(v.string()),
        settledAt: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    for (const pred of args.predictions) {
      const id = await ctx.db.insert("predictions", pred);
      ids.push(id);
    }
    return { count: ids.length, ids };
  },
});

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

export const bulkUpsertTeams = mutation({
  args: {
    teams: v.array(
      v.object({
        canonicalName: v.string(),
        country: v.optional(v.string()),
        logo: v.optional(v.string()),
        eloRating: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;
    for (const team of args.teams) {
      const existing = await ctx.db
        .query("teams")
        .withIndex("by_name", (q) => q.eq("canonicalName", team.canonicalName))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, team);
        updated++;
      } else {
        await ctx.db.insert("teams", team);
        inserted++;
      }
    }
    return { inserted, updated, total: inserted + updated };
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

export const insertRefereeProfile = mutation({
  args: {
    name: v.string(),
    matchesOfficiated: v.number(),
    avgGoals: v.optional(v.number()),
    homeWinPct: v.optional(v.number()),
    drawPct: v.optional(v.number()),
    awayWinPct: v.optional(v.number()),
    avgYellow: v.optional(v.number()),
    avgRed: v.optional(v.number()),
    avgFouls: v.optional(v.number()),
    homeBias: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("refereeProfiles")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("refereeProfiles", args);
  },
});

export const upsertXgFeature = mutation({
  args: {
    teamName: v.string(),
    league: v.optional(v.string()),
    season: v.optional(v.string()),
    source: v.string(),
    matchesPlayed: v.optional(v.number()),
    totalXg: v.optional(v.number()),
    totalXga: v.optional(v.number()),
    totalNpxg: v.optional(v.number()),
    avgXg: v.optional(v.number()),
    avgXga: v.optional(v.number()),
    avgNpxg: v.optional(v.number()),
    avgNpxga: v.optional(v.number()),
    homeXg: v.optional(v.number()),
    homeXga: v.optional(v.number()),
    homeGoals: v.optional(v.number()),
    homeMatches: v.optional(v.number()),
    awayXg: v.optional(v.number()),
    awayXga: v.optional(v.number()),
    awayGoals: v.optional(v.number()),
    awayMatches: v.optional(v.number()),
    xgLast5: v.optional(v.number()),
    xgaLast5: v.optional(v.number()),
    xgLast10: v.optional(v.number()),
    xgaLast10: v.optional(v.number()),
    avgPpda: v.optional(v.number()),
    avgDeep: v.optional(v.number()),
    avgDeepAllowed: v.optional(v.number()),
    xgDiff: v.optional(v.number()),
    npxgRatio: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("xgFeatures", args);
  },
});

export const insertRefereeMatch = mutation({
  args: {
    refereeName: v.string(),
    matchDate: v.string(),
    homeTeam: v.string(),
    awayTeam: v.string(),
    homeGoals: v.number(),
    awayGoals: v.number(),
    yellowCards: v.optional(v.number()),
    redCards: v.optional(v.number()),
    fouls: v.optional(v.number()),
    league: v.optional(v.string()),
    season: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("refereeMatches", args);
  },
});

export const insertAuditLog = mutation({
  args: {
    action: v.string(),
    details: v.optional(v.any()),
    rowsAffected: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("auditLog", args);
  },
});

// ─── Stats Query ────────────────────────────────────────────────

export const getStats = query({
  handler: async (ctx) => {
    // Each table read limited to stay under 32K total
    const leagues = await ctx.db.query("leagues").fullTableScan().take(200);
    const referees = await ctx.db.query("refereeProfiles").fullTableScan().take(500);
    const teams = await ctx.db.query("teams").fullTableScan().take(1000);
    const xgFeatures = await ctx.db.query("xgFeatures").fullTableScan().take(1000);
    // Skip large tables in stats to avoid 32K limit
    return {
      predictions: "~30000",
      fixtures: "~13000",
      teams: teams.length,
      leagues: leagues.length,
      referees: referees.length,
      odds: "~15000",
      xgFeatures: xgFeatures.length,
    };
  },
});
