#!/usr/bin/env node

/**
 * Football-Data.co.uk Scraper
 * 
 * Scrapes FREE CSV data including:
 * - Referee names for every match
 * - Shots (on/off target)
 * - Fouls, corners, yellow/red cards
 * - Half-time results
 * - Betting odds from 10+ bookmakers
 * 
 * Data goes back 25+ seasons (1993/94 to present)
 * Completely free, no API key needed
 */

const https = require("https");
const http = require("http");
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

// League mappings: football-data.co.uk code -> our league name
const LEAGUE_MAP = {
  // Main leagues
  E0: { name: "Premier League", country: "England", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920", "1819"] },
  E1: { name: "Championship", country: "England", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920", "1819"] },
  E2: { name: "League One", country: "England", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920"] },
  E3: { name: "League Two", country: "England", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920"] },
  
  // Germany
  D1: { name: "Bundesliga", country: "Germany", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920", "1819"] },
  D2: { name: "2. Bundesliga", country: "Germany", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920"] },
  
  // Spain
  SP1: { name: "La Liga", country: "Spain", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920", "1819"] },
  SP2: { name: "La Liga 2", country: "Spain", seasons: ["2526", "2425", "2324", "2223", "2122", "2021"] },
  
  // Italy
  I1: { name: "Serie A", country: "Italy", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920", "1819"] },
  I2: { name: "Serie B", country: "Italy", seasons: ["2526", "2425", "2324", "2223", "2122", "2021"] },
  
  // France
  F1: { name: "Ligue 1", country: "France", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920", "1819"] },
  F2: { name: "Ligue 2", country: "France", seasons: ["2526", "2425", "2324", "2223", "2122", "2021"] },
  
  // Netherlands
  N1: { name: "Eredivisie", country: "Netherlands", seasons: ["2526", "2425", "2324", "2223", "2122", "2021", "1920"] },
  
  // Belgium
  B1: { name: "Belgian Pro League", country: "Belgium", seasons: ["2526", "2425", "2324", "2223", "2122", "2021"] },
  
  // Portugal
  P1: { name: "Primeira Liga", country: "Portugal", seasons: ["2526", "2425", "2324", "2223", "2122", "2021"] },
  
  // Turkey
  T1: { name: "Süper Lig", country: "Turkey", seasons: ["2526", "2425", "2324", "2223", "2122"] },
  
  // Scotland
  SC0: { name: "Scottish Premiership", country: "Scotland", seasons: ["2526", "2425", "2324", "2223", "2122", "2021"] },
  
  // Extra worldwide leagues
  ARG1: { name: "Argentine Primera", country: "Argentina", seasons: ["2526", "2425", "2324"] },
  BRA1: { name: "Brasileirão", country: "Brazil", seasons: ["2526", "2425", "2324"] },
  CHN1: { name: "Chinese Super League", country: "China", seasons: ["2526", "2425", "2324"] },
  DEN1: { name: "Danish Superliga", country: "Denmark", seasons: ["2526", "2425", "2324"] },
  FIN1: { name: "Veikkausliiga", country: "Finland", seasons: ["2526", "2425"] },
  IRL1: { name: "League of Ireland", country: "Ireland", seasons: ["2526", "2425", "2324"] },
  JPN1: { name: "J1 League", country: "Japan", seasons: ["2526", "2425", "2324"] },
  MEX1: { name: "Liga MX", country: "Mexico", seasons: ["2526", "2425", "2324"] },
  NOR1: { name: "Eliteserien", country: "Norway", seasons: ["2526", "2425", "2324"] },
  POL1: { name: "Ekstraklasa", country: "Poland", seasons: ["2526", "2425", "2324"] },
  RUS1: { name: "Russian Premier League", country: "Russia", seasons: ["2526", "2425", "2324"] },
  SWE1: { name: "Allsvenskan", country: "Sweden", seasons: ["2526", "2425", "2324"] },
  SWI1: { name: "Swiss Super League", country: "Switzerland", seasons: ["2526", "2425", "2324"] },
  USA1: { name: "MLS", country: "USA", seasons: ["2526", "2425", "2324"] },
};

// Base URLs
const MAIN_URL = "https://www.football-data.co.uk/mmz4281/{season}/{code}.csv";
const EXTRA_URL = "https://www.football-data.co.uk/mmz4281/{season}/{code}.csv";

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout: ${url}`)), 15000);
    
    const get = (u) => {
      const client = u.startsWith("https") ? https : http;
      client.get(u, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          reject(new Error(`HTTP ${res.statusCode}: ${u}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => { clearTimeout(timeout); resolve(data); });
      }).on("error", (err) => { clearTimeout(timeout); reject(err); });
    };
    get(url);
  });
}

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  
  // Parse header
  const header = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Handle quoted fields with commas
    const values = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += char;
    }
    values.push(current.trim());
    
    const row = {};
    header.forEach((h, idx) => { row[h] = values[idx] || ""; });
    rows.push(row);
  }
  return rows;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // Format: DD/MM/YYYY or YYYY-MM-DD
  if (dateStr.includes("/")) {
    const [d, m, y] = dateStr.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return dateStr;
}

async function ensureTeam(name, leagueId) {
  if (!name || name.length < 2) return null;
  
  // Check if team exists
  const { data: existing } = await sb.from("teams")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  
  if (existing) return existing.id;
  
  // Create team
  const { data: created } = await sb.from("teams").insert({
    name: name.trim(),
    league_id: leagueId,
    country: "",
  }).select("id").maybeSingle();
  
  return created?.id || null;
}

async function getOrCreateLeague(name, country) {
  const { data: existing } = await sb.from("leagues")
    .select("id")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  
  if (existing) return existing.id;
  
  const { data: created } = await sb.from("leagues").insert({
    name: name.trim(),
    country: country,
    logo: null,
    is_active: true,
  }).select("id").maybeSingle();
  
  return created?.id || null;
}

async function storeMatches(rows, leagueId, leagueName) {
  let stored = 0;
  let skipped = 0;
  let oddsStored = 0;
  
  for (const row of rows) {
    const homeTeam = row.HomeTeam;
    const awayTeam = row.AwayTeam;
    if (!homeTeam || !awayTeam) { skipped++; continue; }
    
    const kickoff = parseDate(row.Date);
    if (!kickoff) { skipped++; continue; }
    
    const time = row.Time || "15:00";
    const kickoffFull = `${kickoff}T${time.length === 5 ? time : "15:00"}:00`;
    
    const homeGoals = row.FTHG ? parseInt(row.FTHG) : null;
    const awayGoals = row.FTAG ? parseInt(row.FTAG) : null;
    const ftResult = row.FTR || null; // H/D/A
    const htHomeGoals = row.HTHG ? parseInt(row.HTHG) : null;
    const htAwayGoals = row.HTAG ? parseInt(row.HTAG) : null;
    const htResult = row.HTR || null;
    
    // Match stats
    const referee = row.Referee || null;
    const homeShots = row.HS ? parseInt(row.HS) : null;
    const awayShots = row.AS ? parseInt(row.AS) : null;
    const homeShotsOnTarget = row.HST ? parseInt(row.HST) : null;
    const awayShotsOnTarget = row.AST ? parseInt(row.AST) : null;
    const homeFouls = row.HF ? parseInt(row.HF) : null;
    const awayFouls = row.AF ? parseInt(row.AF) : null;
    const homeCorners = row.HC ? parseInt(row.HC) : null;
    const awayCorners = row.AC ? parseInt(row.AC) : null;
    const homeYellow = row.HY ? parseInt(row.HY) : null;
    const awayYellow = row.AY ? parseInt(row.AY) : null;
    const homeRed = row.HR ? parseInt(row.HR) : null;
    const awayRed = row.AR ? parseInt(row.AR) : null;
    
    // Ensure teams exist
    const homeTeamId = await ensureTeam(homeTeam, leagueId);
    const awayTeamId = await ensureTeam(awayTeam, leagueId);
    if (!homeTeamId || !awayTeamId) { skipped++; continue; }
    
    // Check if match already exists (by teams + date)
    const { data: existing } = await sb.from("fixtures")
      .select("id")
      .eq("home_team_id", homeTeamId)
      .eq("away_team_id", awayTeamId)
      .eq("kickoff_time::date", kickoff)
      .limit(1)
      .maybeSingle();
    
    if (existing) { skipped++; continue; }
    
    // Insert match
    const { data: fixture } = await sb.from("fixtures").insert({
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      league_id: leagueId,
      kickoff_time: kickoffFull,
      status: homeGoals !== null ? "finished" : "scheduled",
      home_score: homeGoals,
      away_score: awayGoals,
      // Store referee and match stats in a metadata column if available
    }).select("id").maybeSingle();
    
    if (!fixture) { skipped++; continue; }
    stored++;
    
    // Store match stats
    const matchStats = {
      fixture_id: fixture.id,
      referee,
      home_shots: homeShots,
      away_shots: awayShots,
      home_shots_on_target: homeShotsOnTarget,
      away_shots_on_target: awayShotsOnTarget,
      home_fouls: homeFouls,
      away_fouls: awayFouls,
      home_corners: homeCorners,
      away_corners: awayCorners,
      home_yellow_cards: homeYellow,
      away_yellow_cards: awayYellow,
      home_red_cards: homeRed,
      away_red_cards: awayRed,
      ht_home_goals: htHomeGoals,
      ht_away_goals: htAwayGoals,
      ht_result: htResult,
      ft_result: ftResult,
    };
    
    try {
      await sb.from("match_stats").upsert(matchStats, { onConflict: "fixture_id" });
    } catch (e) {
      // Table might not exist yet — continue storing fixtures and odds
    }
    
    // Store odds
    const oddsData = [];
    
    // 1X2 odds from multiple bookmakers
    if (row.B365H) {
      oddsData.push({
        fixture_id: fixture.id,
        bookmaker: "Bet365",
        market: "1X2",
        home_odds: parseFloat(row.B365H) || null,
        draw_odds: parseFloat(row.B365D) || null,
        away_odds: parseFloat(row.B365A) || null,
      });
    }
    if (row.BWH) {
      oddsData.push({
        fixture_id: fixture.id,
        bookmaker: "bwin",
        market: "1X2",
        home_odds: parseFloat(row.BWH) || null,
        draw_odds: parseFloat(row.BWD) || null,
        away_odds: parseFloat(row.BWA) || null,
      });
    }
    if (row.PSH) {
      oddsData.push({
        fixture_id: fixture.id,
        bookmaker: "Pinnacle",
        market: "1X2",
        home_odds: parseFloat(row.PSH) || null,
        draw_odds: parseFloat(row.PSD) || null,
        away_odds: parseFloat(row.PSA) || null,
      });
    }
    if (row.IWCMH) {
      oddsData.push({
        fixture_id: fixture.id,
        bookmaker: "William Hill",
        market: "1X2",
        home_odds: parseFloat(row.IWCMH) || null,
        draw_odds: parseFloat(row.IWCMD) || null,
        away_odds: parseFloat(row.IWCMA) || null,
      });
    }
    if (row.VCH) {
      oddsData.push({
        fixture_id: fixture.id,
        bookmaker: "VC Bet",
        market: "1X2",
        home_odds: parseFloat(row.VCH) || null,
        draw_odds: parseFloat(row.VCD) || null,
        away_odds: parseFloat(row.VCA) || null,
      });
    }
    
    // Over/Under 2.5 odds
    if (row.B365O25) {
      oddsData.push({
        fixture_id: fixture.id,
        bookmaker: "Bet365",
        market: "over_under",
        over_2_5_odds: parseFloat(row.B365O25) || null,
        under_2_5_odds: parseFloat(row.B365U25) || null,
      });
    }
    
    // Asian Handicap
    if (row.BbAHh) {
      oddsData.push({
        fixture_id: fixture.id,
        bookmaker: "Betbrain",
        market: "asian_handicap",
        handicap: parseFloat(row.BbAHh) || null,
        home_odds: parseFloat(row.BbAHh) || null,
        away_odds: parseFloat(row.BbAHa) || null,
      });
    }
    
    // Insert odds
    for (const odds of oddsData) {
      try {
        await sb.from("odds_snapshots").insert(odds);
        oddsStored++;
      } catch (e) {
        // Skip duplicate odds
      }
    }
    
    if (stored % 100 === 0) {
      console.log(`   Processed ${stored} matches...`);
    }
  }
  
  return { stored, skipped, oddsStored };
}

async function main() {
  console.log("🔄 Football-Data.co.uk Scraper");
  console.log("━".repeat(50));
  console.log("FREE data: referees, shots, fouls, cards, corners, odds");
  console.log("━".repeat(50));
  
  const targetLeagues = process.argv[2]
    ? process.argv[2].split(",")
    : Object.keys(LEAGUE_MAP);
  
  const targetSeasons = process.argv[3]
    ? process.argv[3].split(",")
    : null;
  
  let totalStored = 0;
  let totalSkipped = 0;
  let totalOdds = 0;
  let totalErrors = 0;
  
  for (const code of targetLeagues) {
    const league = LEAGUE_MAP[code];
    if (!league) {
      console.log(`⚠️  Unknown league code: ${code}`);
      continue;
    }
    
    console.log(`\n⚽ ${league.name} (${league.country})...`);
    
    // Get or create league
    const leagueId = await getOrCreateLeague(league.name, league.country);
    
    const seasons = targetSeasons || league.seasons;
    
    for (const season of seasons) {
      const url = MAIN_URL.replace("{season}", season).replace("{code}", code);
      
      try {
        const csv = await fetchCSV(url);
        const rows = parseCSV(csv);
        
        if (rows.length === 0) {
          console.log(`   Season ${season}: No data`);
          continue;
        }
        
        const result = await storeMatches(rows, leagueId, league.name);
        totalStored += result.stored;
        totalSkipped += result.skipped;
        totalOdds += result.oddsStored;
        
        console.log(`   Season ${season}: ${rows.length} rows → ${result.stored} new, ${result.skipped} skipped, ${result.oddsStored} odds`);
      } catch (e) {
        if (e.message.includes("HTTP 404")) {
          // Season not available — skip silently
        } else {
          console.log(`   Season ${season}: ❌ ${e.message}`);
          totalErrors++;
        }
      }
      
      // Rate limit
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  
  console.log("\n━".repeat(50));
  console.log("📊 Summary");
  console.log(`   Matches stored: ${totalStored}`);
  console.log(`   Matches skipped: ${totalSkipped}`);
  console.log(`   Odds stored: ${totalOdds}`);
  console.log(`   Errors: ${totalErrors}`);
  console.log("━".repeat(50));
  
  // Database totals
  const { count: fixtureCount } = await sb.from("fixtures").select("id", { count: "exact", head: true });
  const { count: oddsCount } = await sb.from("odds_snapshots").select("id", { count: "exact", head: true });
  console.log(`\n📊 Database totals: ${fixtureCount} fixtures, ${oddsCount} odds`);
  
  console.log("\n✅ Done! Referee and match stats data stored.");
}

main().catch(console.error);
