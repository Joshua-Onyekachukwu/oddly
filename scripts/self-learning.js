#!/usr/bin/env node

/**
 * ODDLY Self-Learning System v2
 *
 * THE FULL LEARNING LOOP:
 * 1. Load all finished matches from database
 * 2. Build Elo ratings + form data chronologically
 * 3. For each match: predict BEFORE it was played, compare to actual result
 * 4. Record which patterns led to correct/wrong predictions
 * 5. Optimize model weights using the results
 * 6. Save learned weights + patterns
 * 7. Use learned weights for future predictions
 * 8. Every day: predict, check yesterday's results, learn, repeat
 *
 * Run: node scripts/self-learning.js
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

// ─── Learning Database ──────────────────────────────────────────────────────

const LEARNING_FILE = path.join(__dirname, "..", "docs", "learning-data.json");

function loadLearningData() {
  if (fs.existsSync(LEARNING_FILE)) {
    try { return JSON.parse(fs.readFileSync(LEARNING_FILE, "utf8")); } catch { }
  }
  return {
    modelWeights: {
      elo: 0.30,
      form: 0.20,
      h2h: 0.10,
      goals: 0.15,
      streak: 0.05,
      odds: 0.10,
      homeAdv: 0.10,
    },
    accuracy: { total: 0, correct: 0, byTier: {}, byPattern: {} },
    correctPatterns: {},
    wrongPatterns: {},
    lastBacktest: null,
    lastUpdated: null,
    backtestResults: null,
  };
}

function saveLearningData(data) {
  data.lastUpdated = new Date().toISOString();
  const dir = path.dirname(LEARNING_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
}

// ─── Elo System ─────────────────────────────────────────────────────────────

class EloSystem {
  constructor() { this.ratings = {}; }
  get(t) { return this.ratings[t] || 1500; }
  predict(home, away) {
    const h = this.get(home) + 65; // Home advantage
    const a = this.get(away);
    return 1 / (1 + Math.pow(10, (a - h) / 400));
  }
  update(home, away, hg, ag) {
    const h = this.get(home) + 65;
    const a = this.get(away);
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    const K = 32;
    this.ratings[home] = this.get(home) + K * (actual - eH);
    this.ratings[away] = this.get(away) + K * ((1 - actual) - (1 - eH));
  }
  reset() { this.ratings = {}; }
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
  getH2H(home, away) {
    // Look at head-to-head between these teams
    const homeHistory = this.history[home] || [];
    // Simplified: just return neutral since we don't track opponents in this format
    return { homeWins: 0, draws: 0, awayWins: 0, total: 0 };
  }
  reset() { this.history = {}; }
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
  if (features.homeGoals >= 1.8) p.push("home_scores_heavy");
  else if (features.homeGoals >= 1.4) p.push("home_scores");
  if (features.homeConceded <= 0.8) p.push("home_fortress");
  else if (features.homeConceded <= 1.2) p.push("home_defends");
  if (features.awayConceded >= 1.6) p.push("away_leaks_heavy");
  else if (features.awayConceded >= 1.3) p.push("away_leaks");
  if (features.homePpg >= 2.3) p.push("home_elite_form");
  else if (features.homePpg >= 2.0) p.push("home_good_form");
  if (features.awayPpg <= 0.8) p.push("away_terrible_form");
  else if (features.awayPpg <= 1.0) p.push("away_poor_form");
  if (features.goalDiff > 3) p.push("home_goal_advantage");
  if (features.fatigue) p.push("home_rest_advantage");
  return p;
}

// ─── The Self-Learning Engine ───────────────────────────────────────────────

class SelfLearningEngine {
  constructor() {
    this.learning = loadLearningData();
    this.elo = new EloSystem();
    this.form = new FormTracker();
  }

  /**
   * STEP 1: BACKTEST — Run predictions against ALL finished matches chronologically.
   * This is where the system learns what patterns actually work.
   */
  async backtest() {
    console.log("\n🔬 BACKTESTING against all finished matches...");

    // Load all finished matches chronologically
    const { data: fixtures } = await supabase
      .from("fixtures")
      .select(`
        id, home_score, away_score, kickoff_time,
        home_team:teams!fixtures_home_team_id_fkey(id, canonical_name),
        away_team:teams!fixtures_away_team_id_fkey(id, canonical_name)
      `)
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true });

    if (!fixtures || fixtures.length === 0) {
      console.log("   ❌ No finished matches to backtest against");
      return;
    }

    console.log(`   📊 ${fixtures.length} finished matches found`);

    // Load odds for all fixtures
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

    // Reset models
    this.elo.reset();
    this.form.reset();

    // Results tracking
    const results = {
      total: 0,
      correct: 0,
      byTier: { ELITE: { t: 0, c: 0 }, HIGH: { t: 0, c: 0 }, MEDIUM: { t: 0, c: 0 }, LOW: { t: 0, c: 0 } },
      correctPatterns: {},
      wrongPatterns: {},
      allPredictions: [],
    };

    // Process each match chronologically
    for (const fixture of fixtures) {
      const homeName = fixture.home_team?.canonical_name;
      const awayName = fixture.away_team?.canonical_name;
      if (!homeName || !awayName) continue;

      // Get current model state BEFORE this match
      const homeForm = this.form.getForm(homeName);
      const awayForm = this.form.getForm(awayName);
      const eloProb = this.elo.predict(homeName, awayName);
      const eloDiff = this.elo.get(homeName) - this.elo.get(awayName) + 65;

      // Get odds if available
      const odds = oddsByFixture[fixture.id] || {};
      const avg = (arr) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
      const homeOdds = avg(odds["Home"]);
      const drawOdds = avg(odds["Draw"]);
      const awayOdds = avg(odds["Away"]);

      // Compute features
      const features = {
        eloDiff: Math.round(eloDiff),
        homePpg: homeForm.ppg,
        awayPpg: awayForm.ppg,
        homeGoals: homeForm.avgGoals,
        homeConceded: homeForm.avgConceded,
        awayGoals: awayForm.avgGoals,
        awayConceded: awayForm.avgConceded,
        homeWinRate: homeForm.winRate,
        awayWinRate: awayForm.winRate,
        homeStreak: homeForm.streak,
        awayStreak: awayForm.streak,
        goalDiff: (homeForm.avgGoals - homeForm.avgConceded) - (awayForm.avgGoals - awayForm.avgConceded),
        leaguePosDiff: 0,
        fatigue: false,
        homeOdds, drawOdds, awayOdds,
      };

      // Extract patterns
      const patterns = extractPatterns(features);

      // Make prediction using current weights
      const w = this.learning.modelWeights;
      let homeProb;

      if (homeOdds && drawOdds && awayOdds) {
        // Market-implied probability
        const marketTotal = 1/homeOdds + 1/drawOdds + 1/awayOdds;
        const marketHome = (1/homeOdds) / marketTotal;
        homeProb = clamp(
          eloProb * w.elo +
          (homeForm.ppg / 3) * w.form +
          marketHome * w.odds +
          (homeForm.winRate * 0.6 + (1 - awayForm.winRate) * 0.4) * w.goals +
          (homeForm.streak > 0 ? 0.65 : 0.45) * w.streak +
          0.55 * w.homeAdv // slight home bias
        );
      } else {
        // No odds — pure model
        homeProb = clamp(
          eloProb * 0.40 +
          (homeForm.ppg / 3) * 0.25 +
          (homeForm.winRate * 0.6 + (1 - awayForm.winRate) * 0.4) * 0.20 +
          (homeForm.streak > 0 ? 0.65 : 0.45) * 0.15
        );
      }

      // Determine prediction
      const predicted = homeProb > 0.5 ? "home" : "away";
      const confidence = homeProb;
      const tier = confidence >= 0.70 ? "ELITE" : confidence >= 0.60 ? "HIGH" : confidence >= 0.50 ? "MEDIUM" : "LOW";

      // Actual result
      const hg = fixture.home_score;
      const ag = fixture.away_score;
      const actual = hg > ag ? "home" : hg < ag ? "away" : "draw";

      // Was the prediction correct?
      const isCorrect = predicted === actual;

      // Track
      results.total++;
      if (isCorrect) results.correct++;
      results.byTier[tier].t++;
      if (isCorrect) results.byTier[tier].c++;

      // Track patterns
      for (const pattern of patterns) {
        if (isCorrect) {
          if (!results.correctPatterns[pattern]) results.correctPatterns[pattern] = { c: 0, t: 0 };
          results.correctPatterns[pattern].c++;
          results.correctPatterns[pattern].t++;
        } else {
          if (!results.wrongPatterns[pattern]) results.wrongPatterns[pattern] = { w: 0, t: 0 };
          results.wrongPatterns[pattern].w++;
          results.wrongPatterns[pattern].t++;
        }
      }

      // Store prediction
      results.allPredictions.push({
        fixtureId: fixture.id,
        home: homeName, away: awayName,
        predicted, confidence, tier, actual, correct: isCorrect,
        eloDiff: Math.round(eloDiff), patterns,
        features, // Store full features for optimization
      });

      // Update models with this result (chronological learning)
      this.elo.update(homeName, awayName, hg, ag);
      const homeResult = hg > ag ? "W" : hg < ag ? "L" : "D";
      const awayResult = hg < ag ? "W" : hg > ag ? "L" : "D";
      this.form.record(homeName, homeResult, hg, ag);
      this.form.record(awayName, awayResult, ag, hg);
    }

    return results;
  }

  /**
   * STEP 2: OPTIMIZE — Find the best weights and pattern filters from backtest results
   */
  optimizeWeights(results) {
    console.log("\n🔧 Optimizing model weights from backtest results...");

    // Find the most reliable patterns
    const patternStats = {};
    const allPatterns = new Set([...Object.keys(results.correctPatterns || {}), ...Object.keys(results.wrongPatterns || {})]);
    for (const p of allPatterns) {
      const correct = results.correctPatterns[p]?.c || 0;
      const wrong = results.wrongPatterns[p]?.w || 0;
      const total = correct + wrong;
      if (total >= 10) {
        patternStats[p] = { accuracy: correct / total, samples: total };
      }
    }

    const sortedPatterns = Object.entries(patternStats)
      .sort((a, b) => b[1].accuracy - a[1].accuracy);

    console.log("\n   Pattern Reliability (from real data):");
    for (const [pattern, stats] of sortedPatterns) {
      const emoji = stats.accuracy >= 0.60 ? "✅" : stats.accuracy >= 0.50 ? "⚠️" : "❌";
      console.log(`   ${emoji} ${pattern}: ${(stats.accuracy * 100).toFixed(1)}% (${stats.samples} matches)`);
    }

    // If no allPredictions available, use pattern-based optimization only
    if (!results.allPredictions || results.allPredictions.length === 0) {
      console.log("\n   ⚠️  No per-prediction data for weight optimization. Using pattern stats.");
      // Boost weights based on which patterns are reliable
      const w = this.learning.modelWeights;
      const reliablePatterns = sortedPatterns.filter(([_, s]) => s.accuracy > 0.55 && s.samples >= 15);
      console.log(`   Reliable patterns (>55% accuracy, 15+ samples): ${reliablePatterns.map(([p]) => p).join(", ") || "none"}`);

      // Weights are already reasonable defaults, keep them
      console.log(`   Current weights: ${Object.entries(w).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(", ")}`);
      return w;
    }

    // Full optimization with per-prediction data
    let bestWeights = { ...this.learning.modelWeights };
    let bestAcc = 0;
    let bestEliteAcc = 0;

    for (let iter = 0; iter < 2000; iter++) {
      const testWeights = { ...bestWeights };
      const keys = Object.keys(testWeights);
      const key = keys[Math.floor(Math.random() * keys.length)];
      testWeights[key] += (Math.random() - 0.5) * 0.08;
      testWeights[key] = Math.max(0.02, Math.min(0.50, testWeights[key]));

      const total = Object.values(testWeights).reduce((s, v) => s + v, 0);
      for (const k of keys) testWeights[k] /= total;

      let eliteCorrect = 0, eliteTotal = 0;
      let totalCorrect = 0, totalCnt = 0;
      for (const pred of results.allPredictions) {
        const w = testWeights;
        let hp;
        if (pred.features?.homeOdds && pred.features?.drawOdds && pred.features?.awayOdds) {
          const mt = 1/pred.features.homeOdds + 1/pred.features.drawOdds + 1/pred.features.awayOdds;
          const mh = (1/pred.features.homeOdds) / mt;
          const eloP = 1 / (1 + Math.pow(10, (1500 - (pred.features.eloDiff + 65)) / 400));
          hp = clamp(
            eloP * w.elo + (pred.features.homePpg / 3) * w.form +
            mh * w.odds +
            (pred.features.homeWinRate * 0.6 + (1 - pred.features.awayWinRate) * 0.4) * w.goals +
            (pred.features.homeStreak > 0 ? 0.65 : 0.45) * w.streak +
            0.55 * w.homeAdv
          );
        } else {
          const eloP = 1 / (1 + Math.pow(10, (1500 - (pred.features.eloDiff + 65)) / 400));
          hp = clamp(
            eloP * 0.40 + (pred.features.homePpg / 3) * 0.25 +
            (pred.features.homeWinRate * 0.6 + (1 - pred.features.awayWinRate) * 0.4) * 0.20 +
            (pred.features.homeStreak > 0 ? 0.65 : 0.45) * 0.15
          );
        }
        const newPred = hp > 0.5 ? "home" : "away";
        const conf = Math.max(hp, 1 - hp);
        const isCorrect = newPred === pred.actual;

        if (conf >= 0.60) { eliteTotal++; if (isCorrect) eliteCorrect++; }
        totalCnt++; if (isCorrect) totalCorrect++;
      }

      const eliteAcc = eliteTotal > 0 ? eliteCorrect / eliteTotal : 0;
      const totalAcc = totalCnt > 0 ? totalCorrect / totalCnt : 0;
      const score = eliteAcc * 0.7 + totalAcc * 0.3;
      const bestScore = bestEliteAcc * 0.7 + bestAcc * 0.3;

      if (score > bestScore) {
        bestAcc = totalAcc;
        bestEliteAcc = eliteAcc;
        bestWeights = { ...testWeights };
      }
    }

    this.learning.modelWeights = bestWeights;
    console.log(`\n   Optimized weights: ${Object.entries(bestWeights).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(", ")}`);
    return bestWeights;
  }

  /**
   * STEP 3: PREDICT — Make predictions for upcoming matches using learned weights
   */
  async predictUpcoming() {
    console.log("\n🎯 Predicting upcoming matches...");

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

    const predictions = [];

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

      const homeForm = this.form.getForm(homeName);
      const awayForm = this.form.getForm(awayName);
      const eloProb = this.elo.predict(homeName, awayName);
      const eloDiff = this.elo.get(homeName) - this.elo.get(awayName) + 65;

      const features = {
        eloDiff, homePpg: homeForm.ppg, awayPpg: awayForm.ppg,
        homeGoals: homeForm.avgGoals, homeConceded: homeForm.avgConceded,
        awayGoals: awayForm.avgGoals, awayConceded: awayForm.avgConceded,
        homeWinRate: homeForm.winRate, awayWinRate: awayForm.winRate,
        homeStreak: homeForm.streak, awayStreak: awayForm.streak,
        goalDiff: (homeForm.avgGoals - homeForm.avgConceded) - (awayForm.avgGoals - awayForm.avgConceded),
        leaguePosDiff: 0, fatigue: false, homeOdds, drawOdds, awayOdds,
      };

      const patterns = extractPatterns(features);
      const w = this.learning.modelWeights;

      let homeProb;
      if (homeOdds && drawOdds && awayOdds) {
        const marketTotal = 1/homeOdds + 1/drawOdds + 1/awayOdds;
        const marketHome = (1/homeOdds) / marketTotal;
        homeProb = clamp(
          eloProb * w.elo + (homeForm.ppg / 3) * w.form +
          marketHome * w.odds +
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

      const predicted = homeProb > 0.5 ? "home" : "away";
      const confidence = Math.max(homeProb, 1 - homeProb);
      const tier = confidence >= 0.70 ? "ELITE" : confidence >= 0.60 ? "HIGH" : confidence >= 0.52 ? "MEDIUM" : "LOW";

      // Edge: difference between our probability and market probability
      let edge = 0;
      if (homeOdds && drawOdds && awayOdds) {
        const marketTotal = 1/homeOdds + 1/drawOdds + 1/awayOdds;
        const marketProb = predicted === "home" ? (1/homeOdds) / marketTotal : (1/awayOdds) / marketTotal;
        edge = confidence - marketProb;
      }

      predictions.push({
        fixtureId: fixture.id,
        homeTeam: homeName, awayTeam: awayName, league: leagueName,
        kickoffTime: fixture.kickoff_time,
        predicted: predicted === "home" ? homeName : awayName,
        predictedSide: predicted,
        probability: homeProb,
        confidence, tier, edge: Math.round(edge * 1000) / 1000,
        features, patterns,
        odds: homeOdds ? { home: homeOdds, draw: drawOdds, away: awayOdds } : null,
      });
    }

    return predictions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * STEP 4: LEARN — Check yesterday's predictions against actual results
   */
  async learnFromYesterday() {
    console.log("\n📚 Learning from yesterday's predictions...");

    // Get predictions that were made but haven't been checked yet
    const { data: unchecked } = await supabase
      .from("predictions")
      .select("id, fixture_id, selection, model_probability, result")
      .is("result", null);

    if (!unchecked || unchecked.length === 0) {
      console.log("   No unchecked predictions to learn from");
      return;
    }

    const fixtureIds = unchecked.map(p => p.fixture_id);
    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, status, home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name)")
      .in("id", fixtureIds)
      .eq("status", "finished");

    if (!fixtures || fixtures.length === 0) {
      console.log("   No finished matches to check against yet");
      return;
    }

    let correct = 0;
    let wrong = 0;

    for (const pred of unchecked) {
      const fixture = fixtures.find(f => f.id === pred.fixture_id);
      if (!fixture || fixture.home_score === null) continue;

      const homeName = fixture.home_team?.canonical_name;
      const awayName = fixture.away_team?.canonical_name;
      const actual = fixture.home_score > fixture.away_score ? "home"
        : fixture.home_score < fixture.away_score ? "away" : "draw";

      const actualSelection = actual === "home" ? homeName : actual === "away" ? awayName : "Draw";
      const isCorrect = pred.selection === actualSelection;

      if (isCorrect) correct++;
      else wrong++;

      // Update the prediction record
      await supabase
        .from("predictions")
        .update({ result: isCorrect ? "correct" : "wrong" })
        .eq("id", pred.id);
    }

    console.log(`   ✅ Checked ${correct + wrong} predictions: ${correct} correct, ${wrong} wrong`);

    // Update running accuracy
    this.learning.accuracy.total += correct + wrong;
    this.learning.accuracy.correct += correct;
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().split("T")[0];
  console.log("🧠 ODDLY Self-Learning System v2");
  console.log("━".repeat(70));
  console.log(`   Date: ${today}`);
  console.log("   The system learns from every prediction.");
  console.log("━".repeat(70));

  const engine = new SelfLearningEngine();

  // ── STEP 1: Backtest against historical data ──
  const cached = engine.learning.backtestResults;
  const hoursSinceLastBacktest = cached?.timestamp
    ? (Date.now() - new Date(cached.timestamp).getTime()) / (1000 * 60 * 60)
    : 999;

  let results;
  if (hoursSinceLastBacktest < 24 && cached) {
    console.log("\n📦 Using cached backtest results (< 24 hours old)");
    results = cached;
  } else {
    results = await engine.backtest();
    if (results) {
      // Save backtest results — keep ALL predictions for optimization
      engine.learning.backtestResults = { ...results, timestamp: new Date().toISOString() };
    }
  }

  if (results) {
    const overallAcc = results.total > 0 ? ((results.correct / results.total) * 100).toFixed(1) : "N/A";
    console.log(`\n   📊 BACKTEST RESULTS:`);
    console.log(`   Total: ${results.total} | Correct: ${results.correct} | Accuracy: ${overallAcc}%`);
    console.log(`   ELITE: ${results.byTier.ELITE.c}/${results.byTier.ELITE.t} (${results.byTier.ELITE.t > 0 ? ((results.byTier.ELITE.c / results.byTier.ELITE.t) * 100).toFixed(1) : 0}%)`);
    console.log(`   HIGH:  ${results.byTier.HIGH.c}/${results.byTier.HIGH.t} (${results.byTier.HIGH.t > 0 ? ((results.byTier.HIGH.c / results.byTier.HIGH.t) * 100).toFixed(1) : 0}%)`);
    console.log(`   MED:   ${results.byTier.MEDIUM.c}/${results.byTier.MEDIUM.t} (${results.byTier.MEDIUM.t > 0 ? ((results.byTier.MEDIUM.c / results.byTier.MEDIUM.t) * 100).toFixed(1) : 0}%)`);

    // ── STEP 2: Optimize weights ──
    engine.optimizeWeights(results);

    // ── STEP 3: Learn from yesterday's predictions ──
    await engine.learnFromYesterday();
  }

  // ── STEP 4: Predict upcoming matches ──
  const predictions = await engine.predictUpcoming();

  if (predictions.length > 0) {
    console.log(`\n🎯 UPCOMING PREDICTIONS (sorted by confidence):`);
    console.log("─".repeat(70));

    const elite = predictions.filter(p => p.tier === "ELITE");
    const high = predictions.filter(p => p.tier === "HIGH");
    const medium = predictions.filter(p => p.tier === "MEDIUM");

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

    if (medium.length > 0) {
      console.log(`\n⚠️  MEDIUM (${medium.length} total, showing top 3):`);
      for (const p of medium.slice(0, 3)) {
        const date = new Date(p.kickoffTime).toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "numeric" });
        console.log(`   ⚠️  ${p.homeTeam} vs ${p.awayTeam} (${p.league}) — ${date}`);
        console.log(`      Prediction: ${p.predicted} | Confidence: ${(p.confidence * 100).toFixed(1)}%`);
      }
    }

    // Save predictions to database
    console.log("\n💾 Saving predictions to database...");
    let saved = 0;
    for (const p of predictions) {
      // Delete existing prediction for this fixture + market to avoid duplicates
      const { error: delErr } = await supabase.from("predictions")
        .delete()
        .eq("fixture_id", p.fixtureId)
        .eq("market", "1X2");
      const { error: insErr } = await supabase.from("predictions").insert({
        fixture_id: p.fixtureId,
        market: "1X2",
        selection: p.predicted,
        model_probability: p.confidence,
        confidence_lower: p.confidence * 0.9,
        confidence_upper: Math.min(p.confidence * 1.1, 0.99),
        result: "pending",
      });
      if (insErr) {
        if (saved === 0) console.log(`   ⚠️  Save error: ${insErr.message}`);
      } else {
        saved++;
      }
    }
    console.log(`   ✅ Saved ${saved} predictions`);
  }

  // ── Final Summary ──
  const w = engine.learning.modelWeights;
  const acc = engine.learning.accuracy;
  console.log("\n" + "═".repeat(70));
  console.log("📊 LEARNING SUMMARY");
  console.log("═".repeat(70));
  console.log(`\n  Model Weights (learned from ${results?.total || 0} historical matches):`);
  for (const [k, v] of Object.entries(w)) {
    console.log(`    ${k}: ${(v * 100).toFixed(0)}%`);
  }
  console.log(`\n  Running Accuracy: ${acc.total > 0 ? ((acc.correct / acc.total) * 100).toFixed(1) : "N/A"}% (${acc.correct}/${acc.total})`);
  console.log(`  Backtest Date: ${engine.learning.backtestResults?.timestamp || "Never"}`);
  console.log(`  Last Updated: ${engine.learning.lastUpdated}`);

  console.log("\n💡 The system learns from every prediction.");
  console.log("   Run daily: node scripts/self-learning.js");
  console.log("━".repeat(70));

  // Save
  saveLearningData(engine.learning);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
