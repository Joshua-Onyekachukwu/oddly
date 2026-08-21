#!/usr/bin/env node

/**
 * ODDLY StatsBomb Data Collector
 *
 * Downloads free player-level data from StatsBomb open data repository.
 * Stores lineups, appearances, and player statistics in Supabase.
 *
 * Run: node worker/collect-statsbomb.js
 *
 * Data source: https://github.com/hudl/open-data
 * License: CC BY 4.0 (attribution required)
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Environment ─────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BASE_URL = "https://raw.githubusercontent.com/hudl/open-data/master/data";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Step 1: Get available competitions ─────────────────────────────────────

async function getCompetitions() {
  console.log("\n📋 Fetching available competitions...");
  const res = await fetch(`${BASE_URL}/competitions.json`);
  const data = await res.json();
  console.log(`   Found ${data.length} competition-season combinations`);
  return data;
}

// ─── Step 2: Get matches for a competition/season ───────────────────────────

async function getMatches(competitionId, seasonId) {
  const url = `${BASE_URL}/matches/${competitionId}/${seasonId}.json`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data;
}

// ─── Step 3: Get lineup for a match ─────────────────────────────────────────

async function getLineup(matchId) {
  const url = `${BASE_URL}/lineups/${matchId}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

// ─── Step 4: Get events for a match ─────────────────────────────────────────

async function getEvents(matchId) {
  const url = `${BASE_URL}/events/${matchId}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

// ─── Step 5: Parse player from lineup ───────────────────────────────────────

function parsePlayer(playerData, teamId) {
  return {
    statsbomb_id: playerData.player_id,
    name: playerData.player_name,
    nickname: playerData.player_nickname,
    jersey_number: playerData.jersey_number,
    nationality: playerData.country?.name,
    team_id: teamId,
  };
}

// ─── Step 6: Parse appearance from lineup ───────────────────────────────────

function parseAppearance(playerData, fixtureId, teamId) {
  const positions = playerData.positions || [];
  const cards = playerData.cards || [];

  // Determine if starter or substitute
  const isStarter = positions.some(p => p.start_reason === "Starting XI");
  const isSub = positions.some(p => p.start_reason?.includes("Substitution"));

  // Get minutes played
  let minutesPlayed = 0;
  let position = null;
  let substituteInMinute = null;
  let substituteOutMinute = null;

  for (const pos of positions) {
    position = pos.position;
    if (pos.start_reason === "Starting XI") {
      // Started the match
      const endMin = pos.to ? parseMinute(pos.to) : 90;
      minutesPlayed += endMin;
    } else if (pos.start_reason?.includes("Substitution")) {
      // Came on as substitute
      substituteInMinute = parseMinute(pos.from);
      const endMin = pos.to ? parseMinute(pos.to) : 90;
      minutesPlayed += endMin - substituteInMinute;
    }
  }

  // Count cards
  const yellowCards = cards.filter(c => c.card_type === "Yellow Card").length;
  const redCards = cards.filter(c => c.card_type === "Red Card").length;

  return {
    fixture_id: fixtureId,
    team_id: teamId,
    is_starter: isStarter,
    is_substitute: isSub,
    substitute_in_minute: substituteInMinute,
    substitute_out_minute: substituteOutMinute,
    minutes_played: minutesPlayed,
    position: position,
    yellow_cards: yellowCards,
    red_cards: redCards,
  };
}

function parseMinute(timeStr) {
  // Parse "73:10" format to minutes
  if (!timeStr) return 90;
  const parts = timeStr.split(":");
  return parseInt(parts[0]) + (parts[1] ? parseInt(parts[1]) / 60 : 0);
}

// ─── Step 7: Parse events for player stats ──────────────────────────────────

function parseEvents(events, teamId) {
  const playerStats = {};

  for (const event of events) {
    const playerId = event.player?.id;
    if (!playerId) continue;

    if (!playerStats[playerId]) {
      playerStats[playerId] = {
        goals: 0, assists: 0, shots: 0, shots_on_target: 0,
        key_passes: 0, passes_completed: 0, passes_attempted: 0,
        tackles: 0, interceptions: 0, blocks: 0, clearances: 0,
        recoveries: 0, xg: 0, xa: 0,
        progressive_passes: 0, progressive_carries: 0,
        aerial_duels_won: 0, aerial_duels_lost: 0,
        ground_duels_won: 0, ground_duels_lost: 0,
      };
    }

    const stats = playerStats[playerId];
    const type = event.type?.name;
    const subtype = event.sub_type?.name;

    // Goals
    if (type === "Shot" && subtype === "Goal") {
      stats.goals++;
      stats.shots++;
      if (event.shot?.statsbomb?.is_on_target) stats.shots_on_target++;
      stats.xg += event.shot?.statsbomb?.xg || 0;
    }
    // Shots
    else if (type === "Shot") {
      stats.shots++;
      if (event.shot?.statsbomb?.is_on_target) stats.shots_on_target++;
      stats.xg += event.shot?.statsbomb?.xg || 0;
    }
    // Passes
    else if (type === "Pass") {
      stats.passes_attempted++;
      if (event.pass?.outcome?.name === "Complete") {
        stats.passes_completed++;
        if (event.pass?.progressive) stats.progressive_passes++;
        if (event.pass?.goal_assist) stats.assists++;
        if (event.pass?.key_pass) stats.key_passes++;
        stats.xa += event.pass?.statsbomb?.xa || 0;
      }
    }
    // 50/50 duels
    else if (type === "Duel") {
      if (subtype === "Aerial Lost") stats.aerial_duels_lost++;
      else if (subtype === "Aerial Won") stats.aerial_duels_won++;
      else if (subtype === "Ground Lost") stats.ground_duels_lost++;
      else if (subtype === "Ground Won") stats.ground_duels_won++;
    }
    // Defensive actions
    else if (type === "Pressure") {
      stats.recoveries++;
    }
    else if (type === "Block") {
      stats.blocks++;
    }
    else if (type === "Interception") {
      stats.interceptions++;
    }
    else if (type === "Tackle") {
      stats.tackles++;
    }
    else if (type === "Clearance") {
      stats.clearances++;
    }
    // Dribbles
    else if (type === "Dribble" && subtype === "Complete") {
      stats.progressive_carries++;
    }
  }

  return playerStats;
}

// ─── Step 8: Store data in Supabase ─────────────────────────────────────────

async function storePlayer(playerData) {
  // Check if player exists
  const { data: existing } = await supabase
    .from("players")
    .select("id")
    .eq("statsbomb_id", playerData.statsbomb_id)
    .maybeSingle();

  if (existing) return existing.id;

  // Insert new player
  const { data: inserted } = await supabase
    .from("players")
    .insert({
      statsbomb_id: playerData.statsbomb_id,
      name: playerData.name,
      nickname: playerData.nickname,
      nationality: playerData.nationality,
    })
    .select("id")
    .single();

  return inserted?.id;
}

async function storeAppearance(appearanceData) {
  // Check if already exists
  const { data: existing } = await supabase
    .from("player_appearances")
    .select("id")
    .eq("fixture_id", appearanceData.fixture_id)
    .eq("player_id", appearanceData.player_id)
    .maybeSingle();

  if (existing) return false;

  await supabase.from("player_appearances").insert(appearanceData);
  return true;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("⚽ ODDLY StatsBomb Data Collector");
  console.log("━".repeat(70));
  console.log("   Source: https://github.com/hudl/open-data");
  console.log("   License: CC BY 4.0 (attribution required)");
  console.log("━".repeat(70));

  // Get competitions
  const competitions = await getCompetitions();

  // Filter to men's top leagues we care about
  const targetLeagues = [
    "1. Bundesliga", "Premier League", "La Liga", "Serie A", "Ligue 1",
    "Champions League", "FIFA World Cup", "UEFA Euro"
  ];

  const relevant = competitions.filter(c =>
    c.competition_gender === "male" &&
    (targetLeagues.includes(c.competition_name) ||
     c.competition_name.includes("League") ||
     c.competition_name.includes("World Cup") ||
     c.competition_name.includes("Euro"))
  );

  console.log(`\n📊 Processing ${relevant.length} relevant competition-seasons...`);

  let totalMatches = 0;
  let totalPlayers = 0;
  let totalAppearances = 0;

  for (const comp of relevant) {
    console.log(`\n🏆 ${comp.competition_name} (${comp.season_name})`);

    const matches = await getMatches(comp.competition_id, comp.season_id);
    if (matches.length === 0) {
      console.log("   No matches found");
      continue;
    }

    console.log(`   Found ${matches.length} matches`);

    let processed = 0;
    for (const match of matches) {
      const matchId = match.match_id;

      // Get lineup
      const lineup = await getLineup(matchId);
      if (!lineup || lineup.length === 0) {
        processed++;
        continue;
      }

      // Process each team
      for (const teamLineup of lineup) {
        const teamId = teamLineup.team_id;

        for (const player of teamLineup.lineup) {
          // Store player
          const playerId = await storePlayer({
            statsbomb_id: player.player_id,
            name: player.player_name,
            nickname: player.player_nickname,
            nationality: player.country?.name,
          });

          if (!playerId) continue;
          totalPlayers++;

          // Parse appearance
          const appearance = parseAppearance(player, matchId, teamId);
          appearance.player_id = playerId;

          // Store appearance
          await storeAppearance(appearance);
          totalAppearances++;
        }
      }

      processed++;
      if (processed % 10 === 0) {
        console.log(`   📊 Processed ${processed}/${matches.length} matches`);
      }

      // Rate limit (GitHub is forgiving, but be nice)
      await sleep(100);
    }

    totalMatches += matches.length;
  }

  console.log("\n" + "═".repeat(70));
  console.log("✅ STATSbomb DATA COLLECTION COMPLETE");
  console.log("═".repeat(70));
  console.log(`\n   Competitions processed: ${relevant.length}`);
  console.log(`   Total matches: ${totalMatches}`);
  console.log(`   Total players: ${totalPlayers}`);
  console.log(`   Total appearances: ${totalAppearances}`);
  console.log("\n   Data stored in Supabase tables:");
  console.log("   - players (player profiles)");
  console.log("   - player_appearances (match-level appearances)");
  console.log("\n   Next steps:");
  console.log("   1. Run: node worker/calculate-player-impact.js");
  console.log("   2. Run: node worker/collect-statsbomb-events.js (for event data)");
  console.log("━".repeat(70));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
