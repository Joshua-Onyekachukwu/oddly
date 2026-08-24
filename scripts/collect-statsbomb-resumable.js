#!/usr/bin/env node

/**
 * StatsBomb xG Resumable Collector
 * 
 * Downloads xG data incrementally, saving progress after each league.
 * Can be restarted and will skip already-processed seasons.
 * 
 * Usage: node scripts/collect-statsbomb-resumable.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "statsbomb-progress.json");
const OUTPUT = path.join(DATA_DIR, "statsbomb-xg.json");
const PUBLIC_OUTPUT = path.join(__dirname, "..", "public", "data", "statsbomb-xg.json");

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 15000);
    https.get(url, { headers: { "User-Agent": "ODDLY-StatsBomb/1.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        clearTimeout(t);
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { clearTimeout(t); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => { clearTimeout(t); try { resolve(JSON.parse(d)); } catch { reject(new Error("Parse error")); } });
    }).on("error", e => { clearTimeout(t); reject(e); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master/data";

const SEASONS = [
  // Full seasons (highest value)
  { comp: "La Liga", compId: 11, seasonId: 27, name: "2015/2016", country: "Spain" },
  { comp: "Premier League", compId: 2, seasonId: 27, name: "2015/2016", country: "England" },
  { comp: "Serie A", compId: 12, seasonId: 27, name: "2015/2016", country: "Italy" },
  { comp: "Ligue 1", compId: 7, seasonId: 27, name: "2015/2016", country: "France" },
  // La Liga partial
  { comp: "La Liga", compId: 11, seasonId: 90, name: "2020/2021", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 42, name: "2019/2020", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 4, name: "2018/2019", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 1, name: "2017/2018", country: "Spain" },
  { comp: "La Liga", compId: 11, seasonId: 2, name: "2016/2017", country: "Spain" },
  // Bundesliga
  { comp: "Bundesliga", compId: 9, seasonId: 281, name: "2023/2024", country: "Germany" },
  { comp: "Bundesliga", compId: 9, seasonId: 27, name: "2015/2016", country: "Germany" },
  // Ligue 1 partial
  { comp: "Ligue 1", compId: 7, seasonId: 235, name: "2022/2023", country: "France" },
  { comp: "Ligue 1", compId: 7, seasonId: 108, name: "2021/2022", country: "France" },
  // Other
  { comp: "Premier League", compId: 2, seasonId: 44, name: "2003/2004", country: "England" },
  { comp: "MLS", compId: 44, seasonId: 107, name: "2023", country: "USA" },
];

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  } catch {
    return { completedSeasons: [], teamXG: {}, leagueXG: {} };
  }
}

function saveProgress(progress) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress));
}

function saveOutput(progress) {
  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((s, m) => s + fn(m), 0) / arr.length : 0;
  
  const features = {};
  for (const [team, matches] of Object.entries(progress.teamXG)) {
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
      avg_carries: avg(r15, m => m.carries || 0),
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
  
  const leagueFeatures = {};
  for (const [league, matches] of Object.entries(progress.leagueXG)) {
    const hm = matches.filter(m => m.isHome);
    const am = matches.filter(m => !m.isHome);
    leagueFeatures[league] = {
      avg_home_xg: avg(hm, m => m.xG),
      avg_away_xg: avg(am, m => m.xG),
      avg_home_goals: avg(hm, m => m.goals),
      avg_away_goals: avg(am, m => m.goals),
      avg_total_goals: avg(matches, m => m.goals),
      avg_shots_per_match: avg(matches, m => m.shots),
      avg_xg_per_match: avg(matches, m => m.xG),
      matches_analyzed: matches.length,
      poisson_home_lambda: avg(hm, m => m.goals),
      poisson_away_lambda: avg(am, m => m.goals),
    };
  }
  
  const output = {
    source: "StatsBomb Open Data (github.com/statsbomb/open-data)",
    competitions: [...new Set(SEASONS.map(s => s.comp))],
    matches_processed: Object.values(progress.teamXG).reduce((s, m) => s + m.length, 0) / 2,
    teams: Object.keys(features).length,
    leagues: Object.keys(leagueFeatures).length,
    generated_at: new Date().toISOString(),
    features,
    league_features: leagueFeatures,
  };
  
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  fs.mkdirSync(path.dirname(PUBLIC_OUTPUT), { recursive: true });
  fs.writeFileSync(PUBLIC_OUTPUT, JSON.stringify(output, null, 2));
}

async function main() {
  console.log("📊 StatsBomb xG Resumable Collector");
  console.log("━".repeat(50));
  
  const progress = loadProgress();
  const completed = new Set(progress.completedSeasons);
  
  let totalNew = 0;
  
  for (const season of SEASONS) {
    const key = `${season.compId}/${season.seasonId}`;
    if (completed.has(key)) {
      console.log(`   ⏭️  ${season.comp} ${season.name} — already done`);
      continue;
    }
    
    await sleep(200);
    process.stdout.write(`   📡 ${season.comp} ${season.name}... `);
    
    try {
      const matches = await fetchJSON(`${BASE}/matches/${season.compId}/${season.seasonId}.json`);
      let ok = 0;
      
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        try {
          await sleep(50);
          const events = await fetchJSON(`${BASE}/events/${m.match_id}.json`);
          
          for (const side of ["home", "away"]) {
            const teamName = side === "home" ? m.home_team.home_team_name : m.away_team.away_team_name;
            const teamEv = events.filter(e => e.team.name === teamName);
            const goals = side === "home" ? m.home_score : m.away_score;
            const shots = teamEv.filter(e => e.type.name === "Shot" && e.shot?.statsbomb_xg !== undefined);
            const xG = shots.reduce((s, e) => s + e.shot.statsbomb_xg, 0);
            const bc = shots.filter(e => e.shot.statsbomb_xg > 0.3).length;
            const hc = shots.filter(e => e.shot.statsbomb_xg > 0.15 && e.shot.statsbomb_xg <= 0.3).length;
            const ot = shots.filter(e => ["Saved", "Goal"].includes(e.shot.outcome?.name)).length;
            const kp = teamEv.filter(e => e.type.name === "Pass" && e.pass?.shot_assist).length;
            
            const rec = {
              xG, goals, shots: shots.length,
              onTarget: ot, bigChances: bc, halfChances: hc,
              keyPasses: kp, carries: 0,
              isHome: side === "home",
              date: m.match_date, season: season.name,
            };
            
            if (!progress.teamXG[teamName]) progress.teamXG[teamName] = [];
            progress.teamXG[teamName].push(rec);
            
            if (!progress.leagueXG[season.comp]) progress.leagueXG[season.comp] = [];
            progress.leagueXG[season.comp].push(rec);
          }
          ok++;
        } catch {}
      }
      
      totalNew += ok;
      completed.add(key);
      progress.completedSeasons = [...completed];
      
      console.log(`${ok}/${matches.length} matches`);
      
      // Save progress and output after each season
      saveProgress(progress);
      saveOutput(progress);
      
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
  }
  
  // Final summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Collection Complete!");
  console.log(`   Teams: ${Object.keys(progress.teamXG).length}`);
  console.log(`   Leagues: ${Object.keys(progress.leagueXG).length}`);
  
  const avg = (arr, fn) => arr.length > 0 ? arr.reduce((s, m) => s + fn(m), 0) / arr.length : 0;
  for (const [league, matches] of Object.entries(progress.leagueXG)) {
    const hm = matches.filter(m => m.isHome);
    const am = matches.filter(m => !m.isHome);
    console.log(`   ${league.padEnd(20)} Home xG: ${avg(hm, m => m.xG).toFixed(2)}  Away xG: ${avg(am, m => m.xG).toFixed(2)}  (${matches.length} team-matches)`);
  }
  
  console.log(`\n💾 Saved to ${OUTPUT}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
