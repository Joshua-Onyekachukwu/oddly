#!/usr/bin/env node

/**
 * ODDLY Logo Sync Script
 *
 * Fetches real league and team logos from API-Football's media CDN.
 * The media CDN works even on the free plan — it's just image hosting.
 *
 * Usage: node scripts/sync-logos.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Load .env.local
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local not found.");
    process.exit(1);
  }
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// API-Football league ID mapping (name -> api-football league ID)
const LEAGUE_API_IDS = {
  "Premier League": 39,
  "La Liga": 140,
  "Bundesliga": 78,
  "Serie A": 135,
  "Ligue 1": 61,
  "Eredivisie": 88,
  "Primeira Liga": 94,
  "NPFL": 168,
  "Brasileirão": 71,
  "MLS": 253,
  "Champions League": 2,
  "Europa League": 3,
};

// API-Football logo URLs
function getLeagueLogoUrl(apiLeagueId) {
  return `https://media.api-sports.io/football/leagues/${apiLeagueId}.png`;
}

function getTeamLogoUrl(apiTeamId) {
  return `https://media.api-sports.io/football/teams/${apiTeamId}.png`;
}

// Fetch team ID from API-Football by name
async function fetchTeamId(teamName) {
  const apiKey = env.API_FOOTBALL_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://v3.football.api-sports.io/teams?search=${encodeURIComponent(teamName)}`,
      { headers: { "x-apisports-key": apiKey } }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data.response && data.response.length > 0) {
      return data.response[0].team.id;
    }
  } catch {
    // Silently fail
  }
  return null;
}

// Fetch league seasons to get current season teams
async function fetchLeagueTeams(apiLeagueId) {
  const apiKey = env.API_FOOTBALL_KEY;
  if (!apiKey) return [];

  try {
    // Get current season
    const seasonResponse = await fetch(
      `https://v3.football.api-sports.io/leagues?id=${apiLeagueId}`,
      { headers: { "x-apisports-key": apiKey } }
    );
    if (!seasonResponse.ok) return [];
    const seasonData = await seasonResponse.json();
    const currentSeason = seasonData.response?.[0]?.seasons?.[0]?.year;
    if (!currentSeason) return [];

    // Get teams for this league/season
    const teamsResponse = await fetch(
      `https://v3.football.api-sports.io/teams?league=${apiLeagueId}&season=${currentSeason}`,
      { headers: { "x-apisports-key": apiKey } }
    );
    if (!teamsResponse.ok) return [];
    const teamsData = await teamsResponse.json();
    return teamsData.response || [];
  } catch {
    return [];
  }
}

async function syncLeagueLogos() {
  console.log("🏟️  Syncing league logos...");
  let updated = 0;

  for (const [name, apiId] of Object.entries(LEAGUE_API_IDS)) {
    const logoUrl = getLeagueLogoUrl(apiId);

    const { error } = await supabase
      .from("leagues")
      .update({ logo: logoUrl })
      .eq("name", name)
      .is("logo", null);

    if (!error) {
      updated++;
      console.log(`  ✅ ${name} → ${logoUrl}`);
    } else {
      console.log(`  ⚠️  ${name}: ${error.message}`);
    }

    // Rate limit
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`   Updated ${updated} league logos\n`);
  return updated;
}

async function syncTeamLogos() {
  console.log("⚽ Syncing team logos...");
  let updated = 0;
  let fetched = 0;

  // Get all teams without logos
  const { data: teams } = await supabase
    .from("teams")
    .select("id, canonical_name, league_id")
    .is("logo", null)
    .limit(500);

  if (!teams?.length) {
    console.log("   All teams already have logos\n");
    return 0;
  }

  console.log(`   Found ${teams.length} teams without logos`);

  for (const team of teams) {
    try {
      // Try to find team ID from API-Football
      const apiTeamId = await fetchTeamId(team.canonical_name);

      if (apiTeamId) {
        const logoUrl = getTeamLogoUrl(apiTeamId);
        await supabase
          .from("teams")
          .update({ logo: logoUrl })
          .eq("id", team.id);
        updated++;
        fetched++;
        if (fetched % 20 === 0) {
          console.log(`   ... ${fetched}/${teams.length} processed`);
        }
      }

      // Rate limit — API-Football free plan: ~100 requests/day
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      // Skip individual errors
    }
  }

  console.log(`   Updated ${updated} team logos\n`);
  return updated;
}

async function main() {
  console.log("🔄 ODDLY Logo Sync");
  console.log("━".repeat(50));

  const leagueCount = await syncLeagueLogos();
  const teamCount = await syncTeamLogos();

  // Summary
  const { count: totalLeagues } = await supabase
    .from("leagues")
    .select("id", { count: "exact", head: true })
    .not("logo", "is", null);

  const { count: totalTeams } = await supabase
    .from("teams")
    .select("id", { count: "exact", head: true })
    .not("logo", "is", null);

  console.log("━".repeat(50));
  console.log("📊 Summary");
  console.log(`   Leagues with logos: ${totalLeagues}`);
  console.log(`   Teams with logos:   ${totalTeams}`);
  console.log("━".repeat(50));
}

main().catch((err) => {
  console.error("\n❌ Logo sync failed:", err.message);
  process.exit(1);
});
