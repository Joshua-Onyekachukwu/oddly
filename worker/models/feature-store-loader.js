/**
 * ODDLY Feature Store Loader
 *
 * Replaces all local JSON file reads with Supabase queries.
 * Caches results in memory for the duration of a prediction run.
 *
 * Architecture:
 * ┌─────────────┐
 * │ Supabase    │  team_feature_profiles
 * │ Feature     │  referee_feature_profiles
 * │ Store       │  league_model_params
 * │             │  model_weight_config
 * │             │  odds_feature_cache
 * │             │  player_injury_data
 * └──────┬──────┘
 *        ↓
 * ┌──────────────┐
 * │  Loader      │  Caches all data in memory
 * │  (this)      │  Provides lookup functions
 * └──────┬───────┘
 *        ↓
 * ┌──────────────┐
 * │  Models      │  market-1x2, market-goals, etc.
 * └──────────────┘
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "../..", ".env.local");
  const env = {};
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      env[t.slice(0, i).trim()] = v;
    }
  } catch {}
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL || "", env.SUPABASE_SERVICE_ROLE_KEY || "");

// ─── In-Memory Cache ─────────────────────────────────────────────────────
const cache = {
  teamProfiles: null,     // { teamName: {...} }
  refereeProfiles: null,  // { refereeName: {...} }
  leagueParams: null,     // { leagueName: {...} }
  weightConfig: null,     // {...}
  injuries: null,         // { teamName: [{...}] }
  loaded: false,
  loadedAt: null,
};

/**
 * Load all feature store data from Supabase.
 * Call once at startup of prediction run.
 */
async function loadAll() {
  if (cache.loaded) return cache;

  console.log("   📦 Loading feature store from Supabase...");

  const [teamResult, refereeResult, leagueResult, weightResult, injuryResult] = await Promise.all([
    sb.from("team_feature_profiles").select("*"),
    sb.from("referee_feature_profiles").select("*"),
    sb.from("league_model_params").select("*"),
    sb.from("model_weight_config").select("*").eq("config_name", "production_v5").single(),
    sb.from("player_injury_data").select("*"),
  ]);

  // Index team profiles by name
  cache.teamProfiles = {};
  for (const t of teamResult.data || []) {
    cache.teamProfiles[t.team_name] = t;
  }

  // Index referee profiles by name
  cache.refereeProfiles = {};
  for (const r of refereeResult.data || []) {
    cache.refereeProfiles[r.name] = r;
  }

  // Index league params by name
  cache.leagueParams = {};
  for (const l of leagueResult.data || []) {
    cache.leagueParams[l.league_name] = l;
  }

  // Weight config
  cache.weightConfig = weightResult.data || null;

  // Index injuries by team
  cache.injuries = {};
  for (const inj of injuryResult.data || []) {
    if (!cache.injuries[inj.team_name]) cache.injuries[inj.team_name] = [];
    cache.injuries[inj.team_name].push(inj);
  }

  cache.loaded = true;
  cache.loadedAt = new Date();

  const stats = {
    teams: Object.keys(cache.teamProfiles).length,
    referees: Object.keys(cache.refereeProfiles).length,
    leagues: Object.keys(cache.leagueParams).length,
    weightConfig: !!cache.weightConfig,
    injuredTeams: Object.keys(cache.injuries).length,
  };
  console.log(`   ✅ Feature store loaded: ${stats.teams} teams, ${stats.referees} referees, ${stats.leagues} leagues`);

  return cache;
}

/**
 * Get team profile by name.
 */
function getTeamProfile(teamName) {
  return cache.teamProfiles?.[teamName] || null;
}

/**
 * Get referee profile by name.
 */
function getRefereeProfile(name) {
  return cache.refereeProfiles?.[name] || null;
}

/**
 * Get league model parameters by name.
 */
function getLeagueParams(leagueName) {
  return cache.leagueParams?.[leagueName] || null;
}

/**
 * Get optimized weight configuration.
 */
function getWeightConfig() {
  return cache.weightConfig || null;
}

/**
 * Get injury data for a team.
 */
function getTeamInjuries(teamName) {
  return cache.injuries?.[teamName] || [];
}

/**
 * Compute injury impact for a team.
 * Uses player_importance (1-10) to weight impact: key players hurt more.
 */
function getInjuryImpact(teamName) {
  const injuries = getTeamInjuries(teamName);
  const ruledOut = injuries.filter((i) => i.status === "injured");
  const suspended = injuries.filter((i) => i.status === "suspended");
  const doubtful = injuries.filter((i) =>
    i.status?.startsWith("doubtful") || i.status === "questionable" || i.status === "likely"
  );

  // Weighted impact: key players (importance 8-10) cause 2-3x more damage
  const avgImportance = (list) => {
    if (list.length === 0) return 0;
    return list.reduce((s, i) => s + (i.player_importance || 5), 0) / list.length;
  };

  const injScore = ruledOut.length * (avgImportance(ruledOut) / 5) * 0.02;
  const susScore = suspended.length * (avgImportance(suspended) / 5) * 0.025;
  const douScore = doubtful.length * (avgImportance(doubtful) / 5) * 0.008;
  const impact = -(injScore + susScore + douScore);

  return {
    ruled_out: ruledOut.length,
    suspended: suspended.length,
    doubtful: doubtful.length,
    impact,
  };
}

/**
 * Build feature vector for a match from Supabase data.
 * This replaces the local JSON feature building.
 */
function buildFeatures(homeName, awayName, tracker, leagueName) {
  const homeProfile = getTeamProfile(homeName) || {};
  const awayProfile = getTeamProfile(awayName) || {};
  const leagueParams = getLeagueParams(leagueName);
  const weightConfig = getWeightConfig();

  // Referee features
  const homeInj = getInjuryImpact(homeName);
  const awayInj = getInjuryImpact(awayName);

  // Build from tracker (computed from historical fixtures)
  const trackerFeatures = tracker?.getFeatures(homeName, awayName, null) || {};
  const hf = trackerFeatures.features?.hf || {};
  const af = trackerFeatures.features?.af || {};

  // Merge Supabase profile data with tracker-computed data
  return {
    // Names
    homeName,
    awayName,

    // From Supabase team profiles
    homeGF: homeProfile.goals_for_per_game || hf.homeGoalsFor || 1.4,
    homeGA: homeProfile.goals_against_per_game || hf.homeGoalsAgainst || 1.1,
    awayGF: awayProfile.goals_for_per_game || af.awayGoalsFor || 1.0,
    awayGA: awayProfile.goals_against_per_game || af.awayGoalsAgainst || 1.3,
    cleanSheet: (homeProfile.win_rate || 0.4) - (awayProfile.win_rate || 0.3),
    homeWinRate: homeProfile.home_win_rate || 0.45,
    awayWinRate: awayProfile.away_win_rate || 0.3,
    streak: (hf.streak || 0) * 0.05 - (af.streak || 0) * 0.03,
    fatigue: ((hf.lastMatchDaysAgo || 7) - (af.lastMatchDaysAgo || 7)) * 0.005,
    h2h: (trackerFeatures.features?.h2hHomeWins || 0.4) - 0.4,
    homePPG: homeProfile.form_points || hf.homePPG || 1.6,
    awayPPG: awayProfile.form_points || af.awayPPG || 1.2,

    // Elo
    eloDiff: trackerFeatures.features?.eloDiff || 0,
    eloHome: tracker?.elo?.[homeName] || 1500,
    eloAway: tracker?.elo?.[awayName] || 1500,

    // xG (from Supabase profiles)
    homeXG: homeProfile.avg_xg || null,
    homeXGA: homeProfile.avg_xga || null,
    homeXGLast5: homeProfile.xg_last5 || null,
    homeXGHome: homeProfile.home_xg || null,
    awayXG: awayProfile.avg_xg || null,
    awayXGA: awayProfile.avg_xga || null,
    awayXGLast5: awayProfile.xg_last5 || null,
    awayXGAway: awayProfile.away_xg || null,
    homePPDA: homeProfile.avg_ppda || null,
    awayPPDA: awayProfile.avg_ppda || null,

    // Player impact (from Supabase)
    homePlayerImpact: homeProfile.player_impact_score || 5,
    awayPlayerImpact: awayProfile.player_impact_score || 5,
    homeSquadDepth: homeProfile.squad_depth || 5,
    awaySquadDepth: awayProfile.squad_depth || 5,

    // Injury impact
    homeInjuryImpact: homeInj.impact,
    awayInjuryImpact: awayInj.impact,
    homeInjuriesRuledOut: homeInj.ruled_out,
    awayInjuriesRuledOut: awayInj.ruled_out,

    // League position (from tracker)
    homePos: trackerFeatures.features?.homePos || 10,
    awayPos: trackerFeatures.features?.awayPos || 10,
  };
}

module.exports = {
  loadAll,
  getTeamProfile,
  getRefereeProfile,
  getLeagueParams,
  getWeightConfig,
  getTeamInjuries,
  getInjuryImpact,
  buildFeatures,
  cache,
};
