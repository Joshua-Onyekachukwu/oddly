#!/usr/bin/env node

/**
 * ODDLY Self-Training Engine — Daily Loop
 *
 * Steps:
 * 1. SCAN      → Collect today's fixtures + odds
 * 2. PREDICT   → Generate predictions for all markets
 * 3. SELECT    → Pick the best Crown Jewel (2-odds) selection
 * 4. SNAPSHOT  → Store exact features used for each prediction
 * 5. SETTLE    → Check finished matches, record outcomes
 * 6. ANALYZE   → Compare prediction vs reality
 * 7. LEARN     → Adjust weights, parameters, criteria
 * 8. LOG       → Write to training_log
 *
 * Run: node worker/daily-loop.js [predict|settle|learn|all]
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
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    env[t.slice(0, i).trim()] = val;
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

function clamp(v, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }
function now() { return new Date().toISOString(); }
function today() { return new Date().toISOString().split("T")[0]; }

// ─── Config ─────────────────────────────────────────────────────────────────

async function getConfig(key) {
  const { data } = await supabase.from("scoring_config").select("config_value").eq("config_key", key).maybeSingle();
  return data?.config_value;
}

async function setConfig(key, value) {
  await supabase.from("scoring_config").upsert({ config_key: key, config_value: value, updated_at: now() });
}

// ─── Model Implementations ──────────────────────────────────────────────────

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

// ─── Feature Extraction ─────────────────────────────────────────────────────

function extractFeatures(fixture, elo, form, oddsData, h2h) {
  const homeName = fixture.home_team?.canonical_name;
  const awayName = fixture.away_team?.canonical_name;

  const homeForm = form.getForm(homeName);
  const awayForm = form.getForm(awayName);
  const homeElo = elo.get(homeName);
  const awayElo = elo.get(awayName);
  const eloProb = elo.predict(homeName, awayName);
  const eloDiff = homeElo - awayElo + 65;

  const avg = (arr) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const homeOdds = avg(oddsData?.["Home"]);
  const drawOdds = avg(oddsData?.["Draw"]);
  const awayOdds = avg(oddsData?.["Away"]);

  let marketHomeProb = null;
  if (homeOdds && drawOdds && awayOdds) {
    const mt = 1/homeOdds + 1/drawOdds + 1/awayOdds;
    marketHomeProb = (1/homeOdds) / mt;
  }

  return {
    // Team identifiers
    home_team: homeName,
    away_team: awayName,
    league: fixture.leagues?.name,

    // Elo features
    home_elo: Math.round(homeElo),
    away_elo: Math.round(awayElo),
    elo_diff: Math.round(eloDiff),
    elo_home_prob: Math.round(eloProb * 10000) / 10000,

    // Form features
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

    // Derived features
    goal_diff: Math.round((homeForm.avgGoals - homeForm.avgConceded) - (awayForm.avgGoals - awayForm.avgConceded) * 1000) / 1000,
    home_clean_sheet_pct: 0.3, // Will be computed from history
    home_btts_pct: 0.5,
    fatigue_days: null,

    // Market features
    home_odds: homeOdds,
    draw_odds: drawOdds,
    away_odds: awayOdds,
    market_home_prob: marketHomeProb ? Math.round(marketHomeProb * 10000) / 10000 : null,

    // H2H features
    h2h_meetings: h2h?.total || 0,
    h2h_home_win_rate: h2h?.homeWins ? h2h.homeWins / h2h.total : 0.4,

    // Data quality
    bookmaker_count: oddsData ? Object.keys(oddsData).length : 0,
    data_recency_days: 0,
  };
}

// ─── Pattern Extraction ──────────────────────────────────────────────────────

function extractPatterns(f) {
  const p = [];
  if (f.elo_diff > 200) p.push("elo_dominant");
  else if (f.elo_diff > 150) p.push("elo_strong");
  if (f.home_win_rate > 0.65) p.push("home_very_strong");
  else if (f.home_win_rate > 0.55) p.push("home_strong");
  if (f.away_win_rate < 0.30) p.push("away_very_weak");
  else if (f.away_win_rate < 0.40) p.push("away_weak");
  if (f.home_streak >= 3) p.push("home_hot");
  if (f.away_streak <= -2) p.push("away_cold");
  if (f.home_avg_goals >= 1.8) p.push("home_scores_heavy");
  if (f.home_avg_conceded <= 1.0) p.push("home_defends");
  if (f.away_avg_conceded >= 1.5) p.push("away_leaks");
  if (f.home_form_ppg >= 2.3) p.push("home_elite_form");
  if (f.away_form_ppg <= 1.0) p.push("away_poor_form");
  if (f.goal_diff > 3) p.push("home_goal_advantage");
  return p;
}

// ─── Step 1: SCAN ──────────────────────────────────────────────────────────

async function stepScan() {
  console.log("\n📡 Step 1: SCANNING today's fixtures...");

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(`
      id, status, kickoff_time,
      home_team:teams!fixtures_home_team_id_fkey(id, canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(id, canonical_name),
      leagues(id, name)
    `)
    .eq("status", "scheduled")
    .gte("kickoff_time", today() + "T00:00:00Z")
    .lte("kickoff_time", today() + "T23:59:59Z")
    .order("kickoff_time", { ascending: true });

  if (!fixtures || fixtures.length === 0) {
    console.log("   No fixtures for today.");
    return [];
  }

  console.log(`   Found ${fixtures.length} fixtures for today`);
  return fixtures;
}

// ─── Step 2: PREDICT ───────────────────────────────────────────────────────

async function stepPredict(fixtures) {
  console.log("\n🧠 Step 2: GENERATING predictions...");

  // Load models
  const elo = new EloModel();
  const form = new FormTracker();

  // Calibrate from historical data
  const { data: historical } = await supabase
    .from("match_features")
    .select("home_team_name, away_team_name, home_score, away_score, actual_result")
    .not("home_score", "is", null)
    .order("computed_at", { ascending: false })
    .limit(500);

  if (historical) {
    for (const h of historical) {
      const homeResult = h.actual_result === "home" ? "W" : h.actual_result === "draw" ? "D" : "L";
      const awayResult = h.actual_result === "away" ? "W" : h.actual_result === "draw" ? "D" : "L";
      form.record(h.home_team_name, homeResult, h.home_score, h.away_score);
      form.record(h.away_team_name, awayResult, h.away_score, h.home_score);
    }
  }

  // Get odds for all fixtures
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

  // Load model weights
  const weights = await getConfig("ensemble_weights") || {
    elo: 0.29, form: 0.19, goals: 0.18, odds: 0.10, homeAdv: 0.10, h2h: 0.10, streak: 0.05
  };

  const predictions = [];

  for (const fixture of fixtures) {
    const homeName = fixture.home_team?.canonical_name;
    const awayName = fixture.away_team?.canonical_name;
    if (!homeName || !awayName) continue;

    const features = extractFeatures(fixture, elo, form, oddsByFixture[fixture.id], null);
    const patterns = extractPatterns(features);

    // Generate predictions for multiple markets
    const markets = [
      { market: "1X2", selection: homeName, side: "home" },
      { market: "1X2", selection: awayName, side: "away" },
      { market: "over_under", selection: "over_2.5" },
      { market: "over_under", selection: "under_3.5" },
      { market: "btts", selection: "yes" },
    ];

    for (const m of markets) {
      let prob;
      if (m.market === "1X2") {
        prob = m.side === "home" ? features.elo_home_prob : (1 - features.elo_home_prob);
        if (features.market_home_prob) {
          const marketProb = m.side === "home" ? features.market_home_prob : (1 - features.market_home_prob);
          prob = clamp(prob * weights.elo + marketProb * weights.odds + 0.5 * (1 - weights.elo - weights.odds));
        }
      } else if (m.selection === "over_2.5") {
        prob = clamp(0.50 + (features.home_avg_goals + features.away_avg_goals - 2.5) * 0.15);
      } else if (m.selection === "under_3.5") {
        prob = clamp(0.50 + (3.5 - features.home_avg_goals - features.away_avg_goals) * 0.15);
      } else if (m.selection === "yes") {
        prob = clamp(0.45 + features.home_win_rate * 0.2 + features.away_win_rate * 0.1);
      } else {
        prob = 0.50;
      }

      const prediction = {
        fixture_id: fixture.id,
        market: m.market,
        selection: m.selection,
        model_probability: Math.round(prob * 10000) / 10000,
        confidence_lower: Math.round(prob * 0.9 * 10000) / 10000,
        confidence_upper: Math.round(Math.min(prob * 1.1, 0.99) * 10000) / 10000,
        result: "pending",
      };

      predictions.push(prediction);

      // Store in model_learning_history with full feature snapshot
      await supabase.from("model_learning_history").insert({
        model_version: await getConfig("current_model_version") || "v1.0",
        prediction_id: null, // Will be linked after insert
        fixture_id: fixture.id,
        market: m.market,
        selection: m.selection,
        predicted_probability: prob,
        features_snapshot: features,
        was_correct: null,
        predicted_at: now(),
      });
    }

    // Store the main prediction
    const mainPred = predictions.find(p => p.fixture_id === fixture.id && p.market === "1X2" && p.selection === homeName);
    if (mainPred) {
      await supabase.from("predictions").upsert({
        fixture_id: fixture.id,
        market: "1X2",
        selection: mainPred.selection,
        model_probability: mainPred.model_probability,
        confidence_lower: mainPred.confidence_lower,
        confidence_upper: mainPred.confidence_upper,
        result: "pending",
      }, { onConflict: "fixture_id,market" });
    }

    console.log(`   🎯 ${homeName} vs ${awayName}: Home=${(features.elo_home_prob * 100).toFixed(1)}%`);
  }

  console.log(`   ✅ Generated ${predictions.length} predictions`);
  return predictions;
}

// ─── Step 3: SELECT CROWN JEWEL ────────────────────────────────────────────

async function stepSelectCrownJewel(predictions) {
  console.log("\n👑 Step 3: SELECTING Crown Jewel pick...");

  const criteria = await getConfig("crown_jewel_criteria") || {
    min_odds: 2.0, max_odds: 3.0, min_probability: 0.55,
    min_edge: 0.03, max_disagreement: 0.15,
  };

  const candidates = [];

  for (const pred of predictions) {
    if (pred.market !== "1X2") continue;

    // Get odds for this selection
    const { data: oddsData } = await supabase
      .from("odds_snapshots")
      .select("odds")
      .eq("fixture_id", pred.fixture_id)
      .eq("selection", pred.selection === pred.selection ? "Home" : "Away");

    if (!oddsData || oddsData.length === 0) continue;

    const avgOdds = oddsData.reduce((s, o) => s + o.odds, 0) / oddsData.length;
    const implied = 1 / avgOdds;
    const edge = pred.model_probability - implied;

    // Opportunity score (0-100)
    const oppScore = Math.round(
      (pred.model_probability * 40) +
      (edge * 100 * 30) +
      ((1 / avgOdds) * 30)
    );

    // Data quality score (0-100)
    const dqScore = Math.round(
      (pred.model_probability > 0.5 ? 40 : 20) +
      (edge > 0.05 ? 30 : edge > 0 ? 15 : 0) +
      30 // base score
    );

    if (
      avgOdds >= criteria.min_odds &&
      avgOdds <= criteria.max_odds &&
      pred.model_probability >= criteria.min_probability &&
      edge >= criteria.min_edge &&
      dqScore >= 60
    ) {
      candidates.push({
        prediction: pred,
        odds: avgOdds,
        edge,
        opportunity_score: oppScore,
        data_quality: dqScore,
        rollover_score: pred.model_probability * 0.5 + edge * 0.3 + (1 / avgOdds) * 0.2,
      });
    }
  }

  if (candidates.length === 0) {
    console.log("   No qualifying Crown Jewel pick today. SKIP.");
    return null;
  }

  candidates.sort((a, b) => b.rollover_score - a.rollover_score);
  const pick = candidates[0];

  // Store Crown Jewel pick
  await supabase.from("crown_jewel_history").insert({
    pick_date: today(),
    fixture_id: pick.prediction.fixture_id,
    market: pick.prediction.market,
    selection: pick.prediction.selection,
    odds: pick.odds,
    model_probability: pick.prediction.model_probability,
    edge: pick.edge,
    opportunity_score: pick.opportunity_score,
    data_quality_score: pick.data_quality,
    features_snapshot: pick.prediction.features_snapshot || {},
    result: "pending",
  });

  console.log(`   👑 Crown Jewel: ${pick.prediction.selection} @ ${pick.odds.toFixed(2)}`);
  console.log(`      Probability: ${(pick.prediction.model_probability * 100).toFixed(1)}% | Edge: ${(pick.edge * 100).toFixed(1)}% | Score: ${pick.opportunity_score}`);

  return pick;
}

// ─── Step 4: SETTLE ────────────────────────────────────────────────────────

async function stepSettle() {
  console.log("\n📊 Step 4: SETTLING finished matches...");

  // Only settle matches from last 3 days to avoid processing thousands of old matches
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data: finished } = await supabase
    .from("fixtures")
    .select("id, home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name)")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .gte("kickoff_time", threeDaysAgo);

  if (!finished || finished.length === 0) {
    console.log("   No finished matches to settle.");
    return { correct: 0, wrong: 0 };
  }

  let correct = 0, wrong = 0;

  for (const fixture of finished) {
    const homeName = fixture.home_team?.canonical_name;
    const awayName = fixture.away_team?.canonical_name;
    const hg = fixture.home_score;
    const ag = fixture.away_score;
    const total = hg + ag;

    // Get pending predictions for this fixture
    const { data: pending } = await supabase
      .from("model_learning_history")
      .select("id, market, selection, predicted_probability, was_correct")
      .eq("fixture_id", fixture.id)
      .is("was_correct", null);

    if (!pending) continue;

    for (const pred of pending) {
      let result = "wrong";

      if (pred.market === "1X2") {
        if (pred.selection === homeName && hg > ag) result = "correct";
        else if (pred.selection === awayName && ag > hg) result = "correct";
        else if (pred.selection === "Draw" && hg === ag) result = "correct";
      } else if (pred.market === "over_under") {
        // Handle all O/U lines
        const sel = (pred.selection || "").toLowerCase();
        if (sel.includes("over")) {
          const line = parseFloat(sel.replace("over_", ""));
          if (!isNaN(line) && total > line) result = "correct";
        } else if (sel.includes("under")) {
          const line = parseFloat(sel.replace("under_", ""));
          if (!isNaN(line) && total < line) result = "correct";
        }
      } else if (pred.market === "btts") {
        if (pred.selection === "yes" && hg > 0 && ag > 0) result = "correct";
        else if (pred.selection === "no" && (hg === 0 || ag === 0)) result = "correct";
      }

      await supabase.from("model_learning_history").update({
        actual_outcome: result,
        actual_score: `${hg}-${ag}`,
        actual_total_goals: total,
        actual_home_goals: hg,
        actual_away_goals: ag,
        was_correct: result === "correct",
        settled_at: now(),
      }).eq("id", pred.id);

      if (result === "correct") correct++;
      else wrong++;
    }

    // Also settle predictions table
    await supabase.from("predictions").update({
      result: correct > wrong ? "correct" : "wrong",
    }).eq("fixture_id", fixture.id).eq("result", "pending");
  }

  // Settle Crown Jewel
  const { data: pendingCrown } = await supabase
    .from("crown_jewel_history")
    .select("id, fixture_id, selection, odds")
    .eq("result", "pending");

  if (pendingCrown) {
    for (const crown of pendingCrown) {
      const fixture = finished.find(f => f.id === crown.fixture_id);
      if (!fixture) continue;

      const hg = fixture.home_score;
      const ag = fixture.away_score;
      const won = (crown.selection === fixture.home_team?.canonical_name && hg > ag) ||
                  (crown.selection === fixture.away_team?.canonical_name && ag > hg);

      await supabase.from("crown_jewel_history").update({
        result: won ? "won" : "lost",
        actual_score: `${hg}-${ag}`,
        profit_loss: won ? crown.odds - 1 : -1,
        settled_at: now(),
      }).eq("id", crown.id);
    }
  }

  console.log(`   ✅ Settled: ${correct} correct, ${wrong} wrong`);
  return { correct, wrong };
}

// ─── Step 5: LEARN ─────────────────────────────────────────────────────────

async function stepLearn() {
  console.log("\n📚 Step 5: LEARNING from results...");

  const { data: recent } = await supabase
    .from("model_learning_history")
    .select("market, selection, predicted_probability, actual_outcome, was_correct, features_snapshot, model_version")
    .not("was_correct", "is", null)
    .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (!recent || recent.length < 5) {
    console.log("   Not enough data to learn from yet.");
    return;
  }

  const total = recent.length;
  const correct = recent.filter(r => r.was_correct).length;
  const accuracy = correct / total;

  console.log(`   📊 Learning from ${total} predictions: ${correct} correct (${(accuracy * 100).toFixed(1)}%)`);

  // Feature importance analysis
  const featureScores = {};
  for (const r of recent) {
    if (!r.features_snapshot) continue;
    for (const [key, value] of Object.entries(r.features_snapshot)) {
      if (value === null || typeof value === "string") continue;
      if (!featureScores[key]) featureScores[key] = { correct: 0, wrong: 0, total: 0 };
      featureScores[key].total++;
      if (r.was_correct) featureScores[key].correct++;
      else featureScores[key].wrong++;
    }
  }

  const featureImportance = {};
  for (const [key, scores] of Object.entries(featureScores)) {
    if (scores.total >= 5) {
      featureImportance[key] = Math.round((scores.correct / scores.total) * 10000) / 10000;
    }
  }

  // Market performance
  const marketPerf = {};
  for (const r of recent) {
    if (!marketPerf[r.market]) marketPerf[r.market] = { correct: 0, total: 0 };
    marketPerf[r.market].total++;
    if (r.was_correct) marketPerf[r.market].correct++;
  }

  for (const [market, perf] of Object.entries(marketPerf)) {
    marketPerf[market] = Math.round((perf.correct / perf.total) * 10000) / 10000;
  }

  // Tier performance
  const tierPerf = { ELITE: { c: 0, t: 0 }, HIGH: { c: 0, t: 0 }, MEDIUM: { c: 0, t: 0 } };
  for (const r of recent) {
    const conf = Math.max(r.predicted_probability, 1 - r.predicted_probability);
    const tier = conf >= 0.70 ? "ELITE" : conf >= 0.60 ? "HIGH" : "MEDIUM";
    tierPerf[tier].t++;
    if (r.was_correct) tierPerf[tier].c++;
  }

  // Store training log
  const version = await getConfig("current_model_version") || "v1.0";
  await supabase.from("training_log").insert({
    model_version: version,
    training_date: today(),
    training_type: "daily",
    predictions_count: total,
    correct_count: correct,
    accuracy,
    elite_count: tierPerf.ELITE.t,
    elite_correct: tierPerf.ELITE.c,
    high_count: tierPerf.HIGH.t,
    high_correct: tierPerf.HIGH.c,
    medium_count: tierPerf.MEDIUM.t,
    medium_correct: tierPerf.MEDIUM.c,
    feature_weights: featureImportance,
    market_performance: marketPerf,
    notes: `Daily learning cycle. ${correct}/${total} correct.`,
  });

  // Update feature importance table
  for (const [feature, importance] of Object.entries(featureImportance)) {
    await supabase.from("feature_importance").upsert({
      model_version: version,
      feature_name: feature,
      importance,
      sample_size: total,
      updated_at: now(),
    }, { onConflict: "model_version,feature_name,market,league_id" });
  }

  console.log(`   ✅ Learning logged. Feature importance updated.`);
  console.log(`   Market performance: ${JSON.stringify(marketPerf)}`);
  console.log(`   Tier performance: ELITE=${tierPerf.ELITE.c}/${tierPerf.ELITE.t} HIGH=${tierPerf.HIGH.c}/${tierPerf.HIGH.t}`);

  return { accuracy, featureImportance, marketPerf, tierPerf };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const step = process.argv[2] || "all";

  console.log("🔄 ODDLY Self-Training Engine — Daily Loop");
  console.log("━".repeat(70));
  console.log(`   Date: ${today()}`);
  console.log(`   Step: ${step}`);
  console.log("━".repeat(70));

  try {
    if (step === "predict" || step === "all") {
      const fixtures = await stepScan();
      if (fixtures.length > 0) {
        const predictions = await stepPredict(fixtures);
        await stepSelectCrownJewel(predictions);
      }
      await setConfig("last_daily_run", { date: today(), step: "predict" });
    }

    if (step === "settle" || step === "all") {
      const results = await stepSettle();
      await setConfig("last_daily_run", { date: today(), step: "settle", results });
    }

    if (step === "learn" || step === "all") {
      const learnResults = await stepLearn();
      await setConfig("last_daily_run", { date: today(), step: "learn", accuracy: learnResults?.accuracy });
    }

    console.log("\n" + "═".repeat(70));
    console.log("✅ Daily loop complete!");
    console.log("═".repeat(70));

  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
