#!/usr/bin/env node

/**
 * Injury & Suspension Web Scraper
 * 
 * Scrapes injury data from free sources:
 * 1. API-Football (2024 season — free plan limitation)
 * 2. Football-data.co.uk derived signals (cards = suspensions)
 * 3. Transfermarkt-derived patterns
 * 
 * Usage: node scripts/scrape-injuries-web.js
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
const AF_KEY = env.API_FOOTBALL_KEY || "87a7192e40b8af11e5e4c50cc807e7ca";

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers, timeout: 15000 }, (res) => {
      if (res.statusCode === 429) {
        const wait = parseInt(res.headers["retry-after"] || "60");
        console.log(`  ⏳ Rate limited. Waiting ${wait}s...`);
        setTimeout(() => fetchJSON(url, headers).then(resolve).catch(reject), wait * 1000);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("Parse error")); } });
    }).on("error", reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// STRATEGY 1: API-Football 2024 Season Injuries
// ═══════════════════════════════════════════════════════════════

async function fetchAPIFootball2024() {
  console.log("📡 Strategy 1: API-Football injuries (2024 season)");
  console.log("━".repeat(55));
  
  const LEAGUES = [
    { name: "Premier League", id: 39 },
    { name: "La Liga", id: 140 },
    { name: "Bundesliga", id: 78 },
    { name: "Serie A", id: 135 },
    { name: "Ligue 1", id: 61 },
    { name: "Championship", id: 40 },
    { name: "Eredivisie", id: 88 },
    { name: "Primeira Liga", id: 94 },
  ];
  
  const allInjuries = [];
  
  for (const league of LEAGUES) {
    process.stdout.write(`   ⚽ ${league.name.padEnd(22)}`);
    
    try {
      const data = await fetchJSON(
        `https://v3.football.api-sports.io/injuries?league=${league.id}&season=2024`,
        { "x-apisports-key": AF_KEY }
      );
      
      if (data.errors && Object.keys(data.errors).length > 0) {
        console.log(`Error: ${JSON.stringify(data.errors).substring(0, 60)}`);
        continue;
      }
      
      const injuries = data.response || [];
      
      for (const inj of injuries) {
        allInjuries.push({
          player_name: inj.player.name,
          player_id: inj.player.id,
          team_name: inj.team.name,
          team_id_api: inj.team.id,
          status: "injured",
          reason: inj.player.reason || "Unknown",
          injury_type: inj.player.type || "Unknown",
          fixture_date: inj.fixture?.date || null,
          league: league.name,
          source: "api-football-2024",
          fetched_at: new Date().toISOString(),
        });
      }
      
      console.log(`${injuries.length} injuries`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    
    await sleep(1500);
  }
  
  console.log(`\n   Total: ${allInjuries.length} injuries from 2024 season`);
  return allInjuries;
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY 2: Football-Data.co.uk Suspension Signals
// ═══════════════════════════════════════════════════════════════

async function detectSuspensionSignals() {
  console.log("\n🟨 Strategy 2: Suspension signals from cards data");
  console.log("━".repeat(55));
  
  // Load the referee stats data we already collected
  const dataPath = path.join(__dirname, "..", "data", "football-data-referee-stats.json");
  if (!fs.existsSync(dataPath)) {
    console.log("   ⚠️  No referee data found. Run collect:referee-data first.");
    return [];
  }
  
  const matches = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  
  // Find teams with excessive red cards in recent matches
  const teamRedCards = {};
  const recentMatches = matches.filter(m => {
    if (!m.date) return false;
    const d = new Date(m.date);
    const now = new Date();
    return (now - d) < 60 * 24 * 60 * 60 * 1000; // Last 60 days
  });
  
  for (const m of recentMatches) {
    if (m.home_red) {
      if (!teamRedCards[m.home_team]) teamRedCards[m.home_team] = { reds: 0, yellows: 0, matches: 0 };
      teamRedCards[m.home_team].reds += m.home_red;
      teamRedCards[m.home_team].yellows += (m.home_yellow || 0);
      teamRedCards[m.home_team].matches++;
    }
    if (m.away_red) {
      if (!teamRedCards[m.away_team]) teamRedCards[m.away_team] = { reds: 0, yellows: 0, matches: 0 };
      teamRedCards[m.away_team].reds += m.away_red;
      teamRedCards[m.away_team].yellows += (m.away_yellow || 0);
      teamRedCards[m.away_team].matches++;
    }
  }
  
  const suspensions = [];
  for (const [team, stats] of Object.entries(teamRedCards)) {
    if (stats.reds >= 2) {
      suspensions.push({
        team_name: team,
        status: "potential_suspension",
        reason: `${stats.reds} red cards in last ${stats.matches} matches`,
        red_cards: stats.reds,
        yellow_cards: stats.yellows,
        matches_analyzed: stats.matches,
        source: "derived-cards",
        fetched_at: new Date().toISOString(),
      });
    }
  }
  
  console.log(`   Found ${suspensions.length} teams with potential suspension risk`);
  return suspensions;
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY 3: Transfermarkt Page Scraping
// ═══════════════════════════════════════════════════════════════

async function scrapeTransfermarkt() {
  console.log("\n🏥 Strategy 3: Transfermarkt injury page scraping");
  console.log("━".repeat(55));
  
  const TEAMS = [
    { name: "Arsenal", slug: "arsenal", league: "Premier League" },
    { name: "Manchester City", slug: "manchester-city", league: "Premier League" },
    { name: "Liverpool", slug: "liverpool", league: "Premier League" },
    { name: "Chelsea", slug: "chelsea", league: "Premier League" },
    { name: "Barcelona", slug: "fc-barcelona", league: "La Liga" },
    { name: "Real Madrid", slug: "real-madrid", league: "La Liga" },
    { name: "Bayern Munich", slug: "bayern-munchen", league: "Bundesliga" },
    { name: "Borussia Dortmund", slug: "borussia-dortmund", league: "Bundesliga" },
    { name: "Inter Milan", slug: "inter-mailand", league: "Serie A" },
    { name: "AC Milan", slug: "ac-milan", league: "Serie A" },
    { name: "Juventus", slug: "juventus-turin", league: "Serie A" },
    { name: "Paris Saint-Germain", slug: "paris-saint-germain", league: "Ligue 1" },
  ];
  
  const allInjuries = [];
  
  for (const team of TEAMS) {
    process.stdout.write(`   ⚽ ${team.name.padEnd(22)}`);
    
    try {
      const html = await fetchText(`https://www.transfermarkt.com/${team.slug}/verletzungen/verein`);
      
      // Parse injury table from HTML
      // Transfermarkt uses a table with class "items"
      const injuryRows = html.match(/<tr[^>]*class="odd[^"]*"[^>]*>[\s\S]*?<\/tr>/g) || [];
      const injuryRowsEven = html.match(/<tr[^>]*class="even[^"]*"[^>]*>[\s\S]*?<\/tr>/g) || [];
      const allRows = [...injuryRows, ...injuryRowsEven];
      
      for (const row of allRows) {
        // Extract player name
        const nameMatch = row.match(/class="hauptlink"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
        const playerName = nameMatch ? nameMatch[1].trim() : null;
        
        // Extract injury type
        const typeMatch = row.match(/class="spielprofil_tooltip"[^>]*>([^<]+)<\/a>/);
        const injuryType = typeMatch ? typeMatch[1].trim() : "Unknown";
        
        // Extract expected return
        const returnMatch = row.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        const expectedReturn = returnMatch ? returnMatch[1] : null;
        
        // Extract status (injured/suspended)
        const isSuspended = row.includes("suspended") || row.includes("Suspension");
        
        if (playerName && playerName.length > 2) {
          allInjuries.push({
            player_name: playerName,
            team_name: team.name,
            status: isSuspended ? "suspended" : "injured",
            injury_type: injuryType,
            expected_return: expectedReturn,
            league: team.league,
            source: "transfermarkt",
            fetched_at: new Date().toISOString(),
          });
        }
      }
      
      console.log(`${allRows.length} rows parsed`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    
    await sleep(2000); // Be polite to Transfermarkt
  }
  
  console.log(`\n   Total: ${allInjuries.length} injuries from Transfermarkt`);
  return allInjuries;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log("🏥 ODDLY Injury & Suspension Multi-Source Collector");
  console.log("━".repeat(60));
  
  // 1. API-Football (2024 season)
  const apiInjuries = await fetchAPIFootball2024();
  
  // 2. Suspension signals from cards data
  const suspensions = await detectSuspensionSignals();
  
  // 3. Transfermarkt scraping
  const tmInjuries = await scrapeTransfermarkt();
  
  // Combine all sources
  const allInjuries = [...apiInjuries, ...suspensions, ...tmInjuries];
  
  // Save locally
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  
  const outPath = path.join(dataDir, "injuries-suspensions.json");
  fs.writeFileSync(outPath, JSON.stringify({
    fetched_at: new Date().toISOString(),
    total: allInjuries.length,
    sources: {
      api_football: apiInjuries.length,
      derived_suspensions: suspensions.length,
      transfermarkt: tmInjuries.length,
    },
    injuries: allInjuries,
  }, null, 2));
  
  console.log(`\n💾 Saved ${allInjuries.length} records to ${outPath}`);
  
  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log("📊 INJURY COLLECTION SUMMARY");
  console.log("═".repeat(60));
  console.log(`   API-Football (2024):  ${apiInjuries.length} injuries`);
  console.log(`   Derived suspensions:  ${suspensions.length} teams at risk`);
  console.log(`   Transfermarkt:        ${tmInjuries.length} injuries`);
  console.log(`   Total:                ${allInjuries.length} records`);
  
  // Group by team
  const byTeam = {};
  for (const inj of allInjuries) {
    const team = inj.team_name || "Unknown";
    if (!byTeam[team]) byTeam[team] = [];
    byTeam[team].push(inj);
  }
  
  console.log("\n🏥 TEAMS WITH MOST INJURIES:");
  console.log("─".repeat(60));
  Object.entries(byTeam)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .forEach(([team, injList]) => {
      console.log(`   ${team.padEnd(25)} | ${injList.length} players affected`);
    });
  
  console.log("\n✅ Injury collection complete!");
}

main().catch(console.error);
