#!/usr/bin/env node

/**
 * StatsBomb xG Data Collector — Multi-League
 * 
 * Downloads free StatsBomb open data for La Liga, Premier League,
 * Bundesliga, and Serie A (all available seasons).
 * Extracts xG, shots, key passes per team per league.
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

// All available competitions and seasons from StatsBomb Open Data
const COMPETITIONS = [
  {
    name: "La Liga",
    country: "Spain",
    id: 11,
    seasons: [
      { id: 90, name: "2020/2021" },
      { id: 42, name: "2019/2020" },
      { id: 4,  name: "2018/2019" },
      { id: 1,  name: "2017/2018" },
      { id: 2,  name: "2016/2017" },
      { id: 27, name: "2015/2016" },
      { id: 26, name: "2014/2015" },
      { id: 25, name: "2013/2014" },
      { id: 24, name: "2012/2013" },
      { id: 23, name: "2011/2012" },
      { id: 22, name: "2010/2011" },
      { id: 21, name: "2009/2010" },
      { id: 41, name: "2008/2009" },
      { id: 40, name: "2007/2008" },
      { id: 39, name: "2006/2007" },
      { id: 38, name: "2005/2006" },
      { id: 37, name: "2004/2005" },
    ],
  },
  {
    name: "Premier League",
    country: "England",
    id: 2,
    seasons: [
      { id: 27, name: "2015/2016" },
      { id: 44, name: "2003/2004" },
    ],
  },
  {
    name: "Bundesliga",
    country: "Germany",
    id: 9,
    seasons: [
      { id: 281, name: "2023/2024" },
      { id: 27, name: "2015/2016" },
    ],
  },
  {
    name: "Serie A",
    country: "Italy",
    id: 12,
    seasons: [
      { id: 27, name: "2015/2016" },
    ],
  },
  // Bonus: Ligue 1 and MLS
  {
    name: "Ligue 1",
    country: "France",
    id: 7,
    seasons: [
      { id: 235, name: "2022/2023" },
      { id: 108, name: "2021/2022" },
      { id: 27, name: "2015/2016" },
    ],
  },
  {
    name: "MLS",
    country: "USA",
    id: 44,
    seasons: [
      { id: 107, name: "2023" },
    ],
  },
  {
    name: "Champions League",
    country: "Europe",
    id: 16,
    seasons: [
      { id: 4,  name: "2018/2019" },
      { id: 1,  name: "2017/2018" },
      { id: 2,  name: "2016/2017" },
      { id: 27, name: "2015/2016" },
      { id: 26, name: "2014/2015" },
      { id: 25, name: "2013/2014" },
      { id: 24, name: "2012/2013" },
      { id: 23, name: "2011/2012" },
      { id: 22, name: "2010/2011" },
      { id: 21, name: "2009/2010" },
    ],
  },
];
const BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";

async function main() {
  console.log("📊 StatsBomb Open Data — Multi-League xG Collection");
  console.log("━".repeat(60));
  console.log("   Leagues: La Liga, Premier League, Bundesliga, Serie A, Ligue 1, MLS, UCL");
  console.log("");

  // Step 1: Load matches from all competitions
  console.log("📡 Step 1: Loading match lists from all competitions...");
  const allMatches = [];
  const leagueMatchCounts = {};
  
  for (const comp of COMPETITIONS) {
    for (const season of comp.seasons) {
      await sleep(400);
      process.stdout.write(`   ${comp.name} ${season.name}... `);
      try {
        const matches = await fetchJSON(`${BASE}/matches/${comp.id}/${season.id}.json`);
        for (const m of matches) {
          allMatches.push({
            id: m.match_id,
            competition: comp.name,
            country: comp.country,
            season: season.name,
            home: m.home_team.home_team_name,
            away: m.away_team.away_team_name,
            hs: m.home_score,
            as: m.away_score,
            date: m.match_date,
          });
        }
        if (!leagueMatchCounts[comp.name]) leagueMatchCounts[comp.name] = 0;
        leagueMatchCounts[comp.name] += matches.length;
        console.log(`${matches.length} matches`);
      } catch (err) {
        console.log(`error: ${err.message}`);
      }
    }
  }
  console.log(`\n   Total: ${allMatches.length} matches across ${Object.keys(leagueMatchCounts).length} leagues`);
  for (const [league, count] of Object.entries(leagueMatchCounts).sort((a,b) => b[1]-a[1])) {
    console.log(`     ${league.padEnd(20)} ${count} matches`);
  }

  // Step 2: Fetch events and extract xG
  console.log(`\n📡 Step 2: Fetching event data for ${allMatches.length} matches...`);
  console.log("   (downloading ~500KB per match, this may take several minutes)\n");

  const teamXG = {};  // teamName → [{xG, goals, shots, ...}]
  const leagueXG = {};  // league → [{xG, goals, shots, ...}]
  let done = 0, errs = 0;

  for (let i = 0; i < allMatches.length; i++) {
    const m = allMatches[i];
    if (i > 0 && i % 50 === 0) process.stdout.write(`   ${i}/${allMatches.length} (${done} ok, ${errs} err)\n`);

    try {
      await sleep(200);
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

        const record = {
          xG: totalXG, goals, shots: shots.length,
          onTarget, bigChances, halfChances,
          keyPasses, carries,
          isHome: side === "home",
          date: m.date, season: m.season,
          competition: m.competition,
        };

        if (!teamXG[teamName]) teamXG[teamName] = [];
        teamXG[teamName].push(record);

        // League-level aggregation
        if (!leagueXG[m.competition]) leagueXG[m.competition] = [];
        leagueXG[m.competition].push(record);
      }
      done++;
    } catch (err) {
      errs++;
    }
  }

  console.log(`\n   ✅ ${done} matches processed, ${errs} errors`);
  console.log(`   Teams with xG data: ${Object.keys(teamXG).length}`);
  console.log(`   Leagues with xG data: ${Object.keys(leagueXG).length}`);

  // Step 3: Compute per-team features
  console.log("\n🔧 Step 3: Computing team features...");

  const features = {};
  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((s, m) => s + fn(m), 0) / arr.length : 0;

  for (const [team, matches] of Object.entries(teamXG)) {
    const r15 = matches.slice(-15);
    const home = r15.filter(m => m.isHome);
    const away = r15.filter(m => !m.isHome);

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

  // Step 4: Compute per-league averages (for Poisson lambda priors)
  console.log("\n🔧 Step 4: Computing league-level xG averages...");

  const leagueFeatures = {};
  for (const [league, matches] of Object.entries(leagueXG)) {
    const homeMatches = matches.filter(m => m.isHome);
    const awayMatches = matches.filter(m => !m.isHome);
    
    leagueFeatures[league] = {
      avg_home_xg: avg(homeMatches, m => m.xG),
      avg_away_xg: avg(awayMatches, m => m.xG),
      avg_home_goals: avg(homeMatches, m => m.goals),
      avg_away_goals: avg(awayMatches, m => m.goals),
      avg_total_goals: avg(matches, m => m.goals),
      avg_shots_per_match: avg(matches, m => m.shots),
      avg_xg_per_match: avg(matches, m => m.xG),
      matches_analyzed: matches.length,
      // Poisson lambda priors (key for the prediction engine)
      poisson_home_lambda: avg(homeMatches, m => m.goals),
      poisson_away_lambda: avg(awayMatches, m => m.goals),
    };
    
    const lf = leagueFeatures[league];
    console.log(`   ${league.padEnd(20)} Home xG: ${lf.avg_home_xg.toFixed(2)}  Away xG: ${lf.avg_away_xg.toFixed(2)}  Goals: ${lf.avg_total_goals.toFixed(2)}  (${lf.matches_analyzed} matches)`);
  }

  // Print top teams
  const sorted = Object.entries(features).sort((a, b) => b[1].avg_xg - a[1].avg_xg);
  console.log("\n   Top 15 teams by avg xG:");
  for (const [team, f] of sorted.slice(0, 15)) {
    console.log(`     ${team.padEnd(30)} xG: ${f.avg_xg.toFixed(2)}  Shots: ${f.avg_shots.toFixed(1)}  Goals: ${f.avg_goals.toFixed(1)}  (${f.total_matches} matches)`);
  }

  // Save to file
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const output = {
    source: "StatsBomb Open Data (github.com/statsbomb/open-data)",
    competitions: COMPETITIONS.map(c => ({ name: c.name, country: c.country, id: c.id, seasons: c.seasons.length })),
    matches_processed: done,
    errors: errs,
    teams: Object.keys(features).length,
    leagues: Object.keys(leagueFeatures).length,
    generated_at: new Date().toISOString(),
    features,
    league_features: leagueFeatures,
  };
  
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  // Also save to public/ for client-side access
  const publicOutput = path.join(__dirname, "..", "public", "data", "statsbomb-xg.json");
  fs.mkdirSync(path.dirname(publicOutput), { recursive: true });
  fs.writeFileSync(publicOutput, JSON.stringify(output, null, 2));

  console.log(`\n💾 Saved to ${OUTPUT}`);
  console.log(`   ${Object.keys(features).length} team xG profiles across ${Object.keys(leagueFeatures).length} leagues\n`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
