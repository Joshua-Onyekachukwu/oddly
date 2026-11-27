#!/usr/bin/env node

/**
 * Injury Ablation Testing Script
 * 
 * Compares model performance with and without injury features.
 * Uses walk-forward validation to prevent data leakage.
 * 
 * Usage: node scripts/injury-ablation-test.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Load environment
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, "utf8").split("\n").forEach((l) => {
      const m = l.match(/^([^#=]+)="?([^"]*)"?\s*$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    });
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
);

// ─── Metrics Calculation ─────────────────────────────────────────────────

function calculateMetrics(predictions, actuals) {
  let correct = 0;
  let total = predictions.length;
  
  const classMetrics = {
    home: { tp: 0, fp: 0, fn: 0 },
    draw: { tp: 0, fp: 0, fn: 0 },
    away: { tp: 0, fp: 0, fn: 0 },
  };
  
  let logLoss = 0;
  let brierScore = 0;
  
  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const actual = actuals[i];
    
    if (pred.selection === actual) {
      correct++;
    }
    
    // Update class metrics
    if (pred.selection === actual) {
      classMetrics[actual].tp++;
    } else {
      classMetrics[pred.selection].fp++;
      classMetrics[actual].fn++;
    }
    
    // Log loss and Brier score
    const prob = pred.model_probability;
    const actualProb = pred.selection === actual ? 1 : 0;
    
    logLoss -= actualProb * Math.log(prob + 1e-10) + (1 - actualProb) * Math.log(1 - prob + 1e-10);
    brierScore += Math.pow(prob - actualProb, 2);
  }
  
  const accuracy = total > 0 ? correct / total : 0;
  logLoss = total > 0 ? logLoss / total : 0;
  brierScore = total > 0 ? brierScore / total : 0;
  
  // Calculate per-class metrics
  const perClass = {};
  for (const [cls, metrics] of Object.entries(classMetrics)) {
    const precision = metrics.tp + metrics.fp > 0 ? metrics.tp / (metrics.tp + metrics.fp) : 0;
    const recall = metrics.tp + metrics.fn > 0 ? metrics.tp / (metrics.tp + metrics.fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    perClass[cls] = { precision, recall, f1 };
  }
  
  // Balanced accuracy
  const balancedAccuracy = Object.values(perClass).reduce((sum, m) => sum + m.recall, 0) / 3;
  
  return {
    accuracy,
    balancedAccuracy,
    logLoss,
    brierScore,
    perClass,
    sampleSize: total,
  };
}

// ─── Walk-Forward Validation ─────────────────────────────────────────────

async function walkForwardValidation(useInjuryFeatures = false) {
  console.log(`\nRunning walk-forward validation (injury features: ${useInjuryFeatures})...`);
  
  // Get all settled fixtures with predictions
  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select(`
      id,
      kickoff_time,
      home_team:teams!fixtures_home_team_id_fkey(canonical_name),
      away_team:teams!fixtures_away_team_id_fkey(canonical_name),
      home_score,
      away_score
    `)
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: true });

  if (fixturesError || !fixtures?.length) {
    console.error("Error fetching fixtures:", fixturesError);
    return null;
  }

  console.log(`Found ${fixtures.length} finished fixtures`);

  const predictions = [];
  const actuals = [];

  for (const fixture of fixtures) {
    const homeTeam = fixture.home_team?.canonical_name;
    const awayTeam = fixture.away_team?.canonical_name;
    
    if (!homeTeam || !awayTeam) continue;

    // Determine actual result
    let actualResult;
    if (fixture.home_score > fixture.away_score) {
      actualResult = "home";
    } else if (fixture.home_score < fixture.away_score) {
      actualResult = "away";
    } else {
      actualResult = "draw";
    }

    // Get prediction for this fixture
    let query = supabase
      .from("predictions")
      .select("market, selection, model_probability")
      .eq("fixture_id", fixture.id)
      .eq("market", "1X2")
      .order("model_probability", { ascending: false })
      .limit(1);

    const { data: predData, error: predError } = await query.single();

    if (predError || !predData) {
      continue;
    }

    // If using injury features, check if injury features were available
    if (useInjuryFeatures) {
      const { data: injuryFeatures } = await supabase
        .from("fixture_injury_features")
        .select("id")
        .eq("fixture_id", fixture.id)
        .lte("snapshot_date", fixture.kickoff_time)
        .limit(1);

      if (!injuryFeatures?.length) {
        continue; // Skip if no injury features available
      }
    }

    predictions.push({
      selection: predData.selection.toLowerCase(),
      model_probability: Number(predData.model_probability),
    });
    
    actuals.push(actualResult);
  }

  if (predictions.length === 0) {
    console.log("No valid predictions found for validation");
    return null;
  }

  console.log(`Validated ${predictions.length} predictions`);
  
  return calculateMetrics(predictions, actuals);
}

// ─── Feature Analysis ────────────────────────────────────────────────────

async function analyzeInjuryFeatureImpact() {
  console.log("\nAnalyzing injury feature impact...");
  
  // Get fixtures with injury features
  const { data: fixtures, error } = await supabase
    .from("fixture_injury_features")
    .select(`
      fixture_id,
      injury_difference,
      availability_difference,
      home_injury_impact,
      away_injury_impact
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !fixtures?.length) {
    console.log("No injury feature data available for analysis");
    return;
  }

  console.log(`Analyzing ${fixtures.length} fixtures with injury features`);

  // Correlate injury difference with prediction accuracy
  let highInjuryDiffCorrect = 0;
  let highInjuryDiffTotal = 0;
  let lowInjuryDiffCorrect = 0;
  let lowInjuryDiffTotal = 0;

  for (const fixture of fixtures) {
    const { data: prediction } = await supabase
      .from("predictions")
      .select("selection, model_probability")
      .eq("fixture_id", fixture.fixture_id)
      .eq("market", "1X2")
      .order("model_probability", { ascending: false })
      .limit(1)
      .single();

    const { data: actualFixture } = await supabase
      .from("fixtures")
      .select("home_score, away_score")
      .eq("id", fixture.fixture_id)
      .single();

    if (!prediction || !actualFixture) continue;

    let actualResult;
    if (actualFixture.home_score > actualFixture.away_score) {
      actualResult = "home";
    } else if (actualFixture.home_score < actualFixture.away_score) {
      actualResult = "away";
    } else {
      actualResult = "draw";
    }

    const isCorrect = prediction.selection.toLowerCase() === actualResult;
    const absInjuryDiff = Math.abs(fixture.injury_difference);

    if (absInjuryDiff > 2) {
      highInjuryDiffTotal++;
      if (isCorrect) highInjuryDiffCorrect++;
    } else {
      lowInjuryDiffTotal++;
      if (isCorrect) lowInjuryDiffCorrect++;
    }
  }

  console.log("\nInjury Difference Impact on Accuracy:");
  console.log(`  High injury difference (>2): ${highInjuryDiffTotal > 0 ? ((highInjuryDiffCorrect / highInjuryDiffTotal) * 100).toFixed(1) : 0}% (${highInjuryDiffCorrect}/${highInjuryDiffTotal})`);
  console.log(`  Low injury difference (≤2): ${lowInjuryDiffTotal > 0 ? ((lowInjuryDiffCorrect / lowInjuryDiffTotal) * 100).toFixed(1) : 0}% (${lowInjuryDiffCorrect}/${lowInjuryDiffTotal})`);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ODDLY Injury Ablation Testing");
  console.log("═══════════════════════════════════════════════════════════");

  try {
    // Run baseline validation (without injury features)
    console.log("\n═══ Baseline Model (without injury features) ═══");
    const baselineMetrics = await walkForwardValidation(false);
    
    if (baselineMetrics) {
      console.log("\nBaseline Metrics:");
      console.log(`  Accuracy: ${(baselineMetrics.accuracy * 100).toFixed(1)}%`);
      console.log(`  Balanced Accuracy: ${(baselineMetrics.balancedAccuracy * 100).toFixed(1)}%`);
      console.log(`  Log Loss: ${baselineMetrics.logLoss.toFixed(4)}`);
      console.log(`  Brier Score: ${baselineMetrics.brierScore.toFixed(4)}`);
      console.log(`  Sample Size: ${baselineMetrics.sampleSize}`);
      
      console.log("\n  Per-Class Metrics:");
      for (const [cls, metrics] of Object.entries(baselineMetrics.perClass)) {
        console.log(`    ${cls}: P=${(metrics.precision * 100).toFixed(1)}% R=${(metrics.recall * 100).toFixed(1)}% F1=${(metrics.f1 * 100).toFixed(1)}%`);
      }
    }

    // Run validation with injury features (if available)
    console.log("\n═══ Model with Injury Features ═══");
    const injuryMetrics = await walkForwardValidation(true);
    
    if (injuryMetrics) {
      console.log("\nInjury-Enhanced Metrics:");
      console.log(`  Accuracy: ${(injuryMetrics.accuracy * 100).toFixed(1)}%`);
      console.log(`  Balanced Accuracy: ${(injuryMetrics.balancedAccuracy * 100).toFixed(1)}%`);
      console.log(`  Log Loss: ${injuryMetrics.logLoss.toFixed(4)}`);
      console.log(`  Brier Score: ${injuryMetrics.brierScore.toFixed(4)}`);
      console.log(`  Sample Size: ${injuryMetrics.sampleSize}`);
      
      console.log("\n  Per-Class Metrics:");
      for (const [cls, metrics] of Object.entries(injuryMetrics.perClass)) {
        console.log(`    ${cls}: P=${(metrics.precision * 100).toFixed(1)}% R=${(metrics.recall * 100).toFixed(1)}% F1=${(metrics.f1 * 100).toFixed(1)}%`);
      }
    }

    // Compare results
    if (baselineMetrics && injuryMetrics) {
      console.log("\n═══ Comparison ═══");
      console.log(`  Accuracy: ${(baselineMetrics.accuracy * 100).toFixed(1)}% → ${(injuryMetrics.accuracy * 100).toFixed(1)}% (${((injuryMetrics.accuracy - baselineMetrics.accuracy) * 100).toFixed(1)}%)`);
      console.log(`  Balanced Accuracy: ${(baselineMetrics.balancedAccuracy * 100).toFixed(1)}% → ${(injuryMetrics.balancedAccuracy * 100).toFixed(1)}% (${((injuryMetrics.balancedAccuracy - baselineMetrics.balancedAccuracy) * 100).toFixed(1)}%)`);
      console.log(`  Log Loss: ${baselineMetrics.logLoss.toFixed(4)} → ${injuryMetrics.logLoss.toFixed(4)} (${(injuryMetrics.logLoss - baselineMetrics.logLoss).toFixed(4)})`);
      console.log(`  Brier Score: ${baselineMetrics.brierScore.toFixed(4)} → ${injuryMetrics.brierScore.toFixed(4)} (${(injuryMetrics.brierScore - baselineMetrics.brierScore).toFixed(4)})`);
    }

    // Analyze injury feature impact
    await analyzeInjuryFeatureImpact();

    // Save results
    const results = {
      timestamp: new Date().toISOString(),
      baseline: baselineMetrics,
      withInjuries: injuryMetrics,
      improvement: baselineMetrics && injuryMetrics ? {
        accuracy: injuryMetrics.accuracy - baselineMetrics.accuracy,
        balancedAccuracy: injuryMetrics.balancedAccuracy - baselineMetrics.balancedAccuracy,
        logLoss: injuryMetrics.logLoss - baselineMetrics.logLoss,
        brierScore: injuryMetrics.brierScore - baselineMetrics.brierScore,
      } : null,
    };

    const resultsPath = path.join(__dirname, "..", "data", "injury-ablation-results.json");
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\nResults saved to ${resultsPath}`);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Ablation Testing Complete");
    console.log("═══════════════════════════════════════════════════════════");

  } catch (error) {
    console.error("Error during ablation testing:", error);
  }
}

main().catch(console.error);
