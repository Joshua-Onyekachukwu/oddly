#!/usr/bin/env node

/**
 * ODDLY Referee Feature Module
 * 
 * Pre-computes normalized name lookups for fast referee matching.
 * Provides referee home bias, card tendencies, goal tendencies,
 * and team-specific referee history.
 * 
 * Usage:
 *   const { getRefereeFeatures, loadRefereeData } = require('./worker/referee-features');
 *   const ref = getRefereeFeatures('Michael Oliver', 'Arsenal', 'Chelsea');
 */

const fs = require("fs");
const path = require("path");

let refereeProfiles = {};
let matchRefereeIndex = {}; // normalized → [{referee, date}]
let teamRefereeStats = {}; // "team|referee" → {matches, wins, draws, losses, goals_scored, goals_conceded}

function normalize(s) {
  return (s || "").toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/(fc|sc|cf|ac|afc|ssc|us|uv|rc|rcd|ca|cd|vfb|tsg)$/g, "");
}

function loadRefereeData() {
  // Load profiles
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "referee-profiles.json"), "utf8"));
    for (const r of raw) {
      refereeProfiles[r.name.toLowerCase()] = r;
    }
  } catch (e) { /* no profiles */ }

  // Load match-referee mappings and build fast index
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "football-data-referee-stats.json"), "utf8"));
    
    for (const m of data) {
      if (!m.referee || !m.home_team || !m.away_team) continue;
      
      const hNorm = normalize(m.home_team);
      const aNorm = normalize(m.away_team);
      const key = `${hNorm}|${aNorm}`;
      
      if (!matchRefereeIndex[key]) matchRefereeIndex[key] = [];
      matchRefereeIndex[key].push({
        referee: m.referee,
        date: m.date,
        ft_result: m.ft_result,
        home_goals: m.home_goals,
        away_goals: m.away_goals,
      });
      
      // Team-referee stats
      const teams = [m.home_team, m.away_team];
      const results = [
        m.ft_result === "H" ? "win" : m.ft_result === "D" ? "draw" : "loss",
        m.ft_result === "A" ? "win" : m.ft_result === "D" ? "draw" : "loss",
      ];
      const goalsScored = [m.home_goals || 0, m.away_goals || 0];
      const goalsConceded = [m.away_goals || 0, m.home_goals || 0];
      
      for (let i = 0; i < 2; i++) {
        const trKey = `${normalize(teams[i])}|${m.referee.toLowerCase()}`;
        if (!teamRefereeStats[trKey]) {
          teamRefereeStats[trKey] = { matches: 0, wins: 0, draws: 0, losses: 0, goals_scored: 0, goals_conceded: 0 };
        }
        const tr = teamRefereeStats[trKey];
        tr.matches++;
        if (results[i] === "win") tr.wins++;
        else if (results[i] === "draw") tr.draws++;
        else tr.losses++;
        tr.goals_scored += goalsScored[i];
        tr.goals_conceded += goalsConceded[i];
      }
    }
  } catch (e) { /* no match data */ }
  
  return {
    profiles: Object.keys(refereeProfiles).length,
    matches: Object.keys(matchRefereeIndex).length,
    teamRefereePairs: Object.keys(teamRefereeStats).length,
  };
}

function findReferee(homeTeam, awayTeam) {
  const hNorm = normalize(homeTeam);
  const aNorm = normalize(awayTeam);
  const key = `${hNorm}|${aNorm}`;
  
  const entries = matchRefereeIndex[key];
  if (!entries || entries.length === 0) return null;
  
  // Return most recent match's referee
  return entries[entries.length - 1].referee;
}

function getTeamRefereeStats(team, referee) {
  const key = `${normalize(team)}|${referee.toLowerCase()}`;
  const stats = teamRefereeStats[key];
  if (!stats || stats.matches < 2) return null;
  
  return {
    matches: stats.matches,
    winRate: stats.wins / stats.matches,
    drawRate: stats.draws / stats.matches,
    lossRate: stats.losses / stats.matches,
    avgGoalsScored: stats.goals_scored / stats.matches,
    avgGoalsConceded: stats.goals_conceded / stats.matches,
  };
}

function getRefereeFeatures(homeTeam, awayTeam) {
  const refereeName = findReferee(homeTeam, awayTeam);
  
  // Get team-specific referee stats
  const homeTeamRef = refereeName ? getTeamRefereeStats(homeTeam, refereeName) : null;
  const awayTeamRef = refereeName ? getTeamRefereeStats(awayTeam, refereeName) : null;
  
  // Get overall referee profile
  const profile = refereeName ? refereeProfiles[refereeName.toLowerCase()] : null;
  
  return {
    referee: refereeName,
    hasProfile: !!profile,
    
    // Referee tendencies (from profile)
    homeBias: profile?.homeBias || 0,
    avgGoals: profile?.avgGoals || 2.6,
    bttsPct: profile?.bttsPct || 0.50,
    over25Pct: profile?.over25Pct || 0.50,
    yellowPerMatch: profile?.avgYellow || 3.5,
    redPerMatch: profile?.avgRed || 0.1,
    avgFouls: profile?.avgFouls || 20,
    
    // Team-specific referee history
    homeTeamRef: homeTeamRef || { matches: 0, winRate: 0.46, avgGoalsScored: 1.4, avgGoalsConceded: 1.1 },
    awayTeamRef: awayTeamRef || { matches: 0, winRate: 0.30, avgGoalsScored: 1.0, avgGoalsConceded: 1.3 },
  };
}

// ─── CLI ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const stats = loadRefereeData();
  console.log("📊 Referee Feature Module");
  console.log("━".repeat(50));
  console.log(`   Profiles: ${stats.profiles}`);
  console.log(`   Match mappings: ${stats.matches}`);
  console.log(`   Team-referee pairs: ${stats.teamRefereePairs}`);
  
  // Example usage
  console.log("\n   Example: Arsenal vs Chelsea");
  const features = getRefereeFeatures("Arsenal", "Chelsea");
  console.log(`   Referee: ${features.referee || "Not found"}`);
  console.log(`   Home bias: ${(features.homeBias * 100).toFixed(1)}%`);
  console.log(`   Avg goals: ${features.avgGoals.toFixed(2)}`);
  console.log(`   BTTS rate: ${(features.bttsPct * 100).toFixed(1)}%`);
  console.log(`   Yellow/match: ${features.yellowPerMatch.toFixed(1)}`);
}

module.exports = { loadRefereeData, getRefereeFeatures, findReferee, getTeamRefereeStats, normalize };
