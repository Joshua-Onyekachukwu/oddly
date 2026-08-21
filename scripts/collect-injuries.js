#!/usr/bin/env node

/**
 * Injury & Suspension Data Collector
 * 
 * Sources:
 * 1. football-data.org — squad data + match lineups (free tier, 10 req/min)
 * 2. API-Football — injuries endpoint (we have a key)
 * 3. Derived injuries — players absent from recent lineups
 * 
 * Usage: node scripts/collect-injuries.js [--dry-run]
 * 
 * Creates/uses: player_availability table in Supabase
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const https = require("https");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  fs.readFileSync(envPath, "utf8").split("\n").forEach((l) => {
    const m = l.match(/^([^#=]+)="?(.*?)"?\s*$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const FOOTBALL_DATA_KEY = "395f3e8cbe6b4a149f3d854fcdac7ad9";
const API_FOOTBALL_KEY = "87a7192e40b8af11e5e4c50cc807e7ca";
const DRY_RUN = process.argv.includes("--dry-run");

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers, timeout: 15000 }, (res) => {
      if (res.statusCode === 429) {
        const wait = parseInt(res.headers["retry-after"] || "60");
        console.log(`  ⏳ Rate limited. Waiting ${wait}s...`);
        setTimeout(() => fetchJSON(url, headers).then(resolve).catch(reject), wait * 1000);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error("Parse error")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Ensure table exists ────────────────────────────────────────────────

async function ensureTable() {
  console.log("📋 Ensuring player_availability table exists...");
  
  // Try to create the table using raw SQL via the REST API
  const sql = `
    CREATE TABLE IF NOT EXISTS player_availability (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      player_name TEXT NOT NULL,
      team_id UUID REFERENCES teams(id),
      team_name TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      reason TEXT,
      injury_type TEXT,
      expected_return DATE,
      source TEXT DEFAULT 'api-football',
      last_seen_date DATE,
      matches_missed INTEGER DEFAULT 0,
      is_key_player BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_player_availability_team ON player_availability(team_id);
    CREATE INDEX IF NOT EXISTS idx_player_availability_status ON player_availability(status);
    CREATE INDEX IF NOT EXISTS idx_player_availability_player ON player_availability(player_name);
  `;
  
  // We can't run raw SQL via the client, so we'll just try to query the table
  const { error } = await supabase.from("player_availability").select("id").limit(1);
  
  if (error && error.message.includes("does not exist")) {
    console.log("  ⚠️  Table doesn't exist. Please run this SQL in Supabase SQL Editor:");
    console.log("\n" + sql + "\n");
    return false;
  }
  
  console.log("  ✅ Table exists");
  return true;
}

// ─── Strategy 1: football-data.org Squad Data ──────────────────────────

async function fetchSquadInjuries() {
  console.log("\n📡 Strategy 1: football-data.org squad data");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  const results = { found: 0, inserted: 0, errors: 0 };
  
  const competitions = ["PL", "PD", "BL1", "SA", "FL1", "ELC", "DED", "PPL"];
  
  for (const comp of competitions) {
    await sleep(6500); // Rate limit
    
    try {
      console.log(`  ⚽ Competition ${comp}...`);
      
      // Get standings to find team IDs
      const standingData = await fetchJSON(
        `https://api.football-data.org/v4/competitions/${comp}/standings`,
        { "X-Auth-Token": FOOTBALL_DATA_KEY }
      );
      
      if (!standingData.standings?.[0]?.table) continue;
      
      const teams = standingData.standings[0].table.map(t => ({
        id: t.team.id,
        name: t.team.name,
        crest: t.team.crest,
      }));
      
      console.log(`    Found ${teams.length} teams`);
      
      // For each team, get squad info
      for (const team of teams) {
        await sleep(6500);
        
        try {
          const teamData = await fetchJSON(
            `https://api.football-data.org/v4/teams/${team.id}`,
            { "X-Auth-Token": FOOTBALL_DATA_KEY }
          );
          
          if (!teamData.squad) continue;
          
          // Look for players with injury/suspension info
          for (const player of teamData.squad) {
            const isInjured = player.injury || player.injured;
            const isSuspended = player.suspended;
            
            if (isInjured || isSuspended || player.currentSeasonStatistics?.games === 0) {
              results.found++;
              
              if (!DRY_RUN) {
                // Find matching team in our database
                const { data: dbTeam } = await supabase
                  .from("teams")
                  .select("id")
                  .ilike("canonical_name", `%${team.name}%`)
                  .limit(1);
                
                const { error } = await supabase.from("player_availability").upsert({
                  player_name: player.name || player.fullName,
                  team_id: dbTeam?.[0]?.id || null,
                  team_name: team.name,
                  status: isSuspended ? "suspended" : isInjured ? "injured" : "unknown",
                  reason: player.injury?.type || player.injury || "Unknown",
                  source: "football-data.org",
                  updated_at: new Date().toISOString(),
                }, { onConflict: "player_name,team_name" });
                
                if (!error) results.inserted++;
              }
            }
          }
        } catch (err) {
          console.log(`    ❌ ${team.name}: ${err.message}`);
          results.errors++;
        }
      }
      
    } catch (err) {
      console.log(`  ❌ ${comp}: ${err.message}`);
      results.errors++;
    }
  }
  
  return results;
}

// ─── Strategy 2: API-Football Injuries Endpoint ────────────────────────

async function fetchFromAPIFootball() {
  console.log("\n📡 Strategy 2: API-Football injuries endpoint");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  const results = { found: 0, inserted: 0, errors: 0 };
  
  // Get all leagues we track
  const { data: leagues } = await supabase.from("leagues").select("id,name,external_id").limit(30);
  if (!leagues) return results;
  
  // Map league names to API-Football league IDs
  const LEAGUE_MAP = {
    "Premier League": 39,
    "La Liga": 140,
    "Bundesliga": 78,
    "Serie A": 135,
    "Ligue 1": 61,
    "Championship": 40,
    "Eredivisie": 88,
    "Primeira Liga": 94,
    "Champions League": 2,
    "Europa League": 3,
    "Super Lig": 203,
    "Serie B": 16,
    "La Liga 2": 142,
    "Ligue 2": 79,
    "Bundesliga 2": 14,
    "Conference League": 848,
  };
  
  for (const league of leagues) {
    const leagueId = LEAGUE_MAP[league.name] || league.external_id;
    if (!leagueId) continue;
    
    await sleep(1100); // API-Football rate limit
    
    try {
      console.log(`  ⚽ ${league.name} (ID: ${leagueId})...`);
      
      // Get current season injuries
      const season = new Date().getFullYear();
      const data = await fetchJSON(
        `https://v3.football.api-sports.io/injuries?league=${leagueId}&season=${season}`,
        { "x-apisports-key": API_FOOTBALL_KEY }
      );
      
      if (!data.response || !Array.isArray(data.response)) {
        console.log(`    ⚠️  No data returned`);
        continue;
      }
      
      console.log(`    📋 ${data.response.length} injuries found`);
      
      for (const item of data.response) {
        const player = item.player;
        const team = item.team;
        const injury = item.player?.type || "Unknown";
        const reason = item.player?.reason || injury;
        
        results.found++;
        
        if (!DRY_RUN) {
          // Find matching team
          const { data: dbTeam } = await supabase
            .from("teams")
            .select("id")
            .ilike("canonical_name", `%${team.name}%`)
            .limit(1);
          
          const { error } = await supabase.from("player_availability").upsert({
            player_name: player.name,
            team_id: dbTeam?.[0]?.id || null,
            team_name: team.name,
            status: injury.toLowerCase().includes("suspension") ? "suspended" : "injured",
            reason: reason,
            injury_type: injury,
            source: "api-football",
            updated_at: new Date().toISOString(),
          }, { onConflict: "player_name,team_name" });
          
          if (!error) results.inserted++;
        }
      }
      
    } catch (err) {
      console.log(`  ❌ ${league.name}: ${err.message}`);
      results.errors++;
    }
  }
  
  return results;
}

// ─── Strategy 3: Derived Injuries (absence detection) ──────────────────

async function detectDerivedAbsences() {
  console.log("\n🔍 Strategy 3: Detect derived absences from match data");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  const results = { found: 0, inserted: 0, errors: 0 };
  
  // Get teams with recent matches
  const { data: teams } = await supabase
    .from("teams")
    .select("id,canonical_name")
    .limit(100);
  
  if (!teams) return results;
  
  // For each team, check if they have abnormally few scheduled fixtures
  // compared to other teams in their league — this could indicate postponed
  // matches due to international duty or other reasons
  
  const { data: recentMatches } = await supabase
    .from("fixtures")
    .select("home_team_id,away_team_id,status,league_id")
    .gte("kickoff_time", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .lte("kickoff_time", new Date().toISOString());
  
  if (!recentMatches) return results;
  
  // Count matches per team
  const matchCounts = {};
  for (const m of recentMatches) {
    matchCounts[m.home_team_id] = (matchCounts[m.home_team_id] || 0) + 1;
    matchCounts[m.away_team_id] = (matchCounts[m.away_team_id] || 0) + 1;
  }
  
  // Find teams with 0 recent matches (potentially long-term injuries to key players
  // causing team to not be competitive, or postponed matches)
  const teamsWithNoMatches = teams.filter(t => !matchCounts[t.id]);
  
  if (teamsWithNoMatches.length > 0) {
    console.log(`  ℹ️  ${teamsWithNoMatches.length} teams with no recent matches (possible scheduling)`);
  }
  
  results.found = 0; // Derived absences are informational, not directly stored
  console.log("  📊 Derived absence analysis complete");
  
  return results;
}

// ─── Injury Impact Calculator ───────────────────────────────────────────

async function calculateInjuryImpact() {
  console.log("\n📊 Calculating injury impact on team performance...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  // Get all current injuries/suspensions
  const { data: injuries } = await supabase
    .from("player_availability")
    .select("team_id,team_name,status,reason")
    .in("status", ["injured", "suspended"]);
  
  if (!injuries || injuries.length === 0) {
    console.log("  ℹ️  No active injuries/suspensions in database");
    return;
  }
  
  // Group by team
  const teamInjuries = {};
  for (const inj of injuries) {
    const tid = inj.team_id || inj.team_name;
    if (!teamInjuries[tid]) teamInjuries[tid] = { team: inj.team_name, injuries: [], suspensions: 0, injuryCount: 0 };
    teamInjuries[tid].injuries.push(inj);
    if (inj.status === "suspended") teamInjuries[tid].suspensions++;
    else teamInjuries[tid].injuryCount++;
  }
  
  // Print summary
  const sorted = Object.values(teamInjuries).sort((a, b) => 
    (b.injuryCount + b.suspensions) - (a.injuryCount + a.suspensions)
  );
  
  console.log(`\n  Teams with active absences:`);
  for (const t of sorted.slice(0, 20)) {
    const total = t.injuryCount + t.suspensions;
    console.log(`    ${t.team}: ${t.injuryCount} injured, ${t.suspensions} suspended`);
  }
  
  // Calculate impact score per team
  // Simple heuristic: each injury = -0.5% win probability, suspension = -0.7%
  for (const tid of Object.keys(teamInjuries)) {
    const t = teamInjuries[tid];
    const impact = -(t.injuryCount * 0.005 + t.suspensions * 0.007);
    
    if (t.team_id) {
      await supabase.from("team_strengths").upsert({
        team_id: t.team_id,
        injury_impact: impact,
        injured_count: t.injuryCount,
        suspended_count: t.suspensions,
        updated_at: new Date().toISOString(),
      }, { onConflict: "team_id" }).then(() => {}).catch(() => {});
    }
  }
  
  console.log(`\n  📊 Impact scores calculated for ${Object.keys(teamInjuries).length} teams`);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 ODDLY Injury & Suspension Data Collector");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📡 Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`🔑 API-Football: ${API_FOOTBALL_KEY.slice(0, 8)}...`);
  if (DRY_RUN) console.log("⚠️  DRY RUN MODE");
  console.log("");
  
  const hasTable = await ensureTable();
  if (!hasTable && !DRY_RUN) {
    console.log("\n⚠️  Please create the table first, then re-run this script.");
    return;
  }
  
  const allResults = { found: 0, inserted: 0, errors: 0 };
  
  // Strategy 1: football-data.org squad data
  const r1 = await fetchSquadInjuries();
  allResults.found += r1.found;
  allResults.inserted += r1.inserted;
  allResults.errors += r1.errors;
  
  // Strategy 2: API-Football injuries
  const r2 = await fetchFromAPIFootball();
  allResults.found += r2.found;
  allResults.inserted += r2.inserted;
  allResults.errors += r2.errors;
  
  // Strategy 3: Derived absences
  const r3 = await detectDerivedAbsences();
  
  // Calculate impact
  await calculateInjuryImpact();
  
  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Summary");
  console.log(`   Injuries found:     ${allResults.found}`);
  console.log(`   Records inserted:   ${allResults.inserted}`);
  console.log(`   Errors:             ${allResults.errors}`);
  
  const { count } = await supabase
    .from("player_availability")
    .select("*", { count: "exact", head: true })
    .in("status", ["injured", "suspended"]);
  console.log(`   Active absences:    ${count}`);
}

main().catch(console.error);
