#!/usr/bin/env node

/**
 * Player Stats Collector v2 — Optimized
 * 
 * Uses only top scorers and assists (2 endpoints per league) to minimize API calls.
 * Saves data incrementally after each league to survive timeouts.
 * 
 * Usage: node scripts/collect-player-stats-v2.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n").forEach((l) => {
  if (l.startsWith("#") || !l.includes("=")) return;
  const idx = l.indexOf("=");
  const key = l.substring(0, idx).trim();
  let val = l.substring(idx + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  env[key] = val;
});

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const AF_KEY = env.API_FOOTBALL_KEY || "87a7192e40b8af11e5e4c50cc807e7ca";

function fetchJSON(url, retries = 2) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "x-apisports-key": AF_KEY }, timeout: 20000 }, (res) => {
      if (res.statusCode === 429) {
        const wait = parseInt(res.headers["retry-after"] || "30");
        console.log(`  [Rate limited, waiting ${wait}s]`);
        setTimeout(() => fetchJSON(url, retries).then(resolve).catch(reject), wait * 1000);
        return;
      }
      if (res.statusCode !== 200) {
        if (retries > 0) {
          setTimeout(() => fetchJSON(url, retries - 1).then(resolve).catch(reject), 3000);
          return;
        }
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Parse error")); }
      });
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const LEAGUES = [
  { name: "Premier League", id: 39, season: 2024 },
  { name: "La Liga", id: 140, season: 2024 },
  { name: "Bundesliga", id: 78, season: 2024 },
  { name: "Serie A", id: 135, season: 2024 },
  { name: "Ligue 1", id: 61, season: 2024 },
  { name: "Championship", id: 40, season: 2024 },
  { name: "Eredivisie", id: 88, season: 2024 },
  { name: "Primeira Liga", id: 94, season: 2024 },
];

// Only 2 endpoints = 16 total API calls
const ENDPOINTS = [
  { name: "topscorers", path: "players/topscorers" },
  { name: "topassists", path: "players/topassists" },
];

function extractPlayerData(p, league, epName) {
  const stats = p.statistics?.[0] || {};
  const name = p.player?.name;
  const team = stats.team?.name;
  if (!name || !team) return null;
  
  return {
    player_name: name,
    player_id: p.player?.id,
    team_name: team,
    team_id_api: stats.team?.id,
    league: league.name,
    league_id: league.id,
    position: stats.games?.position || "Unknown",
    goals: stats.goals?.total || 0,
    assists: stats.goals?.assists || 0,
    shots_total: stats.shots?.total || 0,
    shots_on_target: stats.shots?.on || 0,
    passes_key: stats.passes?.key || 0,
    pass_accuracy: stats.passes?.accuracy || 0,
    tackles_total: stats.tackles?.total || 0,
    tackles_interceptions: stats.tackles?.interceptions || 0,
    duels_total: stats.duels?.total || 0,
    duels_won: stats.duels?.won || 0,
    dribbles_attempts: stats.dribbles?.attempts || 0,
    dribbles_success: stats.dribbles?.success || 0,
    fouls_committed: stats.fouls?.committed || 0,
    fouls_drawn: stats.fouls?.drawn || 0,
    yellow_cards: stats.cards?.yellow || 0,
    red_cards: stats.cards?.red || 0,
    appearances: stats.games?.appearences || 0,
    minutes: stats.games?.minutes || 0,
    rating: stats.games?.rating ? parseFloat(stats.games.rating) : null,
    penalty_scored: stats.penalty?.scored || 0,
    penalty_missed: stats.penalty?.missed || 0,
    source: epName,
    fetched_at: new Date().toISOString(),
  };
}

function computeTeamImpact(allPlayers) {
  const teamPlayers = {};
  for (const player of allPlayers) {
    const team = player.team_name;
    if (!teamPlayers[team]) teamPlayers[team] = [];
    teamPlayers[team].push(player);
  }

  const teamImpacts = {};
  for (const [team, players] of Object.entries(teamPlayers)) {
    const rated = players.filter((p) => p.rating).sort((a, b) => b.rating - a.rating);
    const totalGoals = players.reduce((s, p) => s + p.goals, 0);
    const totalAssists = players.reduce((s, p) => s + p.assists, 0);
    const totalShots = players.reduce((s, p) => s + p.shots_total, 0);
    const totalShotsOn = players.reduce((s, p) => s + p.shots_on_target, 0);
    const totalPassesKey = players.reduce((s, p) => s + p.passes_key, 0);
    const totalTackles = players.reduce((s, p) => s + p.tackles_total, 0);
    const totalInterceptions = players.reduce((s, p) => s + p.tackles_interceptions, 0);
    const totalYellow = players.reduce((s, p) => s + p.yellow_cards, 0);
    const totalAppearances = Math.max(1, players.reduce((s, p) => s + p.appearances, 0));

    const avgRating = rated.length > 0 ? rated.reduce((s, p) => s + p.rating, 0) / rated.length : 6.5;
    const topScorer = rated[0] || null;
    const topGoalShare = topScorer && totalGoals > 0 ? topScorer.goals / totalGoals : 0;
    const attackStrength = (totalGoals + totalAssists) / totalAppearances;
    const shotAccuracy = totalShots > 0 ? totalShotsOn / totalShots : 0.4;
    const keyPassCreation = totalPassesKey / totalAppearances;
    const defensiveSolidity = (totalTackles + totalInterceptions) / totalAppearances;
    const disciplineRisk = totalYellow / totalAppearances;
    const squadDepth = rated.filter((p) => p.appearances >= 10).length;

    const pis = (
      avgRating * 0.3 + attackStrength * 2.0 + shotAccuracy * 1.5 +
      keyPassCreation * 1.0 + defensiveSolidity * 0.8 +
      (1 - disciplineRisk) * 0.5 + (squadDepth / 11) * 1.0
    );
    const pis1x2 = (pis - 3.5) * 0.08;

    teamImpacts[team] = {
      team_name: team,
      league: players[0]?.league || "Unknown",
      player_count: players.length,
      avg_rating: Math.round(avgRating * 100) / 100,
      attack_strength: Math.round(attackStrength * 1000) / 1000,
      shot_accuracy: Math.round(shotAccuracy * 1000) / 1000,
      key_pass_creation: Math.round(keyPassCreation * 100) / 100,
      defensive_solidity: Math.round(defensiveSolidity * 100) / 100,
      discipline_risk: Math.round(disciplineRisk * 1000) / 1000,
      total_goals: totalGoals,
      total_assists: totalAssists,
      total_yellow: totalYellow,
      squad_depth: squadDepth,
      top_player: topScorer?.player_name || "N/A",
      top_player_goals: topScorer?.goals || 0,
      top_player_rating: topScorer?.rating || 0,
      top_scorer_goal_share: Math.round(topGoalShare * 1000) / 1000,
      player_impact_score: Math.round(pis * 1000) / 1000,
      pis_1x2_impact: Math.round(pis1x2 * 1000) / 1000,
      updated_at: new Date().toISOString(),
    };
  }
  return teamImpacts;
}

async function main() {
  console.log("⚽ Player Stats Collector v2 (Optimized)");
  console.log("━".repeat(60));

  const allPlayers = {};
  
  for (const league of LEAGUES) {
    process.stdout.write(`  ${league.name.padEnd(22)}`);

    let count = 0;
    for (const ep of ENDPOINTS) {
      try {
        const data = await fetchJSON(
          `https://v3.football.api-sports.io/${ep.path}?league=${league.id}&season=${league.season}`
        );
        for (const p of (data.response || [])) {
          const player = extractPlayerData(p, league, ep.name);
          if (!player) continue;
          const key = `${player.player_name}|${player.team_name}`;
          if (!allPlayers[key]) {
            allPlayers[key] = player;
            count++;
          } else {
            // Merge additional stats
            const ex = allPlayers[key];
            if (player.rating && !ex.rating) ex.rating = player.rating;
            if (player.tackles_total && !ex.tackles_total) ex.tackles_total = player.tackles_total;
            if (player.tackles_interceptions && !ex.tackles_interceptions) ex.tackles_interceptions = player.tackles_interceptions;
            if (player.yellow_cards && !ex.yellow_cards) ex.yellow_cards = player.yellow_cards;
            if (player.red_cards && !ex.red_cards) ex.red_cards = player.red_cards;
            if (player.fouls_committed && !ex.fouls_committed) ex.fouls_committed = player.fouls_committed;
          }
        }
        const remaining = data.paging?.total ? ` (${data.paging.current}/${data.paging.total} pages)` : "";
        process.stdout.write(`${ep.name}${remaining} `);
      } catch (e) {
        process.stdout.write(`${ep.name}(err) `);
      }
      await sleep(1500);
    }
    console.log(`→ ${count} new`);

    // Save incrementally after each league
    const playersArray = Object.values(allPlayers);
    fs.writeFileSync(path.join(__dirname, "..", "data", "player-stats.json"), JSON.stringify(playersArray, null, 2));
  }

  console.log(`\n  Total unique players: ${Object.keys(allPlayers).length}`);

  // Compute team impacts
  console.log("\n🧠 Computing team player impact scores...");
  const teamImpacts = computeTeamImpact(Object.values(allPlayers));
  
  const impactsPath = path.join(__dirname, "..", "data", "team-player-impacts.json");
  fs.writeFileSync(impactsPath, JSON.stringify(teamImpacts, null, 2));
  console.log(`  Saved ${Object.keys(teamImpacts).length} team impacts`);

  // Print report
  const sorted = Object.values(teamImpacts).sort((a, b) => b.player_impact_score - a.player_impact_score);

  console.log("\n" + "═".repeat(60));
  console.log("🏆 TOP 15 TEAMS BY PLAYER IMPACT SCORE:");
  console.log("─".repeat(60));
  sorted.slice(0, 15).forEach((t, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${t.team_name.padEnd(22)} PIS: ${t.player_impact_score.toFixed(1)} | ${t.total_goals}G ${t.total_assists}A | Avg: ${t.avg_rating} | Top: ${t.top_player} (${t.top_player_goals}G)`);
  });

  console.log("\n💀 BOTTOM 15:");
  console.log("─".repeat(60));
  sorted.slice(-15).reverse().forEach((t, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${t.team_name.padEnd(22)} PIS: ${t.player_impact_score.toFixed(1)} | ${t.total_goals}G ${t.total_assists}A | Avg: ${t.avg_rating}`);
  });

  console.log("\n🎯 1X2 IMPACT (biggest player-quality advantage):");
  console.log("─".repeat(60));
  [...sorted].sort((a, b) => b.pis_1x2_impact - a.pis_1x2_impact).slice(0, 10).forEach((t, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${t.team_name.padEnd(22)} | 1X2: +${(t.pis_1x2_impact * 100).toFixed(1)}% | Depth: ${t.squad_depth}`);
  });

  // Now store in Supabase
  console.log("\n📦 Storing player impact data in Supabase...");
  const impactsArray = Object.values(teamImpacts);
  
  // Store in batches
  for (let i = 0; i < impactsArray.length; i += 50) {
    const batch = impactsArray.slice(i, i + 50).map((t) => ({
      team_name: t.team_name,
      league: t.league,
      player_count: t.player_count,
      avg_rating: t.avg_rating,
      attack_strength: t.attack_strength,
      shot_accuracy: t.shot_accuracy,
      key_pass_creation: t.key_pass_creation,
      defensive_solidity: t.defensive_solidity,
      discipline_risk: t.discipline_risk,
      total_goals: t.total_goals,
      total_assists: t.total_assists,
      squad_depth: t.squad_depth,
      top_player: t.top_player,
      top_player_goals: t.top_player_goals,
      player_impact_score: t.player_impact_score,
      pis_1x2_impact: t.pis_1x2_impact,
      updated_at: t.updated_at,
    }));

    const { error } = await sb.from("player_impact_scores").upsert(batch, { onConflict: "team_name" });
    if (error) {
      // Table might not exist yet — try individual inserts
      if (error.message?.includes("does not exist")) {
        console.log("  ⚠️  player_impact_scores table not found — run SQL first");
        break;
      }
      console.log(`  ⚠️  Batch ${Math.floor(i / 50) + 1}: ${error.message}`);
    } else {
      process.stdout.write(".");
    }
  }
  console.log(" Done!");

  console.log("\n✅ Complete!");
}

main().catch(console.error);
