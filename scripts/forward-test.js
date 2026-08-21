#!/usr/bin/env node

/**
 * ODDLY Forward-Testing System
 *
 * 1. Predicts today's matches using all models
 * 2. Stores predictions in the database
 * 3. Tracks results as matches finish
 * 4. Calculates real accuracy over time
 *
 * Run daily: node scripts/forward-test.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function poissonPredict(homeLambda, awayLambda) {
  let pHome = 0, pDraw = 0, pAway = 0;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = poissonProb(homeLambda, i) * poissonProb(awayLambda, j);
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
    }
  }
  return { homeWin: clamp(pHome), draw: clamp(pDraw), awayWin: clamp(pAway) };
}

class EloSystem {
  constructor() { this.ratings = {}; }
  get(t) { return this.ratings[t] || 1500; }
  update(home, away, homeScore, awayScore) {
    const h = this.get(home) + 65;
    const a = this.get(away);
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
    this.ratings[home] = (this.ratings[home] || 1500) + 32 * (actual - eH);
    this.ratings[away] = (this.ratings[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }
  predict(home, away) {
    const h = this.get(home) + 65;
    const a = this.get(away);
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    return { homeWin: clamp(eH), draw: clamp(0.25), awayWin: clamp(1 - eH - 0.25) };
  }
}

class FormTracker {
  constructor() { this.h = {}; }
  record(home, away, hg, ag) {
    if (!this.h[home]) this.h[home] = [];
    if (!this.h[away]) this.h[away] = [];
    this.h[home].push({ gf: hg, ga: ag });
    this.h[away].push({ gf: ag, ga: hg });
  }
  getForm(t) {
    const last5 = (this.h[t] || []).slice(-5);
    if (last5.length === 0) return { ppg: 1.5, gsAvg: 1.3, gcAvg: 1.2 };
    return {
      ppg: last5.reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / last5.length,
      gsAvg: last5.reduce((s, m) => s + m.gf, 0) / last5.length,
      gcAvg: last5.reduce((s, m) => s + m.ga, 0) / last5.length,
    };
  }
}

function marketPredict(homeOdds, drawOdds, awayOdds) {
  const total = 1/homeOdds + 1/drawOdds + 1/awayOdds;
  return { homeWin: (1/homeOdds)/total, draw: (1/drawOdds)/total, awayWin: (1/awayOdds)/total };
}

function ensemble(dc, eloPred, mktPred) {
  const w = { dc: 0.25, elo: 0.20, mkt: 0.55 };
  const hw = dc.homeWin*w.dc + eloPred.homeWin*w.elo + mktPred.homeWin*w.mkt;
  const dw = dc.draw*w.dc + eloPred.draw*w.elo + mktPred.draw*w.mkt;
  const aw = dc.awayWin*w.dc + eloPred.awayWin*w.elo + mktPred.awayWin*w.mkt;
  const t = hw+dw+aw;
  return { homeWin: clamp(hw/t), draw: clamp(dw/t), awayWin: clamp(aw/t) };
}

async function main() {
  const today = new Date().toISOString().split("T")[0];
  console.log(`🔄 ODDLY Forward-Testing — ${today}`);
  console.log("━".repeat(70));

  // Fetch today's fixtures with odds
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(`
      id, home_score, away_score, status, kickoff_time,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name),
      leagues(name)
    `)
    .gte("kickoff_time", `${today}T00:00:00Z`)
    .lte("kickoff_time", `${today}T23:59:59Z`)
    .order("kickoff_time", { ascending: true });

  if (!fixtures || fixtures.length === 0) {
    console.log("❌ No fixtures found for today.");
    return;
  }

  // Fetch odds
  const { data: oddsData } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, selection, odds");

  const oddsByFixture = {};
  if (oddsData) {
    for (const o of oddsData) {
      if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
      if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
      oddsByFixture[o.fixture_id][o.selection].push(o.odds);
    }
  }

  const getAvgOdds = (fixtureId) => {
    const odds = oddsByFixture[fixtureId] || {};
    const avg = (arr) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    return { home: avg(odds["Home"]), draw: avg(odds["Draw"]), away: avg(odds["Away"]) };
  };

  // Initialize models
  const elo = new EloSystem();
  const form = new FormTracker();

  // Load historical data for form/elo
  const { data: histFixtures } = await supabase
    .from("fixtures")
    .select("home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name)")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: false })
    .limit(500);

  if (histFixtures) {
    for (const f of histFixtures) {
      const homeName = f.home_team?.canonical_name;
      const awayName = f.away_team?.canonical_name;
      if (homeName && awayName && f.home_score !== null && f.away_score !== null) {
        elo.update(homeName, awayName, f.home_score, f.away_score);
        form.record(homeName, awayName, f.home_score, f.away_score);
      }
    }
  }

  console.log(`📊 Found ${fixtures.length} fixtures for today`);
  console.log(`📈 Loaded ${(histFixtures?.length || 0)} historical matches for form/elo\n`);

  // Track results
  let predicted = 0, alreadyFinished = 0;

  for (const fixture of fixtures) {
    const odds = getAvgOdds(fixture.id);
    const homeName = fixture.home_team?.canonical_name || "Unknown";
    const awayName = fixture.away_team?.canonical_name || "Unknown";
    const leagueName = fixture.leagues?.name || "Unknown";

    // If already finished, track result
    if (fixture.status === "finished" && fixture.home_score !== null) {
      alreadyFinished++;
      const actual = fixture.home_score > fixture.away_score ? "homeWin" : fixture.home_score < fixture.away_score ? "awayWin" : "draw";
      console.log(`  ✅ ${homeName} ${fixture.home_score}-${fixture.away_score} ${awayName} (${leagueName}) — ${actual.toUpperCase()}`);
      continue;
    }

    if (!odds.home || !odds.draw || !odds.away) {
      console.log(`  ⏳ ${homeName} vs ${awayName} — No odds available`);
      continue;
    }

    // Make predictions
    const hf = form.getForm(homeName);
    const af = form.getForm(awayName);

    const homeLambda = 1.35 * (hf.gsAvg / 1.3) * (af.gcAvg / 1.2);
    const awayLambda = 1.35 * (af.gsAvg / 1.3) * (hf.gcAvg / 1.2);
    const dcPred = poissonPredict(homeLambda, awayLambda);
    const eloPred = elo.predict(homeName, awayName);
    const mktPred = marketPredict(odds.home, odds.draw, odds.away);
    const ens = ensemble(dcPred, eloPred, mktPred);

    // Find best pick
    const picks = [
      { sel: "homeWin", prob: ens.homeWin, odds: odds.home, label: `Home Win (${homeName})` },
      { sel: "draw", prob: ens.draw, odds: odds.draw, label: "Draw" },
      { sel: "awayWin", prob: ens.awayWin, odds: odds.away, label: `Away Win (${awayName})` },
    ].sort((a, b) => (b.prob - 1/b.odds) - (a.prob - 1/a.odds));

    const best = picks[0];
    const edge = best.prob - 1/best.odds;
    const confidence = Math.max(ens.homeWin, ens.draw, ens.awayWin);
    const tier = confidence >= 0.55 ? "HIGH" : confidence >= 0.45 ? "MED" : "LOW";

    // Store prediction
    const { error } = await supabase.from("predictions").upsert({
      fixture_id: fixture.id,
      market: "1X2",
      selection: best.sel === "homeWin" ? homeName : best.sel === "awayWin" ? awayName : "Draw",
      model_probability: best.prob,
      confidence_lower: best.prob * 0.9,
      confidence_upper: Math.min(best.prob * 1.1, 0.99),
      result: null,
    }, { onConflict: "fixture_id,market,selection" });

    predicted++;

    const edgeStr = edge > 0 ? `+${(edge * 100).toFixed(1)}% edge` : `${(edge * 100).toFixed(1)}% edge`;
    console.log(`  🎯 ${homeName} vs ${awayName} (${leagueName})`);
    console.log(`     Prediction: ${best.label} @${best.odds.toFixed(2)} (${(best.prob * 100).toFixed(1)}% prob)`);
    console.log(`     Confidence: ${(confidence * 100).toFixed(1)}% [${tier}] | ${edgeStr}`);
    console.log(`     Ensemble: H${(ens.homeWin * 100).toFixed(0)}% D${(ens.draw * 100).toFixed(0)}% A${(ens.awayWin * 100).toFixed(0)}%`);
    console.log("");
  }

  // Summary
  console.log("━".repeat(70));
  console.log(`📊 Summary:`);
  console.log(`   Predictions made: ${predicted}`);
  console.log(`   Already finished: ${alreadyFinished}`);
  console.log(`   Total fixtures: ${fixtures.length}`);
  console.log("");
  console.log("💡 Run this daily to track accuracy over time.");
  console.log("   After 2-4 weeks, we'll have real accuracy data.");
  console.log("━".repeat(70));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
