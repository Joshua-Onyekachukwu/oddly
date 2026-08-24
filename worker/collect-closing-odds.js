#!/usr/bin/env node
/**
 * Closing Odds Collector
 * 
 * Collects odds from The Odds API at two time points:
 * - Opening odds: fetched when fixtures are first synced (days before kickoff)
 * - Closing odds: fetched 1-2 hours before kickoff
 * 
 * CLV (Closing Line Value) = how much the odds moved from opening to closing.
 * This is the single most predictive feature in sports betting.
 * 
 * The closing line is the most accurate predictor of match outcomes.
 * If you consistently beat the closing line, you have genuine edge.
 * 
 * Usage:
 *   node worker/collect-closing-odds.js opening   # Fetch opening odds for upcoming matches
 *   node worker/collect-closing-odds.js closing   # Fetch closing odds for matches about to start
 *   node worker/collect-closing-odds.js compute   # Compute CLV for all matches with both snapshots
 *   node worker/collect-closing-odds.js features  # Generate CLV-based features for training
 * 
 * Runs as Vercel cron or manually.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// ─── Configuration ──────────────────────────────────────────

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split("\n")) {
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

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const API_KEY = (env.THE_ODDS_API_KEY || "").replace(/^["']|["']$/g, "");

// League → Odds API sport key mapping
const LEAGUE_SPORTS = {
  "Premier League": "soccer_epl",
  "La Liga": "soccer_spain_la_liga",
  "Bundesliga": "soccer_germany_bundesliga",
  "Serie A": "soccer_italy_serie_a",
  "Ligue 1": "soccer_france_ligue_one",
  "Eredivisie": "soccer_netherlands_eredivisie",
  "Championship": "soccer_england_championship",
  "Primeira Liga": "soccer_portugal_primeira_liga",
  "MLS": "soccer_usa_mls",
  "Brasileirão": "soccer_brazil_campeonato",
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Opening Odds Collector ─────────────────────────────────

/**
 * Fetch opening odds for all upcoming scheduled fixtures.
 * Stores with snapshot_type = "opening" for CLV computation.
 */
async function collectOpeningOdds() {
  console.log("📊 Collecting Opening Odds");
  console.log("━".repeat(50));

  // Check API quota
  const quotaRes = await fetchJSON(`https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`);
  const remaining = parseInt(quotaRes.headers["x-requests-remaining"] || "0");
  console.log(`   API Quota: ${remaining} requests remaining`);

  if (remaining <= 0) {
    console.log("   ❌ No API requests remaining. Try again tomorrow.");
    return { collected: 0, fixtures: 0 };
  }

  // Get upcoming scheduled fixtures
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, home_team_id, away_team_id, league_id, kickoff_time, leagues(name)")
    .eq("status", "scheduled")
    .gte("kickoff_time", new Date().toISOString())
    .order("kickoff_time", { ascending: true })
    .limit(200);

  if (!fixtures || fixtures.length === 0) {
    console.log("   No upcoming fixtures found");
    return { collected: 0, fixtures: 0 };
  }
  console.log(`   Found ${fixtures.length} upcoming fixtures`);

  // Get team names for matching
  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  let totalOdds = 0;
  let requestsUsed = 0;

  for (const [leagueName, sportKey] of Object.entries(LEAGUE_SPORTS)) {
    if (requestsUsed >= remaining) break;

    // Filter fixtures for this league
    const leagueFixtures = fixtures.filter(f => f.leagues?.name === leagueName);
    if (leagueFixtures.length === 0) continue;

    await sleep(1000); // Rate limit

    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${API_KEY}&regions=eu,uk&markets=h2h&oddsFormat=decimal`;
    console.log(`\n   Fetching ${leagueName}...`);

    try {
      const res = await fetchJSON(url);
      requestsUsed++;

      if (res.status !== 200) {
        console.log(`   ❌ HTTP ${res.status}`);
        continue;
      }

      const events = JSON.parse(res.body);
      console.log(`   📋 ${events.length} events from API`);

      // Match API events to our fixtures
      for (const event of events) {
        const homeName = event.home_team?.toLowerCase();
        const awayName = event.away_team?.toLowerCase();
        if (!homeName || !awayName) continue;

        // Find matching fixture
        const fixture = leagueFixtures.find(f => {
          const ht = teamMap[f.home_team_id]?.toLowerCase();
          const at = teamMap[f.away_team_id]?.toLowerCase();
          return ht && at &&
            (ht.includes(homeName) || homeName.includes(ht)) &&
            (at.includes(awayName) || awayName.includes(at));
        });

        if (!fixture) continue;

        // Store odds with snapshot_type = "opening"
        for (const bookmaker of event.bookmakers || []) {
          const h2h = bookmaker.markets?.find(m => m.key === "h2h");
          if (!h2h) continue;

          for (const outcome of h2h.outcomes || []) {
            let selection = "Home";
            if (outcome.name === "Draw") selection = "Draw";
            else if (outcome.name !== event.home_team) selection = "Away";

            await supabase.from("odds_snapshots").upsert({
              fixture_id: fixture.id,
              bookmaker: bookmaker.title || bookmaker.key,
              market: "1X2",
              selection,
              odds: outcome.price,
              snapshot_time: new Date().toISOString(),
              snapshot_type: "opening",
              source: "the-odds-api",
            }, { onConflict: "fixture_id,bookmaker,market,selection,snapshot_type" });

            totalOdds++;
          }
        }
      }

      const newRemaining = parseInt(res.headers["x-requests-remaining"] || "0");
      console.log(`   ✅ Saved. API remaining: ${newRemaining}`);
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }
  }

  console.log(`\n📊 Opening odds collected: ${totalOdds} records for ${fixtures.length} fixtures`);
  return { collected: totalOdds, fixtures: fixtures.length };
}

// ─── Closing Odds Collector ─────────────────────────────────

/**
 * Fetch closing odds for matches starting within the next 2 hours.
 * Stores with snapshot_type = "closing" for CLV computation.
 */
async function collectClosingOdds() {
  console.log("📊 Collecting Closing Odds");
  console.log("━".repeat(50));

  // Check API quota
  const quotaRes = await fetchJSON(`https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`);
  const remaining = parseInt(quotaRes.headers["x-requests-remaining"] || "0");
  console.log(`   API Quota: ${remaining} requests remaining`);

  if (remaining <= 0) {
    console.log("   ❌ No API requests remaining");
    return { collected: 0 };
  }

  // Get fixtures starting in the next 2 hours
  const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, home_team_id, away_team_id, league_id, kickoff_time, leagues(name)")
    .eq("status", "scheduled")
    .gte("kickoff_time", now)
    .lte("kickoff_time", twoHoursFromNow)
    .order("kickoff_time", { ascending: true });

  if (!fixtures || fixtures.length === 0) {
    console.log("   No matches starting within 2 hours");
    return { collected: 0 };
  }
  console.log(`   Found ${fixtures.length} matches starting soon`);

  // Same collection logic as opening
  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  let totalOdds = 0;

  for (const [leagueName, sportKey] of Object.entries(LEAGUE_SPORTS)) {
    const leagueFixtures = fixtures.filter(f => f.leagues?.name === leagueName);
    if (leagueFixtures.length === 0) continue;

    await sleep(1000);

    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${API_KEY}&regions=eu,uk&markets=h2h&oddsFormat=decimal`;

    try {
      const res = await fetchJSON(url);
      if (res.status !== 200) continue;

      const events = JSON.parse(res.body);

      for (const event of events) {
        const homeName = event.home_team?.toLowerCase();
        const awayName = event.away_team?.toLowerCase();
        if (!homeName || !awayName) continue;

        const fixture = leagueFixtures.find(f => {
          const ht = teamMap[f.home_team_id]?.toLowerCase();
          const at = teamMap[f.away_team_id]?.toLowerCase();
          return ht && at &&
            (ht.includes(homeName) || homeName.includes(ht)) &&
            (at.includes(awayName) || awayName.includes(at));
        });

        if (!fixture) continue;

        for (const bookmaker of event.bookmakers || []) {
          const h2h = bookmaker.markets?.find(m => m.key === "h2h");
          if (!h2h) continue;

          for (const outcome of h2h.outcomes || []) {
            let selection = "Home";
            if (outcome.name === "Draw") selection = "Draw";
            else if (outcome.name !== event.home_team) selection = "Away";

            await supabase.from("odds_snapshots").upsert({
              fixture_id: fixture.id,
              bookmaker: bookmaker.title || bookmaker.key,
              market: "1X2",
              selection,
              odds: outcome.price,
              snapshot_time: new Date().toISOString(),
              snapshot_type: "closing",
              source: "the-odds-api",
            }, { onConflict: "fixture_id,bookmaker,market,selection,snapshot_type" });

            totalOdds++;
          }
        }
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }
  }

  console.log(`\n📊 Closing odds collected: ${totalOdds} records`);
  return { collected: totalOdds };
}

// ─── CLV Computation ────────────────────────────────────────

/**
 * Compute CLV for all fixtures that have both opening and closing odds.
 * CLV = log(closing_odds / opening_odds) for the actual outcome
 * 
 * Positive CLV = odds shortened (you got a better price at opening)
 * Negative CLV = odds lengthened (closing was better than what you took)
 */
async function computeCLV() {
  console.log("📊 Computing CLV (Closing Line Value)");
  console.log("━".repeat(50));

  // Get all fixtures that have both opening and closing odds
  const { data: openingOdds } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, bookmaker, selection, odds, snapshot_time")
    .eq("snapshot_type", "opening");

  const { data: closingOdds } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, bookmaker, selection, odds, snapshot_time")
    .eq("snapshot_type", "closing");

  if (!openingOdds || !closingOdds) {
    console.log("   No odds data available");
    return { computed: 0 };
  }

  console.log(`   Opening snapshots: ${openingOdds.length}`);
  console.log(`   Closing snapshots: ${closingOdds.length}`);

  // Group by fixture + bookmaker + selection
  const openingByFixture = {};
  for (const o of openingOdds) {
    const key = `${o.fixture_id}:${o.bookmaker}:${o.selection}`;
    if (!openingByFixture[key]) openingByFixture[key] = [];
    openingByFixture[key].push(o);
  }

  const closingByFixture = {};
  for (const o of closingOdds) {
    const key = `${o.fixture_id}:${o.bookmaker}:${o.selection}`;
    if (!closingByFixture[key]) closingByFixture[key] = [];
    closingByFixture[key].push(o);
  }

  // Compute CLV for each fixture
  const clvResults = [];
  const fixturesWithBoth = new Set();

  for (const key of Object.keys(openingByFixture)) {
    if (!closingByFixture[key]) continue;

    const [fixtureId, bookmaker, selection] = key.split(":");

    // Get latest opening and closing odds for this selection
    const opening = openingByFixture[key].sort((a, b) =>
      new Date(b.snapshot_time).getTime() - new Date(a.snapshot_time).getTime()
    )[0];
    const closing = closingByFixture[key].sort((a, b) =>
      new Date(b.snapshot_time).getTime() - new Date(a.snapshot_time).getTime()
    )[0];

    if (!opening || !closing) continue;

    const openingOdds = opening.odds;
    const closingOdds = closing.odds;

    if (!openingOdds || !closingOdds || openingOdds <= 1 || closingOdds <= 1) continue;

    // CLV = log(closing / opening) — positive means odds shortened
    const clv = Math.log(closingOdds / openingOdds);
    const clvPercent = ((closingOdds / openingOdds - 1) * 100).toFixed(2);

    // Market consensus: average closing odds across bookmakers
    clvResults.push({
      fixture_id: fixtureId,
      bookmaker,
      selection,
      opening_odds: openingOdds,
      closing_odds: closingOdds,
      clv,
      clv_percent: parseFloat(clvPercent),
      opening_time: opening.snapshot_time,
      closing_time: closing.snapshot_time,
    });

    fixturesWithBoth.add(fixtureId);
  }

  console.log(`   Fixtures with both opening+closing: ${fixturesWithBoth.size}`);
  console.log(`   CLV computations: ${clvResults.length}`);

  // Save CLV results
  const outputPath = path.join(__dirname, "..", "data", "clv-results.json");
  fs.writeFileSync(outputPath, JSON.stringify({
    computed_at: new Date().toISOString(),
    total_fixtures: fixturesWithBoth.size,
    total_computations: clvResults.length,
    results: clvResults,
  }, null, 2));
  console.log(`\n💾 Saved to ${outputPath}`);

  // Summary statistics
  if (clvResults.length > 0) {
    const avgCLV = clvResults.reduce((s, r) => s + r.clv, 0) / clvResults.length;
    const positiveCLV = clvResults.filter(r => r.clv > 0).length;
    const negativeCLV = clvResults.filter(r => r.clv < 0).length;

    console.log(`\n📊 CLV Summary:`);
    console.log(`   Average CLV: ${(avgCLV * 100).toFixed(2)}%`);
    console.log(`   Positive CLV (odds shortened): ${positiveCLV} (${(positiveCLV / clvResults.length * 100).toFixed(1)}%)`);
    console.log(`   Negative CLV (odds lengthened): ${negativeCLV} (${(negativeCLV / clvResults.length * 100).toFixed(1)}%)`);
  }

  return { computed: clvResults.length, fixtures: fixturesWithBoth.size };
}

// ─── Feature Generation ─────────────────────────────────────

/**
 * Generate CLV-based features for the XGBoost training pipeline.
 * Features:
 * - clv_home, clv_draw, clv_away: CLV per selection
 * - market_movement: how much the market moved
 * - closing_line_accuracy: how well closing line predicted outcome
 * - sharp_money_indicator: large CLV movements indicate sharp action
 */
async function generateCLVFeatures() {
  console.log("📊 Generating CLV Features for Training");
  console.log("━".repeat(50));

  // Load CLV results
  const clvPath = path.join(__dirname, "..", "data", "clv-results.json");
  if (!fs.existsSync(clvPath)) {
    console.log("   ❌ No CLV data. Run 'compute' first.");
    return;
  }

  const clvData = JSON.parse(fs.readFileSync(clvPath, "utf8"));
  console.log(`   CLV data: ${clvData.total_computations} computations`);

  // Group CLV by fixture
  const clvByFixture = {};
  for (const r of clvData.results) {
    if (!clvByFixture[r.fixture_id]) clvByFixture[r.fixture_id] = [];
    clvByFixture[r.fixture_id].push(r);
  }

  // Generate features per fixture
  const features = {};

  for (const [fixtureId, clvList] of Object.entries(clvByFixture)) {
    const homeCLV = clvList.filter(r => r.selection === "Home");
    const drawCLV = clvList.filter(r => r.selection === "Draw");
    const awayCLV = clvList.filter(r => r.selection === "Away");

    const avgCLV = arr => arr.length > 0 ? arr.reduce((s, r) => s + r.clv, 0) / arr.length : 0;
    const maxCLV = arr => arr.length > 0 ? Math.max(...arr.map(r => r.clv)) : 0;
    const minCLV = arr => arr.length > 0 ? Math.min(...arr.map(r => r.clv)) : 0;

    const avgOpening = arr => arr.length > 0 ? arr.reduce((s, r) => s + r.opening_odds, 0) / arr.length : 0;
    const avgClosing = arr => arr.length > 0 ? arr.reduce((s, r) => s + r.closing_odds, 0) / arr.length : 0;

    // Market movement: how much odds changed on average
    const homeMovement = avgClosing(homeCLV) > 0 ? (avgClosing(homeCLV) / avgOpening(homeCLV) - 1) : 0;
    const drawMovement = avgClosing(drawCLV) > 0 ? (avgClosing(drawCLV) / avgOpening(drawCLV) - 1) : 0;
    const awayMovement = avgClosing(awayCLV) > 0 ? (avgClosing(awayCLV) / avgOpening(awayCLV) - 1) : 0;

    // Sharp money indicator: large movements suggest informed bettors
    const maxMovement = Math.max(Math.abs(homeMovement), Math.abs(drawMovement), Math.abs(awayMovement));
    const sharpMoney = maxMovement > 0.05 ? 1 : 0; // >5% movement = sharp money

    // Market consensus: how many bookmakers agree
    const bookmakers = new Set(clvList.map(r => r.bookmaker));

    // Favorite odds movement (most predictive)
    const allMovements = [homeMovement, drawMovement, awayMovement];
    const favoriteMovement = Math.min(...allMovements.map(Math.abs));

    features[fixtureId] = {
      // CLV per selection
      clv_home: avgCLV(homeCLV),
      clv_draw: avgCLV(drawCLV),
      clv_away: avgCLV(awayCLV),

      // Max CLV (strongest signal)
      clv_max_home: maxCLV(homeCLV),
      clv_max_draw: maxCLV(drawCLV),
      clv_max_away: maxCLV(awayCLV),

      // Market movement
      market_movement_home: homeMovement,
      market_movement_draw: drawMovement,
      market_movement_away: awayMovement,

      // Sharp money indicators
      sharp_money: sharpMoney,
      max_movement: maxMovement,
      favorite_movement: favoriteMovement,

      // Market consensus
      bookmaker_count: bookmakers.size,
      total_snapshots: clvList.length,

      // Closing line probabilities (most accurate predictor)
      closing_implied_home: avgClosing(homeCLV) > 0 ? 1 / avgClosing(homeCLV) : 0,
      closing_implied_draw: avgClosing(drawCLV) > 0 ? 1 / avgClosing(drawCLV) : 0,
      closing_implied_away: avgClosing(awayCLV) > 0 ? 1 / avgClosing(awayCLV) : 0,
    };
  }

  // Save features
  const outputPath = path.join(__dirname, "..", "data", "clv-features.json");
  fs.writeFileSync(outputPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_fixtures: Object.keys(features).length,
    features,
  }, null, 2));

  console.log(`   Generated features for ${Object.keys(features).length} fixtures`);
  console.log(`💾 Saved to ${outputPath}`);

  // Show sample
  const sampleId = Object.keys(features)[0];
  if (sampleId) {
    const f = features[sampleId];
    console.log(`\n📊 Sample CLV features:`);
    console.log(`   CLV: H ${(f.clv_home * 100).toFixed(2)}% D ${(f.clv_draw * 100).toFixed(2)}% A ${(f.clv_away * 100).toFixed(2)}%`);
    console.log(`   Sharp money: ${f.sharp_money ? "YES" : "no"}`);
    console.log(`   Bookmakers: ${f.bookmaker_count}`);
    console.log(`   Closing implied: H ${(f.closing_implied_home * 100).toFixed(1)}% D ${(f.closing_implied_draw * 100).toFixed(1)}% A ${(f.closing_implied_away * 100).toFixed(1)}%`);
  }
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const action = process.argv[2] || "compute";

  switch (action) {
    case "opening":
      await collectOpeningOdds();
      break;
    case "closing":
      await collectClosingOdds();
      break;
    case "compute":
      await computeCLV();
      break;
    case "features":
      await generateCLVFeatures();
      break;
    case "all":
      await collectOpeningOdds();
      await computeCLV();
      await generateCLVFeatures();
      break;
    default:
      console.log("Usage: node worker/collect-closing-odds.js [opening|closing|compute|features|all]");
  }
}

main().catch(console.error);
