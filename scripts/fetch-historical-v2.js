#!/usr/bin/env node

/**
 * Historical Data Fetch v2 — uses correct football-data.org API codes
 * and existing Supabase league/team UUIDs to avoid duplicates.
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

// Football-data.org codes → existing Supabase league names
const LEAGUES = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "FL1", name: "Ligue 1" },
];

// Only fetch seasons that football-data.org free tier allows (2023+)
const SEASONS = [2023, 2024, 2025];

// Cache for league UUIDs
const leagueCache = {};
const teamCache = {};

async function getLeagueUuid(name) {
  if (leagueCache[name]) return leagueCache[name];

  // Get the FIRST existing league with this name (avoid duplicates)
  const { data } = await supabase.from("leagues").select("id").eq("name", name).limit(1).single();
  if (data) {
    leagueCache[name] = data.id;
    return data.id;
  }

  // Create if missing
  const { data: newLeague } = await supabase
    .from("leagues")
    .insert({ name, country: "Europe", sport: "football", is_active: true, priority: 5 })
    .select("id")
    .single();
  leagueCache[name] = newLeague?.id;
  return newLeague?.id;
}

async function getOrCreateTeam(name, leagueUuid) {
  // Normalize: remove FC/AFC suffixes, lowercase
  const normalized = name
    .replace(/\s+FC$/i, "")
    .replace(/\s+AFC$/i, "")
    .toLowerCase()
    .trim();

  if (teamCache[normalized]) return teamCache[normalized];

  // Check exact match
  const { data: existing } = await supabase.from("teams").select("id").eq("canonical_name", normalized).limit(1).single();
  if (existing) {
    teamCache[normalized] = existing.id;
    return existing.id;
  }

  // Create new team
  const { data: newTeam } = await supabase
    .from("teams")
    .insert({ canonical_name: normalized, league_id: leagueUuid })
    .select("id")
    .single();

  teamCache[normalized] = newTeam?.id;
  return newTeam?.id;
}

async function fetchSeason(code, season) {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?season=${season}`;
  try {
    const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
    if (!res.ok) {
      const text = await res.text();
      console.log(`    ⚠️  HTTP ${res.status}: ${text.slice(0, 80)}`);
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
  console.log("🔄 Historical Data Fetch v2");
  console.log("━".repeat(55));
  console.log(`   Seasons: ${SEASONS.join(", ")}`);
  console.log(`   Leagues: ${LEAGUES.map((l) => l.name).join(", ")}`);
  console.log("");

  let totalStored = 0;
  let totalSkipped = 0;

  for (const league of LEAGUES) {
    const leagueUuid = await getLeagueUuid(league.name);
    if (!leagueUuid) {
      console.log(`❌ Could not find league: ${league.name}`);
      continue;
    }

    for (const season of SEASONS) {
      process.stdout.write(`  ⚽ ${league.name} (${season}/${season + 1})... `);

      const matches = await fetchSeason(league.code, season);
      if (matches.length === 0) {
        console.log("no data (restricted or empty)");
        // Rate limit: 10 req/min
        await new Promise((r) => setTimeout(r, 6500));
        continue;
      }

      let stored = 0;
      let skipped = 0;

      // Batch insert — upsert 50 at a time
      const batchSize = 50;
      for (let i = 0; i < matches.length; i += batchSize) {
        const batch = matches.slice(i, i + batchSize);
        const rows = [];

        for (const match of batch) {
          try {
            const homeTeamId = await getOrCreateTeam(match.homeTeam?.name || "Unknown", leagueUuid);
            const awayTeamId = await getOrCreateTeam(match.awayTeam?.name || "Unknown", leagueUuid);

            if (!homeTeamId || !awayTeamId) {
              skipped++;
              continue;
            }

            rows.push({
              external_id: String(match.id),
              home_team_id: homeTeamId,
              away_team_id: awayTeamId,
              league_id: leagueUuid,
              kickoff_time: match.utcDate,
              home_score: match.score?.fullTime?.home ?? null,
              away_score: match.score?.fullTime?.away ?? null,
              status: "finished",
            });
          } catch {
            skipped++;
          }
        }

        if (rows.length > 0) {
          // Check which external_ids already exist
          const extIds = rows.map((r) => r.external_id);
          const { data: existing } = await supabase
            .from("fixtures")
            .select("external_id")
            .in("external_id", extIds);
          const existingIds = new Set((existing || []).map((e) => e.external_id));
          const newRows = rows.filter((r) => !existingIds.has(r.external_id));

          if (newRows.length > 0) {
            const { error, data } = await supabase.from("fixtures").insert(newRows).select("id");
            if (error) {
              console.log(`\n    ⚠️  Insert error: ${error.message}`);
            } else {
              stored += data?.length || newRows.length;
              if (i === 0) console.log(`\n    [debug] inserted ${data?.length || 0} rows (newRows=${newRows.length})`);
            }
          } else {
            if (i === 0) console.log(`\n    [debug] all ${rows.length} rows already exist`);
          }
        }
      }

      totalStored += stored;
      totalSkipped += skipped;
      console.log(`${matches.length} fetched, ${stored} stored, ${skipped} skipped`);

      // Rate limit: football-data.org free tier = 10 req/min
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
  console.log(`   Skipped: ${totalSkipped}`);
  console.log(`   Total finished in DB: ${totalFinished}`);

  // Breakdown by year
  const { data: all } = await supabase.from("fixtures").select("kickoff_time").eq("status", "finished");
  const yearCounts = {};
  for (const f of all || []) {
    const year = new Date(f.kickoff_time).getFullYear();
    yearCounts[year] = (yearCounts[year] || 0) + 1;
  }
  console.log("\n   By year:");
  for (const [y, c] of Object.entries(yearCounts).sort()) {
    console.log(`     ${y}: ${c} matches`);
  }

  console.log("━".repeat(55));
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
