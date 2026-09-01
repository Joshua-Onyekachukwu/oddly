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
    // New features
    restDaysHome: restHome,
    restDaysAway: restAway,
    leagueHomeAdvantage: ha,
  };
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
 */
export async function predictMatchEnsemble(
  homeName: string,
  awayName: string,
  leagueId?: string,
  eloMap?: Record<string, number>,
  formMap?: Record<string, TeamMatch[]>,
  matchKickoff?: string
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

  // ── Compute rest days from fixture dates ──
  let restDaysHome = 4;
  let restDaysAway = 4;
  try {
    // Get last 2 finished fixtures for each team
    const { data: homeFixtures } = await supabaseAdmin
      .from("fixtures")
      .select("id, kickoff_time, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
      .eq("status", "finished")
      .or(`home.team.canonical_name.eq.${homeName},away.team.canonical_name.eq.${homeName}`)
      .order("kickoff_time", { ascending: false })
      .limit(2);

    const { data: awayFixtures } = await supabaseAdmin
      .from("fixtures")
      .select("id, kickoff_time, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
      .eq("status", "finished")
      .or(`home.team.canonical_name.eq.${awayName},away.team.canonical_name.eq.${awayName}`)
      .order("kickoff_time", { ascending: false })
      .limit(2);

    // Compute rest days relative to the upcoming match kickoff (not now)
    const matchTime = matchKickoff ? new Date(matchKickoff) : new Date();
    if (homeFixtures?.length && (homeFixtures[0] as any).kickoff_time) {
      const lastKickoff = new Date((homeFixtures[0] as any).kickoff_time);
      const diffDays = (matchTime.getTime() - lastKickoff.getTime()) / (1000 * 60 * 60 * 24);
      restDaysHome = Math.max(1, Math.min(14, Math.round(diffDays)));
    }
    if (awayFixtures?.length && (awayFixtures[0] as any).kickoff_time) {
      const lastKickoff = new Date((awayFixtures[0] as any).kickoff_time);
      const diffDays = (matchTime.getTime() - lastKickoff.getTime()) / (1000 * 60 * 60 * 24);
      restDaysAway = Math.max(1, Math.min(14, Math.round(diffDays)));
    }
  } catch {}

  // ── Compute league-specific home advantage ──
  let leagueHomeAdvantage = 65; // default
  let leagueAvgGoals = 2.6;

  // Get store data (league params, weight config)
  const storeData: any = {};
  if (leagueId) {
    try {
      const { data: lp } = await supabaseAdmin
        .from("league_model_params")
        .select("*")
        .eq("league_id", leagueId)
        .single();
      if (lp) {
        storeData.leagueParams = lp;
        // Use league-specific home advantage if available
        if (lp.home_advantage) leagueHomeAdvantage = lp.home_advantage;
        if (lp.goal_expectancy) leagueAvgGoals = lp.goal_expectancy;
      }
    } catch {}
  }

  try {
    const { data: wc } = await supabaseAdmin
      .from("model_weight_config")
      .select("*")
      .eq("config_name", "default")
      .single();
    if (wc) storeData.weightConfig = wc;
  } catch {}

  // Build features with rest days and league-specific home advantage
  const features = buildFeatures(homeStats, awayStats, elo, homeName, awayName, leagueAvgGoals, {
    restDaysHome,
    restDaysAway,
    leagueHomeAdvantage,
  });

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
 * Check if a prediction is correct given actual scores.
 * Reuses the checkPrediction logic from the settle cron.
 */
export function checkPrediction(
  pred: Record<string, any>,
  market: string,
  selection: string,
  homeScore: number,
  awayScore: number
): boolean {
  const total = homeScore + awayScore;
  const homeWin = homeScore > awayScore;
  const draw = homeScore === awayScore;
  const awayWin = homeScore < awayScore;
  const bothScore = homeScore > 0 && awayScore > 0;
  const sel = (selection || "").toLowerCase();

  if (market === "1X2") {
    return (sel === "home" && homeWin) || (sel === "draw" && draw) || (sel === "away" && awayWin);
  }
  if (market.startsWith("ou_over_") || selection?.startsWith("Over_")) {
    const line = parseFloat(market.split("_").pop() || selection?.split("_").pop() || "2.5");
    return total > line;
  }
  if (market.startsWith("ou_under_") || selection?.startsWith("Under_")) {
    const line = parseFloat(market.split("_").pop() || selection?.split("_").pop() || "2.5");
    return total < line;
  }
  if (market === "btts") return sel === "yes" ? bothScore : !bothScore;
  if (market === "dc_1x") return homeScore >= awayScore;
  if (market === "dc_x2") return homeScore <= awayScore;
  if (market === "dc_12") return homeScore !== awayScore;
  if (market === "dnb_home") return homeWin;
  if (market === "dnb_away") return awayWin;
  if (market === "homegoals_over_0.5") return homeScore > 0.5;
  if (market === "homegoals_over_1.5") return homeScore > 1.5;
  if (market === "awaygoals_over_0.5") return awayScore > 0.5;
  if (market === "awaygoals_over_1.5") return awayScore > 1.5;
  if (market === "smart_selection") {
    const ss = pred["smart_selection"];
    if (!ss) return false;
    return checkPrediction(pred, ss.market, ss.selection, homeScore, awayScore);
  }
  return false;
}
