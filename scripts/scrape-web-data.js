#!/usr/bin/env node

/**
 * Web Data Scraper — Multiple Free Sources
 * 
 * Scrapes additional data points from free sources:
 * 
 * 1. football-data.co.uk — Referee, stats, odds (DONE)
 * 2. Understat — xG, xGA, xPTS, shot maps, player xG
 * 3. Transfermarkt — Injuries, suspensions, market values
 * 4. FBref — Advanced stats, passing, possession, defensive actions
 * 
 * All sources are free for personal/research use.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ─── HTTP Helper ────────────────────────────────────────────

function fetch(url, retries = 2) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout")), 20000);
    const get = (u, attempt) => {
      const client = u.startsWith("https") ? https : http;
      client.get(u, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/html,application/json,*/*",
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location, attempt); return;
        }
        if (res.statusCode === 429 && attempt < retries) {
          clearTimeout(timeout);
          setTimeout(() => get(u, attempt + 1), 3000); return;
        }
        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          reject(new Error(`HTTP ${res.statusCode}`)); return;
        }
        let data = "";
        res.on("data", (c) => data += c);
        res.on("end", () => { clearTimeout(timeout); resolve(data); });
      }).on("error", (e) => {
        if (attempt < retries) {
          setTimeout(() => get(u, attempt + 1), 2000);
        } else {
          clearTimeout(timeout);
          reject(e);
        }
      });
    };
    get(url, 0);
  });
}

// ═══════════════════════════════════════════════════════════════
// 1. UNDERSTAT — xG DATA
// ═══════════════════════════════════════════════════════════════

const UNDERSTAT_LEAGUES = {
  "EPL": { name: "Premier League", id: "47" },
  "La_liga": { name: "La Liga", id: "87" },
  "Bundesliga": { name: "Bundesliga", id: "78" },
  "Serie_A": { name: "Serie A", id: "55" },
  "Ligue_1": { name: "Ligue 1", id: "53" },
};

async function scrapeUnderstat() {
  console.log("📥 Scraping Understat for xG data...");
  
  const allTeamData = {};
  const allMatchData = [];
  
  for (const [key, league] of Object.entries(UNDERSTAT_LEAGUES)) {
    console.log(`   ⚽ ${league.name}...`);
    
    try {
      const html = await fetch(`https://understat.com/league/${key}`);
      
      // Extract team statistics JSON from page
      const teamsMatch = html.match(/var teamsData\s*=\s*JSON\.parse\('(.+?)'\)/);
      if (teamsMatch) {
        const decoded = teamsMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        const teamsData = JSON.parse(decoded);
        
        for (const [teamId, team] of Object.entries(teamsData)) {
          const title = team.title;
          const history = team.history || [];
          
          // Aggregate team xG stats
          let totalXG = 0, totalXGA = 0, totalGoals = 0, totalConceded = 0;
          let totalPPDA = 0, totalDeep = 0;
          let matches = 0;
          
          for (const h of history) {
            totalXG += parseFloat(h.xG || 0);
            totalXGA += parseFloat(h.xGA || 0);
            totalGoals += parseInt(h.scored || 0);
            totalConceded += parseInt(h.missed || 0);
            totalPPDA += parseFloat(h.PPDA || 0);
            totalDeep += parseInt(h.deep || 0);
            matches++;
          }
          
          if (matches > 0) {
            allTeamData[title] = {
              team: title,
              league: league.name,
              matches,
              avg_xG: (totalXG / matches).toFixed(3),
              avg_xGA: (totalXGA / matches).toFixed(3),
              avg_goals: (totalGoals / matches).toFixed(3),
              avg_conceded: (totalConceded / matches).toFixed(3),
              avg_PPDA: (totalPPDA / matches).toFixed(3),
              avg_deep: (totalDeep / matches).toFixed(3),
              xG_diff: ((totalGoals - totalXG) / matches).toFixed(3),
              xGA_diff: ((totalConceded - totalXGA) / matches).toFixed(3),
            };
          }
        }
        
        console.log(`      Found ${Object.keys(allTeamData).filter(t => allTeamData[t].league === league.name).length} teams`);
      }
      
      // Extract match-level xG
      const matchesMatch = html.match(/var datesData\s*=\s*JSON\.parse\('(.+?)'\)/);
      if (matchesMatch) {
        const decoded = matchesMatch[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        const datesData = JSON.parse(decoded);
        
        for (const [dateKey, matches] of Object.entries(datesData)) {
          if (Array.isArray(matches)) {
            for (const m of matches) {
              allMatchData.push({
                date: m.date,
                league: league.name,
                home_team: m.h,
                away_team: m.a,
                home_xG: parseFloat(m.xG || 0),
                away_xG: parseFloat(m.xGA || 0),
                home_goals: parseInt(m.fthg || 0),
                away_goals: parseInt(m.ftag || 0),
                result: m.tr || null,
              });
            }
          }
        }
      }
      
    } catch (e) {
      console.log(`      ⚠️  ${e.message}`);
    }
    
    await new Promise(r => setTimeout(r, 2000)); // Rate limit
  }
  
  // Save team xG data
  const teamPath = path.join(dataDir, "understat-team-xg.json");
  fs.writeFileSync(teamPath, JSON.stringify(allTeamData, null, 2));
  console.log(`\n💾 ${Object.keys(allTeamData).length} team xG profiles saved to ${teamPath}`);
  
  // Save match xG data
  const matchPath = path.join(dataDir, "understat-match-xg.json");
  fs.writeFileSync(matchPath, JSON.stringify(allMatchData, null, 2));
  console.log(`💾 ${allMatchData.length} match xG records saved to ${matchPath}`);
  
  return { teamData: allTeamData, matchData: allMatchData };
}

// ═══════════════════════════════════════════════════════════════
// 2. FOOTBALL-DATA.CO.UK — FULL STATS (already done, but expand)
// ═══════════════════════════════════════════════════════════════

async function scrapeFootballDataExtra() {
  console.log("\n📥 Scraping additional football-data.co.uk leagues...");
  
  const EXTRA_LEAGUES = {
    SC0: { name: "Scottish Premiership", country: "Scotland" },
    B1: { name: "Belgian Pro League", country: "Belgium" },
    P1: { name: "Primeira Liga", country: "Portugal" },
    T1: { name: "Süper Lig", country: "Turkey" },
    N1: { name: "Eredivisie", country: "Netherlands" },
    BRA1: { name: "Brasileirão", country: "Brazil" },
    ARG1: { name: "Argentine Primera", country: "Argentina" },
    CHN1: { name: "Chinese Super League", country: "China" },
    JPN1: { name: "J1 League", country: "Japan" },
    USA1: { name: "MLS", country: "USA" },
    NOR1: { name: "Eliteserien", country: "Norway" },
    SWE1: { name: "Allsvenskan", country: "Sweden" },
    DEN1: { name: "Danish Superliga", country: "Denmark" },
    MEX1: { name: "Liga MX", country: "Mexico" },
    POL1: { name: "Ekstraklasa", country: "Poland" },
  };
  
  // Already scraped: E0, D1, SP1, I1, F1
  // Now add the extras
  const existingPath = path.join(dataDir, "football-data-referee-stats.json");
  const existing = fs.existsSync(existingPath) ? JSON.parse(fs.readFileSync(existingPath, "utf8")) : [];
  
  let totalNew = 0;
  const BASE_URL = "https://www.football-data.co.uk/mmz4281/{season}/{code}.csv";
  
  for (const [code, league] of Object.entries(EXTRA_LEAGUES)) {
    process.stdout.write(`   ⚽ ${league.name.padEnd(25)}`);
    let seasonCount = 0;
    
    for (const season of ["2526", "2425", "2324"]) {
      const url = BASE_URL.replace("{season}", season).replace("{code}", code);
      try {
        const csv = await fetch(url);
        const lines = csv.trim().split("\n");
        if (lines.length < 2) continue;
        
        const header = lines[0].split(",").map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(",");
          const row = {};
          header.forEach((h, idx) => row[h] = (vals[idx] || "").trim());
          
          if (!row.HomeTeam || !row.AwayTeam) continue;
          
          const dateParts = (row.Date || "").split("/");
          const date = dateParts.length === 3 ? `${dateParts[2]}-${dateParts[1].padStart(2,"0")}-${dateParts[0].padStart(2,"0")}` : row.Date;
          
          existing.push({
            league: code,
            season,
            date,
            home_team: row.HomeTeam,
            away_team: row.AwayTeam,
            home_goals: row.FTHG ? parseInt(row.FTHG) : null,
            away_goals: row.FTAG ? parseInt(row.FTAG) : null,
            ft_result: row.FTR || null,
            ht_home_goals: row.HTHG ? parseInt(row.HTHG) : null,
            ht_away_goals: row.HTAG ? parseInt(row.HTAG) : null,
            ht_result: row.HTR || null,
            referee: row.Referee || null,
            home_shots: row.HS ? parseInt(row.HS) : null,
            away_shots: row.AS ? parseInt(row.AS) : null,
            home_shots_on_target: row.HST ? parseInt(row.HST) : null,
            away_shots_on_target: row.AST ? parseInt(row.AST) : null,
            home_fouls: row.HF ? parseInt(row.HF) : null,
            away_fouls: row.AF ? parseInt(row.AF) : null,
            home_corners: row.HC ? parseInt(row.HC) : null,
            away_corners: row.AC ? parseInt(row.AC) : null,
            home_yellow: row.HY ? parseInt(row.HY) : null,
            away_yellow: row.AY ? parseInt(row.AY) : null,
            home_red: row.HR ? parseInt(row.HR) : null,
            away_red: row.AR ? parseInt(row.AR) : null,
            b365_home: row.B365H ? parseFloat(row.B365H) : null,
            b365_draw: row.B365D ? parseFloat(row.B365D) : null,
            b365_away: row.B365A ? parseFloat(row.B365A) : null,
            pinnacle_home: row.PSH ? parseFloat(row.PSH) : null,
            pinnacle_draw: row.PSD ? parseFloat(row.PSD) : null,
            pinnacle_away: row.PSA ? parseFloat(row.PSA) : null,
          });
          totalNew++;
        }
        seasonCount++;
      } catch (e) { /* skip */ }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`${seasonCount} seasons`);
  }
  
  fs.writeFileSync(existingPath, JSON.stringify(existing, null, 2));
  console.log(`\n💾 Added ${totalNew} matches. Total: ${existing.length}`);
  
  return existing;
}

// ═══════════════════════════════════════════════════════════════
// 3. COMBINE ALL DATA INTO PREDICTIVE FEATURES
// ═══════════════════════════════════════════════════════════════

function computeCombinedFeatures(allMatches, understatTeams) {
  console.log("\n🧠 Computing combined predictive features...");
  
  // Team strength ratings based on multiple signals
  const teamRatings = {};
  
  for (const m of allMatches) {
    if (m.home_goals === null) continue;
    
    // Initialize teams
    for (const team of [m.home_team, m.away_team]) {
      if (!teamRatings[team]) {
        teamRatings[team] = {
          team,
          matches: 0,
          goalsFor: 0, goalsAgainst: 0,
          wins: 0, draws: 0, losses: 0,
          homeMatches: 0, homeWins: 0,
          awayMatches: 0, awayWins: 0,
          shotsFor: 0, shotsAgainst: 0,
          foulsFor: 0, foulsAgainst: 0,
          yellowCards: 0, redCards: 0,
          cornersFor: 0,
          form: [], // Last 10 results
        };
      }
    }
    
    const ht = teamRatings[m.home_team];
    const at = teamRatings[m.away_team];
    
    ht.matches++; ht.homeMatches++; ht.goalsFor += m.home_goals; ht.goalsAgainst += m.away_goals;
    at.matches++; at.awayMatches++; at.goalsFor += m.away_goals; at.goalsAgainst += m.home_goals;
    
    ht.shotsFor += (m.home_shots || 0); ht.shotsAgainst += (m.away_shots || 0);
    at.shotsFor += (m.away_shots || 0); at.shotsAgainst += (m.home_shots || 0);
    
    ht.foulsFor += (m.home_fouls || 0); ht.foulsAgainst += (m.away_fouls || 0);
    at.foulsFor += (m.away_fouls || 0); at.foulsAgainst += (m.home_fouls || 0);
    
    ht.yellowCards += (m.home_yellow || 0); ht.redCards += (m.home_red || 0);
    at.yellowCards += (m.away_yellow || 0); at.redCards += (m.away_red || 0);
    
    ht.cornersFor += (m.home_corners || 0); at.cornersFor += (m.away_corners || 0);
    
    if (m.ft_result === "H") {
      ht.wins++; ht.homeWins++; at.losses++;
      ht.form.push(3); at.form.push(0);
    } else if (m.ft_result === "D") {
      ht.draws++; at.draws++;
      ht.form.push(1); at.form.push(1);
    } else {
      at.wins++; at.awayWins++; ht.losses++;
      ht.form.push(0); at.form.push(3);
    }
    
    // Keep only last 20 results for form
    ht.form = ht.form.slice(-20);
    at.form = at.form.slice(-20);
  }
  
  // Compute composite ratings
  for (const [team, stats] of Object.entries(teamRatings)) {
    const n = stats.matches;
    if (n < 5) continue;
    
    stats.attackRating = stats.goalsFor / n;
    stats.defenseRating = stats.goalsAgainst / n;
    stats.goalDiff = (stats.goalsFor - stats.goalsAgainst) / n;
    stats.winRate = stats.wins / n;
    stats.homeWinRate = stats.homeMatches > 0 ? stats.homeWins / stats.homeMatches : 0.4;
    stats.awayWinRate = stats.awayMatches > 0 ? stats.awayWins / stats.awayMatches : 0.3;
    stats.shotsPerGame = stats.shotsFor / n;
    stats.foulsPerGame = stats.foulsFor / n;
    stats.yellowPerGame = stats.yellowCards / n;
    stats.cornersPerGame = stats.cornersFor / n;
    
    // Form (last 5)
    const last5 = stats.form.slice(-5);
    stats.recentForm = last5.length > 0 ? last5.reduce((a, b) => a + b, 0) / last5.length : 1.5;
    
    // Add Understat xG if available
    if (understatTeams && understatTeams[team]) {
      const uxg = understatTeams[team];
      stats.avg_xG = parseFloat(uxg.avg_xG);
      stats.avg_xGA = parseFloat(uxg.avg_xGA);
      stats.xG_diff = parseFloat(uxg.xG_diff);
      stats.avg_PPDA = parseFloat(uxg.avg_PPDA);
      stats.avg_deep = parseFloat(uxg.avg_deep);
    }
  }
  
  return teamRatings;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log("🌐 Web Data Scraper — Football Intelligence Pipeline");
  console.log("━".repeat(70));
  
  // 1. Scrape Understat xG data
  const understat = await scrapeUnderstat();
  
  // 2. Expand football-data.co.uk coverage
  const allMatches = await scrapeFootballDataExtra();
  
  // 3. Compute combined features
  const teamRatings = computeCombinedFeatures(allMatches, understat.teamData);
  
  // Save team ratings
  const ratingsPath = path.join(dataDir, "team-composite-ratings.json");
  fs.writeFileSync(ratingsPath, JSON.stringify(teamRatings, null, 2));
  console.log(`\n💾 ${Object.keys(teamRatings).length} team composite ratings saved to ${ratingsPath}`);
  
  // Print summary
  console.log("\n" + "═".repeat(70));
  console.log("📊 DATA COLLECTION SUMMARY");
  console.log("═".repeat(70));
  console.log(`Total matches: ${allMatches.length}`);
  console.log(`With referee data: ${allMatches.filter(m => m.referee).length}`);
  console.log(`With match stats: ${allMatches.filter(m => m.home_shots !== null).length}`);
  console.log(`Team profiles: ${Object.keys(teamRatings).length}`);
  console.log(`Understat xG teams: ${Object.keys(understat.teamData).length}`);
  console.log(`Understat match xG: ${understat.matchData.length}`);
  
  // Top teams by composite rating
  const topTeams = Object.values(teamRatings)
    .filter(t => t.matches >= 30)
    .sort((a, b) => b.goalDiff - a.goalDiff)
    .slice(0, 20);
  
  console.log("\n🏆 TOP 20 TEAMS BY GOAL DIFFERENTIAL:");
  console.log("─".repeat(70));
  topTeams.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.team.padEnd(25)} | GD: ${(t.goalDiff > 0 ? "+" : "") + t.goalDiff.toFixed(2)} | Win: ${(t.winRate * 100).toFixed(0)}% | Goals: ${t.attackRating.toFixed(1)}:${t.defenseRating.toFixed(1)} | ${t.matches} games`);
  });
  
  console.log("\n✅ All data collected and combined!");
}

main().catch(console.error);
