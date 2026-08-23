#!/usr/bin/env node

/**
 * Football-Data.org Sync
 * 
 * Free tier: 10 requests/min, covers current season
 * Competitions: PL, Serie A, La Liga, Bundesliga, Ligue 1, Championship, Eredivisie
 * Provides: Fixtures, results, standings, team data
 * 
 * This is our PRIMARY source for PL and Serie A data
 * (The Odds API has rate limits; football-data.org does not for these leagues)
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Load env
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
  .split("\n")
  .forEach((l) => {
    if (l.startsWith("#") || !l.includes("=")) return;
    const idx = l.indexOf("=");
    env[l.slice(0, idx).trim()] = l.slice(idx + 1).trim().replace(/^"|"$/g, "");
  });

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

const FD_API = "395f3e8cbe6b4a149f3d854fcdac7ad9";
const HEADERS = { "X-Auth-Token": FD_API };

// Football-Data.org competition codes → our league names
const COMPETITIONS = {
  PL: { name: "Premier League", country: "England" },
  SA: { name: "Serie A", country: "Italy" },
  PD: { name: "La Liga", country: "Spain" },
  BL1: { name: "Bundesliga", country: "Germany" },
  FL1: { name: "Ligue 1", country: "France" },
  ELC: { name: "Championship", country: "England" },
  DED: { name: "Eredivisie", country: "Netherlands" },
  PPL: { name: "Primeira Liga", country: "Portugal" },
  BSA: { name: "Brasileirão", country: "Brazil" },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fdFetch(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429) {
      console.log(`  ⏳ Rate limited (attempt ${attempt}/${retries}), waiting 65s...`);
      await sleep(65000);
      continue;
    }
    if (res.status === 500 || res.status === 502 || res.status === 503) {
      console.log(`  ⚠️ Server error ${res.status} (attempt ${attempt}/${retries}), waiting 15s...`);
      await sleep(15000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}

/**
 * Step 1: Upsert teams from competition standings
 */
async function syncTeams(code, comp) {
  console.log(`\n  📋 Syncing teams from ${comp.name}...`);
  const data = await fdFetch(
    `https://api.football-data.org/v4/competitions/${code}/standings`
  );
  const standings = data.standings?.[0]?.table || [];
  let upserted = 0;

  for (const t of standings) {
    const team = t.team;
    const externalId = String(team.id);

    // Check if team exists
    const { data: existing } = await supabase
      .from("teams")
      .select("id")
      .eq("external_id", externalId)
      .single();    if (existing) {
      // Update logo if missing
      await supabase
        .from("teams")
        .update({
          logo: team.crest || null,
          country: comp.country,
        })
        .eq("id", existing.id);
    } else {
      // Insert
      await supabase.from("teams")
        .insert({
          canonical_name: team.shortName || team.name,
          logo: team.crest || null,
          country: comp.country,
        });
    }
    upserted++;
  }

  console.log(`  ✅ ${upserted} teams synced for ${comp.name}`);
  return standings.map((t) => ({
    fdTeamId: t.team.id,
    name: t.team.shortName || t.team.name,
    crest: t.team.crest,
    position: t.position,
    points: t.points,
    goalDifference: t.goalDifference,
    played: t.playedGames,
    won: t.won,
    drawn: t.draw,
    lost: t.lost,
    goalsFor: t.goalsFor,
    goalsAgainst: t.goalsAgainst,
  }));
}

/**
 * Step 2: Sync fixtures for current season
 */
async function syncFixtures(code, comp) {
  console.log(`\n  ⚽ Syncing fixtures from ${comp.name}...`);

  // Get ALL matches (free tier doesn't support multi-status filter)
  const data = await fdFetch(
    `https://api.football-data.org/v4/competitions/${code}/matches`
  );

  const matches = data.matches || [];
  console.log(`  📊 Found ${matches.length} matches (scheduled + live + finished)`);

  // Get our league ID
  const { data: league } = await supabase
    .from("leagues")
    .select("id")
    .eq("name", comp.name)
    .single();

  if (!league) {
    console.log(`  ⚠️ League "${comp.name}" not found in database, creating...`);
    const { data: newLeague } = await supabase
      .from("leagues")
      .insert({ name: comp.name, country: comp.country, sport: "football", is_active: true })
      .select("id")
      .single();
    if (!newLeague) {
      console.log(`  ❌ Failed to create league`);
      return [];
    }
    return syncFixtures(code, comp);
  }

  let created = 0;
  let updated = 0;
  const fixtureData = [];

  for (const match of matches) {
    const externalId = String(match.id);
    const kickoffTime = match.utcDate;

    // Map status (football-data.org uses TIMED for scheduled matches)
    let status = "scheduled";
    if (["FINISHED", "SUSPENDED"].includes(match.status)) status = "finished";
    else if (["IN_PLAY", "LIVE", "PAUSED"].includes(match.status))
      status = "in_progress";
    // TIMED = confirmed/scheduled, keep as 'scheduled'

    // Get or create teams
    const homeTeam = match.homeTeam;
    const awayTeam = match.awayTeam;

    // Find team IDs by name
    const hName = homeTeam.shortName || homeTeam.name;
    const aName = awayTeam.shortName || awayTeam.name;

    let homeTeamId = null;
    let awayTeamId = null;

    const { data: ht } = await supabase
      .from("teams")
      .select("id")
      .ilike("canonical_name", hName)
      .limit(1)
      .maybeSingle();
    if (ht) homeTeamId = ht.id;

    const { data: at } = await supabase
      .from("teams")
      .select("id")
      .ilike("canonical_name", aName)
      .limit(1)
      .maybeSingle();
    if (at) awayTeamId = at.id;

    if (!homeTeamId || !awayTeamId) continue;

    // Check if fixture exists
    const { data: existing } = await supabase
      .from("fixtures")
      .select("id, status, home_score, away_score")
      .eq("external_id", externalId)
      .single();

    const fixtureRecord = {
      external_id: externalId,
      league_id: league.id,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      kickoff_time: kickoffTime,
      status: status,
      home_score: match.score?.fullTime?.home ?? null,
      away_score: match.score?.fullTime?.away ?? null,
    };

    if (existing) {
      // Update if status changed or score available
      if (
        existing.status !== status ||
        (status === "finished" && existing.home_score === null)
      ) {
        await supabase
          .from("fixtures")
          .update(fixtureRecord)
          .eq("id", existing.id);
        updated++;
      }
    } else {
      await supabase.from("fixtures").insert(fixtureRecord);
      created++;
    }

    fixtureData.push({
      externalId,
      home: homeTeam.shortName || homeTeam.name,
      away: awayTeam.shortName || awayTeam.name,
      status,
      kickoff: kickoffTime?.slice(0, 10),
      score:
        status === "finished"
          ? `${match.score?.fullTime?.home ?? "?"}-${match.score?.fullTime?.away ?? "?"}`
          : null,
    });
  }

  console.log(
    `  ✅ ${comp.name}: ${created} created, ${updated} updated`
  );
  return fixtureData;
}

/**
 * Step 3: Sync standings as features for prediction model
 */
async function syncStandings(code, comp, standings) {
  console.log(`\n  📈 Storing standings for ${comp.name}...`);

  // Store standings data in a JSON file for the prediction model
  const dataDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const standingsFile = path.join(dataDir, "standings.json");
  let allStandings = {};
  if (fs.existsSync(standingsFile)) {
    allStandings = JSON.parse(fs.readFileSync(standingsFile, "utf8"));
  }

  allStandings[comp.name] = standings.map((t) => ({
    position: t.position,
    name: t.name,
    played: t.played,
    won: t.won,
    drawn: t.drawn,
    lost: t.lost,
    goalsFor: t.goalsFor,
    goalsAgainst: t.goalsAgainst,
    goalDifference: t.goalDifference,
    points: t.points,
  }));

  fs.writeFileSync(standingsFile, JSON.stringify(allStandings, null, 2));
  console.log(`  ✅ Standings saved to data/standings.json`);
}

/**
 * Main
 */
async function main() {
  console.log("🔄 Football-Data.org Sync");
  console.log("━".repeat(50));
  console.log(`📡 API: football-data.org (free tier)`);
  console.log(`📋 Competitions: ${Object.keys(COMPETITIONS).length}`);
  console.log("━".repeat(50));

  const allFixtures = {};

  for (const [code, comp] of Object.entries(COMPETITIONS)) {
    try {
      // 1. Sync teams + get standings
      const standings = await syncTeams(code, comp);

      // Rate limit: 10 req/min
      await sleep(7000);

      // 2. Sync fixtures
      const fixtures = await syncFixtures(code, comp);
      allFixtures[comp.name] = fixtures;

      // 3. Store standings
      await syncStandings(code, comp, standings);

      // Rate limit between competitions
      await sleep(7000);
    } catch (error) {
      console.error(`  ❌ Error syncing ${comp.name}: ${error.message}`);
      await sleep(5000);
    }
  }

  // Summary
  console.log("\n" + "━".repeat(50));
  console.log("📊 Summary");
  let totalFixtures = 0;
  for (const [league, fixtures] of Object.entries(allFixtures)) {
    const scheduled = fixtures.filter((f) => f.status === "scheduled").length;
    const finished = fixtures.filter((f) => f.status === "finished").length;
    const live = fixtures.filter((f) => f.status !== "scheduled" && f.status !== "finished").length;
    console.log(
      `  ${league.padEnd(20)} ${fixtures.length} matches (${scheduled} upcoming, ${finished} finished, ${live} live)`
    );
    totalFixtures += fixtures.length;
  }
  console.log("━".repeat(50));
  console.log(`  Total: ${totalFixtures} matches across ${Object.keys(allFixtures).length} leagues`);
  console.log("✅ Football-Data.org sync complete!");
}

main().catch((e) => {
  console.error("❌ Fatal error:", e.message);
  process.exit(1);
});
