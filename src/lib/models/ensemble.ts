/**
 * ODDLY Ensemble Prediction Wrapper
 *
 * Wraps the meta-ensemble model (worker/models/meta-ensemble.js) for use
 * in TypeScript API routes. Builds match features from Supabase data
 * and returns calibrated market probabilities.
 *
 * Replaces the inline Poisson model that was duplicated across settle/predict crons.
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeTeamName } from "@/lib/football/team-normalizer";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function clamp(v: number, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}

// ── Ensemble model singleton ──────────────────────────────────────────

let ensembleCache: any = null;

function loadEnsemble() {
  if (ensembleCache) return ensembleCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const metaEnsemble = require("../../../worker/models/meta-ensemble");
    ensembleCache = metaEnsemble;
    console.log("[ENSEMBLE] Loaded meta-ensemble v2.0");
    return ensembleCache;
  } catch (e: any) {
    console.error("[ENSEMBLE] Failed to load meta-ensemble:", e.message);
    return null;
  }
}

// ── Batch caches (per predict cron run) ──────────────────────────────
// These caches prevent N+1 DB queries when predicting many fixtures.
// Call resetBatchCaches() at the start of each predict cron run.
let leagueParamsCache: Record<string, any> = {};
let injuryCache: { data: any[]; loaded: boolean } = { data: [], loaded: false };
let weightConfigCache: any = null;
let restDaysCache: Record<string, string> = {};
let restDaysLoaded = false;

export function resetBatchCaches() {
  leagueParamsCache = {};
  injuryCache = { data: [], loaded: false };
  weightConfigCache = null;
  restDaysCache = {};
  restDaysLoaded = false;
  console.log("[ENSEMBLE] Batch caches reset");
}

// ── Team stats from historical matches ────────────────────────────────

interface TeamMatch {
  gf: number;
  ga: number;
  isHome: boolean;
}

interface TeamStats {
  ppg: number;
  homeGF: number;
  homeGA: number;
  awayGF: number;
  awayGA: number;
  scoresRate: number;
  concedesRate: number;
  homeWinRate: number;
  awayWinRate: number;
  cleanSheetRate: number;
  streak: number;
  matches: number;
}

function getTeamStats(history: TeamMatch[]): TeamStats {
  const h = history.slice(-15);
  if (h.length < 3) {
    return {
      ppg: 1.5, homeGF: 1.4, homeGA: 1.1, awayGF: 1.0, awayGA: 1.3,
      scoresRate: 0.7, concedesRate: 0.75, homeWinRate: 0.45, awayWinRate: 0.30,
      cleanSheetRate: 0.30, streak: 0, matches: h.length,
    };
  }
  const r10 = h.slice(-10);
  const home = h.filter((m) => m.isHome).slice(-8);
  const away = h.filter((m) => !m.isHome).slice(-8);

  // Compute streak (positive = wins, negative = losses)
  let streak = 0;
  for (let i = r10.length - 1; i >= 0; i--) {
    const m = r10[i];
    if (streak === 0) {
      streak = m.gf > m.ga ? 1 : m.gf < m.ga ? -1 : 0;
    } else if (streak > 0 && m.gf > m.ga) streak++;
    else if (streak < 0 && m.gf < m.ga) streak--;
    else break;
  }

  return {
    ppg: r10.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(5, r10.length),
    homeGF: home.reduce((s, m) => s + m.gf, 0) / Math.max(1, home.length),
    homeGA: home.reduce((s, m) => s + m.ga, 0) / Math.max(1, home.length),
    awayGF: away.reduce((s, m) => s + m.gf, 0) / Math.max(1, away.length),
    awayGA: away.reduce((s, m) => s + m.ga, 0) / Math.max(1, away.length),
    scoresRate: r10.filter((m) => m.gf > 0).length / Math.max(1, r10.length),
    concedesRate: r10.filter((m) => m.ga > 0).length / Math.max(1, r10.length),
    homeWinRate: home.filter((m) => m.gf > m.ga).length / Math.max(1, home.length),
    awayWinRate: away.filter((m) => m.gf > m.ga).length / Math.max(1, away.length),
    cleanSheetRate: r10.filter((m) => m.ga === 0).length / Math.max(1, r10.length),
    streak,
    matches: h.length,
  };
}

// ── Build features for the ensemble ───────────────────────────────────

function buildFeatures(
  homeStats: TeamStats,
  awayStats: TeamStats,
  elo: Record<string, number>,
  homeName: string,
  awayName: string,
  leagueAvgGoals?: number,
  extras?: {
    restDaysHome?: number;
    restDaysAway?: number;
    leagueHomeAdvantage?: number;
    homeHomeWinRate?: number;
    awayHomeWinRate?: number;
    homeInjuryImpact?: number;
    awayInjuryImpact?: number;
    homeInjuriesRuledOut?: number;
    awayInjuriesRuledOut?: number;
  }
) {
  const homeElo = elo[homeName] || 1500;
  const awayElo = elo[awayName] || 1500;
  // League-specific home advantage (default 65, overridden by historical data)
  const ha = extras?.leagueHomeAdvantage ?? 65;
  const eloDiff = homeElo - awayElo + ha;

  // Rest days (fatigue feature): fewer rest days = more fatigue = negative impact
  // Optimal is 3-4 days; <2 days is very tired; >7 days is rusty
  const restHome = extras?.restDaysHome ?? 4;
  const restAway = extras?.restDaysAway ?? 4;
  const fatigueHome = restHome < 2 ? -0.15 : restHome < 3 ? -0.05 : restHome > 7 ? -0.03 : 0;
  const fatigueAway = restAway < 2 ? -0.15 : restAway < 3 ? -0.05 : restAway > 7 ? -0.03 : 0;
  const fatigue = fatigueHome - fatigueAway; // positive = home less tired

  return {
    eloDiff,
    homePPG: homeStats.ppg,
    awayPPG: awayStats.ppg,
    homeGF: homeStats.homeGF,
    homeGA: homeStats.homeGA,
    awayGF: awayStats.awayGF,
    awayGA: awayStats.awayGA,
    cleanSheet: homeStats.cleanSheetRate,
    homeWinRate: homeStats.homeWinRate,
    awayWinRate: awayStats.awayWinRate,
    streak: homeStats.streak - awayStats.streak,
    fatigue,
    h2h: 0.5, // Default neutral H2H
    // Goals model features
    homeGFavg: homeStats.homeGF,
    homeGAavg: homeStats.homeGA,
    awayGFavg: awayStats.awayGF,
    awayGAavg: awayStats.awayGA,
    leagueAvgGoals: leagueAvgGoals || 2.6,
    // BTTS features
    homeScoresRate: homeStats.scoresRate,
    awayScoresRate: awayStats.scoresRate,
    homeConcedesRate: homeStats.concedesRate,
    awayConcedesRate: awayStats.concedesRate,
    // Injury features (from feature-store-loader or Supabase player_injury_data)
    homeInjuryImpact: extras?.homeInjuryImpact ?? 0,
    awayInjuryImpact: extras?.awayInjuryImpact ?? 0,
    homeInjuriesRuledOut: extras?.homeInjuriesRuledOut ?? 0,
    awayInjuriesRuledOut: extras?.awayInjuriesRuledOut ?? 0,
    // New features
    restDaysHome: restHome,
    restDaysAway: restAway,
    leagueHomeAdvantage: ha,
  };
}

// ── Market-odds features (opening odds only) ───────────────────────────
// Loaded lazily so tests / callers without fixtureId never touch the DB.

let marketFeatureModule: any = null;
function loadMarketFeature() {
  if (marketFeatureModule) return marketFeatureModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    marketFeatureModule = require("../../../worker/models/market-feature");
    return marketFeatureModule;
  } catch {
    return null;
  }
}

// ── Main prediction function ──────────────────────────────────────────

export interface EnsemblePrediction {
  markets: Record<string, number>;
  bestPick: { market: string; probability: number; tier: string };
  models: any;
  signals: any;
  modelVersion: string;
  // Traceability snapshots
  featureSnapshot: Record<string, any>;
  ensembleOutputs: Record<string, any>;
}

/**
 * Predict all markets for a match using the meta-ensemble.
 *
 * @param homeName - Home team canonical name
 * @param awayName - Away team canonical name
 * @param leagueId - League ID for league-specific adjustments
 * @param eloMap - Optional pre-loaded Elo ratings
 * @param formMap - Optional pre-loaded form histories
 * @param matchKickoff - Fixture kickoff (ISO). Used for rest-days and as the
 *   leakage-guard boundary for opening-odds market features.
 * @param options - Optional extras. `fixtureId` enables opening-odds market
 *   features: odds_snapshots strictly before kickoff are devigged into
 *   marketImpliedHome/Draw/Away (+ totals) and blended into the 1X2 output by
 *   worker/models/market-feature.js. Closing/post-kickoff odds are excluded
 *   by construction. Callers that do not pass fixtureId are unaffected.
 */
export async function predictMatchEnsemble(
  homeName: string,
  awayName: string,
  leagueId?: string,
  eloMap?: Record<string, number>,
  formMap?: Record<string, TeamMatch[]>,
  matchKickoff?: string,
  options?: { fixtureId?: string }
): Promise<EnsemblePrediction | null> {
  const ensemble = loadEnsemble();
  if (!ensemble) return null;

  // Build Elo if not provided
  const elo = eloMap || {};
  if (!eloMap) {
    const { data: histFixtures } = await supabaseAdmin
      .from("fixtures")
      .select(
        "home_score, away_score, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)"
      )
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .limit(2000);

    if (histFixtures) {
      for (const f of histFixtures) {
        const home = (f as any).home?.canonical_name;
        const away = (f as any).away?.canonical_name;
        if (!home || !away) continue;
        const h = (elo[home] || 1500) + 65;
        const a = elo[away] || 1500;
        const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
        const actual = f.home_score > f.away_score ? 1 : f.home_score < f.away_score ? 0 : 0.5;
        elo[home] = (elo[home] || 1500) + 32 * (actual - eH);
        elo[away] = (elo[away] || 1500) + 32 * (1 - actual - (1 - eH));
      }
    }
  }

  // Build form histories if not provided
  const form = formMap || {};
  if (!formMap) {
    const { data: histFixtures } = await supabaseAdmin
      .from("fixtures")
      .select(
        "home_score, away_score, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)"
      )
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .limit(2000);

    if (histFixtures) {
      for (const f of histFixtures) {
        const home = (f as any).home?.canonical_name;
        const away = (f as any).away?.canonical_name;
        if (!home || !away) continue;
        if (!form[home]) form[home] = [];
        if (!form[away]) form[away] = [];
        form[home].push({ gf: f.home_score, ga: f.away_score, isHome: true });
        form[away].push({ gf: f.away_score, ga: f.home_score, isHome: false });
        if (form[home].length > 15) form[home].shift();
        if (form[away].length > 15) form[away].shift();
      }
    }
  }

  // Get team stats
  const homeStats = getTeamStats(form[homeName] || []);
  const awayStats = getTeamStats(form[awayName] || []);

  // ── Compute rest days from fixture dates (batch-cached) ──
  let restDaysHome = 4;
  let restDaysAway = 4;
  try {
    const matchTime = matchKickoff ? new Date(matchKickoff) : new Date();

    // Batch-load rest days for all teams on first call this cron run
    if (!restDaysLoaded) {
      const { data: recentFixtures } = await supabaseAdmin
        .from("fixtures")
        .select("kickoff_time, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
        .eq("status", "finished")
        .gte("kickoff_time", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order("kickoff_time", { ascending: false })
        .limit(2000);

      // For each team, find their most recent fixture before the query cutoff
      const teamLastFixture: Record<string, string> = {};
      for (const f of recentFixtures || []) {
        const teams = [
          (f as any).home?.canonical_name,
          (f as any).away?.canonical_name,
        ].filter(Boolean);
        for (const teamName of teams) {
          const normalized = normalizeTeamName(teamName);
          if (!teamLastFixture[normalized] && f.kickoff_time) {
            teamLastFixture[normalized] = f.kickoff_time;
          }
        }
      }
      restDaysCache = teamLastFixture;
      restDaysLoaded = true;
    }

    // Look up rest days from batch cache (try both raw and normalized keys)
    const lastHome = restDaysCache[homeName] || restDaysCache[normalizeTeamName(homeName)];
    const lastAway = restDaysCache[awayName] || restDaysCache[normalizeTeamName(awayName)];
    if (lastHome) {
      const diffDays = (matchTime.getTime() - new Date(lastHome).getTime()) / (1000 * 60 * 60 * 24);
      restDaysHome = Math.max(1, Math.min(14, Math.round(diffDays)));
    }
    if (lastAway) {
      const diffDays = (matchTime.getTime() - new Date(lastAway).getTime()) / (1000 * 60 * 60 * 24);
      restDaysAway = Math.max(1, Math.min(14, Math.round(diffDays)));
    }
  } catch {}

  // ── Compute league-specific home advantage (with cache) ──
  let leagueHomeAdvantage = 65; // default
  let leagueAvgGoals = 2.6;

  // Get store data (league params, weight config)
  const storeData: any = {};
  if (leagueId && !leagueParamsCache[leagueId]) {
    try {
      // Resolve league UUID to name
      const { data: league } = await supabaseAdmin
        .from("leagues")
        .select("name")
        .eq("id", leagueId)
        .single();
      const leagueName = league?.name;
      if (leagueName) {
        const { data: lp } = await supabaseAdmin
          .from("league_model_params")
          .select("*")
          .eq("league_name", leagueName)
          .single();
        leagueParamsCache[leagueId] = lp || { home_advantage: 65, goal_expectancy: 2.6 };
      } else {
        leagueParamsCache[leagueId] = { home_advantage: 65, goal_expectancy: 2.6 };
      }
    } catch {
      leagueParamsCache[leagueId] = { home_advantage: 65, goal_expectancy: 2.6 };
    }
  }
  if (leagueId && leagueParamsCache[leagueId]) {
    const lp = leagueParamsCache[leagueId];
    storeData.leagueParams = lp;
    if (lp.home_advantage) leagueHomeAdvantage = lp.home_advantage;
    if (lp.goal_expectancy) leagueAvgGoals = lp.goal_expectancy;
  }

  if (!weightConfigCache) {
    try {
      // Learned weights are stored under "production_v5"; fall back to
      // "default" then to the most recently trained config for resilience.
      let { data: wc } = await supabaseAdmin
        .from("model_weight_config")
        .select("*")
        .eq("config_name", "production_v5")
        .maybeSingle();
      if (!wc) {
        ({ data: wc } = await supabaseAdmin
          .from("model_weight_config")
          .select("*")
          .eq("config_name", "default")
          .maybeSingle());
      }
      if (!wc) {
        ({ data: wc } = await supabaseAdmin
          .from("model_weight_config")
          .select("*")
          .order("trained_at", { ascending: false })
          .limit(1)
          .maybeSingle());
      }
      weightConfigCache = wc || null;
    } catch {}
  }
  if (weightConfigCache) storeData.weightConfig = weightConfigCache;

  // ── Load injury data from feature store (with cache) ──
  let homeInjuryImpact = 0;
  let awayInjuryImpact = 0;
  let homeInjuriesRuledOut = 0;
  let awayInjuriesRuledOut = 0;
  try {
    if (!injuryCache.loaded) {
      const { data: injData } = await supabaseAdmin
        .from("player_injury_data")
        .select("team_name, status, player_importance");
      injuryCache.data = injData || [];
      injuryCache.loaded = true;
    }
    const injData = injuryCache.data;
    if (injData.length > 0) {
      const calcImpact = (teamInjuries: any[]) => {
        const injured = teamInjuries.filter((i: any) => i.status === "injured");
        const suspended = teamInjuries.filter((i: any) => i.status === "suspended");
        const doubtful = teamInjuries.filter((i: any) =>
          i.status?.startsWith("doubtful") || i.status === "questionable" || i.status === "likely"
        );
        const avgImp = (list: any[]) =>
          list.length > 0 ? list.reduce((s: number, i: any) => s + (i.player_importance || 5), 0) / list.length : 0;
        const injScore = injured.length * (avgImp(injured) / 5) * 0.02;
        const susScore = suspended.length * (avgImp(suspended) / 5) * 0.025;
        const douScore = doubtful.length * (avgImp(doubtful) / 5) * 0.008;
        return { impact: -(injScore + susScore + douScore), ruledOut: injured.length };
      };
      // Match by normalized name (case-insensitive)
      const homeInj = calcImpact(injData.filter((i: any) => i.team_name?.toLowerCase() === homeName.toLowerCase()));
      const awayInj = calcImpact(injData.filter((i: any) => i.team_name?.toLowerCase() === awayName.toLowerCase()));
      homeInjuryImpact = homeInj.impact;
      awayInjuryImpact = awayInj.impact;
      homeInjuriesRuledOut = homeInj.ruledOut;
      awayInjuriesRuledOut = awayInj.ruledOut;
    }
  } catch {}

  // Build features with rest days, league-specific home advantage, and injury data
  const features = buildFeatures(homeStats, awayStats, elo, homeName, awayName, leagueAvgGoals, {
    restDaysHome,
    restDaysAway,
    leagueHomeAdvantage,
    homeInjuryImpact,
    awayInjuryImpact,
    homeInjuriesRuledOut,
    awayInjuriesRuledOut,
  });

  // ── Opening-odds market features (opt-in via options.fixtureId) ──
  // Only snapshots strictly before kickoff are eligible — see
  // worker/models/market-feature.js leakage guards. Failures are silent:
  // predictions must never depend on odds availability.
  if (options?.fixtureId && matchKickoff) {
    try {
      const mf = loadMarketFeature();
      if (mf) {
        const { data: oddsRows } = await supabaseAdmin
          .from("odds_snapshots")
          .select("fixture_id, bookmaker, market, selection, odds, snapshot_time")
          .eq("fixture_id", options.fixtureId)
          .order("snapshot_time", { ascending: true })
          .limit(2000);
        if (oddsRows && oddsRows.length > 0) {
          const marketFeats = mf.computeOpeningOddsFeatures(oddsRows, matchKickoff);
          if (marketFeats.hasMarketOdds) {
            Object.assign(features, marketFeats);
            (features as any).hasMarketOdds = true;
          }
        }
      }
    } catch {}
  }

  // Run ensemble prediction
  try {
    const result = ensemble.predictMatch(features, storeData);

    // Attach traceability snapshots
    result.featureSnapshot = {
      // Core features
      eloDiff: features.eloDiff,
      homePPG: features.homePPG,
      awayPPG: features.awayPPG,
      homeGF: features.homeGF,
      homeGA: features.homeGA,
      awayGF: features.awayGF,
      awayGA: features.awayGA,
      cleanSheet: features.cleanSheet,
      homeWinRate: features.homeWinRate,
      awayWinRate: features.awayWinRate,
      streak: features.streak,
      // Goals features
      leagueAvgGoals: features.leagueAvgGoals,
      homeScoresRate: features.homeScoresRate,
      awayScoresRate: features.awayScoresRate,
      // Team stats snapshot
      homeTeamStats: homeStats,
      awayTeamStats: awayStats,
      // Elo snapshot
      homeElo: elo[homeName] || 1500,
      awayElo: elo[awayName] || 1500,
      // Store data used
      hasLeagueParams: !!storeData.leagueParams,
      hasWeightConfig: !!storeData.weightConfig,
      // Opening-odds market features (present only when fixtureId was passed
      // and provably pre-kickoff snapshots existed)
      hasMarketOdds: !!(features as any).hasMarketOdds,
      marketImpliedHome: (features as any).marketImpliedHome,
      marketImpliedDraw: (features as any).marketImpliedDraw,
      marketImpliedAway: (features as any).marketImpliedAway,
      marketOpeningSnapshotTime: (features as any).marketOpeningSnapshotTime,
    };

    result.ensembleOutputs = {
      models: result.models,
      signals: result.signals,
      bestPick: result.bestPick,
      modelVersion: result.modelVersion,
      marketsCount: Object.keys(result.markets).length,
    };

    return result as EnsemblePrediction;
  } catch (e: any) {
    console.error("[ENSEMBLE] Prediction failed:", e.message);
    return null;
  }
}

/**
 * Tri-state settlement outcome.
 *  - "correct" / "wrong": determinable from the scoreline.
 *  - "void": the bet pushes/refunds under real bookmaker rules
 *    (exact-line O/U or team-total push, DNB draw). Neither win nor loss.
 *  - "undetermined": the market/selection cannot be mapped to a rule
 *    (unknown market, unparseable line, conflicting market vs selection
 *    encodings). Callers should leave the prediction pending rather than guess.
 */
export type PredictionOutcome = "correct" | "wrong" | "void" | "undetermined";

/** Parse a line like "over_2.5" / "under_3" → { side, line } or null. */
function parseOverUnder(sel: string): { side: "over" | "under"; line: number } | null {
  const m = sel.match(/^(over|under)[_\s]*([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  const line = parseFloat(m[2]);
  if (!isFinite(line) || line < 0) return null;
  return { side: m[1] as "over" | "under", line };
}

/** Compare a goals count to an O/U-style line. Push (exact line) → "void". */
function goalsVsLine(goals: number, ou: { side: "over" | "under"; line: number }): PredictionOutcome {
  if (goals === ou.line) return "void";
  const wins = ou.side === "over" ? goals > ou.line : goals < ou.line;
  return wins ? "correct" : "wrong";
}

const DC_CODES = ["1x", "x2", "12"] as const;
type DcCode = (typeof DC_CODES)[number];

/** Normalize a double-chance encoding from market suffix or selection. */
function dcCodeFromToken(token: string | undefined): DcCode | null {
  if (!token) return null;
  const t = token.toLowerCase();
  if (t === "1x" || t === "home_draw" || t === "1x2_home_draw") return "1x";
  if (t === "x2" || t === "draw_away") return "x2";
  if (t === "12" || t === "home_away") return "12";
  return null;
}

function dcOutcome(code: DcCode, homeScore: number, awayScore: number): PredictionOutcome {
  switch (code) {
    case "1x": return homeScore >= awayScore ? "correct" : "wrong";
    case "x2": return homeScore <= awayScore ? "correct" : "wrong";
    case "12": return homeScore !== awayScore ? "correct" : "wrong";
  }
}

/**
 * Canonical result-checking logic used by the settle cron
 * (src/app/api/v1/cron/settle/route.ts) and smart_selection settlement.
 * Returns a tri-state outcome; see PredictionOutcome for semantics.
 */
export function checkPredictionOutcome(
  pred: Record<string, any>,
  market: string,
  selection: string,
  homeScore: number,
  awayScore: number
): PredictionOutcome {
  const total = homeScore + awayScore;
  const homeWin = homeScore > awayScore;
  const draw = homeScore === awayScore;
  const awayWin = homeScore < awayScore;
  const bothScore = homeScore > 0 && awayScore > 0;
  const sel = (selection || "").toLowerCase().trim();
  const mkt = (market || "").toLowerCase().trim();

  if (mkt === "1x2" || mkt === "match_result" || mkt === "h2h") {
    // Accept "home"/"draw"/"away" plus numeric bookmaker-style "1"/"x"/"2".
    const s = sel === "1" ? "home" : sel === "x" ? "draw" : sel === "2" ? "away" : sel;
    if (s === "home") return homeWin ? "correct" : "wrong";
    if (s === "draw") return draw ? "correct" : "wrong";
    if (s === "away") return awayWin ? "correct" : "wrong";
    return "undetermined";
  }

  // Over/Under: market is "ou" / "over_under" / "totals", selection "over_2.5" etc.
  if (mkt === "over_under" || mkt === "ou" || mkt === "totals") {
    const ou = parseOverUnder(sel);
    if (!ou) return "undetermined";
    return goalsVsLine(total, ou);
  }

  if (mkt === "btts" || mkt.includes("btts")) {
    // Accept "yes"/"no" and compound "btts_yes"/"btts_no".
    const s = sel.replace(/^btts_/, "");
    if (s === "yes") return bothScore ? "correct" : "wrong";
    if (s === "no") return bothScore ? "wrong" : "correct";
    return "undetermined";
  }

  // Double Chance — market may be "dc" (selection carries the code) or
  // "dc_1x"/"dc_x2"/"dc_12" (market carries it). If both encodings exist and
  // disagree, the bet is ambiguous → undetermined rather than a guess.
  if (mkt === "dc" || mkt.startsWith("dc_")) {
    const mktCode = dcCodeFromToken(mkt.startsWith("dc_") ? mkt.slice(3) : undefined);
    const selCode = dcCodeFromToken(sel);
    if (mktCode && selCode && mktCode !== selCode) return "undetermined";
    const code = mktCode ?? selCode;
    if (!code) return "undetermined";
    return dcOutcome(code, homeScore, awayScore);
  }

  // Draw No Bet — a draw voids the bet under bookmaker rules.
  if (mkt === "dnb" || mkt === "draw_no_bet") {
    if (sel === "home") return draw ? "void" : homeWin ? "correct" : "wrong";
    if (sel === "away") return draw ? "void" : awayWin ? "correct" : "wrong";
    return "undetermined";
  }

  // Team totals — selection carries over/under + line; direction matters
  // (previously "under_X" was scored as an over bet — fixed).
  if (mkt === "homegoals" || mkt === "home_goals") {
    const ou = parseOverUnder(sel);
    if (!ou) return "undetermined";
    return goalsVsLine(homeScore, ou);
  }
  if (mkt === "awaygoals" || mkt === "away_goals") {
    const ou = parseOverUnder(sel);
    if (!ou) return "undetermined";
    return goalsVsLine(awayScore, ou);
  }

  if (mkt === "smart_selection") {
    const ss = pred["smart_selection"];
    if (!ss || !ss.market || !ss.selection) return "undetermined";
    return checkPredictionOutcome(pred, ss.market, ss.selection, homeScore, awayScore);
  }

  return "undetermined";
}

/**
 * Check if a prediction is correct given actual scores.
 * Boolean view of checkPredictionOutcome: only "correct" returns true.
 * "void"/"undetermined" return false — callers that care about honest
 * settlement (the settle cron) should use checkPredictionOutcome directly.
 */
export function checkPrediction(
  pred: Record<string, any>,
  market: string,
  selection: string,
  homeScore: number,
  awayScore: number
): boolean {
  return checkPredictionOutcome(pred, market, selection, homeScore, awayScore) === "correct";
}
