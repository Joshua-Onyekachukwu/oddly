#!/usr/bin/env node

/**
 * StatsBomb xG Data Collector — Local Storage
 * 
 * Downloads free StatsBomb open data for La Liga (3 seasons).
 * Extracts xG, shots, key passes per team.
 * Saves to data/statsbomb-xg.json for use by prediction engine.
 * 
 * Usage: node scripts/collect-statsbomb-xg.js
 * Output: data/statsbomb-xg.json
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT = path.join(DATA_DIR, "statsbomb-xg.json");

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), 60000);
    https.get(url, { headers: { "User-Agent": "ODDLY-StatsBomb/1.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        clearTimeout(timeout);
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { clearTimeout(timeout); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => { clearTimeout(timeout); try { resolve(JSON.parse(data)); } catch { reject(new Error("Parse error")); } });
    }).on("error", e => { clearTimeout(timeout); reject(e); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEASONS = [
  { id: 90, name: "2020/2021" },
  { id: 42, name: "2019/2020" },
  { id: 2,  name: "2018/2019" },
];
const BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";

async function main() {
  console.log("📊 StatsBomb Open Data — La Liga xG Collection");
  console.log("━".repeat(50));

  // Step 1: Load matches
  console.log("\n📡 Step 1: Loading match lists...");
  const allMatches = [];
  for (const season of SEASONS) {
    await sleep(400);
    process.stdout.write(`   ${season.name}... `);
    try {
      const matches = await fetchJSON(`${BASE}/matches/11/${season.id}.json`);
      for (const m of matches) {
        allMatches.push({
          id: m.match_id,
          season: season.name,
          home: m.home_team.home_team_name,
          away: m.away_team.away_team_name,
          hs: m.home_score,
          as: m.away_score,
          date: m.match_date,
        });
      }
      console.log(`${matches.length} matches`);
    } catch (err) {
      console.log(`error: ${err.message}`);
    }
  }
  console.log(`   Total: ${allMatches.length} matches`);

  // Step 2: Fetch events and extract xG
  console.log(`\n📡 Step 2: Fetching event data for ${allMatches.length} matches...`);
  console.log("   (downloading ~500KB per match, ~2-3 min total)\n");

  const teamXG = {};
  let done = 0, errs = 0;

  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    if (i > 0 && i % 20 === 0) process.stdout.write(`   ${i}/${allMatches.length}...\n`);

    try {
      await sleep(250);
      const events = await fetchJSON(`${BASE}/events/${m.id}.json`);

      for (const side of ["home", "away"]) {
        const teamName = side === "home" ? m.home : m.away;
        const teamEvents = events.filter(e => e.team.name === teamName);
        const goals = side === "home" ? m.hs : m.as;

        // Shots with xG
        const shots = teamEvents.filter(e => e.type.name === "Shot" && e.shot?.statsbomb_xg !== undefined);
        const totalXG = shots.reduce((s, e) => s + e.shot.statsbomb_xg, 0);
        const bigChances = shots.filter(e => e.shot.statsbomb_xg > 0.3).length;
        const halfChances = shots.filter(e => e.shot.statsbomb_xg > 0.15 && e.shot.statsbomb_xg <= 0.3).length;
        const onTarget = shots.filter(e => ["Saved", "Goal"].includes(e.shot.outcome?.name)).length;

        // Key passes
        const keyPasses = teamEvents.filter(e => e.type.name === "Pass" && e.pass?.shot_assist).length;

        // Dangerous carries into final third
        const carries = teamEvents.filter(e =>
          e.type.name === "Carry" && e.location && e.location[0] > 80
        ).length;

        if (!teamXG[teamName]) teamXG[teamName] = [];
        teamXG[teamName].push({
          xG: totalXG, goals, shots: shots.length,
          onTarget, bigChances, halfChances,
          keyPasses, carries,
          isHome: side === "home",
          date: m.date, season: m.season,
        });
      }
      done++;
    } catch (err) {
      errs++;
    }
  }

  console.log(`   ✅ ${done} matches processed, ${errs} errors`);
  console.log(`   Teams with xG data: ${Object.keys(teamXG).length}`);

  // Step 3: Compute aggregated features
  console.log("\n🔧 Step 3: Computing team features...");

  const features = {};
  for (const [team, matches] of Object.entries(teamXG)) {
    const r15 = matches.slice(-15);
    const home = r15.filter(m => m.isHome);
    const away = r15.filter(m => !m.isHome);
    const avg = (arr, fn) => arr.length > 0 ? arr.reduce((s, m) => s + fn(m), 0) / arr.length : 0;

    features[team] = {
      avg_xg: avg(r15, m => m.xG),
      avg_goals: avg(r15, m => m.goals),
      avg_shots: avg(r15, m => m.shots),
      avg_on_target: avg(r15, m => m.onTarget),
      avg_big_chances: avg(r15, m => m.bigChances),
      avg_key_passes: avg(r15, m => m.keyPasses),
      avg_carries: avg(r15, m => m.carries),
      home_avg_xg: avg(home, m => m.xG),
      home_avg_goals: avg(home, m => m.goals),
      home_avg_shots: avg(home, m => m.shots),
      home_xg_eff: avg(home, m => m.goals) / Math.max(0.1, avg(home, m => m.xG)),
      away_avg_xg: avg(away, m => m.xG),
      away_avg_goals: avg(away, m => m.goals),
      away_avg_shots: avg(away, m => m.shots),
      away_xg_eff: avg(away, m => m.goals) / Math.max(0.1, avg(away, m => m.xG)),
      xg_per_shot: avg(r15, m => m.shots) > 0 ? avg(r15, m => m.xG) / avg(r15, m => m.shots) : 0.1,
      big_chance_rate: avg(r15, m => m.shots) > 0 ? avg(r15, m => m.bigChances) / avg(r15, m => m.shots) : 0,
      conversion_rate: avg(r15, m => m.shots) > 0 ? avg(r15, m => m.goals) / avg(r15, m => m.shots) : 0.1,
      sample_size: r15.length,
      total_matches: matches.length,
    };
  }

  // Print summary
  const sorted = Object.entries(features).sort((a, b) => b[1].avg_xg - a[1].avg_xg);
  console.log("\n   Top 10 teams by avg xG:");
  for (const [team, f] of sorted.slice(0, 10)) {
    console.log(`     ${team.padEnd(25)} xG: ${f.avg_xg.toFixed(2)}  Shots: ${f.avg_shots.toFixed(1)}  Goals: ${f.avg_goals.toFixed(1)}`);
  }

  // Save to file
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify({
    source: "StatsBomb Open Data (github.com/statsbomb/open-data)",
    competition: "La Liga",
    seasons: SEASONS.map(s => s.name),
    matches_processed: done,
    errors: errs,
    teams: Object.keys(features).length,
    generated_at: new Date().toISOString(),
    features,
  }, null, 2));

  console.log(`\n💾 Saved to ${OUTPUT}`);
  console.log(`   ${Object.keys(features).length} team xG profiles ready\n`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
