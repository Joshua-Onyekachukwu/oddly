#!/usr/bin/env node

/**
 * ODDLY Referee Feature Builder
 *
 * Builds time-safe referee features from local JSON data.
 * Features represent information available BEFORE each match.
 *
 * Output: data/referee-features.json — keyed by "homeTeam_awayTeam_date"
 */

const fs = require("fs");
const path = require("path");

function loadJSON(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", filename), "utf8"));
  } catch (e) {
    console.log(`  ⚠️  ${filename}: ${e.message}`);
    return null;
  }
}

// ─── Build Referee Match Timeline ────────────────────────────────────────
function buildRefereeTimeline(history) {
  const timeline = {};
  for (const h of history) {
    const ref = h.referee;
    if (!ref) continue;
    if (!timeline[ref]) timeline[ref] = [];
    timeline[ref].push({
      date: h.date,
      home_team: h.home_team,
      away_team: h.away_team,
      home_goals: h.home_goals || 0,
      away_goals: h.away_goals || 0,
      ft_result: h.ft_result,
      home_yellow: h.home_yellow || 0,
      away_yellow: h.away_yellow || 0,
      home_red: h.home_red || 0,
      away_red: h.away_red || 0,
      home_fouls: h.home_fouls || 0,
      away_fouls: h.away_fouls || 0,
    });
  }
  // Sort each referee's matches by date
  for (const ref of Object.keys(timeline)) {
    timeline[ref].sort((a, b) => a.date.localeCompare(b.date));
  }
  return timeline;
}

// ─── Compute Referee Stats Up To a Date ──────────────────────────────────
function computeRefStats(timeline, refName, beforeDate) {
  const matches = (timeline[refName] || []).filter(m => m.date < beforeDate);
  if (matches.length < 5) return null; // Minimum sample

  const n = matches.length;
  let homeWins = 0, draws = 0, awayWins = 0;
  let totalGoals = 0, homeGoals = 0, awayGoals = 0;
  let btts = 0, over25 = 0;
  let totalYellow = 0, totalRed = 0, totalFouls = 0;

  for (const m of matches) {
    const total = m.home_goals + m.away_goals;
    if (m.ft_result === "H") homeWins++;
    else if (m.ft_result === "D") draws++;
    else if (m.ft_result === "A") awayWins++;

    totalGoals += total;
    homeGoals += m.home_goals;
    awayGoals += m.away_goals;
    if (m.home_goals > 0 && m.away_goals > 0) btts++;
    if (total > 2.5) over25++;
    totalYellow += m.home_yellow + m.away_yellow;
    totalRed += m.home_red + m.away_red;
    totalFouls += m.home_fouls + m.away_fouls;
  }

  return {
    matches: n,
    home_win_pct: homeWins / n,
    draw_pct: draws / n,
    away_win_pct: awayWins / n,
    avg_total_goals: totalGoals / n,
    avg_home_goals: homeGoals / n,
    avg_away_goals: awayGoals / n,
    btts_pct: btts / n,
    over25_pct: over25 / n,
    avg_yellow: totalYellow / n,
    avg_red: totalRed / n,
    avg_fouls: totalFouls / n,
    home_bias: (homeWins / n) - 0.46, // Relative to average home win rate
  };
}

// ─── Compute Team-Referee History ────────────────────────────────────────
function computeTeamRefHistory(timeline, teamName, refName, beforeDate) {
  const matches = (timeline[refName] || []).filter(m =>
    m.date < beforeDate && (m.home_team === teamName || m.away_team === teamName)
  );
  if (matches.length < 3) return null; // Need at least 3 matches

  let wins = 0, draws = 0, losses = 0;
  for (const m of matches) {
    const isHome = m.home_team === teamName;
    const goalsFor = isHome ? m.home_goals : m.away_goals;
    const goalsAgainst = isHome ? m.away_goals : m.home_goals;
    if (goalsFor > goalsAgainst) wins++;
    else if (goalsFor === goalsAgainst) draws++;
    else losses++;
  }

  return {
    matches: matches.length,
    wins,
    draws,
    losses,
    win_rate: wins / matches.length,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────
function main() {
  console.log("👨‍⚖️ Building Referee Features");
  console.log("━".repeat(55));

  // Load referee match history
  const history = loadJSON("football-data-referee-stats.json");
  if (!history || !Array.isArray(history)) {
    console.log("  ❌ No referee history data found");
    return;
  }

  console.log(`  Loaded ${history.length} referee match records`);

  // Build timeline
  const timeline = buildRefereeTimeline(history);
  const refCount = Object.keys(timeline).length;
  console.log(`  ${refCount} unique referees`);

  // Get unique team names
  const teams = new Set();
  for (const h of history) {
    if (h.home_team) teams.add(h.home_team);
    if (h.away_team) teams.add(h.away_team);
  }
  console.log(`  ${teams.size} unique teams`);

  // Build features for each match
  const features = {};
  let featureCount = 0;
  let withRef = 0;

  for (const h of history) {
    const ref = h.referee;
    if (!ref || !timeline[ref]) continue;

    const homeTeam = h.home_team;
    const awayTeam = h.away_team;
    const date = h.date;
    const key = `${homeTeam}_${awayTeam}_${date}`;

    // Referee stats up to this match
    const refStats = computeRefStats(timeline, ref, date);

    // Team-referee history
    const homeTeamRef = computeTeamRefHistory(timeline, homeTeam, ref, date);
    const awayTeamRef = computeTeamRefHistory(timeline, awayTeam, ref, date);

    features[key] = {
      referee_name: ref,
      ref_stats: refStats,
      home_team_ref: homeTeamRef,
      away_team_ref: awayTeamRef,
    };

    featureCount++;
    if (refStats) withRef++;
  }

  // Save features
  const outputPath = path.join(__dirname, "..", "data", "referee-features-built.json");
  fs.writeFileSync(outputPath, JSON.stringify({
    built_at: new Date().toISOString(),
    total_matches: featureCount,
    matches_with_ref_stats: withRef,
    unique_referees: refCount,
    features,
  }, null, 2));

  console.log(`\n  ✅ Built features for ${featureCount} matches`);
  console.log(`  ${withRef} matches have referee statistics (min 5 matches)`);
  console.log(`  Saved to ${outputPath}`);

  // Summary stats
  console.log("\n  Top 10 referees by match count:");
  const refCounts = Object.entries(timeline)
    .map(([name, matches]) => ({ name, count: matches.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  for (const r of refCounts) {
    const stats = computeRefStats(timeline, r.name, "2099-01-01");
    console.log(`    ${r.name.padEnd(20)} ${r.count.toString().padStart(4)} matches | Home: ${(stats?.home_win_pct * 100 || 0).toFixed(1)}% | Goals: ${(stats?.avg_total_goals || 0).toFixed(2)} | Yellow: ${(stats?.avg_yellow || 0).toFixed(1)}`);
  }
}

main();
