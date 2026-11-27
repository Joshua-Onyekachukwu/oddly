#!/usr/bin/env node
/**
 * Market Consensus Feature Generator
 * 
 * Computes market-based features from multi-bookmaker odds.
 * These features are available immediately (no CLV needed) and
 * are among the most predictive features for football matches.
 * 
 * Features:
 * - Market consensus probability (average across bookmakers)
 * - Overround (bookmaker margin)
 * - Market disagreement (variance across bookmakers)
 * - Market favorite and confidence
 * - Best available odds per selection
 * - Implied probability (true, overround removed)
 * 
 * Usage: node worker/compute-market-consensus.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

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

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Convert decimal odds to implied probability
 */
function impliedProb(odds) {
  return odds > 1 ? 1 / odds : 0;
}

/**
 * Remove overround to get "true" probabilities
 */
function removeOverround(probs) {
  const total = probs.reduce((s, p) => s + p, 0);
  return total > 0 ? probs.map(p => p / total) : probs;
}

/**
 * Compute coefficient of variation (disagreement measure)
 */
function cv(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  if (mean === 0) return 0;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance) / mean;
}

async function main() {
  console.log("📊 Market Consensus Feature Generator");
  console.log("━".repeat(50));

  // Load all odds
  const { data: odds } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, bookmaker, selection, odds, snapshot_time")
    .order("snapshot_time", { ascending: false });

  if (!odds || odds.length === 0) {
    console.log("   ❌ No odds data found");
    return;
  }

  console.log(`   Loaded ${odds.length} odds records`);

  // Group by fixture
  const byFixture = {};
  for (const o of odds) {
    if (!byFixture[o.fixture_id]) byFixture[o.fixture_id] = [];
    byFixture[o.fixture_id].push(o);
  }

  console.log(`   ${Object.keys(byFixture).length} fixtures with odds`);

  // Try to get fixture info (odds may have dummy fixture_ids)
  const fixtureIds = Object.keys(byFixture);
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, home_team_id, away_team_id, kickoff_time, leagues(name)")
    .in("id", fixtureIds);

  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  const fixtureMap = {};
  for (const f of fixtures || []) {
    fixtureMap[f.id] = {
      home: teamMap[f.home_team_id] || "?",
      away: teamMap[f.away_team_id] || "?",
      league: f.leagues?.name || "?",
      kickoff: f.kickoff_time,
    };
  }
  // For fixtures without matching DB records, use generic labels
  for (const fid of fixtureIds) {
    if (!fixtureMap[fid]) {
      fixtureMap[fid] = { home: "?", away: "?", league: "?", kickoff: null };
    }
  }

  // Compute features for each fixture
  const features = {};
  let computed = 0;

  for (const [fixtureId, fixtureOdds] of Object.entries(byFixture)) {
    const sel = o => (o.selection || "").toLowerCase();
    const homeOdds = fixtureOdds
      .filter(o => sel(o) === "home" || o.selection === "1")
      .map(o => o.odds);
    const drawOdds = fixtureOdds
      .filter(o => sel(o) === "draw" || o.selection === "X")
      .map(o => o.odds);
    const awayOdds = fixtureOdds
      .filter(o => sel(o) === "away" || o.selection === "2")
      .map(o => o.odds);

    if (homeOdds.length === 0 || drawOdds.length === 0 || awayOdds.length === 0) continue;

    const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const best = arr => Math.min(...arr); // Best (lowest) odds

    const avgHome = avg(homeOdds);
    const avgDraw = avg(drawOdds);
    const avgAway = avg(awayOdds);

    // Implied probabilities
    const impHome = impliedProb(avgHome);
    const impDraw = impliedProb(avgDraw);
    const impAway = impliedProb(avgAway);

    // True probabilities (overround removed)
    const [trueHome, trueDraw, trueAway] = removeOverround([impHome, impDraw, impAway]);

    // Overround
    const overround = impHome + impDraw + impAway - 1;

    // Market disagreement
    const homeDisagreement = cv(homeOdds);
    const drawDisagreement = cv(drawOdds);
    const awayDisagreement = cv(awayOdds);

    // Market favorite
    let marketFavorite = "D";
    if (trueHome > trueDraw && trueHome > trueAway) marketFavorite = "H";
    else if (trueAway > trueDraw && trueAway > trueHome) marketFavorite = "A";

    // Market confidence
    const marketConfidence = Math.max(trueHome, trueDraw, trueAway);

    // Bookmaker count
    const bookmakers = new Set(fixtureOdds.map(o => o.bookmaker));

    const fInfo = fixtureMap[fixtureId] || { home: "?", away: "?", league: "?" };

    features[fixtureId] = {
      // Match info
      home_team: fInfo.home,
      away_team: fInfo.away,
      league: fInfo.league,
      kickoff: fInfo.kickoff,

      // Raw odds
      odds_home: avgHome,
      odds_draw: avgDraw,
      odds_away: avgAway,

      // Best available odds
      best_home: best(homeOdds),
      best_draw: best(drawOdds),
      best_away: best(awayOdds),

      // Implied probabilities
      implied_home: clamp(impHome),
      implied_draw: clamp(impDraw),
      implied_away: clamp(impAway),

      // True probabilities (most important — these are the market's best estimate)
      true_home: clamp(trueHome),
      true_draw: clamp(trueDraw),
      true_away: clamp(trueAway),

      // Market metrics
      overround,
      bookmaker_count: bookmakers.size,

      // Disagreement (high = uncertain match)
      home_disagreement: homeDisagreement,
      draw_disagreement: drawDisagreement,
      away_disagreement: awayDisagreement,
      total_disagreement: (homeDisagreement + drawDisagreement + awayDisagreement) / 3,

      // Market favorite
      market_favorite: marketFavorite,
      market_confidence: marketConfidence,

      // Closest odds (competitive matches have lower min odds)
      closest_odds: Math.min(avgHome, avgDraw, avgAway),
      odds_range: Math.max(avgHome, avgDraw, avgAway) - Math.min(avgHome, avgDraw, avgAway),
    };

    computed++;
  }

  // Save features
  const outputPath = path.join(__dirname, "..", "data", "market-consensus.json");
  fs.writeFileSync(outputPath, JSON.stringify({
    computed_at: new Date().toISOString(),
    total_fixtures: computed,
    features,
  }, null, 2));

  console.log(`\n📊 Computed features for ${computed} fixtures`);
  console.log(`💾 Saved to ${outputPath}`);

  // Distribution
  const favDist = { H: 0, D: 0, A: 0 };
  for (const f of Object.values(features)) favDist[f.market_favorite]++;
  console.log(`\n📊 Market distribution:`);
  console.log(`   Home favorites: ${favDist.H} (${(favDist.H / computed * 100).toFixed(1)}%)`);
  console.log(`   Draw: ${favDist.D} (${(favDist.D / computed * 100).toFixed(1)}%)`);
  console.log(`   Away favorites: ${favDist.A} (${(favDist.A / computed * 100).toFixed(1)}%)`);

  // Sample
  const sampleId = Object.keys(features)[0];
  if (sampleId) {
    const f = features[sampleId];
    console.log(`\n📊 Sample: ${f.home_team} vs ${f.away_team} (${f.league})`);
    console.log(`   Odds: H ${f.odds_home.toFixed(2)} D ${f.odds_draw.toFixed(2)} A ${f.odds_away.toFixed(2)}`);
    console.log(`   True probs: H ${(f.true_home * 100).toFixed(1)}% D ${(f.true_draw * 100).toFixed(1)}% A ${(f.true_away * 100).toFixed(1)}%`);
    console.log(`   Overround: ${(f.overround * 100).toFixed(1)}%`);
    console.log(`   Market favorite: ${f.market_favorite} (${(f.market_confidence * 100).toFixed(1)}%)`);
    console.log(`   Bookmakers: ${f.bookmaker_count}`);
  }
}

main().catch(console.error);
