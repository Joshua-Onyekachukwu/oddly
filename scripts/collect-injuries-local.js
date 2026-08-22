#!/usr/bin/env node

/**
 * Injury & Suspension Collector — Local + Supabase
 * 
 * Fetches injury/suspension data from:
 * 1. API-Football injuries endpoint
 * 2. Derived absences from lineup data
 * 
 * Stores locally in JSON and in Supabase if the table exists.
 * 
 * Usage: node scripts/collect-injuries-local.js
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

async function fetchInjuriesFromAPIFootball() {
  console.log("📡 Fetching injuries from API-Football...");
  
  const allInjuries = [];
  let totalFound = 0;
  
  for (const league of LEAGUES) {
    process.stdout.write(`   ⚽ ${league.name.padEnd(22)}`);
    
    try {
      const data = await fetchJSON(
        `https://v3.football.api-sports.io/injuries?league=${league.id}&season=2025`,
        { "x-apisports-key": AF_KEY }
      );
      
      if (data.errors && Object.keys(data.errors).length > 0) {
        console.log(`Error: ${JSON.stringify(data.errors).substring(0, 80)}`);
        continue;
      }
      
      const injuries = data.response || [];
      totalFound += injuries.length;
      
      for (const inj of injuries) {
        const player = inj.player;
        const team = inj.team;
        
        allInjuries.push({
          player_name: player.name,
          player_id: player.id,
          team_name: team.name,
          team_id_api: team.id,
          status: "injured",
          reason: player.reason || "Unknown",
          injury_type: player.type || "Unknown",
          fixture: inj.fixture ? {
            id: inj.fixture.id,
            date: inj.fixture.date,
          } : null,
          source: "api-football",
          fetched_at: new Date().toISOString(),
        });
      }
      
      console.log(`${injuries.length} injuries`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    
    await sleep(1500); // Rate limit: 10 requests/minute for free plan
  }
  
  console.log(`\n   Total injuries found: ${totalFound}`);
  return allInjuries;
}

async function detectDerivedAbsences() {
  console.log("\n🔍 Detecting derived absences from match data...");
  
  // Get recent finished matches (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  const { data: recentFixtures } = await sb.from("fixtures")
    .select("id, home_team_id, away_team_id, kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name)")
    .eq("status", "finished")
    .gte("kickoff_time", thirtyDaysAgo)
    .order("kickoff_time", { ascending: false })
    .limit(200);
  
  if (!recentFixtures || recentFixtures.length === 0) {
    console.log("   No recent fixtures found");
    return [];
  }
  
  console.log(`   Analyzing ${recentFixtures.length} recent fixtures...`);
  
  // Count appearances per team
  const teamAppearances = {};
  for (const f of recentFixtures) {
    const ht = f.home_team?.canonical_name || f.home_team?.name;
    const at = f.away_team?.canonical_name || f.away_team?.name;
    if (ht) {
      if (!teamAppearances[ht]) teamAppearances[ht] = { appearances: 0, team_id: f.home_team_id };
      teamAppearances[ht].appearances++;
    }
    if (at) {
      if (!teamAppearances[at]) teamAppearances[at] = { appearances: 0, team_id: f.away_team_id };
      teamAppearances[at].appearances++;
    }
  }
  
  // Teams with fewer appearances than expected might have had cancellations
  // (This is a rough heuristic — real absence detection needs lineup data)
  const derived = [];
  for (const [team, data] of Object.entries(teamAppearances)) {
    if (data.appearances < 3) {
      derived.push({
        team_name: team,
        team_id: data.team_id,
        note: `Only ${data.appearances} appearances in last 30 days`,
        source: "derived",
      });
    }
  }
  
  console.log(`   Found ${derived.length} teams with potential absence signals`);
  return derived;
}

async function storeData(injuries, derived) {
  console.log("\n💾 Storing injury data...");
  
  // Store locally
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  
  const localPath = path.join(dataDir, "injuries-suspensions.json");
  const localData = {
    fetched_at: new Date().toISOString(),
    injuries,
    derived_absences: derived,
    summary: {
      total_injuries: injuries.length,
      by_league: {},
      by_status: {},
    },
  };
  
  // Compute summary
  for (const inj of injuries) {
    const league = inj.league || "Unknown";
    localData.summary.by_league[league] = (localData.summary.by_league[league] || 0) + 1;
    localData.summary.by_status[inj.status] = (localData.summary.by_status[inj.status] || 0) + 1;
  }
  
  fs.writeFileSync(localPath, JSON.stringify(localData, null, 2));
  console.log(`   ✅ Saved ${injuries.length} injuries to ${localPath}`);
  
  // Try to store in Supabase
  try {
    const { error } = await sb.from("player_availability").select("id").limit(1);
    if (error) {
      console.log("   ⚠️  player_availability table doesn't exist — data stored locally only");
      console.log("   Run supabase/add-injury-tracking.sql in Supabase SQL Editor to enable DB storage");
      return;
    }
    
    // Upsert injuries
    let stored = 0;
    for (const inj of injuries) {
      try {
        await sb.from("player_availability").upsert({
          player_name: inj.player_name,
          team_name: inj.team_name,
          status: inj.status,
          reason: inj.reason,
          injury_type: inj.injury_type,
          source: inj.source,
          is_key_player: false,
        }, { onConflict: "player_name,team_name" });
        stored++;
      } catch (e) {
        // Skip duplicates
      }
    }
    
    console.log(`   ✅ Stored ${stored} records in Supabase`);
  } catch (e) {
    console.log(`   ⚠️  Supabase storage failed: ${e.message}`);
  }
}

async function printReport(injuries, derived) {
  console.log("\n" + "═".repeat(60));
  console.log("📊 INJURY & SUSPENSION REPORT");
  console.log("═".repeat(60));
  
  // Group by team
  const byTeam = {};
  for (const inj of injuries) {
    if (!byTeam[inj.team_name]) byTeam[inj.team_name] = [];
    byTeam[inj.team_name].push(inj);
  }
  
  // Teams with most injuries
  const teamsWithInjuries = Object.entries(byTeam)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);
  
  console.log("\n🏥 TEAMS WITH MOST INJURIES:");
  console.log("─".repeat(60));
  for (const [team, injList] of teamsWithInjuries) {
    const types = injList.map(i => i.injury_type).filter(Boolean);
    console.log(`   ${team.padEnd(25)} | ${injList.length} players | ${types.slice(0, 3).join(", ")}`);
  }
  
  // Injury types
  const byType = {};
  for (const inj of injuries) {
    const type = inj.injury_type || "Unknown";
    byType[type] = (byType[type] || 0) + 1;
  }
  
  console.log("\n🩺 INJURY TYPES:");
  console.log("─".repeat(60));
  Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([type, count]) => {
    console.log(`   ${type.padEnd(30)} | ${count} players`);
  });
  
  // Prediction impact
  console.log("\n⚡ PREDICTION IMPACT:");
  console.log("─".repeat(60));
  console.log("   Teams with 3+ injuries may see -2-5% win probability reduction");
  console.log("   Teams with 5+ injuries may see -5-10% win probability reduction");
  console.log("   Key player absences can shift odds by 5-15%");
  
  // Missing data
  if (derived.length > 0) {
    console.log("\n🔍 DERIVED ABSENCE SIGNALS:");
    console.log("─".repeat(60));
    derived.slice(0, 10).forEach(d => {
      console.log(`   ${d.team_name.padEnd(25)} | ${d.note}`);
    });
  }
  
  console.log("\n" + "═".repeat(60));
}

async function main() {
  console.log("🏥 ODDLY Injury & Suspension Collector");
  console.log("━".repeat(60));
  
  // 1. Fetch from API-Football
  const injuries = await fetchInjuriesFromAPIFootball();
  
  // 2. Detect derived absences
  const derived = await detectDerivedAbsences();
  
  // 3. Store data
  await storeData(injuries, derived);
  
  // 4. Print report
  await printReport(injuries, derived);
  
  console.log("\n✅ Injury collection complete!");
  console.log("This data can now be used to adjust prediction probabilities:");
  console.log("  • Injured key players → reduce team win probability");
  console.log("  • Multiple injuries → compound strength reduction");
  console.log("  • Suspension data → unavailable for upcoming matches");
}

main().catch(console.error);
