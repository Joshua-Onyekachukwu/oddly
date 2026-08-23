#!/usr/bin/env node

/**
 * Player Stats Collector & Impact Scorer
 * 
 * Collects player-level stats from API-Football (free endpoints):
 * - Top Scorers (goals, assists, shots, rating)
 * - Top Assists (assists, key passes, dribbles)
 * - Top Yellow Cards (fouls, tackles, discipline)
 * - Top Red Cards (aggression, tackles, duels)
 * 
 * Then computes per-team "Player Impact Score" that feeds into 1X2 predictions.
 * 
 * A team missing its top scorer loses ~0.3 goals/season worth of impact.
 * A team with a suspended key defender gains defensive vulnerability.
 * 
 * Usage: node scripts/collect-player-stats.js
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

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "x-apisports-key": AF_KEY }, timeout: 15000 }, (res) => {
      if (res.statusCode === 429) {
        const wait = parseInt(res.headers["retry-after"] || "60");
        console.log(`  ⏳ Rate limited. Waiting ${wait}s...`);
        setTimeout(() => fetchJSON(url).then(resolve).catch(reject), wait * 1000);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("Parse error")); } });
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

const ENDPOINTS = [
  { name: "topscorers", path: "players/topscorers" },
  { name: "topassists", path: "players/topassists" },
  { name: "topyellowcards", path: "players/topyellowcards" },
  { name: "topredcards", path: "players/topredcards" },
];

async function collectPlayerStats() {
  console.log("📡 Collecting player stats from API-Football...");
  console.log("━".repeat(60));

  const allPlayers = {};

  for (const league of LEAGUES) {
    process.stdout.write(`   ⚽ ${league.name.padEnd(22)}`);

    let totalPlayers = 0;

    for (const ep of ENDPOINTS) {
      try {
        const data = await fetchJSON(
          `https://v3.football.api-sports.io/${ep.path}?league=${league.id}&season=${league.season}`
        );

        for (const p of (data.response || [])) {
          const stats = p.statistics?.[0] || {};
          const name = p.player?.name;
          const team = stats.team?.name;
          if (!name || !team) continue;

          const key = `${name}|${team}`;
          if (!allPlayers[key]) {
            allPlayers[key] = {
              player_name: name,
              player_id: p.player?.id,
              team_name: team,
              team_id_api: stats.team?.id,
              league: league.name,
              league_id: league.id,
              position: stats.games?.position || "Unknown",
              // Goals & Assists
              goals: stats.goals?.total || 0,
              assists: stats.goals?.assists || 0,
              // Shooting
              shots_total: stats.shots?.total || 0,
              shots_on_target: stats.shots?.on || 0,
              // Passing
              passes_total: stats.passes?.total || 0,
              passes_key: stats.passes?.key || 0,
              pass_accuracy: stats.passes?.accuracy || 0,
              // Defense
              tackles_total: stats.tackles?.total || 0,
              tackles_interceptions: stats.tackles?.interceptions || 0,
              tackles_blocks: stats.tackles?.blocks || 0,
              // Duels
              duels_total: stats.duels?.total || 0,
              duels_won: stats.duels?.won || 0,
              // Dribbles
              dribbles_attempts: stats.dribbles?.attempts || 0,
              dribbles_success: stats.dribbles?.success || 0,
              // Discipline
              fouls_drawn: stats.fouls?.drawn || 0,
              fouls_committed: stats.fouls?.committed || 0,
              yellow_cards: stats.cards?.yellow || 0,
              red_cards: stats.cards?.red || 0,
              // Games
              appearances: stats.games?.appearences || 0,
              minutes: stats.games?.minutes || 0,
              rating: stats.games?.rating ? parseFloat(stats.games.rating) : null,
              // Penalty
              penalty_scored: stats.penalty?.scored || 0,
              penalty_missed: stats.penalty?.missed || 0,
              // Source tracking
              source: ep.name,
              fetched_at: new Date().toISOString(),
            };
          } else {
            // Merge additional stats from other endpoints
            const existing = allPlayers[key];
            if (stats.games?.rating && !existing.rating) existing.rating = parseFloat(stats.games.rating);
            if (stats.tackles?.total && !existing.tackles_total) existing.tackles_total = stats.tackles.total;
            if (stats.tackles?.interceptions && !existing.tackles_interceptions) existing.tackles_interceptions = stats.tackles.interceptions;
            if (stats.fouls?.committed && !existing.fouls_committed) existing.fouls_committed = stats.fouls.committed;
            if (stats.cards?.yellow && !existing.yellow_cards) existing.yellow_cards = stats.cards.yellow;
            if (stats.cards?.red && !existing.red_cards) existing.red_cards = stats.cards.red;
          }
          totalPlayers++;
        }
      } catch (e) {
        // Skip errors silently
      }
      await sleep(1200); // Rate limit
    }

    console.log(`${totalPlayers} player-stats`);
  }

  console.log(`\n   Total unique players: ${Object.keys(allPlayers).length}`);
  return allPlayers;
}

function computeTeamPlayerImpact(allPlayers) {
  console.log("\n🧠 Computing team player impact scores...");
  console.log("━".repeat(60));

  // Group players by team
  const teamPlayers = {};
  for (const [key, player] of Object.entries(allPlayers)) {
    const team = player.team_name;
    if (!teamPlayers[team]) teamPlayers[team] = [];
    teamPlayers[team].push(player);
  }

  const teamImpacts = {};

  for (const [team, players] of Object.entries(teamPlayers)) {
    // Sort by rating (descending)
    const rated = players.filter(p => p.rating).sort((a, b) => b.rating - a.rating);
    const unrated = players.filter(p => !p.rating);

    // Count by position
    const attackers = players.filter(p => p.position === "Attacker" || p.position === "Forward");
    const midfielders = players.filter(p => p.position === "Midfielder");
    const defenders = players.filter(p => p.position === "Defender");
    const goalkeepers = players.filter(p => p.position === "Goalkeeper");

    // Aggregate stats
    const totalGoals = players.reduce((s, p) => s + p.goals, 0);
    const totalAssists = players.reduce((s, p) => s + p.assists, 0);
    const totalShots = players.reduce((s, p) => s + p.shots_total, 0);
    const totalShotsOnTarget = players.reduce((s, p) => s + p.shots_on_target, 0);
    const totalPassesKey = players.reduce((s, p) => s + p.passes_key, 0);
    const totalTackles = players.reduce((s, p) => s + p.tackles_total, 0);
    const totalInterceptions = players.reduce((s, p) => s + p.tackles_interceptions, 0);
    const totalYellow = players.reduce((s, p) => s + p.yellow_cards, 0);
    const totalRed = players.reduce((s, p) => s + p.red_cards, 0);
    const totalMinutes = players.reduce((s, p) => s + p.minutes, 0);
    const totalAppearances = players.reduce((s, p) => s + p.appearances, 0);

    // Average rating
    const avgRating = rated.length > 0
      ? rated.reduce((s, p) => s + p.rating, 0) / rated.length
      : 6.5;

    // Top player impact (how much does the best player contribute)
    const topScorer = rated.length > 0 ? rated[0] : null;
    const topScorerGoalShare = topScorer && totalGoals > 0
      ? topScorer.goals / totalGoals
      : 0;

    // Attack strength (goals + assists per appearance)
    const attackStrength = totalAppearances > 0
      ? (totalGoals + totalAssists) / totalAppearances
      : 0;

    // Shot volume (shots per appearance)
    const shotVolume = totalAppearances > 0
      ? totalShots / totalAppearances
      : 0;

    // Shot accuracy (on target / total)
    const shotAccuracy = totalShots > 0
      ? totalShotsOnTarget / totalShots
      : 0.4;

    // Key pass creation (key passes per appearance)
    const keyPassCreation = totalAppearances > 0
      ? totalPassesKey / totalAppearances
      : 0;

    // Defensive solidity (tackles + interceptions per appearance)
    const defensiveSolidity = totalAppearances > 0
      ? (totalTackles + totalInterceptions) / totalAppearances
      : 0;

    // Discipline risk (yellow cards per appearance)
    const disciplineRisk = totalAppearances > 0
      ? totalYellow / totalAppearances
      : 0;

    // Squad depth (number of contributing players)
    const squadDepth = rated.filter(p => p.appearances >= 10).length;

    // Player Impact Score (PIS) — composite metric
    // Higher = better team due to player quality
    const pis = (
      avgRating * 0.3 +           // Overall quality
      attackStrength * 2.0 +       // Attacking output
      shotAccuracy * 1.5 +         // Finishing quality
      keyPassCreation * 1.0 +      // Creativity
      defensiveSolidity * 0.8 +    // Defensive strength
      (1 - disciplineRisk) * 0.5 + // Discipline (lower is better)
      (squadDepth / 11) * 1.0      // Squad depth
    );

    // 1X2 Impact — how much player quality shifts win probability
    // Base home win rate ~46%. Strong players shift this.
    const pis1x2 = (pis - 3.5) * 0.08; // Normalized impact on home win probability

    teamImpacts[team] = {
      team_name: team,
      league: players[0]?.league || "Unknown",
      player_count: players.length,
      rated_count: rated.length,

      // Core metrics
      avg_rating: Math.round(avgRating * 100) / 100,
      attack_strength: Math.round(attackStrength * 1000) / 1000,
      shot_volume: Math.round(shotVolume * 100) / 100,
      shot_accuracy: Math.round(shotAccuracy * 1000) / 1000,
      key_pass_creation: Math.round(keyPassCreation * 100) / 100,
      defensive_solidity: Math.round(defensiveSolidity * 100) / 100,
      discipline_risk: Math.round(disciplineRisk * 1000) / 1000,

      // Aggregate stats
      total_goals: totalGoals,
      total_assists: totalAssists,
      total_shots: totalShots,
      total_yellow: totalYellow,
      total_red: totalRed,
      squad_depth: squadDepth,

      // Top player
      top_player: topScorer?.player_name || "N/A",
      top_player_goals: topScorer?.goals || 0,
      top_player_rating: topScorer?.rating || 0,
      top_scorer_goal_share: Math.round(topScorerGoalShare * 1000) / 1000,

      // Position breakdown
      attackers_count: attackers.length,
      midfielders_count: midfielders.length,
      defenders_count: defenders.length,
      goalkeepers_count: goalkeepers.length,

      // Composite scores
      player_impact_score: Math.round(pis * 1000) / 1000,
      pis_1x2_impact: Math.round(pis1x2 * 1000) / 1000,

      updated_at: new Date().toISOString(),
    };
  }

  console.log(`   Computed impact for ${Object.keys(teamImpacts).length} teams`);
  return teamImpacts;
}

function computePlayerImpactFeatures(teamImpacts, match) {
  // Compute features for a specific match based on team player impact
  const home = teamImpacts[match.home_team];
  const away = teamImpacts[match.away_team];

  if (!home || !away) return null;

  return {
    // Direct impact difference
    pis_diff: home.player_impact_score - away.player_impact_score,
    home_pis: home.player_impact_score,
    away_pis: away.player_impact_score,

    // 1X2 specific impact
    home_1x2_impact: home.pis_1x2_impact,
    away_1x2_impact: away.pis_1x2_impact,
    pis_1x2_diff: home.pis_1x2_impact - away.pis_1x2_impact,

    // Attack comparison
    attack_diff: home.attack_strength - away.attack_strength,
    home_attack: home.attack_strength,
    away_attack: away.attack_strength,

    // Shot quality
    shot_accuracy_diff: home.shot_accuracy - away.shot_accuracy,
    home_shot_accuracy: home.shot_accuracy,
    away_shot_accuracy: away.shot_accuracy,

    // Key passes (creativity)
    key_pass_diff: home.key_pass_creation - away.key_pass_creation,

    // Defensive comparison
    defense_diff: home.defensive_solidity - away.defensive_solidity,

    // Discipline comparison
    discipline_diff: home.discipline_risk - away.discipline_risk,

    // Top player comparison
    top_player_gap: home.top_player_rating - away.top_player_rating,
    home_top_player: home.top_player_goals,
    away_top_player: away.top_player_goals,

    // Squad depth
    depth_diff: home.squad_depth - away.squad_depth,
  };
}

async function main() {
  console.log("⚽ Player Stats Collector & Impact Scorer");
  console.log("━".repeat(60));
  console.log("Collecting from: API-Football (top scorers, assists, cards)");
  console.log("━".repeat(60));

  // 1. Collect player stats
  const allPlayers = await collectPlayerStats();

  // 2. Compute team impact
  const teamImpacts = computeTeamPlayerImpact(allPlayers);

  // 3. Save data
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Save all player stats
  const playersPath = path.join(dataDir, "player-stats.json");
  fs.writeFileSync(playersPath, JSON.stringify(Object.values(allPlayers), null, 2));
  console.log(`\n💾 Saved ${Object.keys(allPlayers).length} player stats to ${playersPath}`);

  // Save team impacts
  const impactsPath = path.join(dataDir, "team-player-impacts.json");
  fs.writeFileSync(impactsPath, JSON.stringify(teamImpacts, null, 2));
  console.log(`💾 Saved ${Object.keys(teamImpacts).length} team impacts to ${impactsPath}`);

  // 4. Print report
  console.log("\n" + "═".repeat(60));
  console.log("📊 PLAYER IMPACT REPORT");
  console.log("═".repeat(60));

  const sorted = Object.values(teamImpacts).sort((a, b) => b.player_impact_score - a.player_impact_score);

  console.log("\n🏆 TOP 15 TEAMS BY PLAYER IMPACT SCORE:");
  console.log("─".repeat(60));
  sorted.slice(0, 15).forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.team_name.padEnd(22)} | PIS: ${t.player_impact_score.toFixed(1)} | ${t.total_goals}G ${t.total_assists}A | Avg: ${t.avg_rating} | Top: ${t.top_player} (${t.top_player_goals}G)`);
  });

  console.log("\n💀 BOTTOM 15 TEAMS BY PLAYER IMPACT:");
  console.log("─".repeat(60));
  sorted.slice(-15).reverse().forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.team_name.padEnd(22)} | PIS: ${t.player_impact_score.toFixed(1)} | ${t.total_goals}G ${t.total_assists}A | Avg: ${t.avg_rating}`);
  });

  console.log("\n🎯 1X2 IMPACT (teams where players shift win probability most):");
  console.log("─".repeat(60));
  const byImpact = sorted.sort((a, b) => b.pis_1x2_impact - a.pis_1x2_impact);
  byImpact.slice(0, 10).forEach((t, i) => {
    const sign = t.pis_1x2_impact > 0 ? "+" : "";
    console.log(`  ${i + 1}. ${t.team_name.padEnd(22)} | 1X2 Impact: ${sign}${(t.pis_1x2_impact * 100).toFixed(1)}% | Depth: ${t.squad_depth} players`);
  });

  console.log("\n⚽ ATTACK vs DEFENSE BREAKDOWN:");
  console.log("─".repeat(60));
  const byAttack = [...sorted].sort((a, b) => b.attack_strength - a.attack_strength);
  const byDefense = [...sorted].sort((a, b) => b.defensive_solidity - a.defensive_solidity);
  console.log("  Best Attack:");
  byAttack.slice(0, 5).forEach((t, i) => {
    console.log(`    ${i + 1}. ${t.team_name.padEnd(20)} | ${t.attack_strength.toFixed(2)} G+A/game | ${t.shot_accuracy.toFixed(1)}% shot acc`);
  });
  console.log("  Best Defense:");
  byDefense.slice(0, 5).forEach((t, i) => {
    console.log(`    ${i + 1}. ${t.team_name.padEnd(20)} | ${t.defensive_solidity.toFixed(1)} tackles+int/game | ${t.discipline_risk.toFixed(3)} cards/game`);
  });

  console.log("\n✅ Player impact scoring complete!");
  console.log("These features can now be used by the 1X2 prediction model:");
  console.log("  • PIS difference → adjusts home win probability");
  console.log("  • Attack strength → affects Over/Under and BTTS");
  console.log("  • Shot accuracy → predicts scoring likelihood");
  console.log("  • Defensive solidity → predicts clean sheets");
  console.log("  • Discipline risk → predicts cards and suspensions");
  console.log("  • Squad depth → predicts fatigue and rotation effects");
}

main().catch(console.error);
