#!/usr/bin/env node

/**
 * Fetch missing historical data from football-data.org
 * Maps competition codes to existing league UUIDs in Supabase
 * Only fetches data we don't already have
 */

const fs = require("fs");
const path = require("path");

// Load env
const envContent = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
envContent.split("\n").forEach((line) => {
  const match = line.match(/^([A-Z_]+)="([^"#\n]+)"/);
  if (match) process.env[match[1]] = match[2].trim();
});

const { createClient } = require("@supabase/supabase-js");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TOKEN = process.env.FOOTBALL_DATA_API_KEY || "395f3e8cbe6b4a149f3d854fcdac7ad9";
const BASE = "https://api.football-data.org/v4";

// Competition code → league name mapping
const COMP_MAP = {
  BL1: "Bundesliga",
  BSA: "Brasileirão",
  SA: "Serie A",
  FL1: "Ligue 1",
  EPL: "Premier League",
  PD: "La Liga",
  DED: "Eredivisie",
  ELC: "Championship",
  PPL: "Primeira Liga",
  CL: "Champions League",
};

const SEASONS = [2023, 2024, 2025];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchMatches(competition, season) {
  const url = `${BASE}/competitions/${competition}/matches?season=${season}&status=FINISHED`;
  const res = await fetch(url, { headers: { "X-Auth-Token": TOKEN } });
  if (res.status === 403) return null;
  if (res.status === 429) {
    console.log("    Rate limited, waiting 60s...");
    await sleep(60000);
    return fetchMatches(competition, season);
  }
  if (!res.ok) return null;
  const data = await res.json();
  return data.matches || [];
}

async function getTeamId(teamName) {
  // Try exact match first
  const { data } = await sb
    .from("teams")
    .select("id")
    .ilike("canonical_name", teamName)
    .limit(1);
  if (data && data.length > 0) return data[0].id;

  // Try fuzzy match
  const { data: fuzzy } = await sb
    .from("teams")
    .select("id")
    .ilike("canonical_name", `%${teamName.split(" ")[0]}%`)
    .limit(1);
  if (fuzzy && fuzzy.length > 0) return fuzzy[0].id;

  // Create new team
  const { data: newTeam } = await sb
    .from("teams")
    .insert({ canonical_name: teamName, logo: null })
    .select("id")
    .single();
  return newTeam?.id;
}

async function main() {
  console.log("🔄 Fetching Missing Historical Data");
  console.log("━".repeat(50));

  // Get existing leagues
  const { data: leagues } = await sb.from("leagues").select("id, name").eq("is_active", true);
  const leagueMap = {};
  for (const lg of leagues || []) {
    leagueMap[lg.name] = lg.id;
  }

  // Get existing fixture external IDs to avoid duplicates
  const { data: existingFixtures } = await sb.from("fixtures").select("external_id").limit(50000);
  const existingExternalIds = new Set((existingFixtures || []).map((f) => f.external_id).filter(Boolean));
  console.log("Existing fixtures:", existingExternalIds.size);

  let totalNew = 0;
  let totalOdds = 0;

  for (const [comp, leagueName] of Object.entries(COMP_MAP)) {
    const leagueId = leagueMap[leagueName];
    if (!leagueId) {
      console.log(`\n⚠️  ${leagueName} — not in database, skipping`);
      continue;
    }

    let leagueNew = 0;

    for (const season of SEASONS) {
      process.stdout.write(`  ⚽ ${leagueName} (${season})... `);

      const matches = await fetchMatches(comp, season);
      if (!matches) {
        console.log("restricted");
        await sleep(7000);
        continue;
      }

      const finished = matches.filter((m) => m.status === "FINISHED");
      let newCount = 0;

      for (const m of finished) {
        const externalId = `fd_${m.id}`;
        if (existingExternalIds.has(externalId)) continue;

        // Get or create teams
        const homeId = await getTeamId(m.homeTeam?.name || "Unknown");
        const awayId = await getTeamId(m.awayTeam?.name || "Unknown");

        const { error } = await sb.from("fixtures").insert({
          external_id: externalId,
          league_id: leagueId,
          home_team_id: homeId,
          away_team_id: awayId,
          kickoff_time: m.utcDate,
          status: "finished",
          home_score: m.score?.fullTime?.home ?? null,
          away_score: m.score?.fullTime?.away ?? null,
        });

        if (!error) {
          existingExternalIds.add(externalId);
          newCount++;
        }
      }

      leagueNew += newCount;
      console.log(`${finished.length} matches, ${newCount} new`);
      await sleep(7000);
    }

    if (leagueNew > 0) {
      console.log(`  ✅ ${leagueName}: +${leagueNew} new fixtures`);
    }
    totalNew += leagueNew;
  }

  console.log("\n" + "━".repeat(50));
  console.log(`✅ Total new fixtures: ${totalNew}`);
  console.log(`📊 Database now has: ${existingExternalIds.size} fixtures`);
}

main().catch(console.error);
