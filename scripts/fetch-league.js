#!/usr/bin/env node
/**
 * Fetch historical data for a single league.
 * Usage: node scripts/fetch-league.js <COMP_CODE> [seasons]
 * Example: node scripts/fetch-league.js BSA 2023,2024,2025
 */

const fs = require("fs");
const path = require("path");

// Load env
const envPath = path.join(__dirname, "..", ".env.local");
const envContent = fs.readFileSync(envPath, "utf8");
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

const COMP_NAMES = {
  BL1: "Bundesliga", BSA: "Brasileirão", SA: "Serie A",
  FL1: "Ligue 1", EPL: "Premier League", PD: "La Liga",
  DED: "Eredivisie", ELC: "Championship", PPL: "Primeira Liga",
  CL: "Champions League", FL2: "Ligue 2", ESD: "Eredivisie",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getOrCreateTeam(name) {
  if (!name) return null;
  const { data } = await sb.from("teams").select("id").ilike("canonical_name", name).limit(1);
  if (data?.length) return data[0].id;
  const { data: t } = await sb.from("teams").insert({ canonical_name: name, logo: null }).select("id").single();
  return t?.id;
}

async function main() {
  const comp = process.argv[2];
  const seasons = (process.argv[3] || "2023,2024,2025").split(",").map(Number);
  
  if (!comp) {
    console.log("Usage: node scripts/fetch-league.js <COMP_CODE> [seasons]");
    console.log("Codes: BL1, BSA, SA, FL1, EPL, PD, DED, ELC, PPL, CL");
    process.exit(1);
  }

  const leagueName = COMP_NAMES[comp] || comp;
  console.log(`🔄 Fetching ${leagueName} (${comp}) — Seasons: ${seasons.join(", ")}`);

  // Get league ID
  const { data: league } = await sb.from("leagues").select("id").eq("name", leagueName).eq("is_active", true).limit(1);
  if (!league?.length) {
    console.log(`❌ League "${leagueName}" not found in database`);
    process.exit(1);
  }
  const leagueId = league[0].id;

  // Get existing external IDs (paginate through all)
  const existingIds = new Set();
  let offset = 0;
  while (true) {
    const { data: batch } = await sb.from("fixtures").select("external_id").range(offset, offset + 999);
    if (!batch?.length) break;
    batch.forEach((f) => { if (f.external_id) existingIds.add(f.external_id); });
    if (batch.length < 1000) break;
    offset += 1000;
  }
  console.log(`Existing fixtures: ${existingIds.size}`);

  let totalNew = 0;

  for (const season of seasons) {
    process.stdout.write(`  ${season}: `);
    
    const url = `${BASE}/competitions/${comp}/matches?season=${season}&status=FINISHED`;
    const res = await fetch(url, { headers: { "X-Auth-Token": TOKEN } });
    
    if (res.status === 403) { console.log("restricted"); continue; }
    if (res.status === 429) { console.log("rate limited, waiting 60s"); await sleep(60000); continue; }
    if (!res.ok) { console.log(`error ${res.status}`); continue; }
    
    const data = await res.json();
    const finished = (data.matches || []).filter((m) => m.status === "FINISHED");
    let newCount = 0;

    for (const m of finished) {
      const extId = `fd_${m.id}`;
      if (existingIds.has(extId)) continue;

      const homeId = await getOrCreateTeam(m.homeTeam?.name);
      const awayId = await getOrCreateTeam(m.awayTeam?.name);

      const { error } = await sb.from("fixtures").insert({
        external_id: extId,
        league_id: leagueId,
        home_team_id: homeId,
        away_team_id: awayId,
        kickoff_time: m.utcDate,
        status: "finished",
        home_score: m.score?.fullTime?.home ?? null,
        away_score: m.score?.fullTime?.away ?? null,
      });

      if (!error) { existingIds.add(extId); newCount++; }
    }

    totalNew += newCount;
    console.log(`${finished.length} matches, ${newCount} new`);
    await sleep(6500);
  }

  console.log(`\n✅ ${leagueName}: +${totalNew} new fixtures`);
  console.log(`📊 Total fixtures now: ${existingIds.size}`);
}

main().catch(console.error);
