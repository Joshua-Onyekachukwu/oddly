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
}// ─── Model: Ensemble v5.1 (imported from ensemble-model.js) ──────────────
// Elo, Poisson, Regression, xG, Referee adjustments, Isotonic calibration
// All model logic lives in worker/ensemble-model.js

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

// ─── Step 2: PREDICT (Ensemble v5.1) ──────────────────────────────────────

async function stepPredict(fixtures) {
  console.log("\n🧠 Step 2: GENERATING predictions (Ensemble v5.1)...");

  // Import ensemble model
  const ensemble = require("./ensemble-model");
  const tracker = new ensemble.EnhancedTracker();

  // Load historical data into tracker
  console.log("   Loading historical matches...");
  let offset = 0;
  let loaded = 0;
  while (true) {
    const { data: batch } = await supabase
      .from("fixtures")
      .select("home_score, away_score, kickoff_time, league_id, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    for (const m of batch) {
      const home = m.home?.canonical_name;
      const away = m.away?.canonical_name;
      if (home && away) tracker.recordMatch(home, away, m.home_score, m.away_score, m.kickoff_time, m.league_id);
    }
    loaded += batch.length;
    offset += 999;
    if (batch.length < 1000) break;
  }
  console.log(`   Loaded ${loaded} historical matches`);

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

  const predictions = [];

  for (const fixture of fixtures) {
    const homeName = fixture.home_team?.canonical_name;
    const awayName = fixture.away_team?.canonical_name;
    if (!homeName || !awayName) continue;

    // Set odds for this fixture
    tracker._currentFixtureOdds = oddsByFixture[fixture.id] || null;

    // Get features from ensemble tracker
    const { homeLambda, awayLambda, features } = tracker.getFeatures(homeName, awayName, fixture.league_id);

    // Get referee features
    const refFeatures = ensemble.getRefereeFeatures(homeName, awayName);

    // Adjust lambdas with referee data
    let adjHomeLambda = homeLambda;
    let adjAwayLambda = awayLambda;
    if (refFeatures.hasProfile && refFeatures.referee) {
      const refGoalAdj = refFeatures.avgGoals / 2.6;
      adjHomeLambda = ensemble.clamp(homeLambda * refGoalAdj, 0.3, 4.5);
      adjAwayLambda = ensemble.clamp(awayLambda * refGoalAdj, 0.3, 4.5);
      const hMatches = refFeatures.homeTeamRef?.matches || 0;
      const aMatches = refFeatures.awayTeamRef?.matches || 0;
      if (hMatches >= 3 && aMatches >= 3) {
        const strDiff = (refFeatures.homeTeamRef.winRate - 0.46) - (refFeatures.awayTeamRef.winRate - 0.30);
        adjHomeLambda = ensemble.clamp(adjHomeLambda * (1 + strDiff * 0.25), 0.3, 4.5);
        adjAwayLambda = ensemble.clamp(adjAwayLambda * (1 - strDiff * 0.25), 0.3, 4.5);
      }
      const homeBiasAdj = 1 + (refFeatures.homeBias - 0.46) * 0.15;
      adjHomeLambda = ensemble.clamp(adjHomeLambda * homeBiasAdj, 0.3, 4.5);
      adjAwayLambda = ensemble.clamp(adjAwayLambda / homeBiasAdj, 0.3, 4.5);
    }

    // Model 1: Poisson (referee-adjusted)
    const grid = ensemble.poissonGoals(adjHomeLambda, adjAwayLambda);
    const poissonMarkets = ensemble.computeMarkets(grid);

    // Model 2: Elo
    const eloProb = ensemble.eloWinProb(tracker.elo[homeName] || 1500, tracker.elo[awayName] || 1500);

    // Model 3: Regression
    const { regressionProb } = require("./ensemble-model");
    const regProb = regressionProb(features, refFeatures);

    // Ensemble: combine all three
    let ensembleMarkets = ensemble.ensembleCombine(poissonMarkets, eloProb, regProb, features);

    // Apply calibration
    for (const [mk, prob] of Object.entries(ensembleMarkets)) {
      ensembleMarkets[mk] = ensemble.applyCalibration(prob);
    }

    // Build feature snapshot for traceability
    const featureSnapshot = {
      eloDiff: features.eloDiff,
      homePPG: features.homePPG,
      awayPPG: features.awayPPG,
      homeGF: features.homeGF,
      homeGA: features.homeGA,
      awayGF: features.awayGF,
      awayGA: features.awayGA,
      cleanSheet: features.cleanSheet,
      homeWinRate: features.homeWinRate,
      awayWinRate: features.awayWinRate,
      streak: features.streak,
      homeLambda: adjHomeLambda,
      awayLambda: adjAwayLambda,
      expectedGoals: adjHomeLambda + adjAwayLambda,
      homeElo: tracker.elo[homeName] || 1500,
      awayElo: tracker.elo[awayName] || 1500,
      referee: refFeatures.referee || null,
    };

    // Store predictions for all markets
    for (const [mk, prob] of Object.entries(ensembleMarkets)) {
      const [market, ...selectionParts] = mk.split("_");
      const selection = selectionParts.join("_");
      predictions.push({
        fixture_id: fixture.id,
        market: market === "OU" ? "over_under" : market.toLowerCase(),
        selection: selection || mk,
        model_probability: Math.round(prob * 10000) / 10000,
        confidence_lower: Math.round(prob * 0.9 * 10000) / 10000,
        confidence_upper: Math.round(Math.min(prob * 1.1, 0.99) * 10000) / 10000,
        model_version: "v5.1-ensemble",
        features_used: featureSnapshot,
        result: "pending",
      });
    }

    // Store in model_learning_history with full snapshot
    await supabase.from("model_learning_history").insert({
      model_version: "v5.1-ensemble",
      fixture_id: fixture.id,
      market: "1X2",
      selection: homeName,
      predicted_probability: ensembleMarkets["1X2_Home"] || 0.5,
      features_snapshot: featureSnapshot,
      was_correct: null,
      predicted_at: now(),
    });

    console.log(`   🎯 ${homeName} vs ${awayName}: Home=${((ensembleMarkets["1X2_Home"] || 0.5) * 100).toFixed(1)}% Draw=${((ensembleMarkets["1X2_Draw"] || 0.25) * 100).toFixed(1)}% Away=${((ensembleMarkets["1X2_Away"] || 0.25) * 100).toFixed(1)}%`);
  }

  // Batch insert all predictions
  for (let i = 0; i < predictions.length; i += 50) {
    await supabase.from("predictions").insert(predictions.slice(i, i + 50));
  }

  console.log(`   ✅ Generated ${predictions.length} predictions (Ensemble v5.1)`);
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
