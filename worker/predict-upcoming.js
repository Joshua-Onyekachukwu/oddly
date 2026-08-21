#!/usr/bin/env node

/**
 * Generate predictions for ALL upcoming fixtures (not just today)
 * Used to populate the upcoming matches UI with real prediction data
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
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }
function now() { return new Date().toISOString(); }

// ─── Elo System ───────────────────────────────────────────────────────────
class EloModel {
  constructor() { this.ratings = {}; }
  get(t) { return this.ratings[t] || 1500; }
  predict(home, away) {
    const h = this.get(home) + 65;
    const a = this.get(away);
    return 1 / (1 + Math.pow(10, (a - h) / 400));
  }
  update(home, away, hg, ag) {
    const h = this.get(home) + 65;
    const a = this.get(away);
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.ratings[home] = this.get(home) + 32 * (actual - eH);
    this.ratings[away] = this.get(away) + 32 * ((1 - actual) - (1 - eH));
  }
}

// ─── Form Tracker ─────────────────────────────────────────────────────────
class FormTracker {
  constructor() { this.history = {}; }
  record(team, result, goals, against) {
    if (!this.history[team]) this.history[team] = [];
    this.history[team].push({ result, goals, against });
    if (this.history[team].length > 30) this.history[team].shift();
  }
  getForm(team, n = 5) {
    const last = (this.history[team] || []).slice(-n);
    if (last.length === 0) return { ppg: 1.5, winRate: 0.4, streak: 0, avgGoals: 1.3, avgConceded: 1.2 };
    const ppg = last.reduce((s, r) => s + (r.result === "W" ? 3 : r.result === "D" ? 1 : 0), 0) / last.length;
    const winRate = last.filter(r => r.result === "W").length / last.length;
    let streak = 0;
    for (let i = last.length - 1; i >= 0; i--) {
      if (last[i].result === "W") { if (streak >= 0) streak++; else break; }
      else if (last[i].result === "L") { if (streak <= 0) streak--; else break; }
      else break;
    }
    return {
      ppg, winRate, streak,
      avgGoals: last.reduce((s, r) => s + r.goals, 0) / last.length,
      avgConceded: last.reduce((s, r) => s + r.against, 0) / last.length,
    };
  }
}

async function main() {
  console.log("🎯 Generating predictions for ALL upcoming fixtures...");

  // Load all finished fixtures to calibrate Elo and form
  const elo = new EloModel();
  const form = new FormTracker();

  console.log("   Loading historical matches for calibration...");
  
  // Load in batches
  let offset = 0;
  const batchSize = 500;
  let totalLoaded = 0;
  
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), home_score, away_score, kickoff_time")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + batchSize - 1);
    
    if (!batch || batch.length === 0) break;
    
    for (const m of batch) {
      const homeName = m.home_team?.canonical_name;
      const awayName = m.away_team?.canonical_name;
      if (!homeName || !awayName) continue;
      
      const hg = m.home_score;
      const ag = m.away_score;
      
      elo.update(homeName, awayName, hg, ag);
      
      const homeResult = hg > ag ? "W" : hg < ag ? "L" : "D";
      const awayResult = hg > ag ? "L" : hg < ag ? "W" : "D";
      
      form.record(homeName, homeResult, hg, ag);
      form.record(awayName, awayResult, ag, hg);
    }
    
    totalLoaded += batch.length;
    offset += batchSize;
    
    if (batch.length < batchSize) break;
  }
  
  console.log(`   Loaded ${totalLoaded} finished matches for calibration`);

  // Get ALL upcoming fixtures
  const now_ = new Date().toISOString();
  const { data: upcoming } = await supabase
    .from("fixtures")
    .select(`
      id, kickoff_time, status,
      home_team:teams!fixtures_home_team_id_fkey(id, canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(id, canonical_name),
      leagues(id, name)
    `)
    .eq("status", "scheduled")
    .gte("kickoff_time", now_)
    .order("kickoff_time", { ascending: true });

  if (!upcoming || upcoming.length === 0) {
    console.log("   No upcoming fixtures found.");
    return;
  }

  console.log(`   Found ${upcoming.length} upcoming fixtures`);

  // Get odds for all fixtures
  const fixtureIds = upcoming.map(f => f.id);
  const { data: oddsData } = await supabase
    .from("odds_snapshots")
    .select("fixture_id, selection, odds")
    .in("fixture_id", fixtureIds);

  const oddsByFixture = {};
  if (oddsData) {
    for (const o of oddsData) {
      if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
      if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
      oddsByFixture[o.fixture_id][o.selection].push(o.odds);
    }
  }

  // Generate predictions
  const predictions = [];
  let batchInserts = [];

  for (const fixture of upcoming) {
    const homeName = fixture.home_team?.canonical_name;
    const awayName = fixture.away_team?.canonical_name;
    if (!homeName || !awayName) continue;

    const homeForm = form.getForm(homeName);
    const awayForm = form.getForm(awayName);
    const homeElo = elo.get(homeName);
    const awayElo = elo.get(awayName);
    const eloProb = elo.predict(homeName, awayName);
    const eloDiff = homeElo - awayElo + 65;

    // Compute market-implied probability from odds
    const fixtureOdds = oddsByFixture[fixture.id] || {};
    const avgOdds = (sel) => {
      const arr = fixtureOdds[sel];
      return arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    };
    const homeOdds = avgOdds("Home") || avgOdds("home");
    const drawOdds = avgOdds("Draw") || avgOdds("draw");
    const awayOdds = avgOdds("Away") || avgOdds("away");

    let marketHomeProb = null;
    if (homeOdds && drawOdds && awayOdds) {
      const mt = 1/homeOdds + 1/drawOdds + 1/awayOdds;
      marketHomeProb = (1/homeOdds) / mt;
    }

    // Blend Elo with form
    let homeProb = eloProb;
    const formDiff = homeForm.ppg - awayForm.ppg;
    homeProb += formDiff * 0.08;
    
    // Goals-based adjustments
    homeProb += (homeForm.avgGoals - 1.3) * 0.04;
    homeProb -= (awayForm.avgGoals - 1.3) * 0.04;
    homeProb -= (homeForm.avgConceded - 1.2) * 0.03;
    homeProb += (awayForm.avgConceded - 1.2) * 0.03;
    
    // Home advantage adjustment
    if (homeForm.winRate > 0.60) homeProb += 0.05;
    if (awayForm.winRate < 0.35) homeProb += 0.05;
    
    // Streak
    homeProb += (homeForm.streak > 2 ? 0.05 : homeForm.streak < -2 ? -0.05 : 0);
    homeProb -= (awayForm.streak > 2 ? 0.03 : awayForm.streak < -2 ? -0.03 : 0);
    
    // Blend with market
    if (marketHomeProb) {
      homeProb = homeProb * 0.7 + marketHomeProb * 0.3;
    }
    
    homeProb = clamp(homeProb);

    // Predictions for main markets
    const mainPrediction = {
      fixture_id: fixture.id,
      market: "1X2",
      selection: homeName,
      model_probability: Math.round(homeProb * 10000) / 10000,
      confidence_lower: Math.round(clamp(homeProb * 0.9) * 10000) / 10000,
      confidence_upper: Math.round(clamp(homeProb * 1.1) * 10000) / 10000,
      model_version: "v2.0",
      result: "pending",
    };

    // Over/Under 2.5 prediction
    const expectedGoals = (homeForm.avgGoals + awayForm.avgGoals) / 2;
    const over25Prob = clamp(0.50 + (expectedGoals - 2.5) * 0.20);
    const under35Prob = clamp(0.50 + (3.5 - expectedGoals) * 0.15);
    
    // BTTS prediction
    const bttsProb = clamp(0.45 + homeForm.winRate * 0.15 + awayForm.winRate * 0.1 + 
      (homeForm.avgGoals > 1.2 ? 0.05 : 0) + (awayForm.avgGoals > 1.0 ? 0.05 : 0));

    batchInserts.push(mainPrediction);
    batchInserts.push({
      fixture_id: fixture.id,
      market: "over_under",
      selection: "over_2.5",
      model_probability: Math.round(over25Prob * 10000) / 10000,
      confidence_lower: Math.round(clamp(over25Prob * 0.9) * 10000) / 10000,
      confidence_upper: Math.round(clamp(over25Prob * 1.1) * 10000) / 10000,
      model_version: "v2.0",
      result: "pending",
    });
    batchInserts.push({
      fixture_id: fixture.id,
      market: "over_under",
      selection: "under_3.5",
      model_probability: Math.round(under35Prob * 10000) / 10000,
      confidence_lower: Math.round(clamp(under35Prob * 0.9) * 10000) / 10000,
      confidence_upper: Math.round(clamp(under35Prob * 1.1) * 10000) / 10000,
      model_version: "v2.0",
      result: "pending",
    });
    batchInserts.push({
      fixture_id: fixture.id,
      market: "btts",
      selection: "yes",
      model_probability: Math.round(bttsProb * 10000) / 10000,
      confidence_lower: Math.round(clamp(bttsProb * 0.9) * 10000) / 10000,
      confidence_upper: Math.round(clamp(bttsProb * 1.1) * 10000) / 10000,
      model_version: "v2.0",
      result: "pending",
    });

    predictions.push(mainPrediction);
  }

  // Batch insert predictions
  console.log(`   Inserting ${batchInserts.length} predictions...`);
  
  // Insert in batches of 50
  for (let i = 0; i < batchInserts.length; i += 50) {
    const batch = batchInserts.slice(i, i + 50);
    const { error } = await supabase.from("predictions").insert(batch);
    if (error) {
      console.error(`   ❌ Batch insert error:`, error.message);
    }
  }

  console.log(`\n✅ Generated ${predictions.length} main predictions + ${batchInserts.length - predictions.length} market predictions`);
  console.log(`   Total: ${batchInserts.length} predictions for ${upcoming.length} fixtures`);
  
  // Summary
  const probabilities = predictions.map(p => p.model_probability);
  const avgProb = probabilities.reduce((s, p) => s + p, 0) / probabilities.length;
  const highConf = probabilities.filter(p => p >= 0.65).length;
  const veryHigh = probabilities.filter(p => p >= 0.70).length;
  
  console.log(`\n📊 Summary:`);
  console.log(`   Average probability: ${(avgProb * 100).toFixed(1)}%`);
  console.log(`   High confidence (65%+): ${highConf} matches`);
  console.log(`   Very high confidence (70%+): ${veryHigh} matches`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
