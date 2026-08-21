#!/usr/bin/env node

/**
 * StatsBomb Open Data Collector — La Liga xG Features
 * 
 * StatsBomb provides FREE open data on GitHub:
 * https://github.com/statsbomb/open-data
 * 
 * This script:
 * 1. Downloads match and event data from StatsBomb open-data repo
 * 2. Extracts xG, shots, key passes, chance creation metrics
 * 3. Stores aggregated team-level xG features in Supabase
 * 4. These features improve 1X2, O/U, and BTTS predictions
 * 
 * Data available: La Liga (competition_id=11), multiple seasons
 * No API key needed — fully free and open source
 * 
 * Usage: node scripts/collect-statsbomb-xg.js
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

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000, headers: { "User-Agent": "ODDLY-StatsBomb/1.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { reject(new Error("Parse error")); } });
    }).on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// StatsBomb competition and season IDs for La Liga
const LALIGA = {
  competition_id: 11,
  seasons: [
    { season_id: 90, name: "2020/2021" },
    { season_id: 42, name: "2019/2020" },
    { season_id: 2, name: "2018/2019" },
  ],
};

const BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";

async function main() {
  console.log("📊 StatsBomb Open Data — La Liga xG Features");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("   Source: github.com/statsbomb/open-data (FREE)");
  console.log("   Competition: La Liga (ID: 11)");
  console.log("   Seasons:", LALIGA.seasons.map(s => s.name).join(", "));
  console.log("");

  // ─── Step 1: Load matches for each season ──────────────────────────
  console.log("📡 Step 1: Loading matches...");

  const allMatches = [];
  for (const season of LALIGA.seasons) {
    await sleep(500);
    const url = `${BASE}/matches/${LALIGA.competition_id}/${season.season_id}.json`;
    console.log(`   Fetching ${season.name}...`);
    try {
      const matches = await fetchJSON(url);
      allMatches.push(...matches.map(m => ({
        match_id: m.match_id,
        season_name: season.name,
        home_team: m.home_team.home_team_name,
        away_team: m.away_team.away_team_name,
        home_score: m.home_score,
        away_score: m.away_score,
        match_date: m.match_date,
      })));
      console.log(`   ✅ ${matches.length} matches`);
    } catch (err) {
      console.log(`   ❌ ${season.name}: ${err.message}`);
    }
  }
  console.log(`   Total: ${allMatches.length} matches\n`);

  // ─── Step 2: Fetch event data (shots, key passes, xG) ──────────────
  console.log("📡 Step 2: Fetching event data (xG, shots, key passes)...");

  // StatsBomb stores events in /events/{match_id}.json
  // Each event has: type, sub_type, xG, player, team, minute, location, etc.

  const teamXG = {}; // team -> aggregated xG stats
  const teamShots = {}; // team -> shot patterns
  const processed = 0;
  const errors = [];

  // Process matches in batches (rate limit to avoid GitHub throttling)
  for (let i = 0; i < allMatches.length; i++) {
    const match = allMatches[i];

    if (i % 100 === 0) console.log(`   Processing match ${i + 1}/${allMatches.length}...`);

    try {
      await sleep(300); // Rate limit GitHub
      const url = `${BASE}/events/${match.match_id}.json`;
      const events = await fetchJSON(url);

      // Process events for home team
      const homeEvents = events.filter(e => e.team.name === match.home_team);
      const awayEvents = events.filter(e => e.team.name === match.away_team);

      // Extract xG from shots
      const homeShots = homeEvents.filter(e => e.type.name === "Shot" && e.shot?.statsbomb?.xg);
      const awayShots = awayEvents.filter(e => e.type.name === "Shot" && e.shot?.statsbomb?.xg);

      const homeXG = homeShots.reduce((s, e) => s + e.shot.statsbomb.xg, 0);
      const awayXG = awayShots.reduce((s, e) => s + e.shot.statsbomb.xg, 0);

      // Shot quality: big chances (xG > 0.3) vs low-quality
      const homeBigChances = homeShots.filter(e => e.shot.statsbomb.xg > 0.3).length;
      const awayBigChances = awayShots.filter(e => e.shot.statsbomb.xg > 0.3).length;

      // Key passes (shot assists)
      const homeKeyPasses = homeEvents.filter(e => e.type.name === "Pass" && e.pass?.outcome === "Complete" && e.pass?.end_location && e.pass?.shot_assist);
      const awayKeyPasses = awayEvents.filter(e => e.type.name === "Pass" && e.pass?.outcome === "Complete" && e.pass?.end_location && e.pass?.shot_assist);

      // Store per team per match
      for (const [team, xg, shots, bigChances, keyPasses, isHome] of [
        [match.home_team, homeXG, homeShots.length, homeBigChances, homeKeyPasses.length, true],
        [match.away_team, awayXG, awayShots.length, awayBigChances, awayKeyPasses.length, false],
      ]) {
        if (!teamXG[team]) teamXG[team] = [];
        teamXG[team].push({
          xG: xg,
          shots: shots,
          bigChances: bigChances,
          keyPasses: keyPasses,
          goals: isHome ? match.home_score : match.away_score,
          isHome,
          date: match.match_date,
        });
      }
    } catch (err) {
      errors.push({ match_id: match.match_id, error: err.message });
    }
  }

  console.log(`   ✅ Processed ${allMatches.length - errors.length} matches (${errors.length} errors)`);
  console.log(`   Teams with xG data: ${Object.keys(teamXG).length}\n`);

  // ─── Step 3: Compute aggregated features per team ──────────────────
  console.log("🔧 Step 3: Computing team xG features...");

  const teamFeatures = {};
  for (const [team, matches] of Object.entries(teamXG)) {
    const recent = matches.slice(-15); // Last 15 matches
    const homeMatches = recent.filter(m => m.isHome);
    const awayMatches = recent.filter(m => !m.isHome);

    teamFeatures[team] = {
      // Overall xG
      avgXG: recent.reduce((s, m) => s + m.xG, 0) / recent.length,
      avgShots: recent.reduce((s, m) => s + m.shots, 0) / recent.length,
      avgBigChances: recent.reduce((s, m) => s + m.bigChances, 0) / recent.length,
      avgKeyPasses: recent.reduce((s, m) => s + m.keyPasses, 0) / recent.length,

      // Home-specific
      homeAvgXG: homeMatches.length > 0 ? homeMatches.reduce((s, m) => s + m.xG, 0) / homeMatches.length : 1.3,
      homeAvgShots: homeMatches.length > 0 ? homeMatches.reduce((s, m) => s + m.shots, 0) / homeMatches.length : 12,
      homeConversionRate: homeMatches.length > 0 ?
        homeMatches.filter(m => m.goals > 0).length / homeMatches.length : 0.45,

      // Away-specific
      awayAvgXG: awayMatches.length > 0 ? awayMatches.reduce((s, m) => s + m.xG, 0) / awayMatches.length : 1.0,
      awayAvgShots: awayMatches.length > 0 ? awayMatches.reduce((s, m) => s + m.shots, 0) / awayMatches.length : 10,
      awayConversionRate: awayMatches.length > 0 ?
        awayMatches.filter(m => m.goals > 0).length / awayMatches.length : 0.40,

      // xG efficiency (goals vs xG — over/underperformance)
      xGEfficiency: recent.length > 0 ?
        recent.reduce((s, m) => s + m.goals, 0) / Math.max(0.1, recent.reduce((s, m) => s + m.xG, 0)) : 1.0,

      // xG differential (quality measure)
      avgXGDiff: recent.length > 0 ?
        recent.reduce((s, m) => s + m.xG, 0) / recent.length - (recent.reduce((s, m) => s + (m.isHome ? 0 : 0), 0) / recent.length) : 0,

      sampleSize: recent.length,
    };
  }

  // ─── Step 4: Store in Supabase ─────────────────────────────────────
  console.log("💾 Step 4: Storing xG features in Supabase...");

  // Create xg_features table if it doesn't exist
  // We'll store as a JSON column on team_strengths or as a separate table

  let stored = 0;
  for (const [team, features] of Object.entries(teamFeatures)) {
    // Find matching team in our database
    const { data: dbTeams } = await supabase
      .from("teams")
      .select("id, canonical_name")
      .ilike("canonical_name", `%${team}%`)
      .limit(1);

    if (dbTeams && dbTeams.length > 0) {
      const { error } = await supabase.from("team_strengths").upsert({
        team_id: dbTeams[0].id,
        xg_features: features,
        updated_at: new Date().toISOString(),
      }, { onConflict: "team_id" });

      if (!error) {
        stored++;
        process.stdout.write(`  ✅ ${dbTeams[0].canonical_name}\n`);
      } else {
        // Try update instead
        const { error: e2 } = await supabase.from("team_strengths")
          .update({ xg_features: features, updated_at: new Date().toISOString() })
          .eq("team_id", dbTeams[0].id);
        if (!e2) stored++;
      }
    }
  }

  // ─── Step 5: Summary ───────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Summary");
  console.log(`   Matches analyzed:     ${allMatches.length - errors.length}`);
  console.log(`   Teams with xG data:   ${Object.keys(teamFeatures).length}`);
  console.log(`   Teams stored:         ${stored}`);
  console.log(`   Errors:               ${errors.length}`);
  console.log(`\n   Top 5 teams by avg xG:`);
  const sorted = Object.entries(teamFeatures).sort((a, b) => b[1].avgXG - a[1].avgXG).slice(0, 5);
  for (const [team, f] of sorted) {
    console.log(`     ${team}: xG ${f.avgXG.toFixed(2)} | Shots ${f.avgShots.toFixed(1)} | Key passes ${f.avgKeyPasses.toFixed(1)}`);
  }
  console.log(`${"━".repeat(60)}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
