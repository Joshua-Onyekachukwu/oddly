#!/usr/bin/env node

/**
 * Efficient Team Logo Sync
 * Fetches all teams per league in ONE API call instead of searching one-by-one.
 * Uses API-Football /teams?league=X&season=Y endpoint.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
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
const API_KEY = env.API_FOOTBALL_KEY;

// League name → API-Football league ID + season
const LEAGUES = [
  { name: "Premier League", apiId: 39, season: 2025 },
  { name: "La Liga", apiId: 140, season: 2025 },
  { name: "Bundesliga", apiId: 78, season: 2025 },
  { name: "Serie A", apiId: 135, season: 2025 },
  { name: "Ligue 1", apiId: 61, season: 2025 },
  { name: "Eredivisie", apiId: 88, season: 2025 },
  { name: "Primeira Liga", apiId: 94, season: 2025 },
  { name: "Champions League", apiId: 2, season: 2025 },
  { name: "Europa League", apiId: 3, season: 2025 },
  { name: "MLS", apiId: 253, season: 2025 },
  { name: "Championship", apiId: 40, season: 2025 },
  { name: "Super Lig", apiId: 203, season: 2025 },
  { name: "NPFL", apiId: 168, season: 2025 },
];

function normalize(name) {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

async function fetchLeagueTeams(apiLeagueId, season) {
  try {
    const res = await fetch(
      `https://v3.football.api-sports.io/teams?league=${apiLeagueId}&season=${season}`,
      { headers: { "x-apisports-key": API_KEY } }
    );
    if (!res.ok) {
      const text = await res.text();
      console.log(`    API error ${res.status}: ${text.slice(0, 100)}`);
      return [];
    }
    const data = await res.json();
    return data.response || [];
  } catch (e) {
    console.log(`    Fetch error: ${e.message}`);
    return [];
  }
}

async function main() {
  console.log("🔄 Efficient Team Logo Sync");
  console.log("━".repeat(50));

  if (!API_KEY) {
    console.error("❌ API_FOOTBALL_KEY not found in .env.local");
    process.exit(1);
  }

  let totalUpdated = 0;
  let totalMatched = 0;

  for (const league of LEAGUES) {
    process.stdout.write(`  ⚽ ${league.name}... `);

    // Get API-Football teams (one call per league!)
    const apiTeams = await fetchLeagueTeams(league.apiId, league.season);
    if (apiTeams.length === 0) {
      console.log("no API teams found");
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    // Get our DB teams for this league
    const { data: dbLeague } = await supabase
      .from("leagues")
      .select("id")
      .eq("name", league.name)
      .single();

    if (!dbLeague) {
      console.log(`league not in DB`);
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    const { data: dbTeams } = await supabase
      .from("teams")
      .select("id, canonical_name, logo")
      .eq("league_id", dbLeague.id);

    if (!dbTeams?.length) {
      console.log(`no DB teams`);
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    // Build lookup: normalized API name → logo URL
    const apiLookup = new Map();
    for (const t of apiTeams) {
      apiLookup.set(normalize(t.team.name), {
        logo: t.team.logo,
        id: t.team.id,
        name: t.team.name,
      });
    }

    let updated = 0;
    let matched = 0;

    for (const dbTeam of dbTeams) {
      if (dbTeam.logo) continue; // Already has logo

      const normName = normalize(dbTeam.canonical_name);

      // Try exact match
      let apiTeam = apiLookup.get(normName);

      // Try partial match
      if (!apiTeam) {
        for (const [apiName, apiInfo] of apiLookup) {
          if (
            apiName.includes(normName) ||
            normName.includes(apiName) ||
            apiName.split(" ").some((w) => w.length > 3 && normName.includes(w)) ||
            normName.split(" ").some((w) => w.length > 3 && apiName.includes(w))
          ) {
            apiTeam = apiInfo;
            break;
          }
        }
      }

      if (apiTeam) {
        await supabase
          .from("teams")
          .update({ logo: apiTeam.logo })
          .eq("id", dbTeam.id);
        updated++;
        matched++;
        // Store alias for future matches
        await supabase.from("team_aliases").upsert(
          { canonical_name: dbTeam.canonical_name, alias: normalize(apiTeam.name), source: "logo-sync" },
          { onConflict: "alias" }
        );
      }
      totalMatched++;
    }

    totalUpdated += updated;
    console.log(`${apiTeams.length} API teams → ${dbTeams.length} DB teams → ${updated} logos updated`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("");
  console.log("━".repeat(50));
  console.log("📊 Summary");
  console.log(`   Total logos updated: ${totalUpdated}`);

  // Final count
  const { count: withLogo } = await supabase
    .from("teams")
    .select("*", { count: "exact", head: true })
    .not("logo", "is", null);
  const { count: total } = await supabase
    .from("teams")
    .select("*", { count: "exact", head: true });
  console.log(`   Teams with logos: ${withLogo} / ${total}`);
  console.log("━".repeat(50));
}

main().catch((err) => {
  console.error("\n❌ Failed:", err.message);
  process.exit(1);
});
