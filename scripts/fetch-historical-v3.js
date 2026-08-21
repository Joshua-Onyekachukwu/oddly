#!/usr/bin/env node

/**
 * Historical Data Fetch v3 — simple insert, skip duplicates
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

const LEAGUES = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "FL1", name: "Ligue 1" },
];

const SEASONS = [2023, 2024, 2025];

const leagueCache = {};
const teamCache = {};

async function getLeagueUuid(name) {
  if (leagueCache[name]) return leagueCache[name];
  const { data } = await supabase.from("leagues").select("id").eq("name", name).limit(1).single();
  if (data) { leagueCache[name] = data.id; return data.id; }
  const { data: n } = await supabase.from("leagues").insert({ name, country: "Europe", sport: "football", is_active: true, priority: 5 }).select("id").single();
  leagueCache[name] = n?.id;
  return n?.id;
}

async function getTeamUuid(name, leagueUuid) {
  const norm = name.replace(/\s+FC$/i, "").replace(/\s+AFC$/i, "").toLowerCase().trim();
  if (teamCache[norm]) return teamCache[norm];
  const { data } = await supabase.from("teams").select("id").eq("canonical_name", norm).limit(1).single();
  if (data) { teamCache[norm] = data.id; return data.id; }
  const { data: n } = await supabase.from("teams").insert({ canonical_name: norm, league_id: leagueUuid }).select("id").single();
  teamCache[norm] = n?.id;
  return n?.id;
}

async function fetchSeason(code, season) {
  const url = `https://api.football-data.org/v4/competitions/${code}/matches?season=${season}`;
  const res = await fetch(url, { headers: { "X-Auth-Token": API_KEY } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.matches || []).filter((m) => m.status === "FINISHED");
}

async function main() {
  console.log("🔄 Historical Data Fetch v3");
  console.log("━".repeat(55));

  let totalStored = 0;

  for (const league of LEAGUES) {
    const leagueUuid = await getLeagueUuid(league.name);
    if (!leagueUuid) { console.log(`❌ No league: ${league.name}`); continue; }

    for (const season of SEASONS) {
      process.stdout.write(`  ⚽ ${league.name} (${season}/${season + 1})... `);

      let matches;
      try {
        matches = await fetchSeason(league.code, season);
      } catch (e) {
        console.log(`error: ${e.message}`);
        await new Promise((r) => setTimeout(r, 6500));
        continue;
      }

      if (!matches || matches.length === 0) {
        console.log("restricted or empty");
        await new Promise((r) => setTimeout(r, 6500));
        continue;
      }

      let stored = 0;
      let dupes = 0;

      for (const match of matches) {
        try {
          const homeId = await getTeamUuid(match.homeTeam?.name || "Unknown", leagueUuid);
          const awayId = await getTeamUuid(match.awayTeam?.name || "Unknown", leagueUuid);
          if (!homeId || !awayId) continue;

          const { error } = await supabase.from("fixtures").insert({
            external_id: String(match.id),
            home_team_id: homeId,
            away_team_id: awayId,
            league_id: leagueUuid,
            kickoff_time: match.utcDate,
            home_score: match.score?.fullTime?.home ?? null,
            away_score: match.score?.fullTime?.away ?? null,
            status: "finished",
          });

          if (error) {
            if (error.message.includes("duplicate") || error.message.includes("unique")) {
              dupes++;
            } else {
              // Other error - skip silently
            }
          } else {
            stored++;
          }
        } catch {
          // Skip
        }
      }

      totalStored += stored;
      console.log(`${matches.length} fetched, ${stored} new, ${dupes} dupes`);

      await new Promise((r) => setTimeout(r, 6500));
    }
  }

  // Summary
  const { count: total } = await supabase.from("fixtures").select("*", { count: "exact", head: true }).eq("status", "finished");
  console.log("\n" + "━".repeat(55));
  console.log(`📊 New stored: ${totalStored}`);
  console.log(`📊 Total finished: ${total}`);

  const { data: all } = await supabase.from("fixtures").select("kickoff_time").eq("status", "finished");
  const yearCounts = {};
  for (const f of all || []) {
    const y = new Date(f.kickoff_time).getFullYear();
    yearCounts[y] = (yearCounts[y] || 0) + 1;
  }
  console.log("\nBy year:");
  for (const [y, c] of Object.entries(yearCounts).sort()) console.log(`  ${y}: ${c}`);
  console.log("━".repeat(55));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
