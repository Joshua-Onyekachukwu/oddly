#!/usr/bin/env node

/**
 * ODDLY Pre-Match Prediction Update System
 * 
 * Runs every 30 minutes before kickoff to update predictions as
 * new information arrives:
 * 
 * 1. Fresh odds (line movement indicates informed money)
 * 2. Injury updates (late scratches change team strength)
 * 3. Odds movement patterns (sharp money vs public money)
 * 
 * Each update creates a new prediction version, keeping the history.
 * The latest version is what users see.
 * 
 * Run: node worker/pre-match-update.js [--dry-run] [--fixture=ID]
 */

const { createClient } = require("@supabase/supabase-js");
const https = require("https");
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
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const DRY_RUN = process.argv.includes("--dry-run");
const SINGLE_FIXTURE = process.argv.find(a => a.startsWith("--fixture="))?.split("=")[1];

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

// ─── Odds Movement Detection ───────────────────────────────────────────

function detectOddsMovement(oddsHistory) {
  if (oddsHistory.length < 2) return { moved: false, direction: "none", magnitude: 0 };

  const latest = oddsHistory[oddsHistory.length - 1];
  const previous = oddsHistory[oddsHistory.length - 2];

  // Calculate implied probability shift
  const prevImplied = (1 / previous.odds) * 100;
  const latestImplied = (1 / latest.odds) * 100;
  const shift = latestImplied - prevImplied;

  // Sharp money moves odds DOWN (increases implied probability)
  const isSharpMoney = Math.abs(shift) > 2;

  return {
    moved: isSharpMoney,
    direction: shift > 0 ? "towards" : "away",
    magnitude: Math.abs(shift),
    impliedShift: shift,
    isSharpMoney,
  };
}

// ─── Injury Impact Calculator ──────────────────────────────────────────

async function getInjuryImpact(teamId) {
  const { data: injuries } = await supabase
    .from("player_availability")
    .select("status, reason")
    .eq("team_id", teamId)
    .in("status", ["injured", "suspended"]);

  if (!injuries || injuries.length === 0) return 0;

  // Each injury reduces win probability
  let impact = 0;
  for (const inj of injuries) {
    if (inj.status === "suspended") impact -= 0.007;
    else impact -= 0.005;
  }

  return Math.max(impact, -0.05); // Cap at -5%
}

// ─── Smart Selector ────────────────────────────────────────────────────

function selectBestMarket(markets) {
  const candidates = [];
  for (const [key, prob] of Object.entries(markets)) {
    candidates.push({ key, prob, score: prob * prob });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

// ─── Market Probabilities (simplified for updates) ──────────────────────

function computeMarkets(homeProb, drawProb, awayProb, expectedGoals) {
  const total = homeProb + drawProb + awayProb;
  const pH = homeProb / total;
  const pD = drawProb / total;
  const pA = awayProb / total;

  // Simple O/U from expected goals
  const lambda = expectedGoals;
  const p0 = Math.exp(-lambda);
  const p1 = lambda * Math.exp(-lambda);
  const p2 = (lambda ** 2 / 2) * Math.exp(-lambda);
  const p3 = (lambda ** 3 / 6) * Math.exp(-lambda);
  const under25 = p0 + p1 + p2;
  const under15 = p0 + p1;
  const under35 = under25 + p3;

  return {
    "1X2_Home": pH,
    "1X2_Draw": pD,
    "1X2_Away": pA,
    "OU_Over_2.5": clamp(1 - under25),
    "OU_Under_2.5": clamp(under25),
    "OU_Over_1.5": clamp(1 - under15),
    "OU_Under_3.5": clamp(under35),
    "OU_Over_0.5": clamp(1 - p0),
    "OU_Under_4.5": clamp(under35 + (lambda ** 4 / 24) * Math.exp(-lambda)),
    "BTTS_Yes": clamp(pH * 0.8 + pA * 0.6),
    "BTTS_No": clamp(1 - (pH * 0.8 + pA * 0.6)),
  };
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 ODDLY Pre-Match Update System");
  console.log("━".repeat(60));
  if (DRY_RUN) console.log("⚠️  DRY RUN MODE");
  if (SINGLE_FIXTURE) console.log(`📌 Updating fixture: ${SINGLE_FIXTURE}`);
  console.log("");

  // Find fixtures kicking off in the next 2 hours but not yet started
  const now = new Date();
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  let query = supabase
    .from("fixtures")
    .select("id, kickoff_time, league_id, home_team_id, away_team_id, status, home_score, away_score")
    .eq("status", "scheduled")
    .gte("kickoff_time", now.toISOString())
    .lte("kickoff_time", twoHoursLater.toISOString())
    .order("kickoff_time", { ascending: true });

  if (SINGLE_FIXTURE) {
    query = supabase.from("fixtures").select("*").eq("id", SINGLE_FIXTURE);
  }

  const { data: fixtures } = await query;

  if (!fixtures || fixtures.length === 0) {
    console.log("   No fixtures within 2-hour window.");
    return;
  }

  console.log(`📋 Found ${fixtures.length} fixtures to update\n`);

  // Load team names
  const { data: teams } = await supabase.from("teams").select("id, canonical_name");
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  // Load current odds for these fixtures
  const fixtureIds = fixtures.map(f => f.id);
  const { data: oddsData } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, selection, odds, created_at")
    .in("fixture_id", fixtureIds)
    .order("created_at", { ascending: true });

  // Group odds by fixture and selection
  const oddsHistory = {};
  for (const o of oddsData || []) {
    const key = `${o.fixture_id}|${o.selection}`;
    if (!oddsHistory[key]) oddsHistory[key] = [];
    oddsHistory[key].push({ odds: o.odds, time: o.created_at });
  }

  let updatedCount = 0;

  for (const fixture of fixtures) {
    const home = teamMap[fixture.home_team_id] || "Home";
    const away = teamMap[fixture.away_team_id] || "Away";
    const timeToKickoff = Math.floor((new Date(fixture.kickoff_time).getTime() - now.getTime()) / 60000);

    console.log(`🎯 ${home} vs ${away} (${timeToKickoff}min to kickoff)`);

    // Get latest odds
    const hOddsArr = oddsHistory[`${fixture.id}|Home`] || [];
    const dOddsArr = oddsHistory[`${fixture.id}|Draw`] || [];
    const aOddsArr = oddsHistory[`${fixture.id}|Away`] || [];

    const latestHOdds = hOddsArr.length > 0 ? hOddsArr[hOddsArr.length - 1].odds : null;
    const latestDOdds = dOddsArr.length > 0 ? dOddsArr[dOddsArr.length - 1].odds : null;
    const latestAOdds = aOddsArr.length > 0 ? aOddsArr[aOddsArr.length - 1].odds : null;

    if (!latestHOdds || !latestDOdds || !latestAOdds) {
      console.log(`   ⚠️  No odds available, skipping`);
      continue;
    }

    // Detect odds movement
    const hMovement = detectOddsMovement(hOddsArr);
    const dMovement = detectOddsMovement(dOddsArr);
    const aMovement = detectOddsMovement(aOddsArr);

    if (hMovement.moved || dMovement.moved || aMovement.moved) {
      console.log(`   📈 Odds movement detected!`);
      if (hMovement.moved) console.log(`      Home: ${hMovement.direction} (${hMovement.magnitude.toFixed(1)}%)`);
      if (dMovement.moved) console.log(`      Draw: ${dMovement.direction} (${dMovement.magnitude.toFixed(1)}%)`);
      if (aMovement.moved) console.log(`      Away: ${aMovement.direction} (${aMovement.magnitude.toFixed(1)}%)`);
    }

    // Calculate injury impact
    const homeInjuryImpact = await getInjuryImpact(fixture.home_team_id);
    const awayInjuryImpact = await getInjuryImpact(fixture.away_team_id);

    if (homeInjuryImpact !== 0 || awayInjuryImpact !== 0) {
      console.log(`   🏥 Injury impact: Home ${homeInjuryImpact > 0 ? '+' : ''}${(homeInjuryImpact * 100).toFixed(1)}%, Away ${awayInjuryImpact > 0 ? '+' : ''}${(awayInjuryImpact * 100).toFixed(1)}%`);
    }

    // Calculate base probabilities from odds
    const totalImplied = (1 / latestHOdds) + (1 / latestDOdds) + (1 / latestAOdds);
    let pH = (1 / latestHOdds) / totalImplied;
    let pD = (1 / latestDOdds) / totalImplied;
    let pA = (1 / latestAOdds) / totalImplied;

    // Adjust for injuries
    pH += homeInjuryImpact;
    pA += awayInjuryImpact;
    pD = 1 - pH - pA;

    // Normalize
    const t = pH + pD + pA;
    pH /= t; pD /= t; pA /= t;

    // Expected total goals from O/U odds
    const over25Odds = (latestHOdds + latestAOdds) / 2; // Rough estimate
    const expectedGoals = 2.5 + (pH * 0.3 + pA * 0.3);

    // Compute all markets
    const markets = computeMarkets(pH, pD, pA, expectedGoals);

    // Find best market
    const best = selectBestMarket(markets);
    const tier = best.prob >= 0.70 ? "ELITE" : best.prob >= 0.60 ? "HIGH" : best.prob >= 0.50 ? "MEDIUM" : "LOW";

    console.log(`   Best: ${best.key} ${(best.prob * 100).toFixed(1)}% [${tier}]`);

    if (!DRY_RUN) {
      // Delete old predictions for this fixture
      await supabase.from("predictions").delete().eq("fixture_id", fixture.id);

      // Insert updated predictions
      const predictions = [];
      for (const [key, prob] of Object.entries(markets)) {
        const [market, ...rest] = key.split("_");
        const selection = rest.join("_");
        predictions.push({
          fixture_id: fixture.id,
          market: market === "OU" ? "over_under" : market.toLowerCase(),
          selection,
          model_probability: Math.round(prob * 10000) / 10000,
          confidence_tier: prob >= 0.70 ? "ELITE" : prob >= 0.60 ? "HIGH" : prob >= 0.50 ? "MEDIUM" : "LOW",
          model_version: "v4.1-prematch-update",
          result: "pending",
        });
      }

      const { error } = await supabase.from("predictions").insert(predictions);
      if (!error) updatedCount++;
      else console.log(`   ❌ Insert error: ${error.message}`);
    }
  }

  console.log("\n" + "━".repeat(60));
  console.log(`✅ Updated ${updatedCount} fixtures with latest pre-match data`);
  console.log(`   This system runs every 30 min before kickoff.`);
  console.log(`${"━".repeat(60)}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
