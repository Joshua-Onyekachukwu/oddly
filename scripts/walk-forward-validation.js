#!/usr/bin/env node
/**
 * Walk-Forward Validation Framework v2
 *
 * Tests for data leakage by checking:
 * 1. Calibration: Are high-confidence predictions actually more accurate?
 * 2. Chronological decay: Do older predictions perform differently than newer?
 * 3. Selection distribution: Is the model's selection distribution realistic?
 * 4. Per-model accuracy comparison
 *
 * Uses ACTUAL predictions from the database.
 *
 * Usage: node scripts/walk-forward-validation.js
 */

const fs = require("fs");

// Load env
const envFile = fs.readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}

const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("=== WALK-FORWARD VALIDATION v2 ===\n");

  // ── 1. Load all settled predictions ──
  const { data: predictions, error } = await sb
    .from("predictions")
    .select("id, fixture_id, market, selection, model_probability, confidence_tier, result, model_version, created_at")
    .in("result", ["correct", "wrong"])
    .order("created_at", { ascending: true });

  if (error) {
    console.log("Query error:", error.message);
    return;
  }

  if (!predictions?.length) {
    console.log("No settled predictions found.");
    return;
  }

  console.log(`Total settled predictions: ${predictions.length}`);
  console.log(`Date range: ${predictions[0]?.created_at?.split("T")[0]} → ${predictions[predictions.length - 1]?.created_at?.split("T")[0]}`);
  console.log(`Model versions: ${[...new Set(predictions.map(p => p.model_version))].join(", ")}\n`);

  // ── 2. Calibration Analysis ──
  console.log("─── TEST 1: CALIBRATION (model_probability vs actual accuracy) ───\n");

  const buckets = [
    { label: "50-60%", min: 0.50, max: 0.60, total: 0, correct: 0 },
    { label: "60-70%", min: 0.60, max: 0.70, total: 0, correct: 0 },
    { label: "70-80%", min: 0.70, max: 0.80, total: 0, correct: 0 },
    { label: "80-90%", min: 0.80, max: 0.90, total: 0, correct: 0 },
    { label: "90-95%", min: 0.90, max: 0.95, total: 0, correct: 0 },
    { label: "95%+",   min: 0.95, max: 1.01, total: 0, correct: 0 },
  ];

  for (const p of predictions) {
    const prob = p.model_probability || 0.5;
    for (const b of buckets) {
      if (prob >= b.min && prob < b.max) {
        b.total++;
        if (p.result === "correct") b.correct++;
        break;
      }
    }
  }

  console.log("Confidence  Total   Correct  Actual%  Predicted%  Cal. Error");
  console.log("-".repeat(70));
  for (const b of buckets) {
    if (b.total === 0) continue;
    const actualPct = (b.correct / b.total * 100).toFixed(1);
    const predictedPct = ((b.min + b.max) / 2 * 100).toFixed(0);
    const error = Math.abs(parseFloat(actualPct) - parseFloat(predictedPct)).toFixed(1);
    const status = parseFloat(error) < 5 ? "✅" : parseFloat(error) < 15 ? "⚠️" : "❌";
    console.log(`${b.label.padEnd(12)}${String(b.total).padStart(6)}${String(b.correct).padStart(9)}${(actualPct + "%").padStart(9)}${(predictedPct + "%").padStart(11)}${(error + "%").padStart(7)} ${status}`);
  }

  // ── 3. Chronological Decay ──
  console.log("\n─── TEST 2: CHRONOLOGICAL DECAY ───\n");

  const foldSize = Math.floor(predictions.length / 4);
  const folds = [];
  for (let i = 0; i < 4; i++) {
    const start = i * foldSize;
    const end = i === 3 ? predictions.length : start + foldSize;
    folds.push(predictions.slice(start, end));
  }

  console.log("Period  Date Range                        Total  Correct  Accuracy  Model");
  console.log("-".repeat(80));
  for (let i = 0; i < folds.length; i++) {
    const f = folds[i];
    const correct = f.filter(p => p.result === "correct").length;
    const acc = (correct / f.length * 100).toFixed(1);
    const startDate = f[0]?.created_at?.split("T")[0] || "?";
    const endDate = f[f.length - 1]?.created_at?.split("T")[0] || "?";
    const models = [...new Set(f.map(p => p.model_version))].join(", ");
    console.log(`  ${i + 1}    ${startDate} → ${endDate}  ${String(f.length).padStart(6)}${String(correct).padStart(9)}${(acc + "%").padStart(9)}  ${models}`);
  }

  // ── 4. Selection Distribution ──
  console.log("\n─── TEST 3: SELECTION DISTRIBUTION ───\n");

  const bySelection = {};
  for (const p of predictions) {
    const key = `${p.market}_${p.selection}`;
    if (!bySelection[key]) bySelection[key] = { total: 0, correct: 0 };
    bySelection[key].total++;
    if (p.result === "correct") bySelection[key].correct++;
  }

  console.log("Market_Selection       Total   Correct  Accuracy  Base Rate  Signal?");
  console.log("-".repeat(70));

  // Expected actual rates
  const baseRates = {
    "1X2_home": 0.46, "1X2_away": 0.27, "1X2_draw": 0.27,
    "over_under_over_2.5": 0.50, "over_under_under_2.5": 0.50,
    "over_under_over_1.5": 0.68, "over_under_under_1.5": 0.32,
    "over_under_over_3.5": 0.34, "over_under_under_3.5": 0.66,
    "btts_yes": 0.50, "btts_no": 0.50,
  };

  for (const [k, v] of Object.entries(bySelection).sort((a, b) => b[1].total - a[1].total).slice(0, 20)) {
    const acc = v.total > 0 ? (v.correct / v.total * 100).toFixed(1) : "0";
    const base = baseRates[k];
    let signal = "—";
    if (base !== undefined) {
      const diff = parseFloat(acc) - base * 100;
      signal = diff > 5 ? "✅ +" + diff.toFixed(0) + "%" : diff < -5 ? "❌ " + diff.toFixed(0) + "%" : "~random";
    }
    console.log(`${k.padEnd(23)}${String(v.total).padStart(7)}${String(v.correct).padStart(9)}${(acc + "%").padStart(9)}${base !== undefined ? ("(" + (base * 100).toFixed(0) + "%)") : "?"}  ${signal}`);
  }

  // ── 5. Per-Model Accuracy ──
  console.log("\n─── TEST 4: PER-MODEL ACCURACY ───\n");

  const byModel = {};
  for (const p of predictions) {
    const mv = p.model_version || "unknown";
    if (!byModel[mv]) byModel[mv] = { total: 0, correct: 0, byMarket: {} };
    byModel[mv].total++;
    if (p.result === "correct") byModel[mv].correct++;
    const mk = `${p.market}_${p.selection}`;
    if (!byModel[mv].byMarket[mk]) byModel[mv].byMarket[mk] = { total: 0, correct: 0 };
    byModel[mv].byMarket[mk].total++;
    if (p.result === "correct") byModel[mv].byMarket[mk].correct++;
  }

  for (const [mv, v] of Object.entries(byModel).sort((a, b) => b[1].total - a[1].total)) {
    const acc = (v.correct / v.total * 100).toFixed(1);
    console.log(`${mv}: ${v.correct}/${v.total} = ${acc}%`);

    const sorted = Object.entries(v.byMarket).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
    for (const [mk, mv2] of sorted) {
      const mkAcc = (mv2.correct / mv2.total * 100).toFixed(1);
      console.log(`  ${mk.padEnd(35)}${mv2.correct}/${mv2.total} = ${mkAcc}%`);
    }
    console.log("");
  }

  // ── 6. Brier Score ──
  console.log("─── TEST 5: BRIER SCORE ───\n");

  let brierSum = 0;
  let brierCount = 0;
  const brierByMarket = {};

  for (const p of predictions) {
    const prob = p.model_probability || 0.5;
    const outcome = p.result === "correct" ? 1 : 0;
    const brier = Math.pow(prob - outcome, 2);
    brierSum += brier;
    brierCount++;

    const mk = p.market;
    if (!brierByMarket[mk]) brierByMarket[mk] = { sum: 0, count: 0 };
    brierByMarket[mk].sum += brier;
    brierByMarket[mk].count++;
  }

  const overallBrier = (brierSum / brierCount).toFixed(4);
  console.log(`Overall Brier Score: ${overallBrier}`);
  console.log("(0.0 = perfect, 0.25 = random, 1.0 = worst)\n");

  console.log("Market              Brier    Samples  Quality");
  console.log("-".repeat(50));
  for (const [mk, v] of Object.entries(brierByMarket).sort((a, b) => a[1].sum / a[1].count - b[1].sum / b[1].count)) {
    const brier = (v.sum / v.count).toFixed(4);
    const quality = parseFloat(brier) < 0.20 ? "✅ Good" : parseFloat(brier) < 0.25 ? "⚠️ Fair" : "❌ Poor";
    console.log(`${mk.padEnd(20)}${brier.padStart(8)}${String(v.count).padStart(9)}  ${quality}`);
  }

  // ── 7. Verdict ──
  console.log("\n─── VERDICT ───\n");

  const avgAccuracy = predictions.filter(p => p.result === "correct").length / predictions.length * 100;
  console.log(`Overall accuracy: ${avgAccuracy.toFixed(1)}%`);
  console.log(`Brier score: ${overallBrier}`);
  console.log(`Data points: ${predictions.length}`);

  const issues = [];

  // 1X2 should be better than random (33.3%)
  const x2preds = predictions.filter(p => p.market === "1X2");
  const x2acc = x2preds.length > 0 ? x2preds.filter(p => p.result === "correct").length / x2preds.length * 100 : 0;
  if (x2acc < 38) {
    issues.push(`1X2 accuracy (${x2acc.toFixed(1)}%) near random (33.3%) — model lacks discriminative power for match outcome`);
  }

  // Brier should be better than 0.25
  if (parseFloat(overallBrier) > 0.24) {
    issues.push(`Brier score (${overallBrier}) near random (0.25) — probability estimates are poorly calibrated`);
  }

  // High confidence should be much better than base rate
  const highConfPreds = predictions.filter(p => p.model_probability > 0.8);
  const highConfAcc = highConfPreds.length > 0 ? highConfPreds.filter(p => p.result === "correct").length / highConfPreds.length * 100 : 0;
  if (highConfPreds.length > 10 && highConfAcc < 65) {
    issues.push(`High-confidence (>80%) accuracy (${highConfAcc.toFixed(1)}%) much lower than expected — model is overconfident`);
  }

  // Over_under_2.5 should be better than coin flip
  const ouPreds = predictions.filter(p => p.market === "over_under" && p.selection === "over_2.5");
  const ouAcc = ouPreds.length > 0 ? ouPreds.filter(p => p.result === "correct").length / ouPreds.length * 100 : 0;
  if (ouPreds.length > 50 && Math.abs(ouAcc - 50) < 5) {
    issues.push(`OU 2.5 accuracy (${ouAcc.toFixed(1)}%) is essentially a coin flip — model has no signal for this market`);
  }

  if (issues.length === 0) {
    console.log("\n✅ NO SIGNIFICANT ISSUES DETECTED");
    console.log("   The model appears to produce genuine, calibrated predictions.");
  } else {
    console.log("\n⚠️ ISSUES FOUND:");
    for (const l of issues) {
      console.log(`   • ${l}`);
    }
  }

  console.log("\n=== END ===");
}

run().catch(console.error);
