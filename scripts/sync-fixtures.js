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
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
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
  // Top 5 European Leagues
  { key: "soccer_epl", league: "Premier League", country: "England" },
  { key: "soccer_spain_la_liga", league: "La Liga", country: "Spain" },
  { key: "soccer_germany_bundesliga", league: "Bundesliga", country: "Germany" },
  { key: "soccer_italy_serie_a", league: "Serie A", country: "Italy" },
  { key: "soccer_france_ligue_one", league: "Ligue 1", country: "France" },
  // Second Divisions
  { key: "soccer_efl_champ", league: "Championship", country: "England" },
  { key: "soccer_germany_bundesliga2", league: "Bundesliga 2", country: "Germany" },
  { key: "soccer_italy_serie_b", league: "Serie B", country: "Italy" },
  { key: "soccer_france_ligue_two", league: "Ligue 2", country: "France" },
  { key: "soccer_spain_segunda_division", league: "La Liga 2", country: "Spain" },
  { key: "soccer_germany_liga3", league: "3. Liga", country: "Germany" },
  // Third/Fourth Divisions
  { key: "soccer_england_league1", league: "League 1", country: "England" },
  { key: "soccer_england_league2", league: "League 2", country: "England" },
  // European Leagues
  { key: "soccer_netherlands_eredivisie", league: "Eredivisie", country: "Netherlands" },
  { key: "soccer_portugal_primeira_liga", league: "Primeira Liga", country: "Portugal" },
  { key: "soccer_turkey_super_league", league: "Super Lig", country: "Turkey" },
  { key: "soccer_belgium_first_div", league: "Belgian First Division", country: "Belgium" },
  { key: "soccer_spl", league: "Scottish Premiership", country: "Scotland" },
  { key: "soccer_switzerland_superleague", league: "Swiss Super League", country: "Switzerland" },
  { key: "soccer_austria_bundesliga", league: "Austrian Bundesliga", country: "Austria" },
  { key: "soccer_greece_super_league", league: "Greek Super League", country: "Greece" },
  { key: "soccer_denmark_superliga", league: "Danish Superliga", country: "Denmark" },
  { key: "soccer_sweden_allsvenskan", league: "Swedish Allsvenskan", country: "Sweden" },
  { key: "soccer_sweden_superettan", league: "Swedish Superettan", country: "Sweden" },
  { key: "soccer_norway_eliteserien", league: "Norwegian Eliteserien", country: "Norway" },
  { key: "soccer_poland_ekstraklasa", league: "Polish Ekstraklasa", country: "Poland" },
  { key: "soccer_finland_veikkausliiga", league: "Finnish Veikkausliiga", country: "Finland" },
  { key: "soccer_league_of_ireland", league: "League of Ireland", country: "Ireland" },
  { key: "soccer_russia_premier_league", league: "Russian Premier League", country: "Russia" },
  // Americas
  { key: "soccer_brazil_campeonato", league: "Brasileirão", country: "Brazil" },
  { key: "soccer_brazil_serie_b", league: "Brasileirão Serie B", country: "Brazil" },
  { key: "soccer_usa_mls", league: "MLS", country: "USA" },
  { key: "soccer_argentina_primera_division", league: "Argentine Primera", country: "Argentina" },
  { key: "soccer_chile_campeonato", league: "Chilean Primera División", country: "Chile" },
  { key: "soccer_mexico_ligamx", league: "Liga MX", country: "Mexico" },
  // Middle East & Africa
  { key: "soccer_saudi_arabia_pro_league", league: "Saudi Pro League", country: "Saudi Arabia" },
  // Asia
  { key: "soccer_japan_j_league", league: "J League", country: "Japan" },
  { key: "soccer_korea_kleague1", league: "K League 1", country: "South Korea" },
  { key: "soccer_china_superleague", league: "Chinese Super League", country: "China" },
  // Competitions & Cups
  { key: "soccer_uefa_champs_league", league: "Champions League", country: "Europe" },
  { key: "soccer_conmebol_copa_libertadores", league: "Copa Libertadores", country: "South America" },
  { key: "soccer_conmebol_copa_sudamericana", league: "Copa Sudamericana", country: "South America" },
  { key: "soccer_england_efl_cup", league: "EFL Cup", country: "England" },
  { key: "soccer_fa_cup", league: "FA Cup", country: "England" },
  { key: "soccer_germany_dfb_pokal", league: "DFB-Pokal", country: "Germany" },
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
