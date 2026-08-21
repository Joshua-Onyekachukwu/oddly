#!/usr/bin/env node

/**
 * Set known team logos directly using API-Football CDN URLs.
 * No API calls needed — the CDN is just image hosting.
 * This covers the main teams from top 5 leagues.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    env[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Known API-Football team IDs → logo URLs
// Format: canonical_name (lowercase) → API team ID
const KNOWN_TEAMS = {
  // Premier League
  "arsenal": 42,
  "aston villa": 66,
  "bournemouth": 35,
  "brentford": 55,
  "brighton": 51,
  "chelsea": 49,
  "crystal palace": 52,
  "everton": 45,
  "fulham": 36,
  "ipswich town": 573,
  "leicester city": 46,
  "liverpool": 40,
  "manchester city": 50,
  "manchester united": 33,
  "newcastle united": 34,
  "nottingham forest": 65,
  "southampton": 41,
  "tottenham hotspur": 47,
  "west ham united": 48,
  "wolverhampton wanderers": 39,
  "wolves": 39,
  "leeds united": 63,
  "sunderland": 563,
  "hull city": 463,
  "burnley": 44,
  "sheffield united": 488,
  "coventry city": 430,

  // La Liga
  "real madrid": 541,
  "barcelona": 529,
  "atletico madrid": 530,
  "real sociedad": 548,
  "real betis": 543,
  "villarreal": 536,
  "athletic bilbao": 531,
  "sevilla": 539,
  "valencia": 532,
  "celta vigo": 538,
  "girona": 547,
  "rayo vallecano": 546,
  "mallorca": 537,
  "las palmas": 533,
  "getafe": 534,
  "osasuna": 545,
  "alaves": 542,
  "leganes": 535,
  "espanyol": 540,
  "real valladolid": 549,

  // Bundesliga
  "bayern munich": 157,
  "borussia dortmund": 165,
  "bayer leverkusen": 168,
  "vfb stuttgart": 172,
  "rb leipzig": 173,
  "vfl wolfsburg": 161,
  "eintracht frankfurt": 169,
  "borussia monchengladbach": 163,
  "sc freiburg": 160,
  "1. fc heidenheim": 167,
  "1. fc koln": 162,
  "mainz 05": 164,
  "werder bremen": 166,
  "augsburg": 159,
  "hamburger sv": 158,
  "darmstadt": 170,
  "st. pauli": 174,
  "holstein kiel": 175,
  "borussia dortmund": 165,

  // Serie A
  "inter milan": 505,
  "napoli": 492,
  "ac milan": 489,
  "juventus": 496,
  "atalanta": 497,
  "roma": 498,
  "lazio": 487,
  "fiorentina": 490,
  "bologna": 500,
  "torino": 495,
  "genoa": 491,
  "monza": 1503,
  "udinese": 494,
  "cagliari": 488,
  "parma": 499,
  "como": 1579,
  "empoli": 503,
  "verona": 493,
  "sassuolo": 486,
  "lecce": 8674,

  // Ligue 1
  "paris saint-germain": 85,
  "olympique marseille": 81,
  "lyon": 80,
  "monaco": 82,
  "lille": 79,
  "nice": 83,
  "strasbourg": 84,
  "rennes": 86,
  "lens": 87,
  "montpellier": 88,
  "nantes": 89,
  "toulouse": 91,
  "brest": 92,
  "reims": 93,
  "metz": 94,
  "le havre": 95,
  "lorient": 96,
  "auxerre": 1082,
  "ajaccio": 1081,
  "saint-etienne": 90,

  // Eredivisie
  "ajax": 448,
  "psv": 449,
  "feyenoord": 447,
  "az alkmaar": 450,
  "fc twente": 451,
  "fc utrecht": 454,
  "vitesse": 452,
  "heerenveen": 453,
  "go ahead eagles": 456,
  "sparta rotterdam": 457,
  "nec nijmegen": 458,
  "willem ii": 459,
  "pec zwolle": 460,
  "fortuna sittard": 461,
  " Excelsior": 462,
  "heracles": 463,
  "almere city": 464,
  "ral excelsior": 462,

  // Primeira Liga
  "benfica": 1216,
  "sporting cp": 1214,
  "fc porto": 1215,
  "braga": 1217,
  "vitória de guimaraes": 1218,
  "gil vicente": 1219,
  "casa pia": 1220,
  "rio ave": 1221,
  "estoril": 1222,
  "cs maritimo": 1223,
  "académico de viseu": 8671,
  "moreirense": 1224,
  "boavista": 1225,
  "famalicao": 1226,
  "arouca": 1227,
  "estrela amadora": 8672,

  // Ligue 1 others
  "lens": 87,
};

function logoUrl(teamId) {
  return `https://media.api-sports.io/football/teams/${teamId}.png`;
}

async function main() {
  console.log("🔄 Setting known team logos (no API calls)");
  console.log("━".repeat(50));

  let updated = 0;
  let skipped = 0;

  // Get all teams without logos
  const { data: teams } = await supabase
    .from("teams")
    .select("id, canonical_name, logo");

  if (!teams?.length) {
    console.log("No teams found");
    return;
  }

  console.log(`   Found ${teams.length} teams total`);

  for (const team of teams) {
    if (team.logo) {
      skipped++;
      continue;
    }

    const normalizedName = team.canonical_name.toLowerCase().trim();
    const teamId = KNOWN_TEAMS[normalizedName];

    if (teamId) {
      const { error } = await supabase
        .from("teams")
        .update({ logo: logoUrl(teamId) })
        .eq("id", team.id);

      if (!error) {
        updated++;
        process.stdout.write(`  ✅ ${team.canonical_name} → ID ${teamId}\n`);
      }
    }
  }

  console.log("");
  console.log("━".repeat(50));
  console.log("📊 Summary");
  console.log(`   Already had logos: ${skipped}`);
  console.log(`   New logos set:     ${updated}`);
  console.log(`   Still missing:     ${teams.length - skipped - updated}`);
  console.log("━".repeat(50));
}

main().catch((err) => {
  console.error("\n❌ Failed:", err.message);
  process.exit(1);
});
