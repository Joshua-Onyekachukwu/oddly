#!/usr/bin/env node

/**
 * Compute Injury Features for All Upcoming Fixtures
 * 
 * This script computes team-level and fixture-level injury features
 * for all scheduled fixtures in the next 7 days.
 * 
 * Usage: node scripts/compute-injury-features.js [--fixture <id>]
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Load environment
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8").split("\n").forEach((l) => {
      const m = l.match(/^([^#=]+)="?([^"]*)"?\s*$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    });
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
);

const FIXTURE_FILTER = process.argv.includes("--fixture")
  ? process.argv[process.argv.indexOf("--fixture") + 1]
  : null;

// ─── Helper Functions ────────────────────────────────────────────────────

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  if (level === "error") {
    console.error(`[${timestamp}] ERROR: ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
  }
}

async function getTeamInjuries(teamName) {
  const { data, error } = await supabase
    .from("player_availability")
    .select("*")
    .eq("team_name", teamName)
    .in("status", ["injured", "suspended", "doubtful", "out"])
    .gt("updated_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    log("error", `Error fetching injuries for ${teamName}:`, error);
    return [];
  }

  return data || [];
}

function calculateInjuryImpact(status, injuryType, isKey = false) {
  let baseImpact = 0;
  
  switch (status) {
    case "injured":
    case "out":
      baseImpact = 1.5;
      break;
    case "suspended":
      baseImpact = 2.0;
      break;
    case "doubtful":
      baseImpact = 0.5;
      break;
    default:
      baseImpact = 0.3;
  }

  if (injuryType?.match(/acl|rupture|torn|surgery|fracture/i)) {
    baseImpact *= 2.0;
  } else if (injuryType?.match(/hamstring|groin|muscle/i)) {
    baseImpact *= 1.5;
  }

  if (isKey) {
    baseImpact *= 1.8;
  }

  return baseImpact;
}

function getPlayerPosition(injuryType) {
  if (injuryType?.match(/goalkeeper|keeper|gk/i)) return "goalkeeper";
  if (injuryType?.match(/defender|back|center-back|full-back/i)) return "defender";
  if (injuryType?.match(/midfielder|midfield|winger/i)) return "midfielder";
  if (injuryType?.match(/striker|forward|attacker/i)) return "attacker";
  return "unknown";
}

// ─── Feature Computation ─────────────────────────────────────────────────

async function computeTeamFeatures(teamName, fixtureId, fixtureDate) {
  const injuries = await getTeamInjuries(teamName);
  
  const injuredCount = injuries.filter(i => i.status === "injured").length;
  const suspendedCount = injuries.filter(i => i.status === "suspended").length;
  const doubtfulCount = injuries.filter(i => i.status === "doubtful").length;
  const outCount = injuries.filter(i => i.status === "out").length;
  const totalUnavailable = injuredCount + suspendedCount + doubtfulCount + outCount;

  const squadSize = 25;
  const availabilityPct = Math.max(0, ((squadSize - totalUnavailable) / squadSize) * 100);

  let missingGoalkeeper = false;
  let missingDefenders = 0;
  let missingMidfielders = 0;
  let missingAttackers = 0;
  let missingStarters = 0;
  let missingKeyPlayers = 0;

  for (const injury of injuries) {
    const position = getPlayerPosition(injury.injury_type);
    const isKey = injury.is_key_player || false;

    switch (position) {
      case "goalkeeper":
        missingGoalkeeper = true;
        missingStarters++;
        break;
      case "defender":
        missingDefenders++;
        if (isKey) missingStarters++;
        break;
      case "midfielder":
        missingMidfielders++;
        if (isKey) missingStarters++;
        break;
      case "attacker":
        missingAttackers++;
        if (isKey) missingStarters++;
        break;
    }

    if (isKey) missingKeyPlayers++;
  }

  let injuryImpactScore = 0;
  let keyPlayerImpact = 0;

  for (const injury of injuries) {
    const isKey = injury.is_key_player || false;
    const impact = calculateInjuryImpact(injury.status, injury.injury_type, isKey);
    
    injuryImpactScore += impact;
    if (isKey) keyPlayerImpact += impact;
  }

  const mostRecentUpdate = injuries.length > 0
    ? Math.max(...injuries.map(i => new Date(i.updated_at).getTime()))
    : 0;
  const dataFreshnessHours = mostRecentUpdate > 0
    ? (Date.now() - mostRecentUpdate) / (1000 * 60 * 60)
    : 999;

  let confidenceScore = 0.8;
  if (dataFreshnessHours > 72) confidenceScore -= 0.2;
  if (dataFreshnessHours > 168) confidenceScore -= 0.2;

  return {
    team_name: teamName,
    total_unavailable: totalUnavailable,
    injured_count: injuredCount,
    suspended_count: suspendedCount,
    doubtful_count: doubtfulCount,
    out_count: outCount,
    availability_pct: availabilityPct,
    missing_starters: missingStarters,
    missing_key_players: missingKeyPlayers,
    missing_goalkeeper: missingGoalkeeper,
    missing_defenders: missingDefenders,
    missing_midfielders: missingMidfielders,
    missing_attackers: missingAttackers,
    injury_impact_score: injuryImpactScore,
    key_player_impact: keyPlayerImpact,
    data_freshness_hours: dataFreshnessHours,
    source_count: 1,
    confidence_score: Math.max(0, Math.min(1, confidenceScore)),
  };
}

async function saveTeamFeatures(features, fixtureId, fixtureDate) {
  const { error } = await supabase
    .from("team_injury_features")
    .upsert({
      team_name: features.team_name,
      fixture_id: fixtureId || null,
      fixture_date: fixtureDate?.toISOString() || null,
      snapshot_date: new Date().toISOString(),
      ...features,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "team_name,fixture_id,snapshot_date",
    });

  if (error) {
    log("error", `Error saving features for ${features.team_name}:`, error);
  }
}

async function computeFixtureFeatures(fixtureId, homeTeam, awayTeam, fixtureDate) {
  const [homeFeatures, awayFeatures] = await Promise.all([
    computeTeamFeatures(homeTeam, fixtureId, fixtureDate),
    computeTeamFeatures(awayTeam, fixtureId, fixtureDate),
  ]);

  // Save team features
  await Promise.all([
    saveTeamFeatures(homeFeatures, fixtureId, fixtureDate),
    saveTeamFeatures(awayFeatures, fixtureId, fixtureDate),
  ]);

  // Compute fixture features
  const fixtureFeatures = {
    fixture_id: fixtureId,
    snapshot_date: new Date().toISOString(),
    
    home_unavailable: homeFeatures.total_unavailable,
    home_injured: homeFeatures.injured_count,
    home_suspended: homeFeatures.suspended_count,
    home_doubtful: homeFeatures.doubtful_count,
    home_availability_pct: homeFeatures.availability_pct,
    home_missing_starters: homeFeatures.missing_starters,
    home_missing_key_players: homeFeatures.missing_key_players,
    home_missing_goalkeeper: homeFeatures.missing_goalkeeper,
    home_missing_defenders: homeFeatures.missing_defenders,
    home_missing_midfielders: homeFeatures.missing_midfielders,
    home_missing_attackers: homeFeatures.missing_attackers,
    home_injury_impact: homeFeatures.injury_impact_score,
    
    away_unavailable: awayFeatures.total_unavailable,
    away_injured: awayFeatures.injured_count,
    away_suspended: awayFeatures.suspended_count,
    away_doubtful: awayFeatures.doubtful_count,
    away_availability_pct: awayFeatures.availability_pct,
    away_missing_starters: awayFeatures.missing_starters,
    away_missing_key_players: awayFeatures.missing_key_players,
    away_missing_goalkeeper: awayFeatures.missing_goalkeeper,
    away_missing_defenders: awayFeatures.missing_defenders,
    away_missing_midfielders: awayFeatures.missing_midfielders,
    away_missing_attackers: awayFeatures.missing_attackers,
    away_injury_impact: awayFeatures.injury_impact_score,
    
    injury_difference: homeFeatures.injury_impact_score - awayFeatures.injury_impact_score,
    availability_difference: homeFeatures.availability_pct - awayFeatures.availability_pct,
    key_player_absence_difference: homeFeatures.missing_key_players - awayFeatures.missing_key_players,
    attacking_absence_difference: homeFeatures.missing_attackers - awayFeatures.missing_attackers,
    defensive_absence_difference:
      (homeFeatures.missing_defenders + (homeFeatures.missing_goalkeeper ? 1 : 0)) -
      (awayFeatures.missing_defenders + (awayFeatures.missing_goalkeeper ? 1 : 0)),
    
    data_freshness_hours: Math.max(
      homeFeatures.data_freshness_hours,
      awayFeatures.data_freshness_hours
    ),
    confidence_score: Math.min(
      homeFeatures.confidence_score,
      awayFeatures.confidence_score
    ),
  };

  // Save fixture features
  const { error } = await supabase
    .from("fixture_injury_features")
    .upsert(fixtureFeatures, {
      onConflict: "fixture_id,snapshot_date",
    });

  if (error) {
    log("error", `Error saving fixture features for ${fixtureId}:`, error);
  }

  return {
    home: homeFeatures,
    away: awayFeatures,
    fixture: fixtureFeatures,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ODDLY Injury Feature Computation");
  console.log("═══════════════════════════════════════════════════════════");
  
  try {
    // Get fixtures to process
    let query = supabase
      .from("fixtures")
      .select(`
        id,
        kickoff_time,
        home_team:teams!fixtures_home_team_id_fkey(canonical_name),
        away_team:teams!fixtures_away_team_id_fkey(canonical_name)
      `)
      .gte("kickoff_time", new Date().toISOString())
      .lte("kickoff_time", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
      .in("status", ["scheduled"]);

    if (FIXTURE_FILTER) {
      query = query.eq("id", FIXTURE_FILTER);
    }

    const { data: fixtures, error } = await query;

    if (error) {
      log("error", "Error fetching fixtures:", error);
      return;
    }

    if (!fixtures?.length) {
      log("info", "No fixtures to process");
      return;
    }

    log("info", `Processing ${fixtures.length} fixtures`);

    let processed = 0;
    let errors = 0;

    for (const fixture of fixtures) {
      try {
        const homeTeam = fixture.home_team?.canonical_name;
        const awayTeam = fixture.away_team?.canonical_name;

        if (!homeTeam || !awayTeam) {
          log("warn", `Missing team names for fixture ${fixture.id}`);
          errors++;
          continue;
        }

        log("info", `Processing: ${homeTeam} vs ${awayTeam}`);
        
        const features = await computeFixtureFeatures(
          fixture.id,
          homeTeam,
          awayTeam,
          new Date(fixture.kickoff_time)
        );

        log("info", `  Home: ${features.home.total_unavailable} unavailable (impact: ${features.home.injury_impact_score.toFixed(1)})`);
        log("info", `  Away: ${features.away.total_unavailable} unavailable (impact: ${features.away.injury_impact_score.toFixed(1)})`);
        log("info", `  Difference: ${features.fixture.injury_difference.toFixed(1)}`);

        processed++;
      } catch (err) {
        log("error", `Error processing fixture ${fixture.id}:`, err);
        errors++;
      }
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Summary");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Processed: ${processed}`);
    console.log(`  Errors: ${errors}`);
    console.log("═══════════════════════════════════════════════════════════");

  } catch (error) {
    log("error", "Fatal error:", error);
  }
}

main().catch(console.error);
