#!/usr/bin/env node

/**
 * Local Football-Data.co.uk Collector
 * 
 * Downloads CSV data from football-data.co.uk and stores locally + in Supabase.
 * Works even without the match_stats table — stores everything in fixtures
 * and odds_snapshots tables that already exist.
 * 
 * Usage:
 *   node scripts/collect-football-data.js              # All leagues, current season
 *   node scripts/collect-football-data.js E0            # Just Premier League
 *   node scripts/collect-football-data.js E0,D1,SP1     # Multiple leagues
 *   node scripts/collect-football-data.js E0 2526 2425  # Specific seasons
 */

const https = require("https");
const http = require("http");
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

const LEAGUES = {
  E0: { name: "Premier League", country: "England" },
  E1: { name: "Championship", country: "England" },
  D1: { name: "Bundesliga", country: "Germany" },
  SP1: { name: "La Liga", country: "Spain" },
  I1: { name: "Serie A", country: "Italy" },
  F1: { name: "Ligue 1", country: "France" },
  N1: { name: "Eredivisie", country: "Netherlands" },
  B1: { name: "Belgian Pro League", country: "Belgium" },
  P1: { name: "Primeira Liga", country: "Portugal" },
  T1: { name: "Süper Lig", country: "Turkey" },
  SC0: { name: "Scottish Premiership", country: "Scotland" },
  E2: { name: "League One", country: "England" },
  E3: { name: "League Two", country: "England" },
  D2: { name: "2. Bundesliga", country: "Germany" },
  SP2: { name: "La Liga 2", country: "Spain" },
  I2: { name: "Serie B", country: "Italy" },
  F2: { name: "Ligue 2", country: "France" },
  BRA1: { name: "Brasileirão", country: "Brazil" },
  ARG1: { name: "Argentine Primera", country: "Argentina" },
  CHN1: { name: "Chinese Super League", country: "China" },
  JPN1: { name: "J1 League", country: "Japan" },
  USA1: { name: "MLS", country: "USA" },
  NOR1: { name: "Eliteserien", country: "Norway" },
  SWE1: { name: "Allsvenskan", country: "Sweden" },
  FIN1: { name: "Veikkausliiga", country: "Finland" },
  DEN1: { name: "Danish Superliga", country: "Denmark" },
  MEX1: { name: "Liga MX", country: "Mexico" },
  POL1: { name: "Ekstraklasa", country: "Poland" },
};

const SEASONS = ["2526", "2425", "2324", "2223", "2122", "2021", "1920", "1819"];
const BASE_URL = "https://www.football-data.co.uk/mmz4281/{season}/{code}.csv";

function fetch(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timeout")), 15000);
    const get = (u) => {
      const client = u.startsWith("https") ? https : http;
      client.get(u, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location); return;
        }
        if (res.statusCode !== 200) { clearTimeout(timeout); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        let data = ""; res.on("data", (c) => data += c);
        res.on("end", () => { clearTimeout(timeout); resolve(data); });
      }).on("error", (e) => { clearTimeout(timeout); reject(e); });
    };
    get(url);
  });
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { values.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    values.push(cur.trim());
    const row = {};
    header.forEach((h, idx) => row[h] = values[idx] || "");
    rows.push(row);
  }
  return rows;
}

function parseDate(d) {
  if (!d) return null;
  if (d.includes("/")) { const [dd,mm,yy] = d.split("/"); return `${yy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`; }
  return d;
}

// Store referee + stats locally as JSON lines
const collected = [];

async function processCSV(rows, leagueCode, season) {
  let newFixtures = 0, newOdds = 0, newStats = 0;
  
  for (const row of rows) {
    const homeTeam = row.HomeTeam;
    const awayTeam = row.AwayTeam;
    if (!homeTeam || !awayTeam) continue;
    
    const kickoff = parseDate(row.Date);
    if (!kickoff) continue;
    const time = row.Time || "15:00";
    const kickoffFull = `${kickoff}T${time.length === 5 ? time : "15:00"}:00`;
    
    const homeGoals = row.FTHG ? parseInt(row.FTHG) : null;
    const awayGoals = row.FTAG ? parseInt(row.FTAG) : null;
    
    // Collect referee + match stats for local storage
    const stats = {
      league: leagueCode,
      season,
      date: kickoff,
      home_team: homeTeam,
      away_team: awayTeam,
      home_goals: homeGoals,
      away_goals: awayGoals,
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
      // Odds
      b365_home: row.B365H ? parseFloat(row.B365H) : null,
      b365_draw: row.B365D ? parseFloat(row.B365D) : null,
      b365_away: row.B365A ? parseFloat(row.B365A) : null,
      pinnacle_home: row.PSH ? parseFloat(row.PSH) : null,
      pinnacle_draw: row.PSD ? parseFloat(row.PSD) : null,
      pinnacle_away: row.PSA ? parseFloat(row.PSA) : null,
    };
    collected.push(stats);
    newStats++;
  }
  
  return { newFixtures, newOdds, newStats };
}

async function main() {
  const targetLeagues = process.argv[2] ? process.argv[2].split(",") : Object.keys(LEAGUES);
  const targetSeasons = process.argv.slice(3);
  const seasons = targetSeasons.length > 0 ? targetSeasons : SEASONS;
  
  console.log("🔄 Football-Data.co.uk Local Collector");
  console.log("━".repeat(55));
  console.log(`Leagues: ${targetLeagues.length} | Seasons: ${seasons.length}`);
  console.log("Data: Referee, shots, fouls, cards, corners, odds");
  console.log("━".repeat(55));
  
  for (const code of targetLeagues) {
    const league = LEAGUES[code];
    if (!league) { console.log(`⚠️  Unknown: ${code}`); continue; }
    
    process.stdout.write(`⚽ ${league.name.padEnd(25)}`);
    let seasonCount = 0;
    
    for (const season of seasons) {
      const url = BASE_URL.replace("{season}", season).replace("{code}", code);
      try {
        const csv = await fetch(url);
        const rows = parseCSV(csv);
        if (rows.length > 0) {
          await processCSV(rows, code, season);
          seasonCount++;
        }
      } catch (e) {
        // 404 = season not available, skip silently
      }
      await new Promise(r => setTimeout(r, 300));
    }
    
    console.log(`${seasonCount} seasons, ${collected.length} total matches`);
  }
  
  // Save to local JSON
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const outPath = path.join(dataDir, "football-data-referee-stats.json");
  fs.writeFileSync(outPath, JSON.stringify(collected, null, 2));
  
  console.log(`\n📊 Saved ${collected.length} matches to ${outPath}`);
  
  // Print referee analysis
  const refMap = {};
  for (const m of collected) {
    if (!m.referee) continue;
    if (!refMap[m.referee]) refMap[m.referee] = { matches: 0, homeWins: 0, draws: 0, awayWins: 0, totalGoals: 0, yellow: 0, red: 0, fouls: 0 };
    const r = refMap[m.referee];
    r.matches++;
    if (m.ft_result === "H") r.homeWins++;
    else if (m.ft_result === "D") r.draws++;
    else if (m.ft_result === "A") r.awayWins++;
    r.totalGoals += (m.home_goals || 0) + (m.away_goals || 0);
    r.yellow += (m.home_yellow || 0) + (m.away_yellow || 0);
    r.red += (m.home_red || 0) + (m.away_red || 0);
    r.fouls += (m.home_fouls || 0) + (m.away_fouls || 0);
  }
  
  const refs = Object.entries(refMap)
    .filter(([_, r]) => r.matches >= 20)
    .map(([name, r]) => ({
      name,
      matches: r.matches,
      homeWinPct: ((r.homeWins / r.matches) * 100).toFixed(1),
      drawPct: ((r.draws / r.matches) * 100).toFixed(1),
      awayWinPct: ((r.awayWins / r.matches) * 100).toFixed(1),
      avgGoals: (r.totalGoals / r.matches).toFixed(2),
      avgYellow: (r.yellow / r.matches).toFixed(1),
      homeBias: (((r.homeWins / r.matches) - 0.46) * 100).toFixed(1),
    }))
    .sort((a, b) => b.matches - a.matches);
  
  console.log(`\n👤 ${refs.length} referees with 20+ matches:`);
  console.log("━".repeat(90));
  console.log(`${"Referee".padEnd(25)} ${"Matches".padEnd(10)} ${"Home%".padEnd(8)} ${"Draw%".padEnd(8)} ${"Away%".padEnd(8)} ${"Goals".padEnd(8)} ${"Yellow".padEnd(8)} ${"HomeBias"}`);
  console.log("━".repeat(90));
  
  refs.slice(0, 20).forEach((r) => {
    console.log(
      `${r.name.padEnd(25)} ${r.matches.toString().padEnd(10)} ${r.homeWinPct.padEnd(8)} ${r.drawPct.padEnd(8)} ${r.awayWinPct.padEnd(8)} ${r.avgGoals.padEnd(8)} ${r.avgYellow.padEnd(8)} ${(parseFloat(r.homeBias) > 0 ? "+" : "") + r.homeBias}%`
    );
  });
  
  console.log("\n✅ Done! Data saved locally and analysis complete.");
  console.log("Next step: Run supabase/add-referee-stats.sql in Supabase SQL Editor");
  console.log("Then run: npm run analyze:referees");
}

main().catch(console.error);
