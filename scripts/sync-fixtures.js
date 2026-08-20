#!/usr/bin/env node

/**
 * ODDLY Fixture Sync Script
 *
 * Fetches real fixtures and odds from The Odds API and saves them to Supabase.
 * Run this after setting up your .env.local with valid Supabase keys.
 *
 * Usage: node scripts/sync-fixtures.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Load .env.local
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local not found. Create it with your Supabase keys.");
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};

  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

const env = loadEnv();

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

const ODDS_API_KEY = env.THE_ODDS_API_KEY;

// Sports to sync
const SPORTS = [
  { key: "soccer_epl", league: "Premier League", country: "England" },
  { key: "soccer_spain_la_liga", league: "La Liga", country: "Spain" },
  { key: "soccer_germany_bundesliga", league: "Bundesliga", country: "Germany" },
  { key: "soccer_italy_serie_a", league: "Serie A", country: "Italy" },
  { key: "soccer_france_ligue_one", league: "Ligue 1", country: "France" },
  { key: "soccer_netherlands_eredivisie", league: "Eredivisie", country: "Netherlands" },
  { key: "soccer_portugal_primeira_liga", league: "Primeira Liga", country: "Portugal" },
  { key: "soccer_brazil_campeonato", league: "Brasileirão", country: "Brazil" },
  { key: "soccer_usa_mls", league: "MLS", country: "USA" },
  { key: "soccer_uefa_champs_league", league: "Champions League", country: "Europe" },
];

function normalizeTeamName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b(fc|cf|sc|ac|ssc|us|as|rc|rcd|cd|ud|sd|kf|ks|kk)\b\.?/g, "")
    .trim();
}

async function getOrCreateLeague(name, country) {
  const { data: existing } = await supabase
    .from("leagues")
    .select("id")
    .eq("name", name)
    .single();

  if (existing) return existing.id;

  const { data: newLeague, error } = await supabase
    .from("leagues")
    .insert({ name, country, sport: "football", is_active: true, priority: 5 })
    .select("id")
    .single();

  if (error) throw error;
  return newLeague.id;
}

async function getOrCreateTeam(name, leagueId, country) {
  const normalized = normalizeTeamName(name);

  // Check aliases
  const { data: alias } = await supabase
    .from("team_aliases")
    .select("canonical_name")
    .eq("alias", normalized)
    .single();

  if (alias) {
    const { data: team } = await supabase
      .from("teams")
      .select("id")
      .eq("canonical_name", alias.canonical_name)
      .single();
    if (team) return team.id;
  }

  // Check existing
  const { data: existing } = await supabase
    .from("teams")
    .select("id")
    .eq("canonical_name", normalized)
    .single();

  if (existing) return existing.id;

  // Fuzzy match
  const { data: fuzzy } = await supabase
    .from("teams")
    .select("id, canonical_name")
    .ilike("canonical_name", `%${normalized.substring(0, 6)}%`)
    .limit(1);

  if (fuzzy?.length) {
    await supabase.from("team_aliases").upsert(
      { canonical_name: fuzzy[0].canonical_name, alias: normalized, source: "odds-sync" },
      { onConflict: "alias" }
    );
    return fuzzy[0].id;
  }

  // Create new
  const { data: newTeam, error } = await supabase
    .from("teams")
    .insert({ canonical_name: normalized, country, league_id: leagueId })
    .select("id")
    .single();

  if (error) throw error;

  await supabase.from("team_aliases").upsert(
    { canonical_name: normalized, alias: name.toLowerCase().trim(), source: "odds-sync" },
    { onConflict: "alias" }
  );

  return newTeam.id;
}

async function matchFixture(homeTeam, awayTeam) {
  const homeNorm = normalizeTeamName(homeTeam);
  const awayNorm = normalizeTeamName(awayTeam);

  const { data: homeAlias } = await supabase
    .from("team_aliases")
    .select("canonical_name")
    .eq("alias", homeNorm)
    .single();

  const { data: awayAlias } = await supabase
    .from("team_aliases")
    .select("canonical_name")
    .eq("alias", awayNorm)
    .single();

  const homeName = homeAlias?.canonical_name || homeNorm;
  const awayName = awayAlias?.canonical_name || awayNorm;

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(`
      id,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name)
    `)
    .eq("status", "scheduled")
    .gte("kickoff_time", new Date().toISOString())
    .limit(200);

  if (!fixtures) return null;

  for (const f of fixtures) {
    const dbHome = f.home_team?.canonical_name;
    const dbAway = f.away_team?.canonical_name;

    if (dbHome === homeName && dbAway === awayName) return f.id;
    if (
      (dbHome?.includes(homeName) || homeName?.includes(dbHome)) &&
      (dbAway?.includes(awayName) || awayName?.includes(dbAway))
    ) {
      return f.id;
    }
  }

  return null;
}

async function createFixture(apiFixture, leagueId, country) {
  const homeTeamId = await getOrCreateTeam(apiFixture.home_team, leagueId, country);
  const awayTeamId = await getOrCreateTeam(apiFixture.away_team, leagueId, country);

  const { data, error } = await supabase
    .from("fixtures")
    .insert({
      external_id: apiFixture.id,
      home_team_id: homeTeamId,
      away_team_id: awayTeamId,
      league_id: leagueId,
      kickoff_time: apiFixture.commence_time,
      status: "scheduled",
      is_featured: false,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function saveOdds(fixtureId, apiFixture) {
  const snapshots = [];
  const now = new Date().toISOString();

  for (const bookmaker of apiFixture.bookmakers) {
    for (const market of bookmaker.markets) {
      let marketName = market.key;
      if (market.key === "h2h") marketName = "match_result";
      if (market.key === "totals") marketName = "over_under_2.5";

      for (const outcome of market.outcomes) {
        let selection = outcome.name;
        if (outcome.name === apiFixture.home_team) selection = "home";
        else if (outcome.name === apiFixture.away_team) selection = "away";
        else if (outcome.name === "Draw") selection = "draw";
        else if (outcome.name === "Over") selection = "over";
        else if (outcome.name === "Under") selection = "under";

        if (market.key === "totals" && outcome.point) {
          if (outcome.point === 2.5) marketName = "over_under_2.5";
          else if (outcome.point === 1.5) marketName = "over_under_1.5";
          else if (outcome.point === 3.5) marketName = "over_under_3.5";
        }

        snapshots.push({
          fixture_id: fixtureId,
          bookmaker: bookmaker.title.toLowerCase(),
          market: marketName,
          selection,
          odds: outcome.price,
          snapshot_time: now,
        });
      }
    }
  }

  if (snapshots.length === 0) return 0;

  const { error } = await supabase.from("odds_snapshots").insert(snapshots);
  if (error) {
    console.error("  ⚠️  Failed to save odds:", error.message);
    return 0;
  }

  return snapshots.length;
}

async function syncSport(sport) {
  if (!ODDS_API_KEY) {
    throw new Error("THE_ODDS_API_KEY not configured in .env.local");
  }

  const url = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${ODDS_API_KEY}&regions=uk,eu&markets=h2h,totals&bookmakers=pinnacle,betway`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Odds API ${response.status}: ${text}`);
  }

  const fixtures = await response.json();
  const leagueId = await getOrCreateLeague(sport.league, sport.country);

  let created = 0;
  let matched = 0;
  let oddsCount = 0;

  for (const fixture of fixtures) {
    try {
      let fixtureId = await matchFixture(fixture.home_team, fixture.away_team);

      if (!fixtureId) {
        fixtureId = await createFixture(fixture, leagueId, sport.country);
        created++;
      } else {
        matched++;
      }

      const count = await saveOdds(fixtureId, fixture);
      oddsCount += count;
    } catch (err) {
      console.error(`  ⚠️  ${fixture.home_team} vs ${fixture.away_team}: ${err.message}`);
    }
  }

  return { fixtures: fixtures.length, created, matched, oddsCount };
}

async function main() {
  console.log("🔄 ODDLY Fixture Sync");
  console.log("━".repeat(50));

  if (!env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR_PROJECT")) {
    console.error("❌ Supabase URL is still a placeholder in .env.local");
    console.error("   Update NEXT_PUBLIC_SUPABASE_URL with your real Supabase project URL");
    process.exit(1);
  }

  if (!ODDS_API_KEY) {
    console.error("❌ THE_ODDS_API_KEY not found in .env.local");
    process.exit(1);
  }

  console.log(`📡 Supabase: ${env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`🔑 Odds API: ${ODDS_API_KEY.slice(0, 8)}...`);
  console.log("");

  let totalFixtures = 0;
  let totalCreated = 0;
  let totalMatched = 0;
  let totalOdds = 0;
  const errors = [];

  for (const sport of SPORTS) {
    try {
      process.stdout.write(`  ⚽ ${sport.league}... `);
      const result = await syncSport(sport);
      console.log(`${result.fixtures} fixtures, ${result.created} new, ${result.oddsCount} odds`);
      totalFixtures += result.fixtures;
      totalCreated += result.created;
      totalMatched += result.matched;
      totalOdds += result.oddsCount;

      // Rate limit
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.log(`❌ ${err.message}`);
      errors.push(`${sport.league}: ${err.message}`);
    }
  }

  console.log("");
  console.log("━".repeat(50));
  console.log("📊 Summary");
  console.log(`   Fixtures found:  ${totalFixtures}`);
  console.log(`   New created:     ${totalCreated}`);
  console.log(`   Existing matched: ${totalMatched}`);
  console.log(`   Odds snapshots:  ${totalOdds}`);
  if (errors.length) {
    console.log(`   Errors:          ${errors.length}`);
    errors.forEach((e) => console.log(`     - ${e}`));
  }
  console.log("━".repeat(50));

  // Verify
  const { count: fixtureCount } = await supabase
    .from("fixtures")
    .select("*", { count: "exact", head: true });
  const { count: oddsCount } = await supabase
    .from("odds_snapshots")
    .select("*", { count: "exact", head: true });

  console.log(`\n✅ Database totals: ${fixtureCount} fixtures, ${oddsCount} odds snapshots`);
}

main().catch((err) => {
  console.error("\n❌ Sync failed:", err.message);
  process.exit(1);
});
