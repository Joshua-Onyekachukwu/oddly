#!/usr/bin/env node

/**
 * ODDLY Feature Store Sync
 *
 * Pushes all local JSON feature data to Supabase tables.
 * Run once to migrate, then local JSON files become unnecessary.
 *
 * Usage: node worker/feature-store-sync.js [--dry-run]
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const DRY_RUN = process.argv.includes("--dry-run");

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", filename), "utf8"));
  } catch (e) {
    console.log(`  ⚠️  ${filename}: ${e.message}`);
    return null;
  }
}

async function upsertBatch(table, records, batchSize = 200) {
  let inserted = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    if (DRY_RUN) {
      inserted += batch.length;
      continue;
    }
    const { error } = await sb.from(table).upsert(batch, { onConflict: "team_name,name,config_name,fixture_id" });
    if (error) {
      // Try without onConflict for tables that don't have unique constraint on that column
      const { error: err2 } = await sb.from(table).upsert(batch);
      if (err2) {
        console.log(`  ⚠️  Batch error at ${i}: ${err2.message}`);
      } else {
        inserted += batch.length;
      }
    } else {
      inserted += batch.length;
    }
  }
  return inserted;
}

// ─── Sync Team Feature Profiles ──────────────────────────────────────────
async function syncTeamFeatures() {
  console.log("\n📊 Syncing team feature profiles...");

  // From team-composite-ratings.json
  const ratings = loadJSON("team-composite-ratings.json");
  if (!ratings) return 0;

  const records = [];
  for (const [teamName, data] of Object.entries(ratings)) {
    records.push({
      team_name: teamName,
      attack_rating: data.attackRating || null,
      defense_rating: data.defenseRating || null,
      goals_for_per_game: data.goalsFor || null,
      goals_against_per_game: data.goalsAgainst || null,
      win_rate: data.winRate || null,
      home_win_rate: data.homeWinRate || null,
      away_win_rate: data.awayWinRate || null,
      shots_per_game: data.shotsPerGame || null,
      fouls_per_game: data.foulsPerGame || null,
      yellow_per_game: data.yellowPerGame || null,
      corners_per_game: data.cornersPerGame || null,
      recent_form: data.recentForm || data.form || null,
      form_points: data.form || null,
      goal_diff_per_game: data.goalDiff || null,
    });
  }

  // Enrich with player impacts
  const playerImpacts = loadJSON("team-player-impacts.json");
  if (playerImpacts) {
    for (const rec of records) {
      const pi = playerImpacts[rec.team_name];
      if (pi) {
        rec.player_impact_score = pi.player_impact_score || null;
        rec.squad_depth = pi.squad_depth || null;
        rec.top_player_goals = pi.top_player_goals || null;
        rec.pis_1x2_impact = pi.pis_1x2_impact || null;
        rec.shot_accuracy = pi.shot_accuracy || null;
        rec.defensive_solidity = pi.defensive_solidity || null;
      }
    }
  }

  // Enrich with injury impact
  const injuryImpact = loadJSON("team-injury-impact.json");
  if (injuryImpact) {
    for (const rec of records) {
      const inj = injuryImpact[rec.team_name];
      if (inj) {
        rec.injuries_per_match = inj.injuries_per_match || null;
        rec.injury_impact_per_match = inj.injury_impact_per_match || null;
        rec.avg_injury_severity = inj.avg_severity || null;
        rec.key_player_injuries = inj.key_player_injuries || null;
      }
    }
  }

  // Enrich with xG features (StatsBomb)
  const statsbombXg = loadJSON("statsbomb-xg.json");
  if (statsbombXg?.features) {
    for (const rec of records) {
      const xg = statsbombXg.features[rec.team_name];
      if (xg) {
        rec.avg_xg = xg.avg_xg || null;
        rec.avg_xga = xg.avg_xga || null;
        rec.xg_last5 = xg.xg_last5 || null;
        rec.home_xg = xg.home_xg || null;
        rec.away_xg = xg.away_xg || null;
        rec.home_xga = xg.home_xga || null;
        rec.away_xga = xg.away_xga || null;
        rec.avg_ppda = xg.avg_ppda || null;
        rec.avg_deep = xg.avg_deep || null;
        rec.avg_shots = xg.avg_shots || null;
        rec.avg_big_chances = xg.avg_big_chances || null;
        rec.npxg_ratio = xg.npxg_ratio || null;
        rec.xg_source = "statsbomb";
      }
    }
  }

  // Enrich with Understat xG
  const understat = loadJSON("understat-xg.json");
  if (understat?.teams) {
    for (const rec of records) {
      if (rec.avg_xg) continue; // StatsBomb already has it
      // Find matching understat team
      for (const [key, data] of Object.entries(understat.teams)) {
        const teamPart = key.split(/_EPL_|_La_liga_|_Bundesliga_|_Serie_A_|_Ligue_1_/)[0];
        if (teamPart.toLowerCase() === rec.team_name.toLowerCase()) {
          rec.avg_xg = data.avg_xg || null;
          rec.avg_xga = data.avg_xga || null;
          rec.xg_last5 = data.xg_last5 || null;
          rec.home_xg = data.home_xg || null;
          rec.away_xg = data.away_xg || null;
          rec.home_xga = data.home_xga || null;
          rec.away_xga = data.away_xga || null;
          rec.xg_source = "understat";
          break;
        }
      }
    }
  }

  const count = await upsertBatch("team_feature_profiles", records);
  console.log(`  ✅ ${count} team feature profiles synced`);
  return count;
}

// ─── Sync Referee Profiles ───────────────────────────────────────────────
async function syncRefereeProfiles() {
  console.log("\n👨‍⚖️ Syncing referee profiles...");

  const data = loadJSON("referee-profiles.json");
  if (!data || !Array.isArray(data)) return 0;

  const records = data.map((r) => ({
    name: r.name,
    matches_officiated: r.matches || 0,
    home_win_pct: r.homeWinPct || null,
    draw_pct: r.drawPct || null,
    away_win_pct: r.awayWinPct || null,
    btts_pct: r.bttsPct || null,
    over25_pct: r.over25Pct || null,
    avg_goals: r.avgGoals || null,
    avg_yellow: r.avgYellow || null,
    avg_red: r.avgRed || null,
    avg_fouls: r.avgFouls || null,
    home_bias: r.homeBias || null,
    leagues: r.leagues || [],
  }));

  const count = await upsertBatch("referee_feature_profiles", records);
  console.log(`  ✅ ${count} referee profiles synced`);
  return count;
}

// ─── Sync League Model Params ────────────────────────────────────────────
async function syncLeagueModels() {
  console.log("\n🏆 Syncing league model parameters...");

  const data = loadJSON("per-league-models.json");
  if (!data?.leagues) return 0;

  const records = [];
  for (const [name, params] of Object.entries(data.leagues)) {
    records.push({
      league_name: name,
      overall_accuracy: params.accuracy || null,
      avg_goals: params.avg_goals || null,
      home_win_pct: params.home_win_pct || null,
      draw_pct: params.draw_pct || null,
      avg_yellow: params.avg_yellow || null,
      avg_corners: params.avg_corners || null,
      poisson_weight: params.poisson_weight || 0.33,
      elo_weight: params.elo_weight || 0.33,
      regression_weight: params.regression_weight || 0.33,
      home_advantage: params.home_advantage || 65,
      goal_expectancy: params.goal_expectancy || 2.6,
      data_points: params.data_points || 0,
      last_trained: data.trained_at || null,
    });
  }

  if (records.length === 0) return 0;
  const count = await upsertBatch("league_model_params", records);
  console.log(`  ✅ ${count} league model params synced`);
  return count;
}

// ─── Sync Optimized Weights ──────────────────────────────────────────────
async function syncOptimizedWeights() {
  console.log("\n⚙️ Syncing optimized model weights...");

  const data = loadJSON("optimized-weights.json");
  if (!data?.optimized_reg_weights) return 0;

  const rw = data.optimized_reg_weights;
  const ew = data.optimized_ensemble_weights || {};

  const record = {
    config_name: "production_v5",
    intercept: rw.intercept || -0.5887,
    elo_diff_weight: rw.eloDiff || 0.0037,
    home_ppg_weight: rw.homePPG || 0.0025,
    away_ppg_weight: rw.awayPPG || -0.1225,
    home_gf_weight: rw.homeGoalsFor || 0.0938,
    home_ga_weight: rw.homeGoalsAgainst || -0.1713,
    away_gf_weight: rw.awayGoalsFor || 0.0738,
    away_ga_weight: rw.awayGoalsAgainst || -0.1738,
    clean_sheet_weight: rw.cleanSheetRate || 0.4813,
    home_win_rate_weight: rw.homeWinRate || 0.0225,
    away_win_rate_weight: rw.awayWinRate || -0.1225,
    streak_weight: rw.streak || 0.1338,
    fatigue_weight: rw.fatigue || 0.02,
    h2h_weight: rw.h2hHomeWins || 0.1738,
    home_xg_weight: rw.homeXG || 0.1338,
    away_xg_weight: rw.awayXG || -0.1012,
    home_xg_diff_weight: rw.homeXGDiff || 0.06,
    away_xg_diff_weight: rw.awayXGDiff || -0.05,
    shots_diff_weight: rw.shotsDiff || 0.003,
    big_chances_diff_weight: rw.bigChancesDiff || 0.02,
    // Ensemble weights
    poisson_1x2_weight: ew.poisson_1x2 || 0.17,
    elo_1x2_weight: ew.elo_1x2 || 0.40,
    regression_1x2_weight: ew.regression_1x2 || 0.43,
    poisson_totals_weight: ew.poisson_totals || 0.55,
    regression_totals_weight: ew.regression_totals || 0.30,
    poisson_btts_weight: ew.poisson_btts || 0.50,
    regression_btts_weight: ew.regression_btts || 0.40,
    poisson_dc_weight: ew.poisson_dc || 0.35,
    elo_dc_weight: ew.elo_dc || 0.30,
    regression_dc_weight: ew.regression_dc || 0.35,
    brier_score: data.optimized?.brier_score || null,
    accuracy: data.optimized?.accuracy || null,
    matches_analyzed: data.matches_analyzed || null,
    trained_at: data.timestamp || null,
  };

  if (DRY_RUN) {
    console.log("  [DRY RUN] Would upsert 1 weight config");
    return 1;
  }

  const { error } = await sb.from("model_weight_config").upsert(record, { onConflict: "config_name" });
  if (error) {
    console.log(`  ⚠️  Error: ${error.message}`);
    return 0;
  }
  console.log("  ✅ 1 optimized weight config synced");
  return 1;
}

// ─── Sync Injury Data ────────────────────────────────────────────────────
async function syncInjuryData() {
  console.log("\n🏥 Syncing injury data...");

  const premier = loadJSON("premier-injuries.json");
  const transfermarkt = loadJSON("transfermarkt-injuries.json");

  const records = [];

  if (premier?.injuries) {
    for (const inj of premier.injuries) {
      records.push({
        team_name: inj.team_name || inj.team,
        player_name: inj.player_name || inj.player,
        status: inj.status || "injured",
        injury_type: inj.injury_type || inj.type || null,
        expected_return: inj.expected_return || null,
        player_importance: inj.importance || 5,
        source: "premier-injuries",
      });
    }
  }

  if (transfermarkt?.injuries) {
    for (const inj of transfermarkt.injuries) {
      records.push({
        team_name: inj.team_name || inj.team,
        player_name: inj.player_name || inj.player,
        status: inj.status || "injured",
        injury_type: inj.injury_type || inj.type || null,
        expected_return: inj.expected_return || null,
        player_importance: inj.importance || 5,
        source: "transfermarkt",
      });
    }
  }

  if (records.length === 0) return 0;

  // Delete old injury data and insert fresh
  if (!DRY_RUN) {
    await sb.from("player_injury_data").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  }

  const count = await upsertBatch("player_injury_data", records);
  console.log(`  ✅ ${count} injury records synced`);
  return count;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔄 ODDLY Feature Store Sync");
  console.log("━".repeat(55));
  if (DRY_RUN) console.log("   [DRY RUN MODE — no data will be written]\n");

  const results = {};

  results.teams = await syncTeamFeatures();
  results.referees = await syncRefereeProfiles();
  results.leagues = await syncLeagueModels();
  results.weights = await syncOptimizedWeights();
  results.injuries = await syncInjuryData();

  console.log("\n" + "═".repeat(55));
  console.log("  SUMMARY");
  console.log("═".repeat(55));
  console.log(`  Team profiles:     ${results.teams}`);
  console.log(`  Referee profiles:  ${results.referees}`);
  console.log(`  League models:     ${results.leagues}`);
  console.log(`  Weight configs:    ${results.weights}`);
  console.log(`  Injury records:    ${results.injuries}`);
  console.log(`  Total records:     ${Object.values(results).reduce((s, v) => s + v, 0)}`);
  console.log("═".repeat(55));
  console.log("\n✅ Feature store sync complete!");
}

main().catch(console.error);
