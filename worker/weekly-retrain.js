#!/usr/bin/env node

/**
 * ODDLY Self-Training Engine — Weekly Retrain
 *
 * Runs every 7 days or every 50 predictions.
 * Retrains all models on accumulated data.
 *
 * Run: node worker/weekly-retrain.js
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
function today() { return new Date().toISOString().split("T")[0]; }

async function getConfig(key) {
  const { data } = await supabase.from("scoring_config").select("config_value").eq("config_key", key).maybeSingle();
  return data?.config_value;
}

async function setConfig(key, value) {
  await supabase.from("scoring_config").upsert({ config_key: key, config_value: value, updated_at: new Date().toISOString() });
}

// ─── Feature Vector Conversion ──────────────────────────────────────────────

const FEATURE_NAMES = [
  "elo_diff", "home_form_ppg", "away_form_ppg", "home_win_rate", "away_win_rate",
  "home_avg_goals", "home_avg_conceded", "away_avg_goals", "away_avg_conceded",
  "home_streak", "away_streak", "goal_diff", "home_odds", "draw_odds", "away_odds",
  "market_home_prob", "h2h_meetings", "h2h_home_win_rate",
];

function featuresToVector(features) {
  return FEATURE_NAMES.map(name => {
    const val = features[name];
    if (val === null || val === undefined) return 0;
    return typeof val === "number" ? val : 0;
  });
}

// ─── Simple Gradient Boosting (XGBoost approximation) ──────────────────────

class SimpleGradientBoosting {
  constructor(nEstimators = 100, learningRate = 0.1, maxDepth = 4) {
    this.nEstimators = nEstimators;
    this.learningRate = learningRate;
    this.maxDepth = maxDepth;
    this.trees = [];
    this.basePrediction = 0;
  }

  fit(X, y) {
    this.basePrediction = y.reduce((s, v) => s + v, 0) / y.length;
    let predictions = new Array(y.length).fill(this.basePrediction);

    for (let i = 0; i < this.nEstimators; i++) {
      const residuals = y.map((yi, idx) => yi - predictions[idx]);
      const tree = this._buildTree(X, residuals, 0);
      this.trees.push(tree);

      for (let j = 0; j < X.length; j++) {
        predictions[j] += this.learningRate * this._predictTree(tree, X[j]);
      }
    }
  }

  predict(X) {
    return X.map(x => {
      let pred = this.basePrediction;
      for (const tree of this.trees) {
        pred += this.learningRate * this._predictTree(tree, x);
      }
      return clamp(pred);
    });
  }

  _buildTree(X, y, depth) {
    if (depth >= this.maxDepth || X.length < 5) {
      return { leaf: true, value: y.reduce((s, v) => s + v, 0) / y.length };
    }

    let bestFeature = 0, bestThreshold = 0, bestScore = Infinity;

    for (let f = 0; f < X[0].length; f++) {
      const values = X.map(x => x[f]).sort((a, b) => a - b);
      for (let t = 0; t < Math.min(10, values.length); t++) {
        const threshold = values[Math.floor(values.length * (t + 1) / 11)];
        const left = [], right = [], leftY = [], rightY = [];
        for (let i = 0; i < X.length; i++) {
          if (X[i][f] <= threshold) { left.push(X[i]); leftY.push(y[i]); }
          else { right.push(X[i]); rightY.push(y[i]); }
        }
        if (left.length < 3 || right.length < 3) continue;
        const leftMean = leftY.reduce((s, v) => s + v, 0) / leftY.length;
        const rightMean = rightY.reduce((s, v) => s + v, 0) / rightY.length;
        const score = leftY.reduce((s, v) => s + (v - leftMean) ** 2, 0) +
                     rightY.reduce((s, v) => s + (v - rightMean) ** 2, 0);
        if (score < bestScore) { bestScore = score; bestFeature = f; bestThreshold = threshold; }
      }
    }

    const leftX = [], rightX = [], leftY = [], rightY = [];
    for (let i = 0; i < X.length; i++) {
      if (X[i][bestFeature] <= bestThreshold) { leftX.push(X[i]); leftY.push(y[i]); }
      else { rightX.push(X[i]); rightY.push(y[i]); }
    }

    return {
      leaf: false,
      feature: bestFeature,
      threshold: bestThreshold,
      left: this._buildTree(leftX, leftY, depth + 1),
      right: this._buildTree(rightX, rightY, depth + 1),
    };
  }

  _predictTree(tree, x) {
    if (tree.leaf) return tree.value;
    return x[tree.feature] <= tree.threshold
      ? this._predictTree(tree.left, x)
      : this._predictTree(tree.right, x);
  }

  getFeatureImportance() {
    const importance = new Array(FEATURE_NAMES.length).fill(0);
    for (const tree of this.trees) {
      this._countImportance(tree, importance);
    }
    const total = importance.reduce((s, v) => s + v, 0) || 1;
    const result = {};
    FEATURE_NAMES.forEach((name, i) => {
      result[name] = Math.round((importance[i] / total) * 10000) / 10000;
    });
    return result;
  }

  _countImportance(tree, importance) {
    if (tree.leaf) return;
    importance[tree.feature]++;
    this._countImportance(tree.left, importance);
    this._countImportance(tree.right, importance);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔧 ODDLY Weekly Retrain");
  console.log("━".repeat(70));
  console.log(`   Date: ${today()}`);

  // 1. Gather all prediction-outcome pairs
  console.log("\n📊 Step 1: Gathering training data...");
  const { data: allData } = await supabase
    .from("model_learning_history")
    .select("features_snapshot, was_correct, predicted_probability, market, model_version")
    .not("was_correct", "is", null);

  if (!allData || allData.length < 20) {
    console.log(`   Not enough data (${allData?.length || 0} pairs). Need 20+.`);
    console.log("   Run daily loop for a few days first.");
    return;
  }

  console.log(`   Found ${allData.length} prediction-outcome pairs`);

  // 2. Extract feature matrix and labels
  console.log("\n📊 Step 2: Building feature matrix...");
  const X = [];
  const y = [];
  for (const record of allData) {
    if (!record.features_snapshot) continue;
    X.push(featuresToVector(record.features_snapshot));
    y.push(record.was_correct ? 1 : 0);
  }

  console.log(`   Feature matrix: ${X.length} samples × ${X[0]?.length || 0} features`);

  // 3. Train XGBoost
  console.log("\n📊 Step 3: Training Gradient Boosting model...");
  const xgb = new SimpleGradientBoosting(100, 0.1, 4);
  xgb.fit(X, y);

  // Predict on training data
  const predictions = xgb.predict(X);
  const predictedClasses = predictions.map(p => p > 0.5 ? 1 : 0);
  const xgbAccuracy = predictedClasses.filter((c, i) => c === y[i]).length / y.length;
  console.log(`   XGBoost training accuracy: ${(xgbAccuracy * 100).toFixed(1)}%`);

  // 4. Feature importance
  console.log("\n📊 Step 4: Feature importance:");
  const featureImportance = xgb.getFeatureImportance();
  const sorted = Object.entries(featureImportance).sort((a, b) => b[1] - a[1]);
  for (const [name, imp] of sorted.slice(0, 10)) {
    const bar = "█".repeat(Math.round(imp * 50));
    console.log(`   ${name.padEnd(25)} ${bar} ${(imp * 100).toFixed(1)}%`);
  }

  // 5. Market-specific performance
  console.log("\n📊 Step 5: Market performance:");
  const marketPerf = {};
  for (const r of allData) {
    if (!marketPerf[r.market]) marketPerf[r.market] = { c: 0, t: 0 };
    marketPerf[r.market].t++;
    if (r.was_correct) marketPerf[r.market].c++;
  }
  for (const [market, perf] of Object.entries(marketPerf)) {
    const acc = perf.c / perf.t;
    console.log(`   ${market.padEnd(15)} ${(acc * 100).toFixed(1)}% (${perf.c}/${perf.t})`);
  }

  // 6. Calculate new ensemble weights
  console.log("\n📊 Step 6: Calculating ensemble weights...");

  // Simple heuristic: weight by accuracy
  const currentWeights = await getConfig("ensemble_weights") || {
    elo: 0.29, form: 0.19, goals: 0.18, odds: 0.10, homeAdv: 0.10, h2h: 0.10, streak: 0.05
  };

  // Boost weights for features that correlate with correct predictions
  const newWeights = { ...currentWeights };
  for (const [feature, importance] of sorted) {
    if (feature === "elo_diff" && importance > 0.1) newWeights.elo = Math.min(newWeights.elo + 0.02, 0.40);
    if (feature === "home_form_ppg" && importance > 0.08) newWeights.form = Math.min(newWeights.form + 0.02, 0.35);
    if (feature === "home_avg_goals" && importance > 0.08) newWeights.goals = Math.min(newWeights.goals + 0.02, 0.30);
  }

  // Normalize
  const total = Object.values(newWeights).reduce((s, v) => s + v, 0);
  for (const key of Object.keys(newWeights)) newWeights[key] /= total;

  console.log("   Old weights:", Object.entries(currentWeights).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(", "));
  console.log("   New weights:", Object.entries(newWeights).map(([k, v]) => `${k}=${(v * 100).toFixed(0)}%`).join(", "));

  // 7. Version increment
  const currentVersion = await getConfig("current_model_version") || "v1.0";
  const versionNum = parseFloat(currentVersion.replace("v", "")) + 0.1;
  const newVersion = `v${versionNum.toFixed(1)}`;

  // 8. Save new model version
  console.log(`\n📊 Step 7: Deploying ${newVersion}...`);
  await supabase.from("model_versions").insert({
    version: newVersion,
    model_weights: newWeights,
    ensemble_weights: newWeights,
    feature_weights: featureImportance,
    backtest_accuracy: xgbAccuracy,
    training_samples: X.length,
    training_period: `${allData.length} prediction-outcome pairs`,
    training_date: today(),
    status: "active",
  });

  // Archive old version
  await supabase.from("model_versions")
    .update({ status: "archived" })
    .eq("status", "active")
    .neq("version", newVersion);

  await setConfig("current_model_version", newVersion);
  await setConfig("ensemble_weights", newWeights);

  // 9. Training log
  await supabase.from("training_log").insert({
    model_version: newVersion,
    training_date: today(),
    training_type: "weekly",
    predictions_count: allData.length,
    correct_count: y.filter(v => v === 1).length,
    accuracy: xgbAccuracy,
    model_weights: newWeights,
    feature_weights: featureImportance,
    market_performance: marketPerf,
    notes: `Weekly retrain. ${allData.length} samples. XGBoost accuracy: ${(xgbAccuracy * 100).toFixed(1)}%`,
  });

  // 10. Feature importance table
  for (const [feature, importance] of Object.entries(featureImportance)) {
    await supabase.from("feature_importance").upsert({
      model_version: newVersion,
      feature_name: feature,
      importance,
      sample_size: X.length,
      updated_at: new Date().toISOString(),
    }, { onConflict: "model_version,feature_name,market,league_id" });
  }

  await setConfig("last_weekly_retrain", { date: today(), version: newVersion });

  console.log("\n" + "═".repeat(70));
  console.log("✅ Weekly retrain complete!");
  console.log(`   New version: ${newVersion}`);
  console.log(`   XGBoost accuracy: ${(xgbAccuracy * 100).toFixed(1)}%`);
  console.log(`   Training samples: ${X.length}`);
  console.log("═".repeat(70));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
