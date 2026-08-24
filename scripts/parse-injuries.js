#!/usr/bin/env node
/**
 * Parse premierinjuries.com text data into structured JSON.
 * Run: node scripts/parse-injuries.js
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const INJURIES_PATH = path.join(DATA_DIR, "premier-injuries.json");
const IMPACT_PATH = path.join(DATA_DIR, "team-injury-impact.json");

// The injury text data (fetched via read_url or saved from previous run)
// This is the parsed text format from premierinjuries.com

function parseInjuryText(text) {
  const injuries = [];
  const teams = {};

  // Split by team sections - each team starts with "TeamName\nTRACK\nN\n"
  const teamPattern = /^([A-Z][A-Za-z &]+)\nTRACK\n(\d+)\n/gm;
  let teamMatch;
  const teamPositions = [];

  while ((teamMatch = teamPattern.exec(text)) !== null) {
    teamPositions.push({
      name: teamMatch[1].trim(),
      count: parseInt(teamMatch[2]),
      pos: teamMatch.index,
    });
  }

  // Extract player data between team sections
  for (let i = 0; i < teamPositions.length; i++) {
    const start = teamPositions[i].pos + teamPositions[i].name.length + 20;
    const end = i < teamPositions.length - 1 ? teamPositions[i + 1].pos : text.length;
    const section = text.substring(start, end);

    // Parse player entries: "Player\nName\nReason\nType\n..."
    const playerBlocks = section.split(/(?=Player\n)/g).filter(b => b.startsWith("Player\n"));

    for (const block of playerBlocks) {
      const lines = block.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      let playerName = "", reason = "", detail = "", returnDate = "", condition = "", status = "";

      for (let j = 0; j < lines.length; j++) {
        if (lines[j] === "Player" && j + 1 < lines.length) playerName = lines[j + 1];
        if (lines[j] === "Reason" && j + 1 < lines.length) reason = lines[j + 1];
        if (lines[j] === "Further Detail" && j + 1 < lines.length) detail = lines[j + 1];
        if (lines[j] === "Potential Return" && j + 1 < lines.length) returnDate = lines[j + 1];
        if (lines[j] === "Condition" && j + 1 < lines.length) condition = lines[j + 1];
        if (lines[j] === "Status" && j + 1 < lines.length) status = lines[j + 1];
      }

      if (playerName && playerName !== "Reason") {
        const inj = {
          player_name: playerName,
          team_name: teamPositions[i].name,
          injury_type: reason,
          detail: detail.substring(0, 200),
          expected_return: returnDate,
          condition: condition,
          status: status.toLowerCase().includes("ruled") ? "injured" :
                  status.toLowerCase().includes("suspend") ? "suspended" :
                  status.includes("25%") ? "doubtful_25" :
                  status.includes("50%") ? "doubtful_50" :
                  status.includes("75%") ? "likely_75" :
                  status.includes("100%") ? "fit" : "questionable",
          availability_pct: status.includes("25%") ? 25 :
                            status.includes("50%") ? 50 :
                            status.includes("75%") ? 75 :
                            status.includes("100%") ? 100 :
                            status.toLowerCase().includes("ruled") ? 0 : 50,
          source: "premierinjuries.com",
          fetched_at: new Date().toISOString(),
        };
        injuries.push(inj);

        if (!teams[teamPositions[i].name]) {
          teams[teamPositions[i].name] = [];
        }
        teams[teamPositions[i].name].push(inj);
      }
    }
  }

  return { injuries, teams };
}

function computeTeamImpact(teams) {
  const impact = {};

  for (const [teamName, teamInjuries] of Object.entries(teams)) {
    const ruledOut = teamInjuries.filter(i => i.status === "injured").length;
    const suspended = teamInjuries.filter(i => i.status === "suspended").length;
    const doubtful = teamInjuries.filter(i => i.status.startsWith("doubtful")).length;
    const total = teamInjuries.length;

    // Impact score: each ruled-out player = 5, suspended = 4, doubtful = 2
    let score = 0;
    for (const inj of teamInjuries) {
      score += inj.status === "injured" ? 5 :
               inj.status === "suspended" ? 4 :
               inj.status.startsWith("doubtful") ? 2 : 1;
    }

    impact[teamName] = {
      team_name: teamName,
      total_injured: total,
      ruled_out: ruledOut,
      total_suspended: suspended,
      total_doubtful: doubtful,
      impact_score: Math.min(10, score / 3), // Normalize to 0-10
      players: teamInjuries.map(inj => ({
        name: inj.player_name,
        status: inj.status,
        injury: inj.injury_type,
        impact: inj.status === "injured" ? 5 : inj.status === "suspended" ? 4 : 2,
      })),
    };
  }

  return impact;
}

// Main
const text = fs.readFileSync(path.join(DATA_DIR, "premier-injuries-raw.txt"), "utf8");
const { injuries, teams } = parseInjuryText(text);
const impact = computeTeamImpact(teams);

// Save
fs.writeFileSync(INJURIES_PATH, JSON.stringify({
  source: "premierinjuries.com",
  fetched_at: new Date().toISOString(),
  total: injuries.length,
  injuries,
}, null, 2));

// Merge with existing impact data (keep other leagues)
const existingImpact = fs.existsSync(IMPACT_PATH) ? JSON.parse(fs.readFileSync(IMPACT_PATH, "utf8")) : {};
for (const [team, data] of Object.entries(impact)) {
  existingImpact[team] = data;
}
fs.writeFileSync(IMPACT_PATH, JSON.stringify(existingImpact, null, 2));

console.log("📊 Injury Data Parsed");
console.log("━".repeat(50));
console.log(`   Total injuries: ${injuries.length}`);
console.log(`   Teams affected: ${Object.keys(teams).length}`);
console.log(`   Ruled out: ${injuries.filter(i => i.status === "injured").length}`);
console.log(`   Suspended: ${injuries.filter(i => i.status === "suspended").length}`);
console.log(`   Doubtful: ${injuries.filter(i => i.status.startsWith("doubtful")).length}`);

console.log("\n⚽ By Team:");
for (const [team, teamInjuries] of Object.entries(teams)) {
  const imp = impact[team];
  console.log(`   ${team.padEnd(22)} ${imp.impact_score.toFixed(1)} impact | ${imp.ruled_out} out, ${imp.total_suspended} suspended, ${imp.total_doubtful} doubtful`);
}

console.log(`\n💾 Saved to ${INJURIES_PATH}`);
console.log(`💾 Impact scores to ${IMPACT_PATH}`);
