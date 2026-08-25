import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * SLIM CONVEX SCHEMA — Real-time features only.
 *
 * Heavy data lives in Supabase (599K predictions, 15K odds, etc.)
 * Convex is used ONLY for real-time subscriptions that need live updates:
 *   - Live pick of the day
 *   - Value picks (real-time)
 *   - Settlement notifications
 *   - Live stats counters
 *
 * All historical/analytics queries go through Supabase API routes.
 */

export default defineSchema({
  // ─── Lightweight reference data (synced from Supabase) ──────
  leagues: defineTable({
    externalId: v.number(),
    name: v.string(),
    country: v.optional(v.string()),
    logo: v.optional(v.string()),
    isActive: v.boolean(),
    priority: v.number(),
  }).index("by_externalId", ["externalId"]),

  teams: defineTable({
    canonicalName: v.string(),
    country: v.optional(v.string()),
    leagueExternalId: v.optional(v.number()),
    logo: v.optional(v.string()),
    eloRating: v.number(),
  }).index("by_name", ["canonicalName"])
    .index("by_league", ["leagueExternalId"]),

  // ─── Real-time live data (written by pipeline, read by frontend) ──
  livePick: defineTable({
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
  }),

  valuePicks: defineTable({
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
  }).index("by_tier", ["tier"])
    .index("by_market", ["market"]),

  // ─── Settlement feed (last 500 settled predictions for live UI) ──
  settlementFeed: defineTable({
    fixtureId: v.string(),
    market: v.string(),
    selection: v.string(),
    modelProbability: v.number(),
    modelVersion: v.string(),
    result: v.string(),
    settledAt: v.string(),
    matchName: v.optional(v.string()),
  }).index("by_result", ["result"])
    .index("by_settled", ["settledAt"]),

  // ─── Live stats counters (updated atomically) ──────────────
  liveStats: defineTable({
    key: v.string(),
    value: v.number(),
    updatedAt: v.string(),
  }).index("by_key", ["key"]),
});
