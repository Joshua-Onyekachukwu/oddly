#!/usr/bin/env node

/**
 * ODDLY Self-Learning System v3
 *
 * THE FULL LEARNING LOOP:
 * 1. Load pre-computed features from `match_features` table (instant)
 * 2. If no stored features, compute them from scratch and store
 * 3. Evaluate predictions using stored features
 * 4. Optimize model weights
 * 5. Predict upcoming matches using learned weights
 * 6. Store predictions in `prediction_history` table
 * 7. Check yesterday's predictions vs actual results
 * 8. Update model_performance with latest accuracy
 * 9. Every day: load → predict → check → learn → repeat
 *
 * Run: node scripts/self-learning.js
 * Prerequisites: Run `node scripts/store-historical.js` first (once)
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

// ─── Learning Database (local cache for weights) ────────────────────────────

const LEARNING_FILE = path.join(__dirname, "..", "docs", "learning-data.json");

function loadLearningData() {
  if (fs.existsSync(LEARNING_FILE)) {
    try { return JSON.parse(fs.readFileSync(LEARNING_FILE, "utf8")); } catch { }
  }
  return {
    modelWeights: { elo: 0.29, form: 0.19, goals: 0.18, odds: 0.10, homeAdv: 0.10, h2h: 0.10, streak: 0.05 },
    accuracy: { total: 0, correct: 0 },
    lastUpdated: null,
  };
}

function saveLearningData(data) {
  data.lastUpdated = new Date().toISOString();
  const dir = path.dirname(LEARNING_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
}

// ─── Pattern Extractor ──────────────────────────────────────────────────────

function extractPatterns(f) {
  const p = [];
  if (f.elo_diff > 200) p.push("elo_dominant");
  else if (f.elo_diff > 150) p.push("elo_strong");
  else if (f.elo_diff > 100) p.push("elo_moderate");
  if (f.home_win_rate > 0.65) p.push("home_very_strong");
  else if (f.home_win_rate > 0.55) p.push("home_strong");
  if (f.away_win_rate < 0.30) p.push("away_very_weak");
  else if (f.away_win_rate < 0.40) p.push("away_weak");
  if (f.home_streak >= 3) p.push("home_hot");
  if (f.away_streak <= -2) p.push("away_cold");
  if (f.home_avg_goals >= 1.8) p.push("home_scores_heavy");
  else if (f.home_avg_goals >= 1.4) p.push("home_scores");
  if (f.home_avg_conceded <= 0.8) p.push("home_fortress");
  else if (f.home_avg_conceded <= 1.2) p.push("home_defends");
  if (f.away_avg_conceded >= 1.6) p.push("away_leaks_heavy");
  else if (f.away_avg_conceded >= 1.3) p.push("away_leaks");
  if (f.home_form_ppg >= 2.3) p.push("home_elite_form");
  else if (f.home_form_ppg >= 2.0) p.push("home_good_form");
  if (f.away_form_ppg <= 0.8) p.push("away_terrible_form");
  else if (f.away_form_ppg <= 1.0) p.push("away_poor_form");
  if (f.goal_diff > 3) p.push("home_goal_advantage");
  return p;
}

// ─── Self-Learning Engine ──────────────────────────────────────────────────

class SelfLearningEngine {
  constructor() {
    this.learning = loadLearningData();
  }

  /**
   * STEP 1: Load pre-computed features from database (instant)
   * If no features exist, run a full backtest and store them.
   */
  async loadFeatures() {
    console.log("\n💾 Loading pre-computed features from database...");

    const { data: features, error } = await supabase
      .from("match_features")
      .select("*")
      .order("computed_at", { ascending: true });

    if (error) {
      console.log(`   ⚠️  Table not found: ${error.message}`);
      console.log("   Run: node scripts/store-historical.js (first time only)");
      return null;
    }

    if (!features || features.length === 0) {
      console.log("   ⚠️  No stored features found");
      console.log("   Run: node scripts/store-historical.js (first time only)");
      return null;
    }

    console.log(`   ✅ Loaded ${features.length} pre-computed features`);
    return features;
  }

  /**
   * STEP 2: Load learned weights from model_performance table
   */
  async loadWeights() {
    const { data: perf } = await supabase
      .from("model_performance")
      .select("model_weights, elite_accuracy, accuracy, run_date")
      .eq("model_name", "ensemble")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (perf?.model_weights) {
      const w = typeof perf.model_weights === "string" ? JSON.parse(perf.model_weights) : perf.model_weights;
      this.learning.modelWeights = w;
      console.log(`   ✅ Loaded weights from ${perf.run_date} (ELITE: ${(perf.elite_accuracy * 100).toFixed(1)}%)`);
      return w;
    }

    console.log("   ⚠️  No stored weights found, using defaults");
    return this.learning.modelWeights;
  }

  /**
   * STEP 3: Evaluate accuracy using stored features
   */
  evaluateFromFeatures(features) {
    console.log("\n📊 Evaluating accuracy from stored features...");

    const w = this.learning.modelWeights;
    const results = {
      total: 0, correct: 0,
      byTier: { ELITE: { t: 0, c: 0 }, HIGH: { t: 0, c: 0 }, MEDIUM: { t: 0, c: 0 }, LOW: { t: 0, c: 0 } },
      correctPatterns: {}, wrongPatterns: {},
    };

    for (const f of features) {
      if (f.home_score === null || f.actual_result === null) continue;

      // Recompute prediction with current weights
      let homeProb;
      if (f.home_odds && f.draw_odds && f.away_odds) {
        const mt = 1/f.home_odds + 1/f.draw_odds + 1/f.away_odds;
        const mh = (1/f.home_odds) / mt;
        homeProb = clamp(
          f.elo_home_prob * w.elo +
          (f.home_form_ppg / 3) * w.form +
          mh * w.odds +
          (f.home_win_rate * 0.6 + (1 - f.away_win_rate) * 0.4) * w.goals +
          (f.home_streak > 0 ? 0.65 : 0.45) * w.streak +
          0.55 * w.homeAdv
        );
      } else {
        homeProb = clamp(
          f.elo_home_prob * 0.40 + (f.home_form_ppg / 3) * 0.25 +
          (f.home_win_rate * 0.6 + (1 - f.away_win_rate) * 0.4) * 0.20 +
          (f.home_streak > 0 ? 0.65 : 0.45) * 0.15
        );
      }

      const predictedSide = homeProb > 0.5 ? "home" : "away";
      const confidence = Math.max(homeProb, 1 - homeProb);
      const tier = confidence >= 0.70 ? "ELITE" : confidence >= 0.60 ? "HIGH" : confidence >= 0.50 ? "MEDIUM" : "LOW";
      const correct = predictedSide === f.actual_result;

      results.total++;
      if (correct) results.correct++;
      results.byTier[tier].t++;
      if (correct) results.byTier[tier].c++;

      // Track patterns
      const patterns = extractPatterns(f);
      for (const pattern of patterns) {
        if (correct) {
          if (!results.correctPatterns[pattern]) results.correctPatterns[pattern] = { c: 0, t: 0 };
          results.correctPatterns[pattern].c++;
          results.correctPatterns[pattern].t++;
        } else {
          if (!results.wrongPatterns[pattern]) results.wrongPatterns[pattern] = { w: 0, t: 0 };
          results.wrongPatterns[pattern].w++;
          results.wrongPatterns[pattern].t++;
        }
      }
    }

    return results;
  }

  /**
   * STEP 4: Optimize weights using stored features
   */
  optimizeWeights(features) {
    console.log("\n🔧 Optimizing model weights...");

    let bestWeights = { ...this.learning.modelWeights };
    let bestScore = 0;

    for (let iter = 0; iter < 3000; iter++) {
      const testWeights = { ...bestWeights };
      const keys = Object.keys(testWeights);
      const key = keys[Math.floor(Math.random() * keys.length)];
      testWeights[key] += (Math.random() - 0.5) * 0.08;
      testWeights[key] = Math.max(0.02, Math.min(0.50, testWeights[key]));
      const total = Object.values(testWeights).reduce((s, v) => s + v, 0);
      for (const k of keys) testWeights[k] /= total;

      let eliteCorrect = 0, eliteTotal = 0;
      let totalCorrect = 0, totalCnt = 0;

      for (const f of features) {
        if (f.home_score === null || f.actual_result === null) continue;
        let hp;
        if (f.home_odds && f.draw_odds && f.away_odds) {
          const mt = 1/f.home_odds + 1/f.draw_odds + 1/f.away_odds;
          const mh = (1/f.home_odds) / mt;
          hp = clamp(
            f.elo_home_prob * testWeights.elo + (f.home_form_ppg / 3) * testWeights.form +
            mh * testWeights.odds +
            (f.home_win_rate * 0.6 + (1 - f.away_win_rate) * 0.4) * testWeights.goals +
            (f.home_streak > 0 ? 0.65 : 0.45) * testWeights.streak +
            0.55 * testWeights.homeAdv
          );
        } else {
          hp = clamp(
            f.elo_home_prob * 0.40 + (f.home_form_ppg / 3) * 0.25 +
            (f.home_win_rate * 0.6 + (1 - f.away_win_rate) * 0.4) * 0.20 +
            (f.home_streak > 0 ? 0.65 : 0.45) * 0.15
          );
        }
        const pred = hp > 0.5 ? "home" : "away";
        const conf = Math.max(hp, 1 - hp);
        const isCorrect = pred === f.actual_result;
        if (conf >= 0.60) { eliteTotal++; if (isCorrect) eliteCorrect++; }
        totalCnt++; if (isCorrect) totalCorrect++;
      }

      const eliteAcc = eliteTotal > 0 ? eliteCorrect / eliteTotal : 0;
      const totalAcc = totalCnt > 0 ? totalCorrect / totalCnt : 0;
      const score = eliteAcc * 0.7 + totalAcc * 0.3;
      if (score > bestScore) { bestScore = score; bestWeights = { ...testWeights }; }
    }

    this.learning.modelWeights = bestWeights;
    console.log(`   ✅ Optimized: ${Object.entries(bestWeights).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(", ")}`);
    return bestWeights;
  }

  /**
   * STEP 5: Predict upcoming matches using learned weights + stored Elo/form
   */
  async predictUpcoming() {
    console.log("\n🎯 Predicting upcoming matches...");

    // Load latest Elo ratings from database
    const eloRatings = {};
    const { data: latestElos } = await supabase
      .from("elo_ratings")
      .select("team_id, rating, teams!inner(canonical_name)")
      .order("match_date", { ascending: false });

    if (latestElos) {
      for (const e of latestElos) {
        const name = e.teams?.canonical_name;
        if (name && !eloRatings[name]) eloRatings[name] = e.rating;
      }
    }
    console.log(`   Loaded Elo ratings for ${Object.keys(eloRatings).length} teams`);

    // Load latest form data from match_features (most recent 5 per team)
    const teamForm = {};
    const { data: recentFeatures } = await supabase
      .from("match_features")
      .select("home_team_name, away_team_name, home_score, away_score, actual_result")
      .not("home_score", "is", null)
      .order("computed_at", { ascending: false })
      .limit(500);

    if (recentFeatures) {
      for (const f of recentFeatures) {
        // Home team form
        if (!teamForm[f.home_team_name]) teamForm[f.home_team_name] = [];
        if (teamForm[f.home_team_name].length < 10) {
          teamForm[f.home_team_name].push({
            result: f.actual_result === "home" ? "W" : f.actual_result === "draw" ? "D" : "L",
            goals: f.home_score, against: f.away_score,
          });
        }
        // Away team form
        if (!teamForm[f.away_team_name]) teamForm[f.away_team_name] = [];
        if (teamForm[f.away_team_name].length < 10) {
          teamForm[f.away_team_name].push({
            result: f.actual_result === "away" ? "W" : f.actual_result === "draw" ? "D" : "L",
            goals: f.away_score, against: f.home_score,
          });
        }
      }
    }

    function getForm(team, n = 5) {
      const last = (teamForm[team] || []).slice(-n);
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

    // Get upcoming fixtures
    const { data: fixtures } = await supabase
      .from("fixtures")
      .select(`
        id, status, kickoff_time,
        home_team:teams!fixtures_home_team_id_fkey(canonical_name),
        away_team:teams!fixtures_away_team_id_fkey(canonical_name),
        leagues(name)
      `)
      .eq("status", "scheduled")
      .gte("kickoff_time", new Date().toISOString())
      .order("kickoff_time", { ascending: true })
      .limit(50);

    if (!fixtures || fixtures.length === 0) {
      console.log("   No upcoming matches found");
      return [];
    }

    // Get odds
    const { data: oddsData } = await supabase.from("odds_snapshots").select("fixture_id, selection, odds");
    const oddsByFixture = {};
    if (oddsData) {
      for (const o of oddsData) {
        if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
        if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
        oddsByFixture[o.fixture_id][o.selection].push(o.odds);
      }
    }

    const predictions = [];
    const w = this.learning.modelWeights;

    for (const fixture of fixtures) {
      const homeName = fixture.home_team?.canonical_name;
      const awayName = fixture.away_team?.canonical_name;
      const leagueName = fixture.leagues?.name;
      if (!homeName || !awayName) continue;

      const odds = oddsByFixture[fixture.id] || {};
      const avg = (arr) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
      const homeOdds = avg(odds["Home"]);
      const drawOdds = avg(odds["Draw"]);
      const awayOdds = avg(odds["Away"]);

      const homeElo = eloRatings[homeName] || 1500;
      const awayElo = eloRatings[awayName] || 1500;
      const eloProb = 1 / (1 + Math.pow(10, ((awayElo) - (homeElo + 65)) / 400));
      const eloDiff = homeElo - awayElo + 65;

      const homeForm = getForm(homeName);
      const awayForm = getForm(awayName);

      let homeProb;
      if (homeOdds && drawOdds && awayOdds) {
        const mt = 1/homeOdds + 1/drawOdds + 1/awayOdds;
        const mh = (1/homeOdds) / mt;
        homeProb = clamp(
          eloProb * w.elo + (homeForm.ppg / 3) * w.form + mh * w.odds +
          (homeForm.winRate * 0.6 + (1 - awayForm.winRate) * 0.4) * w.goals +
          (homeForm.streak > 0 ? 0.65 : 0.45) * w.streak + 0.55 * w.homeAdv
        );
      } else {
        homeProb = clamp(
          eloProb * 0.40 + (homeForm.ppg / 3) * 0.25 +
          (homeForm.winRate * 0.6 + (1 - awayForm.winRate) * 0.4) * 0.20 +
          (homeForm.streak > 0 ? 0.65 : 0.45) * 0.15
        );
      }

      const predicted = homeProb > 0.5 ? "home" : "away";
      const confidence = Math.max(homeProb, 1 - homeProb);
      const tier = confidence >= 0.70 ? "ELITE" : confidence >= 0.60 ? "HIGH" : confidence >= 0.52 ? "MEDIUM" : "LOW";

      let edge = 0;
      if (homeOdds && drawOdds && awayOdds) {
        const mt = 1/homeOdds + 1/drawOdds + 1/awayOdds;
        const marketProb = predicted === "home" ? (1/homeOdds) / mt : (1/awayOdds) / mt;
        edge = confidence - marketProb;
      }

      const features = {
        elo_diff: Math.round(eloDiff), home_form_ppg: homeForm.ppg, away_form_ppg: awayForm.ppg,
        home_avg_goals: homeForm.avgGoals, home_avg_conceded: homeForm.avgConceded,
        away_avg_goals: awayForm.avgGoals, away_avg_conceded: awayForm.avgConceded,
        home_win_rate: homeForm.winRate, away_win_rate: awayForm.winRate,
        home_streak: homeForm.streak, away_streak: awayForm.streak,
        goal_diff: (homeForm.avgGoals - homeForm.avgConceded) - (awayForm.avgGoals - awayForm.avgConceded),
      };

      predictions.push({
        fixtureId: fixture.id,
        homeTeam: homeName, awayTeam: awayName, league: leagueName,
        kickoffTime: fixture.kickoff_time,
        predicted: predicted === "home" ? homeName : awayName,
        predictedSide: predicted,
        probability: homeProb, confidence, tier,
        edge: Math.round(edge * 1000) / 1000,
        features, patterns: extractPatterns(features),
        odds: homeOdds ? { home: homeOdds, draw: drawOdds, away: awayOdds } : null,
      });
    }

    return predictions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * STEP 6: Store predictions in database
   */
  async storePredictions(predictions) {
    console.log("\n💾 Storing predictions...");

    // Load current weights for reference
    const w = this.learning.modelWeights;

    let saved = 0;
    for (const p of predictions) {
      // Delete old prediction for this fixture
      await supabase.from("predictions").delete()
        .eq("fixture_id", p.fixtureId).eq("market", "1X2");

      // Insert new prediction
      const { error } = await supabase.from("predictions").insert({
        fixture_id: p.fixtureId,
        market: "1X2",
        selection: p.predicted,
        model_probability: p.confidence,
        confidence_lower: p.confidence * 0.9,
        confidence_upper: Math.min(p.confidence * 1.1, 0.99),
        result: "pending",
      });

      // Also store in prediction_history for long-term tracking
      await supabase.from("prediction_history").upsert({
        fixture_id: p.fixtureId,
        predicted_side: p.predictedSide,
        predicted_prob: p.confidence,
        confidence_tier: p.tier,
        features_snapshot: p.features,
        patterns: p.patterns,
        model_version: "v3.0",
        model_weights: w,
      }, { onConflict: "fixture_id,predicted_side" });

      if (!error) saved++;
    }
    console.log(`   ✅ Stored ${saved} predictions`);
  }

  /**
   * STEP 7: Check yesterday's predictions and learn
   */
  async learnFromResults() {
    console.log("\n📚 Checking past predictions vs results...");

    const { data: pending } = await supabase
      .from("predictions")
      .select("id, fixture_id, selection, model_probability")
      .eq("result", "pending");

    if (!pending || pending.length === 0) {
      console.log("   No pending predictions to check");
      return { correct: 0, wrong: 0 };
    }

    const fixtureIds = pending.map(p => p.fixture_id);
    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, status, home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name)")
      .in("id", fixtureIds)
      .eq("status", "finished");

    if (!fixtures || fixtures.length === 0) {
      console.log("   No finished matches to check against yet");
      return { correct: 0, wrong: 0 };
    }

    let correct = 0, wrong = 0;
    for (const pred of pending) {
      const fixture = fixtures.find(f => f.id === pred.fixture_id);
      if (!fixture || fixture.home_score === null) continue;

      const homeName = fixture.home_team?.canonical_name;
      const awayName = fixture.away_team?.canonical_name;
      const actual = fixture.home_score > fixture.away_score ? "home"
        : fixture.home_score < fixture.away_score ? "away" : "draw";
      const actualSelection = actual === "home" ? homeName : actual === "away" ? awayName : "Draw";
      const isCorrect = pred.selection === actualSelection;

      if (isCorrect) correct++; else wrong++;

      // Update both tables
      await supabase.from("predictions").update({ result: isCorrect ? "correct" : "wrong" }).eq("id", pred.id);
      await supabase.from("prediction_history").update({
        actual_result: actual, correct: isCorrect, checked_at: new Date().toISOString(),
      }).eq("fixture_id", pred.fixture_id);
    }

    console.log(`   ✅ Checked ${correct + wrong} predictions: ${correct} correct, ${wrong} wrong`);
    this.learning.accuracy.total += correct + wrong;
    this.learning.accuracy.correct += correct;
    return { correct, wrong };
  }

  /**
   * STEP 8: Store performance metrics in database
   */
  async storePerformance(results, features) {
    const w = this.learning.modelWeights;
    await supabase.from("model_performance").upsert({
      run_date: new Date().toISOString().split("T")[0],
      model_name: "ensemble",
      total_predictions: results.total,
      correct_predictions: results.correct,
      accuracy: results.total > 0 ? Math.round((results.correct / results.total) * 10000) / 10000 : 0,
      elite_total: results.byTier.ELITE.t,
      elite_correct: results.byTier.ELITE.c,
      elite_accuracy: results.byTier.ELITE.t > 0 ? Math.round((results.byTier.ELITE.c / results.byTier.ELITE.t) * 10000) / 10000 : 0,
      high_total: results.byTier.HIGH.t,
      high_correct: results.byTier.HIGH.c,
      high_accuracy: results.byTier.HIGH.t > 0 ? Math.round((results.byTier.HIGH.c / results.byTier.HIGH.t) * 10000) / 10000 : 0,
      pattern_stats: results.correctPatterns,
      model_weights: w,
      total_matches_in_db: features?.length || 0,
      evaluation_period: "2023-2026",
    }, { onConflict: "run_date,model_name" });
    console.log("   ✅ Stored performance metrics");
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().split("T")[0];
  console.log("🧠 ODDLY Self-Learning System v3");
  console.log("━".repeat(70));
  console.log(`   Date: ${today}`);
  console.log("   Loads from stored data. Runs in seconds, not minutes.");
  console.log("━".repeat(70));

  const engine = new SelfLearningEngine();

  // ── STEP 1: Load stored features (instant) ──
  const features = await engine.loadFeatures();

  if (features) {
    // ── STEP 2: Load learned weights ──
    await engine.loadWeights();

    // ── STEP 3: Evaluate accuracy ──
    const results = engine.evaluateFromFeatures(features);
    const overallAcc = results.total > 0 ? ((results.correct / results.total) * 100).toFixed(1) : "N/A";
    console.log(`\n   📊 ACCURACY (from ${results.total} stored matches):`);
    console.log(`   Total: ${results.total} | Correct: ${results.correct} | Accuracy: ${overallAcc}%`);
    console.log(`   ELITE: ${results.byTier.ELITE.c}/${results.byTier.ELITE.t} (${results.byTier.ELITE.t > 0 ? ((results.byTier.ELITE.c / results.byTier.ELITE.t) * 100).toFixed(1) : 0}%)`);
    console.log(`   HIGH:  ${results.byTier.HIGH.c}/${results.byTier.HIGH.t} (${results.byTier.HIGH.t > 0 ? ((results.byTier.HIGH.c / results.byTier.HIGH.t) * 100).toFixed(1) : 0}%)`);
    console.log(`   MED:   ${results.byTier.MEDIUM.c}/${results.byTier.MEDIUM.t} (${results.byTier.MEDIUM.t > 0 ? ((results.byTier.MEDIUM.c / results.byTier.MEDIUM.t) * 100).toFixed(1) : 0}%)`);

    // Show pattern reliability
    const patternStats = {};
    for (const [p, s] of Object.entries({ ...results.correctPatterns })) {
      const wrong = results.wrongPatterns[p]?.w || 0;
      const total = s.c + wrong;
      if (total >= 10) patternStats[p] = { accuracy: s.c / total, samples: total };
    }
    const sorted = Object.entries(patternStats).sort((a, b) => b[1].accuracy - a[1].accuracy);
    console.log("\n   Pattern Reliability:");
    for (const [p, s] of sorted.slice(0, 8)) {
      const emoji = s.accuracy >= 0.60 ? "✅" : s.accuracy >= 0.50 ? "⚠️" : "❌";
      console.log(`   ${emoji} ${p}: ${(s.accuracy * 100).toFixed(1)}% (${s.samples} matches)`);
    }

    // ── STEP 4: Optimize weights ──
    engine.optimizeWeights(features);

    // ── STEP 5: Store performance ──
    await engine.storePerformance(results, features);
  }

  // ── STEP 6: Check past predictions ──
  const checkResults = await engine.learnFromResults();

  // ── STEP 7: Predict upcoming matches ──
  const predictions = await engine.predictUpcoming();

  if (predictions.length > 0) {
    console.log(`\n🎯 UPCOMING PREDICTIONS:`);
    console.log("─".repeat(70));

    const elite = predictions.filter(p => p.tier === "ELITE");
    const high = predictions.filter(p => p.tier === "HIGH");

    if (elite.length > 0) {
      console.log(`\n🚀 ELITE PICKS (${elite.length}):`);
      for (const p of elite) {
        const date = new Date(p.kickoffTime).toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" });
        console.log(`   🏆 ${p.homeTeam} vs ${p.awayTeam} (${p.league}) — ${date}`);
        console.log(`      Prediction: ${p.predicted} | Confidence: ${(p.confidence * 100).toFixed(1)}% | Edge: ${(p.edge * 100).toFixed(1)}%`);
        console.log(`      Patterns: ${p.patterns.join(", ") || "none"}`);
      }
    }

    if (high.length > 0) {
      console.log(`\n✅ HIGH CONFIDENCE (${high.length}):`);
      for (const p of high.slice(0, 5)) {
        const date = new Date(p.kickoffTime).toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" });
        console.log(`   ✅ ${p.homeTeam} vs ${p.awayTeam} (${p.league}) — ${date}`);
        console.log(`      Prediction: ${p.predicted} | Confidence: ${(p.confidence * 100).toFixed(1)}% | Edge: ${(p.edge * 100).toFixed(1)}%`);
      }
    }

    // ── STEP 8: Store predictions ──
    await engine.storePredictions(predictions);
  }

  // ── Final Summary ──
  const w = engine.learning.modelWeights;
  console.log("\n" + "═".repeat(70));
  console.log("📊 LEARNING SUMMARY");
  console.log("═".repeat(70));
  console.log(`\n  Model Weights (learned):`);
  for (const [k, v] of Object.entries(w)) {
    console.log(`    ${k}: ${(v * 100).toFixed(0)}%`);
  }
  console.log(`\n  Running Accuracy: ${engine.learning.accuracy.total > 0 ? ((engine.learning.accuracy.correct / engine.learning.accuracy.total) * 100).toFixed(1) : "N/A"}% (${engine.learning.accuracy.correct}/${engine.learning.accuracy.total})`);
  console.log(`  Last Updated: ${engine.learning.lastUpdated}`);
  console.log("\n💡 Run daily: node scripts/self-learning.js");
  console.log("   All data is stored in Supabase — instant load, no recomputation.");
  console.log("━".repeat(70));

  saveLearningData(engine.learning);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
