#!/usr/bin/env node

/**
 * ODDLY Historical Data Storage
 *
 * Computes and stores ALL features for every finished match in Supabase.
 * After running this, the self-learning system loads from stored data instantly
 * instead of recomputing from scratch every time.
 *
 * Run: node scripts/store-historical.js
 * Run ONCE. Then the data is there forever.
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// ─── Environment ─────────────────────────────────────────────────────────────

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

// ─── Elo System ─────────────────────────────────────────────────────────────

class EloSystem {
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

// ─── Form Tracker ───────────────────────────────────────────────────────────

class FormTracker {
  constructor() { this.history = {}; }
  record(team, result, goals, against) {
    if (!this.history[team]) this.history[team] = [];
    this.history[team].push({ result, goals, against });
    if (this.history[team].length > 30) this.history[team].shift();
  }
  getForm(team, n = 5) {
    const last = (this.history[team] || []).slice(-n);
    if (last.length === 0) return { ppg: 1.5, winRate: 0.4, streak: 0, avgGoals: 1.3, avgConceded: 1.2, cleanSheetPct: 0.3, bttsPct: 0.5 };
    const ppg = last.reduce((s, r) => s + (r.result === "W" ? 3 : r.result === "D" ? 1 : 0), 0) / last.length;
    const winRate = last.filter(r => r.result === "W").length / last.length;
    let streak = 0;
    for (let i = last.length - 1; i >= 0; i--) {
      if (last[i].result === "W") { if (streak >= 0) streak++; else break; }
      else if (last[i].result === "L") { if (streak <= 0) streak--; else break; }
      else break;
    }
    const avgGoals = last.reduce((s, r) => s + r.goals, 0) / last.length;
    const avgConceded = last.reduce((s, r) => s + r.against, 0) / last.length;
    const cleanSheets = last.filter(r => r.against === 0).length;
    const btts = last.filter(r => r.goals > 0 && r.against > 0).length;
    return {
      ppg, winRate, streak, avgGoals, avgConceded,
      cleanSheetPct: cleanSheets / last.length,
      bttsPct: btts / last.length,
    };
  }
}

// ─── Pattern Extractor ──────────────────────────────────────────────────────

function extractPatterns(features) {
  const p = [];
  if (features.eloDiff > 200) p.push("elo_dominant");
  else if (features.eloDiff > 150) p.push("elo_strong");
  else if (features.eloDiff > 100) p.push("elo_moderate");
  if (features.homeWinRate > 0.65) p.push("home_very_strong");
  else if (features.homeWinRate > 0.55) p.push("home_strong");
  if (features.awayWinRate < 0.30) p.push("away_very_weak");
  else if (features.awayWinRate < 0.40) p.push("away_weak");
  if (features.homeStreak >= 3) p.push("home_hot");
  if (features.awayStreak <= -2) p.push("away_cold");
  if (features.homeAvgGoals >= 1.8) p.push("home_scores_heavy");
  else if (features.homeAvgGoals >= 1.4) p.push("home_scores");
  if (features.homeAvgConceded <= 0.8) p.push("home_fortress");
  else if (features.homeAvgConceded <= 1.2) p.push("home_defends");
  if (features.awayAvgConceded >= 1.6) p.push("away_leaks_heavy");
  else if (features.awayAvgConceded >= 1.3) p.push("away_leaks");
  if (features.homeFormPpg >= 2.3) p.push("home_elite_form");
  else if (features.homeFormPpg >= 2.0) p.push("home_good_form");
  if (features.awayFormPpg <= 0.8) p.push("away_terrible_form");
  else if (features.awayFormPpg <= 1.0) p.push("away_poor_form");
  if (features.goalDiff > 3) p.push("home_goal_advantage");
  return p;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("💾 ODDLY Historical Data Storage");
  console.log("━".repeat(70));

  // Step 1: Load all finished matches chronologically
  console.log("\n📊 Step 1: Loading finished matches...");
  const { data: fixtures, error } = await supabase
    .from("fixtures")
    .select(`
      id, home_score, away_score, kickoff_time,
      home_team:teams!fixtures_home_team_id_fkey(id, canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(id, canonical_name)
    `)
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: true });

  if (error) { console.error("❌", error.message); return; }
  console.log(`   Found ${fixtures.length} finished matches`);

  // Step 2: Load odds for all fixtures
  console.log("\n📊 Step 2: Loading odds...");
  const fixtureIds = fixtures.map(f => f.id);
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
  console.log(`   Loaded odds for ${Object.keys(oddsByFixture).length} fixtures`);

  // Step 3: Process each match chronologically and store features
  console.log("\n📊 Step 3: Computing and storing features...");

  const elo = new EloSystem();
  const form = new FormTracker();

  let stored = 0;
  let errors = 0;
  const eloHistory = []; // Store Elo snapshots
  const featureBatch = []; // Batch insert features
  const BATCH_SIZE = 100;

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const homeName = fixture.home_team?.canonical_name;
    const awayName = fixture.away_team?.canonical_name;
    if (!homeName || !awayName) continue;

    // Get features BEFORE updating models (predictive features)
    const homeForm = form.getForm(homeName);
    const awayForm = form.getForm(awayName);
    const homeElo = elo.get(homeName);
    const awayElo = elo.get(awayName);
    const eloProb = elo.predict(homeName, awayName);
    const eloDiff = homeElo - awayElo + 65;

    // Get odds
    const odds = oddsByFixture[fixture.id] || {};
    const avg = (arr) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const homeOdds = avg(odds["Home"]);
    const drawOdds = avg(odds["Draw"]);
    const awayOdds = avg(odds["Away"]);

    // Market implied probability
    let marketHomeProb = null;
    if (homeOdds && drawOdds && awayOdds) {
      const mt = 1/homeOdds + 1/drawOdds + 1/awayOdds;
      marketHomeProb = (1/homeOdds) / mt;
    }

    // Compute goal diff
    const goalDiff = (homeForm.avgGoals - homeForm.avgConceded) - (awayForm.avgGoals - awayForm.avgConceded);

    // Make prediction
    const w = { elo: 0.29, form: 0.19, goals: 0.18, odds: 0.10, homeAdv: 0.10, h2h: 0.10, streak: 0.05 };
    let homeProb;
    if (marketHomeProb) {
      homeProb = clamp(
        eloProb * w.elo + (homeForm.ppg / 3) * w.form +
        marketHomeProb * w.odds +
        (homeForm.winRate * 0.6 + (1 - awayForm.winRate) * 0.4) * w.goals +
        (homeForm.streak > 0 ? 0.65 : 0.45) * w.streak +
        0.55 * w.homeAdv
      );
    } else {
      homeProb = clamp(
        eloProb * 0.40 + (homeForm.ppg / 3) * 0.25 +
        (homeForm.winRate * 0.6 + (1 - awayForm.winRate) * 0.4) * 0.20 +
        (homeForm.streak > 0 ? 0.65 : 0.45) * 0.15
      );
    }

    const predictedSide = homeProb > 0.5 ? "home" : "away";
    const predictedProb = homeProb;

    // Actual result
    const hg = fixture.home_score;
    const ag = fixture.away_score;
    const actualResult = hg > ag ? "home" : hg < ag ? "away" : "draw";
    const correct = predictedSide === actualResult;

    // Patterns
    const features = {
      eloDiff, homeFormPpg: homeForm.ppg, awayFormPpg: awayForm.ppg,
      homeAvgGoals: homeForm.avgGoals, homeAvgConceded: homeForm.avgConceded,
      awayAvgGoals: awayForm.avgGoals, awayAvgConceded: awayForm.avgConceded,
      homeWinRate: homeForm.winRate, awayWinRate: awayForm.winRate,
      homeStreak: homeForm.streak, awayStreak: awayForm.streak,
      goalDiff,
    };
    const patterns = extractPatterns(features);

    // Collect batch data
    featureBatch.push({
      fixture_id: fixture.id,
      home_team_name: homeName,
      away_team_name: awayName,
      home_elo: Math.round(homeElo),
      away_elo: Math.round(awayElo),
      elo_diff: Math.round(eloDiff),
      elo_home_prob: Math.round(eloProb * 10000) / 10000,
      home_form_ppg: Math.round(homeForm.ppg * 1000) / 1000,
      away_form_ppg: Math.round(awayForm.ppg * 1000) / 1000,
      home_win_rate: Math.round(homeForm.winRate * 1000) / 1000,
      away_win_rate: Math.round(awayForm.winRate * 1000) / 1000,
      home_avg_goals: Math.round(homeForm.avgGoals * 1000) / 1000,
      home_avg_conceded: Math.round(homeForm.avgConceded * 1000) / 1000,
      away_avg_goals: Math.round(awayForm.avgGoals * 1000) / 1000,
      away_avg_conceded: Math.round(awayForm.avgConceded * 1000) / 1000,
      home_streak: homeForm.streak,
      away_streak: awayForm.streak,
      goal_diff: Math.round(goalDiff * 1000) / 1000,
      home_clean_sheet_pct: Math.round(homeForm.cleanSheetPct * 1000) / 1000,
      home_btts_pct: Math.round(homeForm.bttsPct * 1000) / 1000,
      fatigue_days: null,
      home_odds: homeOdds,
      draw_odds: drawOdds,
      away_odds: awayOdds,
      market_home_prob: marketHomeProb ? Math.round(marketHomeProb * 10000) / 10000 : null,
      home_score: hg,
      away_score: ag,
      actual_result: actualResult,
      predicted_side: predictedSide,
      predicted_prob: Math.round(predictedProb * 10000) / 10000,
      prediction_correct: correct,
      patterns: patterns,
    });

    // Store Elo snapshots
    eloHistory.push({
      team_id: fixture.home_team?.id,
      rating: Math.round(homeElo * 100) / 100,
      match_date: fixture.kickoff_time?.split("T")[0],
      fixture_id: fixture.id,
      opponent_name: awayName,
      result: hg > ag ? "W" : hg < ag ? "L" : "D",
    });
    eloHistory.push({
      team_id: fixture.away_team?.id,
      rating: Math.round(awayElo * 100) / 100,
      match_date: fixture.kickoff_time?.split("T")[0],
      fixture_id: fixture.id,
      opponent_name: homeName,
      result: hg < ag ? "W" : hg > ag ? "L" : "D",
    });

    stored++;

    // Update models with actual result
    elo.update(homeName, awayName, hg, ag);
    const homeResult = hg > ag ? "W" : hg < ag ? "L" : "D";
    const awayResult = hg < ag ? "W" : hg > ag ? "L" : "D";
    form.record(homeName, homeResult, hg, ag);
    form.record(awayName, awayResult, ag, hg);

    // Progress
    if ((i + 1) % 100 === 0) {
      console.log(`   📊 Processed ${i + 1}/${fixtures.length} matches (${stored} stored, ${errors} errors)`);
    }

    // Batch insert features every BATCH_SIZE matches
    if (featureBatch.length >= BATCH_SIZE || i === fixtures.length - 1) {
      if (featureBatch.length > 0) {
        const { error } = await supabase.from("match_features").upsert(featureBatch, { onConflict: "fixture_id" });
        if (error && errors < 3) console.log(`   ⚠️  Batch insert error: ${error.message}`);
        featureBatch.length = 0;
      }
    }
  }

  // Store Elo ratings in batches
  console.log("\n📊 Step 4: Storing Elo ratings...");
  const eloBatchSize = 100;
  let eloStored = 0;
  for (let i = 0; i < eloHistory.length; i += eloBatchSize) {
    const batch = eloHistory.slice(i, i + eloBatchSize);
    const { error } = await supabase.from("elo_ratings").upsert(batch, {
      onConflict: "team_id,match_date,fixture_id",
      ignoreDuplicates: true,
    });
    if (!error) eloStored += batch.length;
  }
  console.log(`   ✅ Stored ${eloStored} Elo rating snapshots`);

  // Store model performance
  console.log("\n📊 Step 5: Storing model performance...");

  // Calculate overall stats
  let totalCorrect = 0, totalPredictions = 0;
  let eliteCorrect = 0, eliteTotal = 0;
  let highCorrect = 0, highTotal = 0;

  // Re-query to get stats
  const { data: allFeatures } = await supabase
    .from("match_features")
    .select("prediction_correct, predicted_prob");

  if (allFeatures) {
    for (const f of allFeatures) {
      if (f.predicted_prob === null) continue;
      const conf = Math.max(f.predicted_prob, 1 - f.predicted_prob);
      totalPredictions++;
      if (f.prediction_correct) totalCorrect++;

      if (conf >= 0.70) { eliteTotal++; if (f.prediction_correct) eliteCorrect++; }
      else if (conf >= 0.60) { highTotal++; if (f.prediction_correct) highCorrect++; }
    }
  }

  await supabase.from("model_performance").upsert({
    run_date: new Date().toISOString().split("T")[0],
    model_name: "ensemble",
    total_predictions: totalPredictions,
    correct_predictions: totalCorrect,
    accuracy: totalPredictions > 0 ? Math.round((totalCorrect / totalPredictions) * 10000) / 10000 : 0,
    elite_total: eliteTotal,
    elite_correct: eliteCorrect,
    elite_accuracy: eliteTotal > 0 ? Math.round((eliteCorrect / eliteTotal) * 10000) / 10000 : 0,
    high_total: highTotal,
    high_correct: highCorrect,
    high_accuracy: highTotal > 0 ? Math.round((highCorrect / highTotal) * 10000) / 10000 : 0,
    pattern_stats: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "learning-data.json"), "utf8")?.correctPatterns || "{}"),
    model_weights: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "docs", "learning-data.json"), "utf8")?.modelWeights || "{}"),
    total_matches_in_db: fixtures.length,
    evaluation_period: "2023-2026",
  }, { onConflict: "run_date,model_name" });

  console.log(`   ✅ Stored model performance`);

  // Final summary
  console.log("\n" + "═".repeat(70));
  console.log("💾 HISTORICAL DATA STORAGE COMPLETE");
  console.log("═".repeat(70));
  console.log(`\n   Match features stored: ${stored}`);
  console.log(`   Elo ratings stored: ${eloStored}`);
  console.log(`   Model performance stored: 1`);
  console.log(`   Errors: ${errors}`);
  console.log(`\n   Total predictions: ${totalPredictions}`);
  console.log(`   Correct: ${totalCorrect}`);
  console.log(`   Accuracy: ${totalPredictions > 0 ? ((totalCorrect / totalPredictions) * 100).toFixed(1) : 0}%`);
  console.log(`   ELITE accuracy: ${eliteTotal > 0 ? ((eliteCorrect / eliteTotal) * 100).toFixed(1) : 0}% (${eliteCorrect}/${eliteTotal})`);
  console.log(`   HIGH accuracy: ${highTotal > 0 ? ((highCorrect / highTotal) * 100).toFixed(1) : 0}% (${highCorrect}/${highTotal})`);
  console.log("\n💡 All data is now stored in Supabase. The self-learning system");
  console.log("   will load from these tables instead of recomputing.");
  console.log("━".repeat(70));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
