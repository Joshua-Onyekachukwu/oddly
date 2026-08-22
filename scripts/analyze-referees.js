#!/usr/bin/env node

/**
 * Referee Impact Analysis Engine
 * 
 * Analyzes how referees affect match outcomes:
 * - Home advantage variance by referee
 * - Card tendencies (strict vs lenient)
 * - Goal tendencies (high/low scoring)
 * - Team-specific referee relationships
 * - Identifies referee biases and patterns
 * 
 * Key insight: Some referees consistently produce more home wins,
 * more goals, more cards, or more draws than average.
 * This is a genuine predictive signal.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load env
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

// ─── Referee Profile Computation ─────────────────────────────

async function computeRefereeProfiles() {
  console.log("🔄 Computing referee profiles from match stats...");
  
  // Get all matches with referee data
  const { data: matches, error } = await sb.from("match_stats")
    .select(`
      *,
      fixtures!inner(
        id, home_team_id, away_team_id, league_id,
        home_score, away_score, status,
        kickoff_time
      )
    `)
    .not("referee", "is", null)
    .eq("fixtures.status", "finished");
  
  if (error) throw error;
  if (!matches || matches.length === 0) {
    console.log("⚠️  No match stats with referee data found. Run scrape-football-data.js first.");
    return;
  }
  
  console.log(`📊 Analyzing ${matches.length} matches with referee data...`);
  
  // Group by referee
  const refereeMap = {};
  for (const match of matches) {
    const ref = match.referee;
    if (!refereeMap[ref]) {
      refereeMap[ref] = [];
    }
    refereeMap[ref].push(match);
  }
  
  console.log(`👤 Found ${Object.keys(refereeMap).length} unique referees`);
  
  // Compute profiles
  const profiles = [];
  
  for (const [refName, refMatches] of Object.entries(refereeMap)) {
    if (refMatches.length < 5) continue; // Need minimum sample
    
    let homeWins = 0, draws = 0, awayWins = 0;
    let totalGoals = 0, homeGoals = 0, awayGoals = 0;
    let totalYellow = 0, totalRed = 0, totalFouls = 0;
    let bttsCount = 0, over25Count = 0, over15Count = 0;
    let penalties = 0;
    const leagues = new Set();
    
    for (const m of refMatches) {
      const hs = m.fixtures.home_score;
      const as = m.fixtures.away_score;
      if (hs === null || as === null) continue;
      
      const ftResult = m.ft_result || (hs > as ? "H" : hs < as ? "A" : "D");
      
      if (ftResult === "H") homeWins++;
      else if (ftResult === "D") draws++;
      else awayWins++;
      
      const total = hs + as;
      totalGoals += total;
      homeGoals += hs;
      awayGoals += as;
      
      if (hs > 0 && as > 0) bttsCount++;
      if (total > 2) over25Count++;
      if (total > 1) over15Count++;
      
      totalYellow += (m.home_yellow_cards || 0) + (m.away_yellow_cards || 0);
      totalRed += (m.home_red_cards || 0) + (m.away_red_cards || 0);
      totalFouls += (m.home_fouls || 0) + (m.away_fouls || 0);
      
      leagues.add(m.fixtures.league_id);
    }
    
    const n = refMatches.length;
    
    const profile = {
      referee_name: refName,
      total_matches: n,
      total_home_wins: homeWins,
      total_draws: draws,
      total_away_wins: awayWins,
      
      home_win_pct: Math.round((homeWins / n) * 10000) / 100,
      draw_pct: Math.round((draws / n) * 10000) / 100,
      away_win_pct: Math.round((awayWins / n) * 10000) / 100,
      
      avg_yellow_per_match: Math.round((totalYellow / n) * 100) / 100,
      avg_red_per_match: Math.round((totalRed / n) * 1000) / 1000,
      avg_fouls_per_match: Math.round((totalFouls / n) * 100) / 100,
      
      avg_total_goals: Math.round((totalGoals / n) * 100) / 100,
      avg_home_goals: Math.round((homeGoals / n) * 100) / 100,
      avg_away_goals: Math.round((awayGoals / n) * 100) / 100,
      
      btts_pct: Math.round((bttsCount / n) * 10000) / 100,
      over_2_5_pct: Math.round((over25Count / n) * 10000) / 100,
      over_1_5_pct: Math.round((over15Count / n) * 10000) / 100,
      
      // Home bias: positive = referee favors home team, negative = favors away
      // Average home win % in football is ~46%. Deviation from that is the bias.
      home_bias: Math.round(((homeWins / n) - 0.46) * 1000) / 1000,
      
      leagues_officiated: [...leagues],
      last_match_date: refMatches.reduce((latest, m) => {
        const d = m.fixtures.kickoff_time;
        return d > latest ? d : latest;
      }, ""),
      updated_at: new Date().toISOString(),
    };
    
    profiles.push(profile);
  }
  
  // Upsert profiles
  let stored = 0;
  for (const p of profiles) {
    try {
      await sb.from("referee_profiles").upsert(p, { onConflict: "referee_name" });
      stored++;
    } catch (e) {
      console.log(`⚠️  Error storing ${p.referee_name}: ${e.message}`);
    }
  }
  
  console.log(`✅ ${stored} referee profiles computed and stored`);
  return profiles;
}

// ─── Team-Referee Relationship Computation ───────────────────

async function computeTeamRefereeStats() {
  console.log("\n🔄 Computing team-referee relationships...");
  
  const { data: matches, error } = await sb.from("match_stats")
    .select(`
      *,
      fixtures!inner(
        id, home_team_id, away_team_id, league_id,
        home_score, away_score, status, kickoff_time
      )
    `)
    .not("referee", "is", null)
    .eq("fixtures.status", "finished");
  
  if (error) throw error;
  if (!matches || matches.length === 0) return;
  
  // Group by team + referee
  const teamRefMap = {};
  
  for (const match of matches) {
    const { fixtures: f } = match;
    const hs = f.home_score;
    const as = f.away_score;
    if (hs === null || as === null) continue;
    
    const ref = match.referee;
    
    // Home team perspective
    const homeKey = `${f.home_team_id}:${ref}`;
    if (!teamRefMap[homeKey]) {
      teamRefMap[homeKey] = {
        team_id: f.home_team_id,
        referee_name: ref,
        matches: 0, wins: 0, draws: 0, losses: 0,
        goals_scored: 0, goals_conceded: 0,
        yellow: 0, red: 0, fouls: 0,
      };
    }
    const ht = teamRefMap[homeKey];
    ht.matches++;
    if (hs > as) ht.wins++;
    else if (hs === as) ht.draws++;
    else ht.losses++;
    ht.goals_scored += hs;
    ht.goals_conceded += as;
    ht.yellow += (match.home_yellow_cards || 0);
    ht.red += (match.home_red_cards || 0);
    ht.fouls += (match.home_fouls || 0);
    
    // Away team perspective
    const awayKey = `${f.away_team_id}:${ref}`;
    if (!teamRefMap[awayKey]) {
      teamRefMap[awayKey] = {
        team_id: f.away_team_id,
        referee_name: ref,
        matches: 0, wins: 0, draws: 0, losses: 0,
        goals_scored: 0, goals_conceded: 0,
        yellow: 0, red: 0, fouls: 0,
      };
    }
    const at = teamRefMap[awayKey];
    at.matches++;
    if (as > hs) at.wins++;
    else if (as === hs) at.draws++;
    else at.losses++;
    at.goals_scored += as;
    at.goals_conceded += hs;
    at.yellow += (match.away_yellow_cards || 0);
    at.red += (match.away_red_cards || 0);
    at.fouls += (match.away_fouls || 0);
  }
  
  // Store results
  let stored = 0;
  for (const [, stats] of Object.entries(teamRefMap)) {
    if (stats.matches < 2) continue; // Need at least 2 matches
    
    const winPct = stats.wins / stats.matches;
    
    // Referee advantage: how much better/worse this team performs under this ref
    // compared to their average. Positive = referee is favorable.
    // We approximate: a team's average win rate ~40% (home 46%, away 30%, avg ~38%)
    const refereeAdvantage = Math.round((winPct - 0.38) * 1000) / 1000;
    
    try {
      await sb.from("team_referee_stats").upsert({
        team_id: stats.team_id,
        referee_name: stats.referee_name,
        matches_under_referee: stats.matches,
        wins: stats.wins,
        draws: stats.draws,
        losses: stats.losses,
        goals_scored: stats.goals_scored,
        goals_conceded: stats.goals_conceded,
        yellow_cards: stats.yellow,
        red_cards: stats.red,
        fouls_committed: stats.fouls,
        win_pct: Math.round(winPct * 10000) / 100,
        referee_advantage: refereeAdvantage,
        updated_at: new Date().toISOString(),
      }, { onConflict: "team_id,referee_name" });
      stored++;
    } catch (e) {
      // Skip errors
    }
  }
  
  console.log(`✅ ${stored} team-referee relationships computed and stored`);
}

// ─── Print Analysis Report ──────────────────────────────────

async function printReport() {
  console.log("\n📊 REFEE IMPACT ANALYSIS REPORT");
  console.log("━".repeat(60));
  
  // Top 10 most strict referees (most cards)
  const { data: strict } = await sb.from("referee_profiles")
    .select("referee_name, total_matches, avg_yellow_per_match, avg_red_per_match, avg_fouls_per_match, home_bias")
    .gte("total_matches", 20)
    .order("avg_yellow_per_match", { ascending: false })
    .limit(10);
  
  if (strict && strict.length > 0) {
    console.log("\n🟨 TOP 10 STRICTEST REFEREES (most cards per match)");
    console.log("   " + "─".repeat(55));
    strict.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.referee_name.padEnd(25)} | ${r.total_matches} matches | ${r.avg_yellow_per_match} 🟨 | ${r.avg_red_per_match} 🟥 | Home bias: ${(r.home_bias > 0 ? "+" : "")}${r.home_bias}`);
    });
  }
  
  // Top 10 highest home bias
  const { data: homeBias } = await sb.from("referee_profiles")
    .select("referee_name, total_matches, home_win_pct, draw_pct, away_win_pct, home_bias, avg_total_goals")
    .gte("total_matches", 20)
    .order("home_bias", { ascending: false })
    .limit(10);
  
  if (homeBias && homeBias.length > 0) {
    console.log("\n🏠 TOP 10 REFEREES WITH HIGHEST HOME BIAS");
    console.log("   " + "─".repeat(55));
    homeBias.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.referee_name.padEnd(25)} | Home: ${r.home_win_pct}% | Draw: ${r.draw_pct}% | Away: ${r.away_win_pct}% | Bias: +${r.home_bias}`);
    });
  }
  
  // Top 10 highest-scoring referees
  const { data: highScoring } = await sb.from("referee_profiles")
    .select("referee_name, total_matches, avg_total_goals, over_2_5_pct, btts_pct")
    .gte("total_matches", 20)
    .order("avg_total_goals", { ascending: false })
    .limit(10);
  
  if (highScoring && highScoring.length > 0) {
    console.log("\n⚽ TOP 10 HIGHEST-SCORING REFEREES");
    console.log("   " + "─".repeat(55));
    highScoring.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.referee_name.padEnd(25)} | ${r.avg_total_goals} goals/match | O2.5: ${r.over_2_5_pct}% | BTTS: ${r.btts_pct}%`);
    });
  }
  
  // Top 10 most favorable referees for away teams (lowest home bias)
  const { data: awayFavor } = await sb.from("referee_profiles")
    .select("referee_name, total_matches, home_win_pct, draw_pct, away_win_pct, home_bias")
    .gte("total_matches", 20)
    .order("home_bias", { ascending: true })
    .limit(10);
  
  if (awayFavor && awayFavor.length > 0) {
    console.log("\n✈️  TOP 10 REFEREES MOST FAVORABLE TO AWAY TEAMS");
    console.log("   " + "─".repeat(55));
    awayFavor.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.referee_name.padEnd(25)} | Home: ${r.home_win_pct}% | Away: ${r.away_win_pct}% | Bias: ${r.home_bias}`);
    });
  }
  
  // Team-referee relationships with strongest advantage
  const { data: teamRef } = await sb.from("team_referee_analysis")
    .select("team_name, referee_name, matches_under_referee, win_pct, referee_advantage")
    .gte("matches_under_referee", 3)
    .order("referee_advantage", { ascending: false })
    .limit(15);
  
  if (teamRef && teamRef.length > 0) {
    console.log("\n🤝 STRONGEST TEAM-REFEREE RELATIONSHIPS (Best Record Under Referee)");
    console.log("   " + "─".repeat(55));
    teamRef.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.team_name.padEnd(20)} under ${r.referee_name.padEnd(20)} | ${r.matches_under_referee} games | ${r.win_pct}% win rate | Adv: +${r.referee_advantage}`);
    });
  }
  
  console.log("\n" + "━".repeat(60));
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  console.log("📊 Referee Impact Analysis Engine");
  console.log("━".repeat(60));
  console.log("Analyzing referee effects on match outcomes...");
  console.log("Data source: football-data.co.uk (free CSV data)");
  console.log("━".repeat(60));
  
  await computeRefereeProfiles();
  await computeTeamRefereeStats();
  await printReport();
  
  console.log("\n✅ Referee analysis complete!");
  console.log("These features can now be used by the prediction model:");
  console.log("  • Home bias score → affects 1X2 predictions");
  console.log("  • Cards per match → affects BTTS, foul-based markets");
  console.log("  • Goals per match → affects over/under predictions");
  console.log("  • Team-referee history → specific team advantage");
  console.log("  • BTTS tendency → affects BTTS predictions");
  console.log("  • Draw tendency → affects 1X2 draw predictions");
}

main().catch(console.error);
