#!/usr/bin/env node

/**
 * Historical Data Fetch v4 — expanded leagues
 * Adds: Championship, Eredivisie, Primeira Liga, Championship, Scottish Premiership
 * football-data.org free tier: 2022+ for most competitions, 2023+ for some
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
    let val = t.slice(i + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const API_KEY = env.FOOTBALL_DATA_ORG_KEY || "395f3e8cbe6b4a149f3d854fcdac7ad9";

// Expanded leagues — all available on football-data.org free tier
const LEAGUES = [
  // Top 5 already done
  { code: "PL", name: "Premier League", country: "England" },
  { code: "PD", name: "La Liga", country: "Spain" },
  { code: "BL1", name: "Bundesliga", country: "Germany" },
  { code: "SA", name: "Serie A", country: "Italy" },
  { code: "FL1", name: "Ligue 1", country: "France" },
  // New leagues
  { code: "ELC", name: "Championship", country: "England" },
  { code: "DED", name: "Eredivisie", country: "Netherlands" },
  { code: "PPL", name: "Primeira Liga", country: "Portugal" },
  { code: "BSA", name: "Serie B", country: "Italy" },
  { code: "CL", name: "Champions League", country: "Europe" },
];

const SEASONS = [2023, 2024, 2025];

const leagueCache = {};
const teamCache = {};

async function getLeagueUuid(name, country) {
  if (leagueCache[name]) return leagueCache[name];
  const { data } = await supabase.from("leagues").select("id").eq("name", name).limit(1).single();
  if (data) { leagueCache[name] = data.id; return data.id; }
  const { data: n } = await supabase.from("leagues").insert({ name, country: country || "Europe", sport: "football", is_active: true, priority: 5 }).select("id").single();
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
  if (res.status === 403) return { matches: [], restricted: true };
  if (res.status === 429) return { matches: [], rateLimited: true };
  if (!res.ok) return { matches: [], error: res.status };
  const data = await res.json();
  return { matches: (data.matches || []).filter((m) => m.status === "FINISHED"), restricted: false };
}

async function main() {
  console.log("🔄 Historical Data Fetch v4 — Expanded Leagues");
  console.log("━".repeat(55));

  let totalStored = 0;
  let totalSkipped = 0;

  for (const league of LEAGUES) {
    const leagueUuid = await getLeagueUuid(league.name, league.country);
    if (!leagueUuid) { console.log(`❌ No league: ${league.name}`); continue; }

    for (const season of SEASONS) {
      process.stdout.write(`  ⚽ ${league.name} (${season}/${season + 1})... `);

      let result;
      try {
        result = await fetchSeason(league.code, season);
      } catch (e) {
        console.log(`error: ${e.message}`);
        await new Promise((r) => setTimeout(r, 6500));
        continue;
      }

      if (result.restricted) {
        console.log("restricted (free tier)");
        await new Promise((r) => setTimeout(r, 6500));
        continue;
      }

      if (result.rateLimited) {
        console.log("rate limited — pausing 60s");
        await new Promise((r) => setTimeout(r, 60000));
        // Retry once
        try {
          result = await fetchSeason(league.code, season);
        } catch { continue; }
        if (result.restricted || result.rateLimited) {
          console.log("still blocked, skipping");
          continue;
        }
      }

      const matches = result.matches || [];
      if (matches.length === 0) {
        console.log("empty");
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
            }
          } else {
            stored++;
          }
        } catch {
          // Skip
        }
      }

      totalStored += stored;
      totalSkipped += dupes;
      console.log(`${matches.length} fetched, ${stored} new, ${dupes} dupes`);

      await new Promise((r) => setTimeout(r, 6500));
    }
  }

  // Summary
  const { count: total } = await supabase.from("fixtures").select("*", { count: "exact", head: true }).eq("status", "finished");
  console.log("\n" + "━".repeat(55));
  console.log(`📊 New stored this run: ${totalStored}`);
  console.log(`📊 Total finished matches: ${total}`);

  // Breakdown by league
  const { data: allFixtures } = await supabase.from("fixtures").select("league_id, leagues!inner(name)").eq("status", "finished");
  const leagueCounts = {};
  for (const f of allFixtures || []) {
    const name = f.leagues?.name || "Unknown";
    leagueCounts[name] = (leagueCounts[name] || 0) + 1;
  }
  console.log("\nBy league:");
  for (const [name, count] of Object.entries(leagueCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }

  console.log("━".repeat(55));
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
