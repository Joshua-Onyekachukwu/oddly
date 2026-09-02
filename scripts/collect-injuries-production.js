#!/usr/bin/env node

/**
 * ODDLY Production Injury Collector
 *
 * Fetches injury/suspension data from:
 *   1. API-Football injuries endpoint (top 5 leagues, current season)
 *   2. Existing local JSON files (premier-injuries.json, injuries-suspensions.json)
 *
 * Stores into player_injury_data (the table ensemble feature-store-loader reads from).
 *
 * Usage: node scripts/collect-injuries-production.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ─── Config ─────────────────────────────────────────────────────────────────

const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
  .split("\n")
  .forEach((l) => {
    if (l.startsWith("#") || !l.includes("=")) return;
    const idx = l.indexOf("=");
    const key = l.substring(0, idx).trim();
    let val = l.substring(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[key] = val;
  });

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const AF_KEY = env.API_FOOTBALL_KEY || "87a7192e40b8af11e5e4c50cc807e7ca";

// API-Football free plan: 10 requests/min, 100/day
const LEAGUES = [
  { name: "Premier League", id: 39, country: "England" },
  { name: "La Liga", id: 140, country: "Spain" },
  { name: "Bundesliga", id: 78, country: "Germany" },
  { name: "Serie A", id: 135, country: "Italy" },
  { name: "Ligue 1", id: 61, country: "France" },
];

// Current season year
const CURRENT_SEASON = new Date().getMonth() >= 7
  ? new Date().getFullYear()
  : new Date().getFullYear() - 1;

// Known key players per team (weight by importance 1-10)
const KEY_PLAYER_WEIGHTS = {
  // Premier League
  "Arsenal": { "Bukayo Saka": 9, "Martin Odegaard": 9, "William Saliba": 8, "Declan Rice": 8, "Gabriel Magalhaes": 7, "Kai Havertz": 7, "Jurrien Timber": 6, "Thomas Partey": 6 },
  "Manchester City": { "Erling Haaland": 10, "Kevin De Bruyne": 9, "Rodri": 9, "Bernardo Silva": 8, "Phil Foden": 8, "Ederson": 7, "John Stones": 7 },
  "Liverpool": { "Mohamed Salah": 9, "Virgil van Dijk": 9, "Trent Alexander-Arnold": 8, "Alisson": 8, "Dominik Szoboszlai": 7, "Alexis Mac Allister": 7 },
  "Manchester United": { "Bruno Fernandes": 9, "Kobbie Mainoo": 7, "Rasmus Hojlund": 7, "Andre Onana": 7 },
  "Chelsea": { "Cole Palmer": 9, "Enzo Fernandez": 8, "Moises Caicedo": 8, "Nicolas Jackson": 7 },
  "Tottenham": { "Son Heung-min": 9, "James Maddison": 8, "Micky van de Ven": 7, "Cristian Romero": 8 },
  "Newcastle": { "Alexander Isak": 9, "Bruno Guimaraes": 8, "Sandro Tonali": 7, "Anthony Gordon": 8 },
  "Aston Villa": { "Ollie Watkins": 8, "Emiliano Martinez": 8, "John McGinn": 7, "Youri Tielemans": 7 },
  "Brighton": { "Kaoru Mitoma": 8, "Danny Welbeck": 6, "Carlos Baleba": 6, "Joao Pedro": 7 },
  "West Ham": { "Lucas Paqueta": 7, "Jarrod Bowen": 7, "Mohammed Kudus": 7 },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function fetchJSON(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers, timeout: 15000 }, (res) => {
        if (res.statusCode === 429) {
          const wait = parseInt(res.headers["retry-after"] || "60");
          console.log(`  ⏳ Rate limited. Waiting ${wait}s...`);
          setTimeout(() => fetchJSON(url, headers).then(resolve).catch(reject), wait * 1000);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("JSON parse error"));
          }
        });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeTeamName(name) {
  // Normalize common API-Football team names to match our fixture data
  const MAP = {
    "Manchester United": "Manchester United",
    "Manchester City": "Manchester City",
    "Tottenham Hotspur": "Tottenham",
    "Tottenham": "Tottenham",
    "West Ham United": "West Ham",
    "Newcastle United": "Newcastle",
    "Wolverhampton Wanderers": "Wolves",
    "Brighton & Hove Albion": "Brighton",
    "Nottingham Forest": "Nottingham Forest",
    "AFC Bournemouth": "Bournemouth",
    "Aston Villa": "Aston Villa",
    "Crystal Palace": "Crystal Palace",
    "Fulham": "Fulham",
    "Everton": "Everton",
    "Brentford": "Brentford",
    "Ipswich Town": "Ipswich",
    "Leicester City": "Leicester",
    "Southampton": "Southampton",
    // La Liga
    "Real Madrid": "Real Madrid",
    "FC Barcelona": "Barcelona",
    "Atletico Madrid": "Atletico Madrid",
    "Athletic Club": "Athletic Bilbao",
    "Real Sociedad": "Real Sociedad",
    "Real Betis": "Real Betis",
    "Villarreal": "Villarreal",
    "Girona": "Girona",
    "Getafe": "Getafe",
    "Sevilla": "Sevilla",
    // Bundesliga
    "Bayer Leverkusen": "Bayer Leverkusen",
    "Bayern Munich": "Bayern Munich",
    "Borussia Dortmund": "Borussia Dortmund",
    "RB Leipzig": "RB Leipzig",
    "VfB Stuttgart": "Stuttgart",
    "Eintracht Frankfurt": "Eintracht Frankfurt",
    "VfL Wolfsburg": "Wolfsburg",
    "SC Freiburg": "Freiburg",
    // Serie A
    "Inter Milan": "Inter Milan",
    "AC Milan": "AC Milan",
    "SSC Napoli": "Napoli",
    "Juventus": "Juventus",
    "AS Roma": "Roma",
    "SS Lazio": "Lazio",
    "Atalanta": "Atalanta",
    "ACF Fiorentina": "Fiorentina",
    // Ligue 1
    "Paris Saint-Germain": "Paris Saint-Germain",
    "Olympique Marseille": "Marseille",
    "Olympique Lyonnais": "Lyon",
    "AS Monaco": "Monaco",
    "OGC Nice": "Nice",
    "Lille": "Lille",
    "RC Lens": "Lens",
    "Stade Brestois": "Brest",
  };
  return MAP[name] || name;
}

function getStatusFromReason(reason) {
  if (!reason) return "injured";
  const r = reason.toLowerCase();
  if (r.includes("suspended") || r.includes("ban") || r.includes("red card")) return "suspended";
  if (r.includes("doubtful") || r.includes("questionable")) return "doubtful";
  if (r.includes("match fitness") || r.includes("lack of match")) return "doubtful";
  return "injured";
}

// ─── Step 1: Fetch from API-Football ────────────────────────────────────────

async function fetchFromAPIFootball() {
  console.log("\n📡 Step 1: Fetching from API-Football...");

  const allInjuries = [];
  let totalFound = 0;

  for (const league of LEAGUES) {
    process.stdout.write(`   ⚽ ${league.name.padEnd(22)}`);

    try {
      const data = await fetchJSON(
        `https://v3.football.api-sports.io/injuries?league=${league.id}&season=${CURRENT_SEASON}`,
        { "x-apisports-key": AF_KEY }
      );

      if (data.errors && Object.keys(data.errors).length > 0) {
        console.log(`Error: ${JSON.stringify(data.errors).substring(0, 80)}`);
        continue;
      }

      const injuries = data.response || [];
      totalFound += injuries.length;

      for (const inj of injuries) {
        const playerName = inj.player?.name || "Unknown";
        const teamName = normalizeTeamName(inj.team?.name || "Unknown");
        const reason = inj.player?.reason || inj.player?.type || "Unknown";
        const status = getStatusFromReason(reason);

        // Get importance weight
        const teamWeights = KEY_PLAYER_WEIGHTS[teamName] || {};
        const importance = teamWeights[playerName] || 5;

        allInjuries.push({
          team_name: teamName,
          player_name: playerName,
          status,
          injury_type: inj.player?.type || reason,
          player_importance: importance,
          source: "api-football",
        });
      }

      console.log(`${injuries.length} injuries`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }

    // Rate limit: free plan = 10 req/min
    await sleep(7000);
  }

  console.log(`   Total from API-Football: ${totalFound}`);
  return allInjuries;
}

// ─── Step 2: Load existing local data ───────────────────────────────────────

function loadLocalInjuries() {
  console.log("\n📂 Step 2: Loading existing local injury data...");

  const localInjuries = [];
  const dataDir = path.join(__dirname, "..", "data");

  // premier-injuries.json (scraped from premierinjuries.com)
  const premierPath = path.join(dataDir, "premier-injuries.json");
  if (fs.existsSync(premierPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(premierPath, "utf8"));
      const injuries = data.injuries || [];
      console.log(`   premier-injuries.json: ${injuries.length} injuries`);

      for (const inj of injuries) {
        const teamName = normalizeTeamName(inj.team_name || "Unknown");
        const teamWeights = KEY_PLAYER_WEIGHTS[teamName] || {};
        const importance = teamWeights[inj.player_name] || 5;

        localInjuries.push({
          team_name: teamName,
          player_name: inj.player_name,
          status: inj.status || "injured",
          injury_type: inj.injury_type || "Unknown",
          player_importance: importance,
          source: "premierinjuries.com",
        });
      }
    } catch (e) {
      console.log(`   ⚠️  premier-injuries.json: ${e.message}`);
    }
  }

  // save-injury-data.js hardcoded data (if exists)
  const saveInjPath = path.join(__dirname, "save-injury-data.js");
  if (fs.existsSync(saveInjPath)) {
    const content = fs.readFileSync(saveInjPath, "utf8");
    // Extract inline injury data
    const match = content.match(/const\s+injuries\s*=\s*\[([\s\S]*?)\];/);
    if (match) {
      try {
        const arr = JSON.parse(`[${match[1]}]`);
        console.log(`   save-injury-data.js: ${arr.length} inline injuries`);
        for (const inj of arr) {
          const status = inj.s || "injured";
          localInjuries.push({
            team_name: "Unknown", // Inline data doesn't have team
            player_name: inj.p,
            status: status.includes("doubtful") ? "doubtful" : status.includes("suspend") ? "suspended" : "injured",
            injury_type: inj.r || "Unknown",
            player_importance: 5,
            source: "manual",
          });
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  // injuries-suspensions.json (API-Football local cache from previous runs)
  const apiCachePath = path.join(dataDir, "injuries-suspensions.json");
  if (fs.existsSync(apiCachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(apiCachePath, "utf8"));
      const injuries = data.injuries || [];
      console.log(`   injuries-suspensions.json: ${injuries.length} injuries`);

      for (const inj of injuries) {
        const teamName = normalizeTeamName(inj.team_name || "Unknown");
        const teamWeights = KEY_PLAYER_WEIGHTS[teamName] || {};
        const importance = teamWeights[inj.player_name] || 5;

        localInjuries.push({
          team_name: teamName,
          player_name: inj.player_name || inj.name,
          status: inj.status || "injured",
          injury_type: inj.injury_type || inj.reason || inj.type || "Unknown",
          player_importance: importance,
          source: inj.source || "local-cache",
        });
      }
    } catch (e) {
      console.log(`   ⚠️  injuries-suspensions.json: ${e.message}`);
    }
  }

  console.log(`   Total from local files: ${localInjuries.length}`);
  return localInjuries;
}

// ─── Step 3: Merge & deduplicate ────────────────────────────────────────────

function mergeInjuries(apiInjuries, localInjuries) {
  console.log("\n🔀 Step 3: Merging & deduplicating...");

  const byPlayer = new Map();

  // API-Football takes priority (more recent)
  for (const inj of apiInjuries) {
    const key = `${inj.team_name}|${inj.player_name}`;
    byPlayer.set(key, inj);
  }

  // Add local data where API didn't have it
  let added = 0;
  for (const inj of localInjuries) {
    const key = `${inj.team_name}|${inj.player_name}`;
    if (!byPlayer.has(key)) {
      byPlayer.set(key, inj);
      added++;
    } else {
      // Update importance if local has higher (manual knowledge)
      const existing = byPlayer.get(key);
      if (inj.player_importance > existing.player_importance) {
        existing.player_importance = inj.player_importance;
      }
    }
  }

  const merged = Array.from(byPlayer.values());
  console.log(`   API-Football: ${apiInjuries.length}`);
  console.log(`   Local files: ${localInjuries.length}`);
  console.log(`   Added from local: ${added}`);
  console.log(`   Merged total: ${merged.length}`);

  // Group by team
  const byTeam = {};
  for (const inj of merged) {
    if (!byTeam[inj.team_name]) byTeam[inj.team_name] = [];
    byTeam[inj.team_name].push(inj);
  }

  console.log(`   Teams with injuries: ${Object.keys(byTeam).length}`);
  return merged;
}

// ─── Step 4: Store in Supabase ──────────────────────────────────────────────

async function storeInSupabase(injuries) {
  console.log("\n💾 Step 4: Storing in Supabase (player_injury_data)...");

  // First, check table exists
  const { error: checkErr } = await sb
    .from("player_injury_data")
    .select("id")
    .limit(1);

  if (checkErr) {
    console.log(`   ❌ Table doesn't exist: ${checkErr.message}`);
    console.log("   Run the SQL in supabase/create-feature-store.sql first");
    return 0;
  }

  // Clear old data and insert fresh
  console.log("   Clearing old injury records...");
  const { error: delErr } = await sb
    .from("player_injury_data")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (delErr) {
    console.log(`   ⚠️  Delete failed: ${delErr.message} — trying upsert instead`);
  }

  // Batch insert (Supabase allows max 1000 rows per insert)
  let stored = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < injuries.length; i += BATCH_SIZE) {
    const batch = injuries.slice(i, i + BATCH_SIZE).map((inj) => ({
      team_name: inj.team_name,
      player_name: inj.player_name,
      status: inj.status,
      injury_type: inj.injury_type,
      player_importance: inj.player_importance,
      source: inj.source,
      fetched_at: new Date().toISOString(),
    }));

    const { data, error } = await sb.from("player_injury_data").insert(batch);

    if (error) {
      console.log(`   ⚠️  Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`);
      // Try individual inserts for this batch
      for (const row of batch) {
        const { error: singleErr } = await sb.from("player_injury_data").insert(row);
        if (!singleErr) stored++;
      }
    } else {
      stored += batch.length;
    }
  }

  console.log(`   ✅ ${stored} injury records stored in Supabase`);
  return stored;
}

// ─── Step 5: Compute team injury impact ─────────────────────────────────────

function computeTeamImpact(injuries) {
  console.log("\n📊 Step 5: Computing team injury impact scores...");

  const byTeam = {};
  for (const inj of injuries) {
    if (!byTeam[inj.team_name]) byTeam[inj.team_name] = [];
    byTeam[inj.team_name].push(inj);
  }

  console.log("\n   TEAM INJURY IMPACT:");
  console.log("   " + "─".repeat(55));

  const impacts = {};
  for (const [team, teamInjuries] of Object.entries(byTeam).sort(
    (a, b) => b[1].length - a[1].length
  )) {
    const injured = teamInjuries.filter((i) => i.status === "injured");
    const suspended = teamInjuries.filter((i) => i.status === "suspended");
    const doubtful = teamInjuries.filter((i) => i.status === "doubtful");

    // Impact: key players hurt more
    const totalImpact = teamInjuries.reduce(
      (sum, i) => sum + (i.player_importance || 5) * 0.005,
      0
    );

    // Penalty: -0.5% per injured player, -0.3% per doubtful, -0.7% per suspended
    const penalty =
      -(injured.length * 0.005 + doubtful.length * 0.003 + suspended.length * 0.007);

    const keyPlayers = teamInjuries
      .filter((i) => i.player_importance >= 7)
      .map((i) => `${i.player_name}(${i.player_importance})`);

    impacts[team] = {
      total: teamInjuries.length,
      injured: injured.length,
      suspended: suspended.length,
      doubtful: doubtful.length,
      impact: penalty,
      keyPlayers: keyPlayers.join(", "),
    };

    const impStr = (penalty * 100).toFixed(1) + "%";
    console.log(
      `   ${team.padEnd(25)} | ${teamInjuries.length} out | Impact: ${impStr.padStart(6)} | Key: ${keyPlayers.slice(0, 2).join(", ") || "none"}`
    );
  }

  // Also store as local JSON for ensemble-model.js fallback
  const impactPath = path.join(__dirname, "..", "data", "team-injury-impact.json");
  fs.writeFileSync(impactPath, JSON.stringify(impacts, null, 2));
  console.log(`\n   ✅ Team impact saved to ${impactPath}`);

  return impacts;
}

// ─── Step 6: Print report ───────────────────────────────────────────────────

function printReport(injuries, impacts) {
  console.log("\n" + "═".repeat(60));
  console.log("🏥 INJURY COLLECTION REPORT");
  console.log("═".repeat(60));

  // Top 10 most injured teams
  const sorted = Object.entries(impacts)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);

  console.log("\nTOP 10 MOST INJURED TEAMS:");
  console.log("─".repeat(60));
  for (const [team, data] of sorted) {
    const bar = "█".repeat(Math.min(data.total, 30));
    console.log(
      `  ${team.padEnd(25)} ${bar} ${data.total} (${data.injured} injured, ${data.suspended} suspended, ${data.doubtful} doubtful)`
    );
  }

  // Injury types
  const byType = {};
  for (const inj of injuries) {
    const t = (inj.injury_type || "Unknown").toLowerCase();
    byType[t] = (byType[t] || 0) + 1;
  }

  console.log("\nTOP INJURY TYPES:");
  console.log("─".repeat(60));
  Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([type, count]) => {
      console.log(`  ${type.padEnd(30)} | ${count} players`);
    });

  // Stats
  const totalInjured = injuries.filter((i) => i.status === "injured").length;
  const totalSuspended = injuries.filter((i) => i.status === "suspended").length;
  const totalDoubtful = injuries.filter((i) => i.status === "doubtful").length;

  console.log("\nSUMMARY:");
  console.log("─".repeat(60));
  console.log(`  Total injuries:     ${injuries.length}`);
  console.log(`  Injured (out):      ${totalInjured}`);
  console.log(`  Suspended:          ${totalSuspended}`);
  console.log(`  Doubtful:           ${totalDoubtful}`);
  console.log(`  Teams affected:     ${Object.keys(impacts).length}`);
  console.log(
    `  Avg impact/team:    ${(
      Object.values(impacts).reduce((s, i) => s + Math.abs(i.impact), 0) /
      Math.max(Object.keys(impacts).length, 1) *
      100
    ).toFixed(2)}%`
  );

  console.log("\n" + "═".repeat(60));
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("🏥 ODDLY Production Injury Collector");
  console.log("━".repeat(60));
  console.log(`Season: ${CURRENT_SEASON}`);
  console.log(`API-Football key: ${AF_KEY.slice(0, 8)}...`);
  console.log(`Supabase: ${env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 40)}...`);

  // Step 1: API-Football
  const apiInjuries = await fetchFromAPIFootball();

  // Step 2: Local data
  const localInjuries = loadLocalInjuries();

  // Step 3: Merge
  const merged = mergeInjuries(apiInjuries, localInjuries);

  if (merged.length === 0) {
    console.log("\n❌ No injuries found from any source. Check API key and network.");
    return;
  }

  // Step 4: Store in Supabase
  const stored = await storeInSupabase(merged);

  // Step 5: Compute team impact
  const impacts = computeTeamImpact(merged);

  // Step 6: Report
  printReport(merged, impacts);

  console.log("\n✅ Injury collection complete!");
  console.log(`   Data now available to ensemble via feature-store-loader.js`);
  console.log(`   The model will automatically use injury impact in predictions`);
}

main().catch((e) => {
  console.error("❌ Fatal error:", e);
  process.exit(1);
});
