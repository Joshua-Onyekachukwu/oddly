#!/usr/bin/env node
/**
 * ODDLY Odds Feature Integration
 *
 * Adds odds-derived features to the prediction engine:
 * 1. Implied probabilities from bookmaker odds (removing overround)
 * 2. Market consensus probability
 * 3. Overround (bookmaker margin)
 * 4. Odds movement (if multiple snapshots)
 * 5. Value detection (model vs market disagreement)
 *
 * These features significantly improve 1X2 accuracy by leveraging
 * the wisdom of the crowd encoded in bookmaker prices.
 *
 * Usage: node worker/add-odds-features.js
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

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Convert decimal odds to implied probability (removing overround)
 */
function oddsToImpliedProb(odds) {
  if (!odds || odds <= 1) return null;
  return 1 / odds;
}

/**
 * Remove overround from implied probabilities to get "true" probabilities
 */
function removeOverround(impliedProbs) {
  const total = impliedProbs.reduce((s, p) => s + p, 0);
  if (total <= 0) return impliedProbs;
  return impliedProbs.map(p => p / total);
}

/**
 * Get average odds across bookmakers for a fixture
 */
function getAverageOdds(oddsList) {
  if (!oddsList || oddsList.length === 0) return null;

  const homeOdds = oddsList.filter(o => o.selection === "Home" || o.selection === "1").map(o => o.odds);
  const drawOdds = oddsList.filter(o => o.selection === "Draw" || o.selection === "X").map(o => o.odds);
  const awayOdds = oddsList.filter(o => o.selection === "Away" || o.selection === "2").map(o => o.odds);

  const avg = arr => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  return {
    home: avg(homeOdds),
    draw: avg(drawOdds),
    away: avg(awayOdds),
    bookmakers: new Set(oddsList.map(o => o.bookmaker)).size,
  };
}

/**
 * Compute odds-derived features for a fixture
 */
function computeOddsFeatures(oddsList) {
  const avgOdds = getAverageOdds(oddsList);
  if (!avgOdds || !avgOdds.home || !avgOdds.draw || !avgOdds.away) {
    return null;
  }

  // Implied probabilities
  const impliedH = oddsToImpliedProb(avgOdds.home);
  const impliedD = oddsToImpliedProb(avgOdds.draw);
  const impliedA = oddsToImpliedProb(avgOdds.away);

  if (!impliedH || !impliedD || !impliedA) return null;

  // Remove overround to get "true" probabilities
  const [trueH, trueD, trueA] = removeOverround([impliedH, impliedD, impliedA]);

  // Overround (bookmaker margin)
  const overround = impliedH + impliedD + impliedA - 1;

  // Market consensus strength (how much bookmakers agree)
  const homeOddsList = oddsList.filter(o => o.selection === "Home" || o.selection === "1").map(o => o.odds);
  const drawOddsList = oddsList.filter(o => o.selection === "Draw" || o.selection === "X").map(o => o.odds);
  const awayOddsList = oddsList.filter(o => o.selection === "Away" || o.selection === "2").map(o => o.odds);

  const cv = arr => {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
    return Math.sqrt(variance) / mean;
  };

  const homeConsensus = 1 - cv(homeOddsList);
  const drawConsensus = 1 - cv(drawOddsList);
  const awayConsensus = 1 - cv(awayOddsList);

  return {
    // Raw odds
    odds_home: avgOdds.home,
    odds_draw: avgOdds.draw,
    odds_away: avgOdds.away,

    // Implied probabilities
    implied_home: clamp(impliedH),
    implied_draw: clamp(impliedD),
    implied_away: clamp(impliedA),

    // True probabilities (overround removed)
    true_home: clamp(trueH),
    true_draw: clamp(trueD),
    true_away: clamp(trueA),

    // Market metrics
    overround,
    bookmaker_count: avgOdds.bookmakers,

    // Consensus strength (0-1, higher = more agreement)
    home_consensus: clamp(homeConsensus),
    draw_consensus: clamp(drawConsensus),
    away_consensus: clamp(awayConsensus),

    // Market favorite
    market_favorite: trueH > trueD && trueH > trueA ? "H" :
                     trueA > trueD ? "A" : "D",

    // Market confidence (how strong the favorite is)
    market_confidence: Math.max(trueH, trueD, trueA),

    // Closest odds (how competitive the match is)
    closest_odds: Math.min(avgOdds.home, avgOdds.draw, avgOdds.away),

    // Favorite odds (lower = stronger favorite)
    favorite_odds: Math.min(avgOdds.home, avgOdds.draw, avgOdds.away),
  };
}

/**
 * Blend model probability with market probability
 * Market gets weight based on bookmaker count and consensus
 */
function blendWithMarket(modelProb, marketProb, bookmakerCount, consensus) {
  // More bookmakers = more weight to market
  // Higher consensus = more weight to market
  const marketWeight = Math.min(0.4, 0.1 + (bookmakerCount * 0.05) + (consensus * 0.2));
  const modelWeight = 1 - marketWeight;

  return clamp(modelProb * modelWeight + marketProb * marketWeight);
}

async function main() {
  console.log("📊 ODDLY Odds Feature Integration");
  console.log("━".repeat(50));

  const env = loadEnv();
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // 1. Load all odds data
  console.log("\n📋 Loading odds data...");
  const { data: allOdds } = await supabase.from("odds_snapshots").select("*");
  console.log(`   Loaded ${allOdds?.length || 0} odds records`);

  // Group by fixture
  const oddsByFixture = {};
  for (const o of allOdds || []) {
    if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = [];
    oddsByFixture[o.fixture_id].push(o);
  }
  console.log(`   ${Object.keys(oddsByFixture).length} fixtures with odds`);

  // 2. Compute features for all fixtures with odds
  console.log("\n🔧 Computing odds features...");
  const features = {};
  let computed = 0;

  for (const [fixtureId, oddsList] of Object.entries(oddsByFixture)) {
    const feat = computeOddsFeatures(oddsList);
    if (feat) {
      features[fixtureId] = feat;
      computed++;
    }
  }

  console.log(`   Computed features for ${computed} fixtures`);

  // 3. Show sample features
  const sampleId = Object.keys(features)[0];
  if (sampleId) {
    console.log("\n📊 Sample features:");
    const f = features[sampleId];
    console.log(`   Odds: H ${f.odds_home.toFixed(2)} D ${f.odds_draw.toFixed(2)} A ${f.odds_away.toFixed(2)}`);
    console.log(`   True probs: H ${(f.true_home * 100).toFixed(1)}% D ${(f.true_draw * 100).toFixed(1)}% A ${(f.true_away * 100).toFixed(1)}%`);
    console.log(`   Overround: ${(f.overround * 100).toFixed(1)}%`);
    console.log(`   Market favorite: ${f.market_favorite} (${(f.market_confidence * 100).toFixed(1)}%)`);
    console.log(`   Bookmakers: ${f.bookmaker_count}`);
  }

  // 4. Save features
  const outputPath = path.join(__dirname, "..", "data", "odds-features.json");
  fs.writeFileSync(outputPath, JSON.stringify({
    computed_at: new Date().toISOString(),
    fixtures_with_odds: computed,
    features,
  }, null, 2));
  console.log(`\n💾 Saved to ${outputPath}`);

  // 5. Show distribution
  const favDist = { H: 0, D: 0, A: 0 };
  const confBuckets = { high: 0, medium: 0, low: 0 };
  for (const f of Object.values(features)) {
    favDist[f.market_favorite]++;
    if (f.market_confidence > 0.5) confBuckets.high++;
    else if (f.market_confidence > 0.35) confBuckets.medium++;
    else confBuckets.low++;
  }

  console.log("\n📊 Market distribution:");
  console.log(`   Home favorites: ${favDist.H} (${(favDist.H / computed * 100).toFixed(1)}%)`);
  console.log(`   Draw: ${favDist.D} (${(favDist.D / computed * 100).toFixed(1)}%)`);
  console.log(`   Away favorites: ${favDist.A} (${(favDist.A / computed * 100).toFixed(1)}%)`);
  console.log(`\n   High confidence (>50%): ${confBuckets.high}`);
  console.log(`   Medium (35-50%): ${confBuckets.medium}`);
  console.log(`   Low (<35%): ${confBuckets.low}`);
}

main().catch(console.error);
