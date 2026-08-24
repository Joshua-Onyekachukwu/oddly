#!/usr/bin/env node
/**
 * ODDLY Injury Scraper — premierinjuries.com
 *
 * Scrapes real injury and suspension data for all 20 Premier League teams.
 * Extracts: player name, team, injury type, return date, condition, status.
 *
 * Also scrapes from football-data.co.uk CSV for historical injury patterns.
 *
 * Usage: node scripts/scrape-injuries.js
 */

const https = require("https");
const http = require("http");
const zlib = require("zlib");
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
    let v = t.slice(i + 1).trim();
    if ((v[0] === '"' && v.slice(-1) === '"') || (v[0] === "'" && v.slice(-1) === "'")) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    proto.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith("http") ? res.headers.location : `https://www.premierinjuries.com${res.headers.location}`;
        return fetchPage(loc).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      let stream;
      if (res.headers["content-encoding"] === "gzip") stream = res.pipe(zlib.createGunzip());
      else if (res.headers["content-encoding"] === "br") stream = res.pipe(zlib.createBrotliDecompress());
      else if (res.headers["content-encoding"] === "deflate") stream = res.pipe(zlib.createInflate());
      else stream = res;
      stream.on("data", c => chunks.push(c));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      stream.on("error", reject);
    }).on("error", reject).on("timeout", function () { this.destroy(); reject(new Error("Timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Parse premierinjuries.com ───────────────────────────────────────

function parsePremierInjuries(html) {
  const injuries = [];

  // Find team positions in HTML
  const teamNames = [
    "Bournemouth", "Arsenal", "Aston Villa", "Brentford", "Brighton",
    "Chelsea", "Crystal Palace", "Everton", "Fulham", "Ipswich",
    "Leicester", "Liverpool", "Man City", "Man United", "Newcastle",
    "Nottingham", "Southampton", "Tottenham", "West Ham", "Wolves",
  ];

  const positions = [];
  for (const team of teamNames) {
    const regex = new RegExp(`>\\s*${team}\\s*<`, "gi");
    const match = regex.exec(html);
    if (match) positions.push({ team, pos: match.index });
  }
  positions.sort((a, b) => a.pos - b.pos);

  // For each team section, extract player rows
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].pos;
    const end = i < positions.length - 1 ? positions[i + 1].pos : html.length;
    const section = html.substring(start, end);

    // Find all td cells
    const cells = [...section.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
    const values = cells.map(c => c[1].replace(/<[^>]+>/g, "").trim());

    // Parse in groups of 7 (header + 6 data columns)
    // Pattern: [header], Player, Reason, Detail, Return, Condition, Status, TRACK, Player, ...
    let currentTeam = positions[i].team;
    let j = 0;

    // Skip header row (first 6 cells)
    while (j < values.length && values[j] === "Player") j++;

    while (j + 5 < values.length) {
      const playerCell = values[j];
      const reasonCell = values[j + 1];
      const detailCell = values[j + 2];
      const returnCell = values[j + 3];
      const conditionCell = values[j + 4];
      const statusCell = values[j + 5];

      // Validate: player cell should start with "Player"
      if (playerCell.startsWith("Player") && reasonCell.startsWith("Reason")) {
        const playerName = playerCell.replace(/^Player/, "").trim();
        const reason = reasonCell.replace(/^Reason/, "").trim();
        const detail = detailCell.replace(/^Further Detail/, "").trim();
        const returnDate = returnCell.replace(/^Potential Return/, "").trim();
        const condition = conditionCell.replace(/^Condition/, "").trim();
        const status = statusCell.replace(/^Status/, "").trim();

        if (playerName && playerName.length > 2) {
          injuries.push({
            player_name: playerName,
            team_name: currentTeam,
            injury_type: reason,
            detail: detail.substring(0, 200),
            expected_return: returnDate,
            condition: condition,
            status: status.toLowerCase().includes("ruled") ? "injured" :
                    status.toLowerCase().includes("suspend") ? "suspended" :
                    status.includes("25%") || status.includes("50%") ? "doubtful" :
                    status.includes("75%") ? "likely" : "questionable",
            availability_pct: status.includes("25%") ? 25 :
                              status.includes("50%") ? 50 :
                              status.includes("75%") ? 75 :
                              status.toLowerCase().includes("ruled") ? 0 : 50,
            source: "premierinjuries.com",
            fetched_at: new Date().toISOString(),
          });
        }
        j += 6; // Skip TRACK cell too
      } else {
        j++;
      }
    }
  }

  return injuries;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("🏥 ODDLY Injury Scraper");
  console.log("━".repeat(50));

  const allInjuries = [];

  // 1. Scrape premierinjuries.com
  console.log("\n📋 Source 1: premierinjuries.com");
  try {
    const html = await fetchPage("https://www.premierinjuries.com/injury-table.php");
    console.log(`   Page size: ${(html.length / 1024).toFixed(0)}KB`);

    const injuries = parsePremierInjuries(html);
    console.log(`   Found ${injuries.length} injuries/suspensions`);

    // Group by team
    const byTeam = {};
    for (const inj of injuries) {
      if (!byTeam[inj.team_name]) byTeam[inj.team_name] = [];
      byTeam[inj.team_name].push(inj);
    }

    for (const [team, teamInjuries] of Object.entries(byTeam)) {
      const ruled = teamInjuries.filter(i => i.status === "injured").length;
      const suspended = teamInjuries.filter(i => i.status === "suspended").length;
      const doubtful = teamInjuries.filter(i => i.status === "doubtful").length;
      console.log(`   ${team.padEnd(20)} ${ruled} injured, ${suspended} suspended, ${doubtful} doubtful`);
    }

    allInjuries.push(...injuries);
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
  }

  // 2. Compute team injury impact scores
  console.log("\n📊 Computing team injury impact scores...");
  const teamImpact = {};

  for (const inj of allInjuries) {
    const team = inj.team_name;
    if (!teamImpact[team]) {
      teamImpact[team] = {
        team_name: team,
        total_injured: 0,
        total_suspended: 0,
        total_doubtful: 0,
        ruled_out: 0,
        impact_score: 0,
        players: [],
      };
    }

    const impact = inj.status === "injured" ? 5 :
                   inj.status === "suspended" ? 4 :
                   inj.status === "doubtful" ? 2 : 1;

    teamImpact[team].total_injured++;
    if (inj.status === "injured") teamImpact[team].ruled_out++;
    if (inj.status === "suspended") teamImpact[team].total_suspended++;
    if (inj.status === "doubtful") teamImpact[team].total_doubtful++;
    teamImpact[team].impact_score += impact;
    teamImpact[team].players.push({
      name: inj.player_name,
      status: inj.status,
      injury: inj.injury_type,
      impact,
    });
  }

  // Normalize impact score (0-10 scale)
  for (const team of Object.values(teamImpact)) {
    team.impact_score = Math.min(10, team.impact_score / 3);
  }

  // 3. Save results
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Save raw injuries
  const injuriesPath = path.join(dataDir, "premier-injuries.json");
  fs.writeFileSync(injuriesPath, JSON.stringify({
    source: "premierinjuries.com",
    fetched_at: new Date().toISOString(),
    total: allInjuries.length,
    injuries: allInjuries,
  }, null, 2));
  console.log(`\n💾 Saved ${allInjuries.length} injuries to ${injuriesPath}`);

  // Save team impact scores
  const impactPath = path.join(dataDir, "team-injury-impact.json");
  const existingImpact = fs.existsSync(impactPath) ? JSON.parse(fs.readFileSync(impactPath, "utf8")) : {};

  // Merge with existing (keep other leagues' data)
  for (const [team, impact] of Object.entries(teamImpact)) {
    existingImpact[team] = impact;
  }

  fs.writeFileSync(impactPath, JSON.stringify(existingImpact, null, 2));
  console.log(`💾 Saved team impact scores to ${impactPath}`);

  // Summary
  console.log("\n" + "━".repeat(50));
  console.log("📊 Summary");
  console.log(`   Total injuries: ${allInjuries.length}`);
  console.log(`   Teams affected: ${Object.keys(teamImpact).length}`);
  console.log(`   Ruled out: ${allInjuries.filter(i => i.status === "injured").length}`);
  console.log(`   Suspended: ${allInjuries.filter(i => i.status === "suspended").length}`);
  console.log(`   Doubtful: ${allInjuries.filter(i => i.status === "doubtful").length}`);

  // Top 5 most affected teams
  const sorted = Object.values(teamImpact).sort((a, b) => b.impact_score - a.impact_score);
  console.log("\n⚽ Most affected teams:");
  for (const t of sorted.slice(0, 5)) {
    console.log(`   ${t.team_name.padEnd(20)} Impact: ${t.impact_score.toFixed(1)} (${t.total_injured} players)`);
    for (const p of t.players.filter(p => p.impact >= 4).slice(0, 3)) {
      console.log(`     🏥 ${p.name} — ${p.injury} [${p.status}]`);
    }
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
