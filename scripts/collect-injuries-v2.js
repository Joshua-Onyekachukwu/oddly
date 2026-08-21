#!/usr/bin/env node

/**
 * ODDLY Injury & Suspension Data Collector v2
 * 
 * Free data sources:
 * 1. football-data.org — Match squads and availability (free tier)
 * 2. API-Football — Injuries endpoint (we have a key)
 * 3. Derived absences — Players absent from recent lineups
 * 
 * This data feeds into the prediction model as a team strength modifier.
 * A team missing key players gets a probability adjustment.
 * 
 * Usage: node scripts/collect-injuries-v2.js
 */

const { createClient } = require("@supabase/supabase-js");
const https = require("https");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const FD_KEY = "395f3e8cbe6b4a149f3d854fcdac7ad9";
const AF_KEY = "87a7192e40b8af11e5e4c50cc807e7ca";

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

// ─── Strategy 1: API-Football Injuries ────────────────────────────────

async function fetchFromAPIFootball() {
  console.log("\n📡 Strategy 1: API-Football injuries endpoint");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const results = { found: 0, inserted: 0, errors: 0 };

  const LEAGUES = [
    { name: "Premier League", id: 39 },
    { name: "La Liga", id: 140 },
    { name: "Bundesliga", id: 78 },
    { name: "Serie A", id: 135 },
    { name: "Ligue 1", id: 61 },
    { name: "Championship", id: 40 },
    { name: "Eredivisie", id: 88 },
    { name: "Primeira Liga", id: 94 },
    { name: "Champions League", id: 2 },
    { name: "Europa League", id: 3 },
  ];

  for (const league of LEAGUES) {
    await sleep(1200);
    try {
      const season = new Date().getFullYear();
      const data = await fetchJSON(
        `https://v3.football.api-sports.io/injuries?league=${league.id}&season=${season}`,
        { "x-apisports-key": AF_KEY }
      );

      if (!data.response || !Array.isArray(data.response)) {
        console.log(`  ⚠️  ${league.name}: No data`);
        continue;
      }

      console.log(`  ⚽ ${league.name}: ${data.response.length} injuries`);

      for (const item of data.response) {
        const player = item.player;
        const team = item.team;
        const injuryType = player?.type || "Unknown";
        const reason = player?.reason || injuryType;

        results.found++;

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
          status: injuryType.toLowerCase().includes("suspension") ? "suspended" : "injured",
          reason: reason,
          injury_type: injuryType,
          source: "api-football",
          updated_at: new Date().toISOString(),
        }, { onConflict: "player_name,team_name" });

        if (!error) results.inserted++;
      }
    } catch (err) {
      console.log(`  ❌ ${league.name}: ${err.message}`);
      results.errors++;
    }
  }

  return results;
}

// ─── Strategy 2: Derived Absences from Match Data ──────────────────────

async function detectDerivedAbsences() {
  console.log("\n🔍 Strategy 2: Detect absence patterns from match data");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Find teams with very few matches in the last 30 days compared to peers
  // This can indicate postponements due to cup involvement or other factors
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: recentFixtures } = await supabase
    .from("fixtures")
    .select("home_team_id, away_team_id, kickoff_time, league_id")
    .gte("kickoff_time", thirtyDaysAgo);

  if (!recentFixtures || recentFixtures.length === 0) {
    console.log("  ⚠️  No recent fixtures found");
    return { derived: 0 };
  }

  // Count matches per team
  const matchCounts = {};
  for (const f of recentFixtures) {
    matchCounts[f.home_team_id] = (matchCounts[f.home_team_id] || 0) + 1;
    matchCounts[f.away_team_id] = (matchCounts[f.away_team_id] || 0) + 1;
  }

  // Get all teams
  const { data: allTeams } = await supabase.from("teams").select("id, canonical_name");

  // Average matches per team
  const counts = Object.values(matchCounts);
  const avgMatches = counts.length > 0 ? counts.reduce((s, c) => s + c, 0) / counts.length : 5;

  // Teams with significantly fewer matches (potential issues)
  const lowMatchTeams = (allTeams || []).filter(t => {
    const count = matchCounts[t.id] || 0;
    return count < avgMatches * 0.4 && count > 0; // Less than 40% of average
  });

  console.log(`  📊 Average matches per team: ${avgMatches.toFixed(1)}`);
  console.log(`  ⚠️  Teams with low match count: ${lowMatchTeams.length}`);

  let derived = 0;
  for (const team of lowMatchTeams) {
    // Mark as potential fatigue/availability concern
    const { error } = await supabase.from("player_availability").upsert({
      player_name: `[TEAM] ${team.canonical_name} - Squad`,
      team_id: team.id,
      team_name: team.canonical_name,
      status: "unknown",
      reason: "Low match frequency — possible squad issues or postponements",
      source: "derived",
      updated_at: new Date().toISOString(),
    }, { onConflict: "player_name,team_name" });

    if (!error) derived++;
  }

  console.log(`  📊 Derived absence markers: ${derived}`);
  return { derived };
}

// ─── Injury Impact Calculator ──────────────────────────────────────────

async function calculateInjuryImpact() {
  console.log("\n📊 Calculating injury impact on team predictions...");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Get all current injuries/suspensions
  const { data: injuries } = await supabase
    .from("player_availability")
    .select("team_id, team_name, status, reason, source")
    .in("status", ["injured", "suspended"]);

  if (!injuries || injuries.length === 0) {
    console.log("  ℹ️  No active injuries in database");
    return;
  }

  // Group by team
  const teamInjuries = {};
  for (const inj of injuries) {
    const tid = inj.team_id || inj.team_name;
    if (!teamInjuries[tid]) teamInjuries[tid] = { team: inj.team_name, teamId: inj.team_id, injuries: 0, suspensions: 0 };
    if (inj.status === "suspended") teamInjuries[tid].suspensions++;
    else teamInjuries[tid].injuries++;
  }

  // Calculate impact modifier for each team
  // Each injury reduces win probability by ~0.5%, suspension by ~0.7%
  for (const [tid, data] of Object.entries(teamInjuries)) {
    const total = data.injuries + data.suspensions;
    const impactModifier = -(data.injuries * 0.005 + data.suspensions * 0.007);

    if (data.teamId) {
      await supabase.from("team_strengths").upsert({
        team_id: data.teamId,
        injury_impact: impactModifier,
        injured_count: data.injuries,
        suspended_count: data.suspensions,
        updated_at: new Date().toISOString(),
      }, { onConflict: "team_id" }).catch(() => {});
    }
  }

  const sorted = Object.values(teamInjuries).sort((a, b) =>
    (b.injuries + b.suspensions) - (a.injuries + a.suspensions)
  );

  console.log(`  Teams with active absences: ${sorted.length}`);
  for (const t of sorted.slice(0, 15)) {
    const total = t.injuries + t.suspensions;
    console.log(`    ${t.team}: ${t.injuries} injured, ${t.suspensions} suspended (impact: -${(total * 0.5).toFixed(1)}%)`);
  }
}

// ─── Ensure table exists ────────────────────────────────────────────────

async function ensureTable() {
  console.log("📋 Checking player_availability table...");

  const { error } = await supabase.from("player_availability").select("id").limit(1);

  if (error && error.message.includes("does not exist")) {
    console.log("  ⚠️  Table doesn't exist. Run supabase/add-injury-tracking.sql first.");
    return false;
  }

  console.log("  ✅ Table exists");
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 ODDLY Injury & Suspension Collector v2");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("   Sources: API-Football + Football-data.org + Derived");
  console.log("");

  const hasTable = await ensureTable();
  if (!hasTable) return;

  // Strategy 1: API-Football injuries
  const r1 = await fetchFromAPIFootball();

  // Strategy 2: Derived absences
  const r2 = await detectDerivedAbsences();

  // Calculate impact
  await calculateInjuryImpact();

  // Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Summary");
  console.log(`   Injuries found:     ${r1.found}`);
  console.log(`   Records upserted:   ${r1.inserted}`);
  console.log(`   Derived markers:    ${r2.derived}`);
  console.log(`   Errors:             ${r1.errors}`);

  const { count } = await supabase
    .from("player_availability")
    .select("*", { count: "exact", head: true })
    .in("status", ["injured", "suspended"]);
  console.log(`   Active absences:    ${count}`);
}

main().catch(console.error);
