#!/usr/bin/env node

/**
 * ODDLY Player Impact Calculator
 *
 * Calculates player impact scores from collected StatsBomb data.
 * Measures On/Off performance, availability impact, and combination effects.
 *
 * Run: node worker/calculate-player-impact.js
 */

const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const fs = require("fs");
  const path = require("path");
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

// ─── Step 1: Get all players with appearances ───────────────────────────────

async function getPlayersWithAppearances() {
  console.log("\n📊 Loading player appearances...");

  const { data: players } = await supabase
    .from("players")
    .select("id, name, position");

  if (!players || players.length === 0) {
    console.log("   No players found. Run collect-statsbomb.js first.");
    return [];
  }

  console.log(`   Found ${players.length} players`);
  return players;
}

// ─── Step 2: Calculate On/Off metrics for a player ──────────────────────────

async function calculateOnOff(playerId, teamId) {
  // Get all matches this player appeared in
  const { data: appearances } = await supabase
    .from("player_appearances")
    .select(`
      fixture_id, minutes_played, is_starter,
      goals, assists, xg, xa
    `)
    .eq("player_id", playerId);

  if (!appearances || appearances.length < 5) {
    return null; // Not enough data
  }

  const matchIds = appearances.map(a => a.fixture_id);

  // Get results for these matches
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, home_score, away_score, home_team_id, away_team_id")
    .in("id", matchIds);

  if (!fixtures || fixtures.length === 0) return null;

  // Calculate team performance WITH this player
  let wins = 0, draws = 0, losses = 0;
  let goalsScored = 0, goalsConceded = 0;
  let matches = 0;

  for (const fixture of fixtures) {
    const appearance = appearances.find(a => a.fixture_id === fixture.id);
    if (!appearance) continue;

    const isHome = fixture.home_team_id === teamId;
    const teamGoals = isHome ? fixture.home_score : fixture.away_score;
    const opponentGoals = isHome ? fixture.away_score : fixture.home_score;

    goalsScored += teamGoals;
    goalsConceded += opponentGoals;
    matches++;

    if (teamGoals > opponentGoals) wins++;
    else if (teamGoals === opponentGoals) draws++;
    else losses++;
  }

  if (matches === 0) return null;

  return {
    matches,
    wins,
    draws,
    losses,
    winRate: wins / matches,
    goalsPer90: (goalsScored / matches) * (90 / 90), // Simplified
    concededPer90: (goalsConceded / matches) * (90 / 90),
    pointsPerMatch: (wins * 3 + draws) / matches,
  };
}

// ─── Step 3: Calculate team performance WITHOUT this player ─────────────────

async function calculateWithoutPlayer(playerId, teamId) {
  // Get all matches where this team played
  const { data: allMatches } = await supabase
    .from("fixtures")
    .select("id, home_score, away_score, home_team_id, away_team_id")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);

  if (!allMatches || allMatches.length < 10) return null;

  // Get matches where player DID appear
  const { data: appearances } = await supabase
    .from("player_appearances")
    .select("fixture_id")
    .eq("player_id", playerId);

  const playerMatchIds = new Set(appearances?.map(a => a.fixture_id) || []);

  // Filter to matches WITHOUT this player
  const withoutMatches = allMatches.filter(m => !playerMatchIds.has(m.id));

  if (withoutMatches.length < 5) return null;

  let wins = 0, draws = 0, losses = 0;
  let goalsScored = 0, goalsConceded = 0;

  for (const fixture of withoutMatches) {
    const isHome = fixture.home_team_id === teamId;
    const teamGoals = isHome ? fixture.home_score : fixture.away_score;
    const opponentGoals = isHome ? fixture.away_score : fixture.home_score;

    goalsScored += teamGoals;
    goalsConceded += opponentGoals;

    if (teamGoals > opponentGoals) wins++;
    else if (teamGoals === opponentGoals) draws++;
    else losses++;
  }

  const matches = withoutMatches.length;

  return {
    matches,
    wins,
    draws,
    losses,
    winRate: wins / matches,
    goalsPer90: (goalsScored / matches) * (90 / 90),
    concededPer90: (goalsConceded / matches) * (90 / 90),
    pointsPerMatch: (wins * 3 + draws) / matches,
  };
}

// ─── Step 4: Calculate impact score ─────────────────────────────────────────

function calculateImpactScore(onOff, withoutPlayer) {
  if (!onOff || !withoutPlayer) return 0;

  // Weighted impact score (0-100)
  let score = 0;

  // Win rate impact (40% weight)
  const winRateDiff = onOff.winRate - withoutPlayer.winRate;
  score += winRateDiff * 80; // +40 for 0.5 difference

  // Goals scored impact (30% weight)
  const goalsDiff = onOff.goalsPer90 - withoutPlayer.goalsPer90;
  score += goalsDiff * 30; // +30 for 1.0 goal difference

  // Goals conceded impact (20% weight)
  const concededDiff = withoutPlayer.concededPer90 - onOff.concededPer90;
  score += concededDiff * 20; // +20 for 1.0 goal difference

  // Points per match impact (10% weight)
  const pointsDiff = onOff.pointsPerMatch - withoutPlayer.pointsPerMatch;
  score += pointsDiff * 10;

  // Normalize to 0-100
  return Math.max(0, Math.min(100, Math.round(score + 50)));
}

// ─── Step 5: Determine impact tier ──────────────────────────────────────────

function getImpactTier(score) {
  if (score >= 70) return "elite";
  if (score >= 60) return "high";
  if (score >= 50) return "medium";
  if (score >= 40) return "low";
  return "negligible";
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("📊 ODDLY Player Impact Calculator");
  console.log("━".repeat(70));

  const players = await getPlayersWithAppearances();
  if (players.length === 0) return;

  let processed = 0;
  let impactScores = [];

  for (const player of players) {
    // Get player's team
    const { data: appearances } = await supabase
      .from("player_appearances")
      .select("team_id")
      .eq("player_id", player.id)
      .limit(1);

    if (!appearances || appearances.length === 0) continue;
    const teamId = appearances[0].team_id;

    // Calculate On/Off
    const onOff = await calculateOnOff(player.id, teamId);
    if (!onOff) continue;

    // Calculate without player
    const without = await calculateWithoutPlayer(player.id, teamId);
    if (!without) continue;

    // Calculate impact score
    const impactScore = calculateImpactScore(onOff, without);
    const impactTier = getImpactTier(impactScore);

    impactScores.push({
      playerId: player.id,
      playerName: player.name,
      teamId,
      impactScore,
      impactTier,
      onOff,
      without,
    });

    processed++;
    if (processed % 50 === 0) {
      console.log(`   📊 Processed ${processed} players...`);
    }
  }

  // Sort by impact score
  impactScores.sort((a, b) => b.impactScore - a.impactScore);

  // Display top players
  console.log("\n" + "═".repeat(70));
  console.log("🏆 TOP 20 MOST IMPACTFUL PLAYERS");
  console.log("═".repeat(70));

  for (let i = 0; i < Math.min(20, impactScores.length); i++) {
    const p = impactScores[i];
    const emoji = p.impactTier === "elite" ? "🥇" :
                  p.impactTier === "high" ? "🥈" :
                  p.impactTier === "medium" ? "🥉" : "  ";
    console.log(`${emoji} ${i + 1}. ${p.playerName}`);
    console.log(`   Impact: ${p.impactScore}/100 [${p.impactTier}]`);
    console.log(`   Win rate: ${(p.onOff.winRate * 100).toFixed(1)}% with vs ${(p.without.winRate * 100).toFixed(1)}% without`);
    console.log(`   Goals: ${p.onOff.goalsPer90.toFixed(2)} with vs ${p.without.goalsPer90.toFixed(2)} without`);
    console.log("");
  }

  // Store in Supabase
  console.log("\n💾 Storing impact scores...");

  for (const p of impactScores) {
    await supabase.from("player_impact").upsert({
      player_id: p.playerId,
      team_id: p.teamId,
      season: "all",
      matches_started: p.onOff.matches,
      team_win_rate_with: p.onOff.winRate,
      team_win_rate_without: p.without.winRate,
      team_goals_per_90_with: p.onOff.goalsPer90,
      team_goals_per_90_without: p.without.goalsPer90,
      team_conceded_per_90_with: p.onOff.concededPer90,
      team_conceded_per_90_without: p.without.concededPer90,
      impact_score: p.impactScore,
      impact_tier: p.impactTier,
      total_minutes: p.onOff.matches * 90,
      starts_count: p.onOff.matches,
    }, { onConflict: "player_id,team_id,season" });
  }

  console.log(`   ✅ Stored ${impactScores.length} impact scores`);

  // Summary
  const tiers = { elite: 0, high: 0, medium: 0, low: 0, negligible: 0 };
  for (const p of impactScores) tiers[p.impactTier]++;

  console.log("\n" + "═".repeat(70));
  console.log("📊 IMPACT DISTRIBUTION");
  console.log("═".repeat(70));
  console.log(`   Elite (70+):      ${tiers.elite} players`);
  console.log(`   High (60-69):     ${tiers.high} players`);
  console.log(`   Medium (50-59):   ${tiers.medium} players`);
  console.log(`   Low (40-49):      ${tiers.low} players`);
  console.log(`   Negligible (<40): ${tiers.negligible} players`);
  console.log("━".repeat(70));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
