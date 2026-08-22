#!/usr/bin/env node

/**
 * Deep Relationship Analyzer — Referee × Team × Player × Outcome
 * 
 * Finds hidden connections:
 * - Which teams ALWAYS win/draw/lose under specific referees
 * - Which referees card specific teams more than others
 * - Which referees produce goals when specific teams play
 * - Player booking patterns under specific referees
 * - Foul differential patterns per referee-team combination
 * - Home advantage multiplier per referee per team
 * - Draw tendency per referee per team matchup
 * 
 * These are "tiny edges" that compound into real predictive signal.
 */

const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "football-data-referee-stats.json");
const allMatches = JSON.parse(fs.readFileSync(dataPath, "utf8"));

console.log("🔬 Deep Referee × Team × Outcome Relationship Analyzer");
console.log("━".repeat(70));
console.log(`Analyzing ${allMatches.length} matches for hidden patterns...\n`);

// ═══════════════════════════════════════════════════════════════
// 1. TEAM-REFEREE DOMINANCE PATTERNS
// ═══════════════════════════════════════════════════════════════

const teamRefStats = {}; // "TeamName|RefereeName" -> {home, draw, away, goals_for, goals_against, cards...}

for (const m of allMatches) {
  if (!m.referee || m.home_goals === null) continue;
  
  const homeKey = `${m.home_team}|${m.referee}`;
  const awayKey = `${m.away_team}|${m.referee}`;
  
  // Initialize
  for (const key of [homeKey, awayKey]) {
    if (!teamRefStats[key]) {
      teamRefStats[key] = {
        team: key.split("|")[0],
        referee: key.split("|")[1],
        matches: 0, wins: 0, draws: 0, losses: 0,
        goalsFor: 0, goalsAgainst: 0,
        homeMatches: 0, awayMatches: 0,
        yellowCards: 0, redCards: 0, fouls: 0,
        totalGoalsInMatch: 0,
        htHomeGoals: 0, htAwayGoals: 0,
      };
    }
  }
  
  // Home team stats
  const ht = teamRefStats[homeKey];
  ht.matches++;
  ht.homeMatches++;
  ht.goalsFor += m.home_goals;
  ht.goalsAgainst += m.away_goals;
  ht.yellowCards += (m.home_yellow || 0);
  ht.redCards += (m.home_red || 0);
  ht.fouls += (m.home_fouls || 0);
  ht.totalGoalsInMatch += m.home_goals + m.away_goals;
  ht.htHomeGoals += (m.ht_home_goals || 0);
  ht.htAwayGoals += (m.ht_away_goals || 0);
  
  if (m.ft_result === "H") ht.wins++;
  else if (m.ft_result === "D") ht.draws++;
  else ht.losses++;
  
  // Away team stats
  const at = teamRefStats[awayKey];
  at.matches++;
  at.awayMatches++;
  at.goalsFor += m.away_goals;
  at.goalsAgainst += m.home_goals;
  at.yellowCards += (m.away_yellow || 0);
  at.redCards += (m.away_red || 0);
  at.fouls += (m.away_fouls || 0);
  at.totalGoalsInMatch += m.home_goals + m.away_goals;
  at.htHomeGoals += (m.ht_home_goals || 0);
  at.htAwayGoals += (m.ht_away_goals || 0);
  
  if (m.ft_result === "A") at.wins++;
  else if (m.ft_result === "D") at.draws++;
  else at.losses++;
}

// ═══════════════════════════════════════════════════════════════
// 2. FIND DOMINANT PATTERNS (Team that always wins under specific ref)
// ═══════════════════════════════════════════════════════════════

console.log("═".repeat(70));
console.log("🏆 TEAM-REFEREE DOMINANCE PATTERNS");
console.log("(Teams that consistently win/lose under specific referees)");
console.log("═".repeat(70));

const dominantPatterns = [];
for (const [key, stats] of Object.entries(teamRefStats)) {
  if (stats.matches < 5) continue; // Need meaningful sample
  
  const winRate = stats.wins / stats.matches;
  const lossRate = stats.losses / stats.matches;
  const avgGoalsFor = stats.goalsFor / stats.matches;
  const avgGoalsAgainst = stats.goalsAgainst / stats.matches;
  const goalDiff = avgGoalsFor - avgGoalsAgainst;
  
  // Dominance score: how extreme is the win rate vs expected 40%
  const dominanceScore = Math.abs(winRate - 0.40);
  
  if (dominanceScore > 0.15) { // Significant deviation
    dominantPatterns.push({
      team: stats.team,
      referee: stats.referee,
      matches: stats.matches,
      wins: stats.wins,
      draws: stats.draws,
      losses: stats.losses,
      winRate: (winRate * 100).toFixed(1),
      avgGoalsFor: avgGoalsFor.toFixed(1),
      avgGoalsAgainst: avgGoalsAgainst.toFixed(1),
      goalDiff: goalDiff.toFixed(1),
      dominanceScore,
      direction: winRate > 0.40 ? "DOMINANT" : "STRUGGLING",
    });
  }
}

dominantPatterns.sort((a, b) => b.dominanceScore - a.dominanceScore);

console.log("\n🏆 TOP 15 TEAMS THAT DOMINATE UNDER SPECIFIC REFEREES:");
console.log("─".repeat(70));
dominantPatterns.filter(p => p.direction === "DOMINANT").slice(0, 15).forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.team.padEnd(22)} under ${p.referee.padEnd(20)} | ${p.matches} games | ${p.wins}W ${p.draws}D ${p.losses}L | ${p.winRate}% win | GD: ${p.goalDiff > 0 ? "+" : ""}${p.goalDiff}`);
});

console.log("\n💀 TOP 15 TEAMS THAT STRUGGLE UNDER SPECIFIC REFEREES:");
console.log("─".repeat(70));
dominantPatterns.filter(p => p.direction === "STRUGGLING").slice(0, 15).forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.team.padEnd(22)} under ${p.referee.padEnd(20)} | ${p.matches} games | ${p.wins}W ${p.draws}D ${p.losses}L | ${p.winRate}% win | GD: ${p.goalDiff > 0 ? "+" : ""}${p.goalDiff}`);
});

// ═══════════════════════════════════════════════════════════════
// 3. REFEREE CARDING PATTERNS PER TEAM
// ═══════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(70));
console.log("🟨 REFEREE CARDING PATTERNS PER TEAM");
console.log("(Which refs card which teams disproportionately)");
console.log("═".repeat(70));

const cardPatterns = [];
for (const [key, stats] of Object.entries(teamRefStats)) {
  if (stats.matches < 5) continue;
  
  const avgYellow = stats.yellowCards / stats.matches;
  const avgFouls = stats.fouls / stats.matches;
  
  // Expected average yellow cards per team per match is ~1.5
  const yellowDeviation = avgYellow - 1.5;
  
  if (Math.abs(yellowDeviation) > 0.5) {
    cardPatterns.push({
      team: stats.team,
      referee: stats.referee,
      matches: stats.matches,
      totalYellow: stats.yellowCards,
      avgYellow: avgYellow.toFixed(1),
      avgFouls: avgFouls.toFixed(1),
      yellowDeviation,
      direction: yellowDeviation > 0 ? "HEAVY CARDS" : "LENIENT",
    });
  }
}

cardPatterns.sort((a, b) => Math.abs(b.yellowDeviation) - Math.abs(a.yellowDeviation));

console.log("\n🟨 TEAMS THAT GET CARDED MOST BY SPECIFIC REFEREES:");
console.log("─".repeat(70));
cardPatterns.filter(p => p.direction === "HEAVY CARDS").slice(0, 10).forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.team.padEnd(22)} under ${p.referee.padEnd(20)} | ${p.avgYellow} 🟨/game | ${p.avgFouls} fouls/game | ${p.matches} matches`);
});

console.log("\n✅ TEAMS THAT ESCAPE CARDS UNDER SPECIFIC REFEREES:");
console.log("─".repeat(70));
cardPatterns.filter(p => p.direction === "LENIENT").slice(0, 10).forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.team.padEnd(22)} under ${p.referee.padEnd(20)} | ${p.avgYellow} 🟨/game | ${p.avgFouls} fouls/game | ${p.matches} matches`);
});

// ═══════════════════════════════════════════════════════════════
// 4. GOAL PATTERNS PER REFEREE-TEAM
// ═══════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(70));
console.log("⚽ GOAL PATTERNS PER REFEREE-TEAM COMBINATION");
console.log("(High/low scoring patterns when specific teams play specific refs)");
console.log("═".repeat(70));

const goalPatterns = [];
for (const [key, stats] of Object.entries(teamRefStats)) {
  if (stats.matches < 5) continue;
  
  const avgGoals = stats.totalGoalsInMatch / stats.matches;
  const avgGoalsFor = stats.goalsFor / stats.matches;
  const avgGoalsAgainst = stats.goalsAgainst / stats.matches;
  
  // Overall average is ~2.7 goals per match
  const goalDeviation = avgGoals - 2.7;
  
  if (Math.abs(goalDeviation) > 0.4) {
    goalPatterns.push({
      team: stats.team,
      referee: stats.referee,
      matches: stats.matches,
      avgGoals: avgGoals.toFixed(2),
      avgGoalsFor: avgGoalsFor.toFixed(1),
      avgGoalsAgainst: avgGoalsAgainst.toFixed(1),
      goalDeviation,
      direction: goalDeviation > 0 ? "HIGH SCORING" : "LOW SCORING",
    });
  }
}

goalPatterns.sort((a, b) => Math.abs(b.goalDeviation) - Math.abs(a.goalDeviation));

console.log("\n⚽ HIGHEST-SCORING REFEREE-TEAM COMBINATIONS:");
console.log("─".repeat(70));
goalPatterns.filter(p => p.direction === "HIGH SCORING").slice(0, 10).forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.team.padEnd(22)} under ${p.referee.padEnd(20)} | ${p.avgGoals} goals/match | For: ${p.avgGoalsFor} | Against: ${p.avgGoalsAgainst} | ${p.matches} matches`);
});

console.log("\n🔒 LOWEST-SCORING REFEREE-TEAM COMBINATIONS:");
console.log("─".repeat(70));
goalPatterns.filter(p => p.direction === "LOW SCORING").slice(0, 10).forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.team.padEnd(22)} under ${p.referee.padEnd(20)} | ${p.avgGoals} goals/match | For: ${p.avgGoalsFor} | Against: ${p.avgGoalsAgainst} | ${p.matches} matches`);
});

// ═══════════════════════════════════════════════════════════════
// 5. DRAW TENDENCY PATTERNS
// ═══════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(70));
console.log("🤝 DRAW TENDENCY PATTERNS");
console.log("(Teams/refs that produce draws at unusual rates)");
console.log("═".repeat(70));

const drawPatterns = [];
for (const [key, stats] of Object.entries(teamRefStats)) {
  if (stats.matches < 8) continue;
  
  const drawRate = stats.draws / stats.matches;
  const drawDeviation = drawRate - 0.24; // Average draw rate ~24%
  
  if (Math.abs(drawDeviation) > 0.08) {
    drawPatterns.push({
      team: stats.team,
      referee: stats.referee,
      matches: stats.matches,
      draws: stats.draws,
      drawRate: (drawRate * 100).toFixed(1),
      drawDeviation,
      direction: drawDeviation > 0 ? "DRAW PRONE" : "DECISIVE",
    });
  }
}

drawPatterns.sort((a, b) => Math.abs(b.drawDeviation) - Math.abs(a.drawDeviation));

console.log("\n🤝 MOST DRAW-PRONE REFEREE-TEAM COMBINATIONS:");
console.log("─".repeat(70));
drawPatterns.filter(p => p.direction === "DRAW PRONE").slice(0, 10).forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.team.padEnd(22)} under ${p.referee.padEnd(20)} | ${p.draws}/${p.matches} draws | ${p.drawRate}% draw rate | ${p.matches} matches`);
});

console.log("\n⚡ MOST DECISIVE (LEAST DRAWS) REFEREE-TEAM COMBINATIONS:");
console.log("─".repeat(70));
drawPatterns.filter(p => p.direction === "DECISIVE").slice(0, 10).forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.team.padEnd(22)} under ${p.referee.padEnd(20)} | ${p.draws}/${p.matches} draws | ${p.drawRate}% draw rate | ${p.matches} matches`);
});

// ═══════════════════════════════════════════════════════════════
// 6. REFEREE HEAD-TO-HEAD MATCHUP PATTERNS
// ═══════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(70));
console.log("⚔️  REFEREE MATCHUP PATTERNS (When two teams meet under specific ref)");
console.log("═".repeat(70));

const matchupPatterns = {};
for (const m of allMatches) {
  if (!m.referee || m.home_goals === null) continue;
  
  const matchupKey = [m.home_team, m.away_team].sort().join(" vs ");
  const fullKey = `${matchupKey}|${m.referee}`;
  
  if (!matchupPatterns[fullKey]) {
    matchupPatterns[fullKey] = {
      home_team: m.home_team,
      away_team: m.away_team,
      referee: m.referee,
      matches: 0,
      homeWins: 0, draws: 0, awayWins: 0,
      totalGoals: 0,
    };
  }
  
  const mp = matchupPatterns[fullKey];
  mp.matches++;
  mp.totalGoals += m.home_goals + m.away_goals;
  if (m.ft_result === "H") mp.homeWins++;
  else if (m.ft_result === "D") mp.draws++;
  else mp.awayWins++;
}

// Find matchups with extreme results
const extremeMatchups = Object.values(matchupPatterns)
  .filter(mp => mp.matches >= 3)
  .map(mp => ({
    ...mp,
    homeWinPct: ((mp.homeWins / mp.matches) * 100).toFixed(0),
    drawPct: ((mp.draws / mp.matches) * 100).toFixed(0),
    awayWinPct: ((mp.awayWins / mp.matches) * 100).toFixed(0),
    avgGoals: (mp.totalGoals / mp.matches).toFixed(1),
    dominance: Math.abs((mp.homeWins - mp.awayWins) / mp.matches),
  }))
  .sort((a, b) => b.dominance - a.dominance);

console.log("\n⚔️  MOST ONE-SIDED MATCHUPS UNDER SPECIFIC REFEREES:");
console.log("─".repeat(70));
extremeMatchups.slice(0, 15).forEach((mp, i) => {
  const winner = mp.homeWins > mp.awayWins ? mp.home_team : mp.away_team;
  console.log(`  ${i + 1}. ${mp.home_team} vs ${mp.away_team} under ${mp.referee}`);
  console.log(`     ${mp.matches} games | ${mp.homeWinPct}%H ${mp.drawPct}%D ${mp.awayWinPct}%A | Winner: ${winner} | Avg goals: ${mp.avgGoals}`);
});

// ═══════════════════════════════════════════════════════════════
// 7. REFEREE LEAGUE TENDENCIES
// ═══════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(70));
console.log("🌍 REFEREE TENDENCIES BY LEAGUE");
console.log("═".repeat(70));

const leagueRefStats = {};
for (const m of allMatches) {
  if (!m.referee || m.home_goals === null) continue;
  
  const key = `${m.league}|${m.referee}`;
  if (!leagueRefStats[key]) {
    leagueRefStats[key] = { league: m.league, referee: m.referee, matches: 0, homeWins: 0, draws: 0, totalGoals: 0 };
  }
  const ls = leagueRefStats[key];
  ls.matches++;
  ls.totalGoals += m.home_goals + m.away_goals;
  if (m.ft_result === "H") ls.homeWins++;
  else if (m.ft_result === "D") ls.draws++;
}

// Referees that officiate in multiple leagues
const multiLeagueRefs = {};
for (const [, stats] of Object.entries(leagueRefStats)) {
  if (!multiLeagueRefs[stats.referee]) multiLeagueRefs[stats.referee] = [];
  multiLeagueRefs[stats.referee].push(stats);
}

const multiRef = Object.entries(multiLeagueRefs)
  .filter(([_, leagues]) => leagues.length >= 2)
  .map(([name, leagues]) => ({
    name,
    leagues: leagues.map(l => l.league),
    totalMatches: leagues.reduce((s, l) => s + l.matches, 0),
  }))
  .sort((a, b) => b.totalMatches - a.totalMatches);

if (multiRef.length > 0) {
  console.log("\n👥 REFEREES OFFICIATING IN MULTIPLE LEAGUES:");
  console.log("─".repeat(70));
  multiRef.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name.padEnd(20)} | ${r.totalMatches} matches | Leagues: ${r.leagues.join(", ")}`);
  });
}

// ═══════════════════════════════════════════════════════════════
// 8. SAVE ALL PATTERNS AS PREDICTIVE FEATURES
// ═══════════════════════════════════════════════════════════════

const featureExport = {
  generatedAt: new Date().toISOString(),
  totalMatches: allMatches.length,
  features: {
    teamRefereeDominance: dominantPatterns.slice(0, 50).map(p => ({
      team: p.team, referee: p.referee, matches: p.matches,
      winRate: parseFloat(p.winRate), goalDiff: parseFloat(p.goalDiff),
      signal: p.direction,
    })),
    teamRefereeCards: cardPatterns.slice(0, 50).map(p => ({
      team: p.team, referee: p.referee, matches: p.matches,
      avgYellow: parseFloat(p.avgYellow), avgFouls: parseFloat(p.avgFouls),
      signal: p.direction,
    })),
    teamRefereeGoals: goalPatterns.slice(0, 50).map(p => ({
      team: p.team, referee: p.referee, matches: p.matches,
      avgGoals: parseFloat(p.avgGoals),
      signal: p.direction,
    })),
    teamRefereeDraws: drawPatterns.slice(0, 50).map(p => ({
      team: p.team, referee: p.referee, matches: p.matches,
      drawRate: parseFloat(p.drawRate),
      signal: p.direction,
    })),
    extremeMatchups: extremeMatchups.slice(0, 30).map(mp => ({
      home_team: mp.home_team, away_team: mp.away_team, referee: mp.referee,
      matches: mp.matches, homeWinPct: parseFloat(mp.homeWinPct),
      drawPct: parseFloat(mp.drawPct), awayWinPct: parseFloat(mp.awayWinPct),
      avgGoals: parseFloat(mp.avgGoals),
    })),
  },
};

const outPath = path.join(__dirname, "..", "data", "referee-relationship-features.json");
fs.writeFileSync(outPath, JSON.stringify(featureExport, null, 2));
console.log(`\n💾 ${featureExport.features.teamRefereeDominance.length} dominance patterns saved`);
console.log(`💾 ${featureExport.features.teamRefereeCards.length} card patterns saved`);
console.log(`💾 ${featureExport.features.teamRefereeGoals.length} goal patterns saved`);
console.log(`💾 ${featureExport.features.teamRefereeDraws.length} draw patterns saved`);
console.log(`💾 ${featureExport.features.extremeMatchups.length} extreme matchups saved`);
console.log(`📁 Saved to: ${outPath}`);

console.log("\n" + "═".repeat(70));
console.log("✅ DEEP RELATIONSHIP ANALYSIS COMPLETE");
console.log("═".repeat(70));
console.log("\nThese patterns can now be used as predictive features:");
console.log("  1. Team-Referee dominance score → 1X2 prediction adjustment");
console.log("  2. Team-Referee card tendency → BTTS, card market predictions");
console.log("  3. Team-Referee goal tendency → Over/Under predictions");
console.log("  4. Team-Referee draw tendency → Draw prediction adjustment");
console.log("  5. Extreme matchup patterns → Specific fixture predictions");
console.log("  6. Referee league tendencies → Cross-league referee effects");
