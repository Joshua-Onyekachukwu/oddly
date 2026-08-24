import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ─── Leagues Reference ──────────────────────────────────────
  leagues: defineTable({
    externalId: v.number(),
    name: v.string(),
    country: v.optional(v.string()),
    logo: v.optional(v.string()),
    isActive: v.boolean(),
    priority: v.number(),
  }).index("by_externalId", ["externalId"]),

  // ─── Teams Reference ────────────────────────────────────────
  teams: defineTable({
    canonicalName: v.string(),
    country: v.optional(v.string()),
    leagueExternalId: v.optional(v.number()),
    logo: v.optional(v.string()),
    eloRating: v.number(),
    // xG features
    avgXg: v.optional(v.number()),
    avgXga: v.optional(v.number()),
    avgNpxg: v.optional(v.number()),
    avgNpxga: v.optional(v.number()),
    homeXg: v.optional(v.number()),
    homeXga: v.optional(v.number()),
    awayXg: v.optional(v.number()),
    awayXga: v.optional(v.number()),
    xgLast5: v.optional(v.number()),
    xgaLast5: v.optional(v.number()),
    avgPpda: v.optional(v.number()),
    avgDeep: v.optional(v.number()),
    avgDeepAllowed: v.optional(v.number()),
    xgDiff: v.optional(v.number()),
  }).index("by_name", ["canonicalName"])
    .index("by_league", ["leagueExternalId"]),

  // ─── Historical Fixtures ────────────────────────────────────
  fixtures: defineTable({
    externalId: v.optional(v.string()),
    homeTeamId: v.string(),
    awayTeamId: v.string(),
    leagueExternalId: v.optional(v.number()),
    kickoffTime: v.string(),
    status: v.string(),
    homeScore: v.optional(v.number()),
    awayScore: v.optional(v.number()),
    season: v.optional(v.string()),
    referee: v.optional(v.string()),
  }).index("by_externalId", ["externalId"])
    .index("by_kickoff", ["kickoffTime"])
    .index("by_status", ["status"])
    .index("by_season", ["season"])
    .index("by_league", ["leagueExternalId"]),

  // ─── Historical Predictions (Cold Storage) ──────────────────
  predictions: defineTable({
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
  }).index("by_fixture", ["fixtureId"])
    .index("by_market", ["market"])
    .index("by_result", ["result"])
    .index("by_model", ["modelVersion"]),

  // ─── Odds Snapshots ─────────────────────────────────────────
  odds: defineTable({
    fixtureId: v.string(),
    bookmaker: v.string(),
    market: v.string(),
    selection: v.string(),
    odds: v.number(),
    impliedProb: v.number(),
    timestamp: v.string(),
  }).index("by_fixture", ["fixtureId"])
    .index("by_bookmaker", ["bookmaker"]),

  // ─── xG Features ────────────────────────────────────────────
  xgFeatures: defineTable({
    teamName: v.string(),
    league: v.optional(v.string()),
    season: v.optional(v.string()),
    source: v.string(),
    matchesPlayed: v.optional(v.number()),
    totalGoals: v.optional(v.number()),
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
  }).index("by_team", ["teamName"])
    .index("by_season", ["season"]),

  // ─── Referee Profiles ───────────────────────────────────────
  refereeProfiles: defineTable({
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
  }).index("by_name", ["name"]),

  // ─── Referee Match History ──────────────────────────────────
  refereeMatches: defineTable({
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
  }).index("by_referee", ["refereeName"])
    .index("by_date", ["matchDate"]),

  // ─── Injuries & Suspensions ─────────────────────────────────
  injuries: defineTable({
    playerName: v.string(),
    teamName: v.optional(v.string()),
    injuryType: v.optional(v.string()),
    detail: v.optional(v.string()),
    returnDate: v.optional(v.string()),
    status: v.optional(v.string()),
    source: v.string(),
  }).index("by_team", ["teamName"]),

  // ─── Match-Level xG ─────────────────────────────────────────
  matchXg: defineTable({
    fixtureId: v.optional(v.string()),
    homeTeam: v.string(),
    awayTeam: v.string(),
    league: v.optional(v.string()),
    season: v.optional(v.string()),
    matchDate: v.string(),
    homeGoals: v.number(),
    awayGoals: v.number(),
    homeXg: v.optional(v.number()),
    awayXg: v.optional(v.number()),
    homeNpxg: v.optional(v.number()),
    awayNpxg: v.optional(v.number()),
    source: v.string(),
  }).index("by_date", ["matchDate"])
    .index("by_teams", ["homeTeam", "awayTeam"]),

  // ─── Training Datasets ──────────────────────────────────────
  trainingData: defineTable({
    fixtureId: v.optional(v.string()),
    market: v.string(),
    features: v.any(),
    label: v.number(),
    modelVersion: v.optional(v.string()),
  }).index("by_market", ["market"]),

  // ─── Per-League Model Parameters ────────────────────────────
  leagueModels: defineTable({
    leagueName: v.string(),
    modelVersion: v.optional(v.string()),
    intercept: v.optional(v.number()),
    weights: v.optional(v.any()),
    accuracy: v.optional(v.number()),
    brierScore: v.optional(v.number()),
    logLoss: v.optional(v.number()),
    sampleSize: v.optional(v.number()),
  }).index("by_league", ["leagueName"]),

  // ─── Value Analysis Results ─────────────────────────────────
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

  // ─── Feature Store (from Supabase migration) ────────────────
  teamFeatureProfiles: defineTable({
    teamName: v.string(),
    league: v.optional(v.string()),
    season: v.optional(v.string()),
    eloRating: v.optional(v.number()),
    homeWinRate: v.optional(v.number()),
    awayWinRate: v.optional(v.number()),
    avgGoalsScored: v.optional(v.number()),
    avgGoalsConceded: v.optional(v.number()),
    formLast5: v.optional(v.number()),
    features: v.any(),
  }).index("by_team", ["teamName"]),

  refereeFeatureProfiles: defineTable({
    refereeName: v.string(),
    matchesOfficiated: v.number(),
    homeWinRate: v.optional(v.number()),
    avgGoals: v.optional(v.number()),
    avgCards: v.optional(v.number()),
    homeBias: v.optional(v.number()),
    features: v.any(),
  }).index("by_name", ["refereeName"]),

  // ─── Audit Log ──────────────────────────────────────────────
  auditLog: defineTable({
    action: v.string(),
    details: v.optional(v.any()),
    rowsAffected: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  }).index("by_action", ["action"]),
});
