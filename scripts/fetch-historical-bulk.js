#!/usr/bin/env node

/**
 * Bulk Historical Data Fetch from football-data.org
 * Fetches 4 seasons × 5 leagues = ~7,000+ real matches
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const API_KEY = env.FOOTBALL_DATA_ORG_KEY || "395f3e8cbe6b4a149f3d854fcdac7ad9";

// Football-data.org competition codes
const LEAGUES = [
  { code: "PL", name: "Premier League", country: "England" },
  { code: "PD", name: "La Liga", country: "Spain" },
  { code: "BL1", name: "Bundesliga", country: "Germany" },
  { code: "SA", name: "Serie A", country: "Italy" },
  { code: "FL1", name: "Ligue 1", country: "France" },
];

const SEASONS = [2022, 2023, 2024, 2025];

async function getLeagueUuid(name, country) {
  const { data } = await supabase.from("leagues").select("id").eq("name", name).single();
  if (data) return data.id;
  const { data: newLeague } = await supabase
    .from("leagues")
    .insert({ name, country, sport: "football", is_active: true, priority: 5 })
    .select("id")
    .single();
  return newLeague?.id;
}

async function getOrCreateTeam(name, leagueUuid) {
  const normalized = name
    .replace(" FC", "")
    .replace(" AFC", "")
    .toLowerCase()
    .trim();
  
  const { data: existing } = await supabase.from("teams").select("id").eq("canonical_name", normalized).single();
  if (existing) return existing.id;

  const { data: newTeam } = await supabase
    .from("teams")
    .insert({ canonical_name: normalized, league_id: leagueUuid })
    .select("id")
    .single();
  return newTeam?.id;
}

async function fetchSeason(code, season) {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?season=${season}`;
  try {
    const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
    if (!res.ok) {
      const text = await res.text();
      console.log(`    ⚠️  HTTP ${res.status}: ${text.slice(0, 100)}`);
      return [];
    }
    const data = await res.json();
    return (data.matches || []).filter((m) => m.status === "FINISHED");
  } catch (e) {
    console.log(`    ❌ ${e.message}`);
    return [];
  }
}

async function main() {
  console.log("🔄 Bulk Historical Data Fetch");
  console.log("━".repeat(55));

  let totalStored = 0;

  for (const league of LEAGUES) {
    const leagueUuid = await getLeagueUuid(league.name, league.country);
    if (!leagueUuid) {
      console.log(`❌ Could not create league: ${league.name}`);
      continue;
    }

    for (const season of SEASONS) {
      process.stdout.write(`  ⚽ ${league.name} (${season}/${season + 1})... `);

      const matches = await fetchSeason(league.code, season);
      if (matches.length === 0) {
        console.log("no data");
        await new Promise((r) => setTimeout(r, 6500)); // Rate limit: 10 req/min
        continue;
      }

      let stored = 0;
      for (const match of matches) {
        try {
          const homeName = match.homeTeam?.name || "Unknown";
          const awayName = match.awayTeam?.name || "Unknown";

          const homeTeamId = await getOrCreateTeam(homeName, leagueUuid);
          const awayTeamId = await getOrCreateTeam(awayName, leagueUuid);

          if (!homeTeamId || !awayTeamId) continue;

          const { error } = await supabase.from("fixtures").upsert(
            {
              external_id: String(match.id),
              home_team_id: homeTeamId,
              away_team_id: awayTeamId,
              league_id: leagueUuid,
              kickoff_time: match.utcDate,
              home_score: match.score?.fullTime?.home ?? null,
              away_score: match.score?.fullTime?.away ?? null,
              status: "finished",
            },
            { onConflict: "external_id" }
          );

          if (!error) stored++;
        } catch (err) {
          // Skip individual errors
        }
      }

      totalStored += stored;
      console.log(`${matches.length} matches, ${stored} stored`);

      // Rate limit: football-data.org free tier = 10 requests/min
      await new Promise((r) => setTimeout(r, 6500));
    }
  }

  // Summary
  console.log("");
  console.log("━".repeat(55));
  console.log("📊 Summary");

  const { count: totalFinished } = await supabase
    .from("fixtures")
    .select("*", { count: "exact", head: true })
    .eq("status", "finished");

  console.log(`   New stored this run: ${totalStored}`);
  console.log(`   Total finished in DB: ${totalFinished}`);
  console.log("━".repeat(55));
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
