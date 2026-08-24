#!/usr/bin/env node

/**
 * StatsBomb xG Fast Collector — Prioritized by data value
 * 
 * Processes full seasons (380 matches) first, then partial seasons.
 * Uses minimal delays to speed up collection.
 * 
 * Usage: node scripts/collect-statsbomb-fast.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT = path.join(DATA_DIR, "statsbomb-xg.json");

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timeout")), 30000);
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

// Full seasons (380 matches) — highest value
const FULL_SEASONS = [
  { comp: "La Liga", compId: 11, seasonId: 27, seasonName: "2015/2016", country: "Spain" },
  { comp: "Premier League", compId: 2, seasonId: 27, seasonName: "2015/2016", country: "England" },
  { comp: "Serie A", compId: 12, seasonId: 27, seasonName: "2015/2016", country: "Italy" },
  { comp: "Ligue 1", compId: 7, seasonId: 27, seasonName: "2015/2016", country: "France" },
];

// Partial seasons (30-40 matches) — supplementary
const PARTIAL_SEASONS = [
  // La Liga partial
  { comp: "La Liga", compId: 11, seasonId: 90, seasonName: "2020/2021", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 42, seasonName: "2019/2020", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 4, seasonName: "2018/2019", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 1, seasonName: "2017/2018", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 2, seasonName: "2016/2017", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 26, seasonName: "2014/2015", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 25, seasonName: "2013/2014", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 24, seasonName: "2012/2013", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 23, seasonName: "2011/2012", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 22, seasonName: "2010/2011", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 21, seasonName: "2009/2010", country: "Spain" },
  // Bundesliga
  { comp: "Bundesliga", compId: 9, seasonId: 281, seasonName: "2023/2024", country: "Germany" },
  { comp: "Bundesliga", compId: 9, seasonId: 27, seasonName: "2015/2016", country: "Germany" },
  // Ligue 1 partial
  { comp: "Ligue 1", compId: 7, seasonId: 235, seasonName: "2022/2023", country: "France" },
  { comp: "Ligue 1", compId: 7, seasonId: 108, seasonName: "2021/2022", country: "France" },
  // Premier League partial
  { comp: "Premier League", compId: 2, seasonId: 44, seasonName: "2003/2004", country: "England" },
  // MLS
  { comp: "MLS", compId: 44, seasonId: 107, seasonName: "2023", country: "USA" },
];

const BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";

async function processSeason(season, teamXG, leagueXG) {
  await sleep(100); // Minimal delay
  process.stdout.write(`   ${season.comp} ${season.seasonName}... `);
  try {
    const matches = await fetchJSON(`${BASE}/matches/${season.compId}/${season.seasonId}.json`);
    console.log(`${matches.length} matches`);
    
    let ok = 0, err = 0;
    for (const m of matches) {
      try {
        await sleep(80); // Fast but respectful
        const events = await fetchJSON(`${BASE}/events/${m.match_id}.json`);
        
        for (const side of ["home", "away"]) {
          const teamName = side === "home" ? m.home_team.home_team_name : m.away_team.away_team_name;
          const teamEvents = events.filter(e => e.team.name === teamName);
          const goals = side === "home" ? m.home_score : m.away_score;
          
          const shots = teamEvents.filter(e => e.type.name === "Shot" && e.shot?.statsbomb_xg !== undefined);
          const totalXG = shots.reduce((s, e) => s + e.shot.statsbomb_xg, 0);
          const bigChances = shots.filter(e => e.shot.statsbomb_xg > 0.3).length;
          const halfChances = shots.filter(e => e.shot.statsbomb_xg > 0.15 && e.shot.statsbomb_xg <= 0.3).length;
          const onTarget = shots.filter(e => ["Saved", "Goal"].includes(e.shot.outcome?.name)).length;
          const keyPasses = teamEvents.filter(e => e.type.name === "Pass" && e.pass?.shot_assist).length;
          const carries = teamEvents.filter(e => e.type.name === "Carry" && e.location && e.location[0] > 80).length;
          
          const record = {
            xG: totalXG, goals, shots: shots.length,
            onTarget, bigChances, halfChances,
            keyPasses, carries,
            isHome: side === "home",
            date: m.match_date, season: season.seasonName,
            competition: season.comp,
          };
          
          if (!teamXG[teamName]) teamXG[teamName] = [];
          teamXG[teamName].push(record);
          
          if (!leagueXG[season.comp]) leagueXG[season.comp] = [];
          leagueXG[season.comp].push(record);
        }
        ok++;
      } catch { err++; }
    }
    return { ok, err };
  } catch (e) {
    console.log(`error: ${e.message}`);
    return { ok: 0, err: 1 };
  }
}

async function main() {
  console.log("📊 StatsBomb xG Fast Collector");
  console.log("━".repeat(50));
  console.log("   Phase 1: Full seasons (4 × 380 = 1,520 matches)");
  console.log("   Phase 2: Partial seasons (663 matches)");
  console.log("");
  
  const teamXG = {};
  const leagueXG = {};
  let totalOk = 0, totalErr = 0;
  
  // Phase 1: Full seasons
  console.log("📡 Phase 1: Full Seasons");
  for (const season of FULL_SEASONS) {
    const r = await processSeason(season, teamXG, leagueXG);
    totalOk += r.ok;
    totalErr += r.err;
  }
  
  console.log(`\n   Phase 1 complete: ${totalOk} matches processed\n`);
  
  // Phase 2: Partial seasons
  console.log("📡 Phase 2: Partial Seasons");
  for (const season of PARTIAL_SEASONS) {
    const r = await processSeason(season, teamXG, leagueXG);
    totalOk += r.ok;
    totalErr += r.err;
  }
  
  console.log(`\n   Total: ${totalOk} matches processed, ${totalErr} errors`);
  console.log(`   Teams with xG data: ${Object.keys(teamXG).length}`);
  
  // Compute features
  console.log("\n🔧 Computing team features...");
  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((s, m) => s + fn(m), 0) / arr.length : 0;
  
  const features = {};
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
  
  // League features
  console.log("\n🔧 Computing league-level xG averages...");
  const leagueFeatures = {};
  for (const [league, matches] of Object.entries(leagueXG)) {
    const homeM = matches.filter(m => m.isHome);
    const awayM = matches.filter(m => !m.isHome);
    
    leagueFeatures[league] = {
      avg_home_xg: avg(homeM, m => m.xG),
      avg_away_xg: avg(awayM, m => m.xG),
      avg_home_goals: avg(homeM, m => m.goals),
      avg_away_goals: avg(awayM, m => m.goals),
      avg_total_goals: avg(matches, m => m.goals),
      avg_shots_per_match: avg(matches, m => m.shots),
      avg_xg_per_match: avg(matches, m => m.xG),
      matches_analyzed: matches.length,
      poisson_home_lambda: avg(homeM, m => m.goals),
      poisson_away_lambda: avg(awayM, m => m.goals),
    };
    
    const lf = leagueFeatures[league];
    console.log(`   ${league.padEnd(20)} Home xG: ${lf.avg_home_xg.toFixed(2)}  Away xG: ${lf.avg_away_xg.toFixed(2)}  Goals: ${lf.avg_total_goals.toFixed(2)}  (${lf.matches_analyzed} matches)`);
  }
  
  // Top teams
  const sorted = Object.entries(features).sort((a, b) => b[1].avg_xg - a[1].avg_xg);
  console.log("\n   Top 15 teams by avg xG:");
  for (const [team, f] of sorted.slice(0, 15)) {
    console.log(`     ${team.padEnd(30)} xG: ${f.avg_xg.toFixed(2)}  Shots: ${f.avg_shots.toFixed(1)}  Goals: ${f.avg_goals.toFixed(1)}  (${f.total_matches} matches)`);
  }
  
  // Save
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const output = {
    source: "StatsBomb Open Data (github.com/statsbomb/open-data)",
    competitions: [...new Set([...FULL_SEASONS, ...PARTIAL_SEASONS].map(s => s.comp))],
    matches_processed: totalOk,
    errors: totalErr,
    teams: Object.keys(features).length,
    leagues: Object.keys(leagueFeatures).length,
    generated_at: new Date().toISOString(),
    features,
    league_features: leagueFeatures,
  };
  
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  const publicOutput = path.join(__dirname, "..", "public", "data", "statsbomb-xg.json");
  fs.mkdirSync(path.dirname(publicOutput), { recursive: true });
  fs.writeFileSync(publicOutput, JSON.stringify(output, null, 2));
  
  console.log(`\n💾 Saved to ${OUTPUT}`);
  console.log(`   ${Object.keys(features).length} team xG profiles across ${Object.keys(leagueFeatures).length} leagues\n`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
