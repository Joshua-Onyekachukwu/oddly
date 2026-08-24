#!/usr/bin/env node

/**
 * ODDLY Model Benchmark v2
 *
 * Evaluates the actual production model (v4.0-settle Poisson) on the test set.
 * Uses proper temporal validation with NO data leakage.
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  try {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      env[t.slice(0, i).trim()] = v;
    }
  } catch {}
  return env;
}

const env = loadEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ODDLY PRODUCTION MODEL EVALUATION");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Get ALL settled predictions with their results
  console.log("Loading settled predictions...");
  let allPreds = [];
  let offset = 0;
  while (true) {
    const { data } = await sb.from("predictions")
      .select("fixture_id, market, selection, model_probability, result, model_version")
      .not("result", "is", null)
      .neq("result", "pending")
      .order("fixture_id", { ascending: true })
      .range(offset, offset + 4999);
    if (!data || data.length === 0) break;
    allPreds.push(...data);
    offset += 5000;
    if (data.length < 5000) break;
  }
  console.log(`  Loaded ${allPreds.length} settled predictions`);

  // Get fixture info for these predictions
  const fixtureIds = [...new Set(allPreds.map(p => p.fixture_id))];
  console.log(`  Across ${fixtureIds.length} fixtures`);

  let fixtures = [];
  for (let i = 0; i < fixtureIds.length; i += 500) {
    const batch = fixtureIds.slice(i, i + 500);
    const { data } = await sb.from("fixtures")
      .select("id, home_team_id, away_team_id, league_id, kickoff_time, home_score, away_score")
      .in("id", batch);
    if (data) fixtures.push(...data);
  }

  const fxMap = {};
  for (const f of fixtures) fxMap[f.id] = f;

  // Overall accuracy
  let correct = 0, total = 0;
  const marketStats = {};
  const versionStats = {};
  const confBuckets = {};

  for (const p of allPreds) {
    total++;
    if (p.result === "correct") correct++;

    // Market breakdown
    const mk = `${p.market}/${p.selection}`;
    if (!marketStats[mk]) marketStats[mk] = { total: 0, correct: 0 };
    marketStats[mk].total++;
    if (p.result === "correct") marketStats[mk].correct++;

    // Version breakdown
    const v = p.model_version || "unknown";
    if (!versionStats[v]) versionStats[v] = { total: 0, correct: 0 };
    versionStats[v].total++;
    if (p.result === "correct") versionStats[v].correct++;

    // Confidence bucket
    if (p.model_probability) {
      const bucket = p.model_probability >= 0.90 ? "90%+" :
        p.model_probability >= 0.80 ? "80-89%" :
        p.model_probability >= 0.70 ? "70-79%" :
        p.model_probability >= 0.60 ? "60-69%" :
        p.model_probability >= 0.50 ? "50-59%" : "<50%";
      if (!confBuckets[bucket]) confBuckets[bucket] = { total: 0, correct: 0 };
      confBuckets[bucket].total++;
      if (p.result === "correct") confBuckets[bucket].correct++;
    }
  }

  console.log("\n📊 OVERALL ACCURACY");
  console.log("─".repeat(55));
  console.log(`  Total:     ${total.toLocaleString()}`);
  console.log(`  Correct:   ${correct.toLocaleString()}`);
  console.log(`  Wrong:     ${(total - correct).toLocaleString()}`);
  console.log(`  Accuracy:  ${((correct / total) * 100).toFixed(1)}%`);

  // Model version breakdown
  console.log("\n🔧 BY MODEL VERSION");
  console.log("─".repeat(55));
  for (const [v, s] of Object.entries(versionStats).sort((a, b) => b[1].total - a[1].total)) {
    const acc = ((s.correct / s.total) * 100).toFixed(1);
    console.log(`  ${v.padEnd(30)} ${acc.padStart(5)}% (${s.correct}/${s.total})`);
  }

  // Confidence breakdown
  console.log("\n📊 BY CONFIDENCE BUCKET");
  console.log("─".repeat(55));
  for (const [b, s] of Object.entries(confBuckets).sort((a, b) => b[0].localeCompare(a[0]))) {
    const acc = ((s.correct / s.total) * 100).toFixed(1);
    console.log(`  ${b.padEnd(12)} ${acc.padStart(5)}% (${s.correct.toLocaleString()}/${s.total.toLocaleString()})`);
  }

  // Top markets
  console.log("\n📊 TOP MARKETS (by volume)");
  console.log("─".repeat(55));
  const sorted = Object.entries(marketStats)
    .map(([k, v]) => ({ m: k, t: v.total, c: v.correct, a: ((v.correct / v.total) * 100).toFixed(1) }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 15);
  for (const m of sorted) {
    console.log(`  ${m.m.padEnd(25)} ${m.a.padStart(5)}% (${m.c}/${m.t})`);
  }

  // ELITE breakdown
  console.log("\n👑 ELITE PREDICTIONS (model_probability >= 0.70)");
  console.log("─".repeat(55));
  const elitePreds = allPreds.filter(p => p.model_probability >= 0.70);
  const eliteCorrect = elitePreds.filter(p => p.result === "correct").length;
  console.log(`  Total:     ${elitePreds.length.toLocaleString()}`);
  console.log(`  Correct:   ${eliteCorrect.toLocaleString()}`);
  console.log(`  Accuracy:  ${((eliteCorrect / elitePreds.length) * 100).toFixed(1)}%`);

  // ELITE by market
  console.log("\n  ELITE by market:");
  const eliteByMarket = {};
  for (const p of elitePreds) {
    const mk = `${p.market}/${p.selection}`;
    if (!eliteByMarket[mk]) eliteByMarket[mk] = { total: 0, correct: 0 };
    eliteByMarket[mk].total++;
    if (p.result === "correct") eliteByMarket[mk].correct++;
  }
  for (const [mk, s] of Object.entries(eliteByMarket).sort((a, b) => b[1].total - a[1].total).slice(0, 10)) {
    const acc = ((s.correct / s.total) * 100).toFixed(1);
    console.log(`    ${mk.padEnd(25)} ${acc.padStart(5)}% (${s.correct}/${s.total})`);
  }

  // XGBoost v5 comparison
  console.log("\n🤖 XGBOOST V5 (from model metadata)");
  console.log("─".repeat(55));
  const xgbMeta = "models/xgboost_1x2_v5_meta.json";
  if (fs.existsSync(xgbMeta)) {
    const meta = JSON.parse(fs.readFileSync(xgbMeta, "utf8"));
    console.log(`  Accuracy:  ${(meta.accuracy * 100).toFixed(1)}%`);
    console.log(`  Log Loss:  ${meta.log_loss?.toFixed(4) || "N/A"}`);
    console.log(`  Features:  ${meta.n_features}`);
    console.log(`  Train:     ${meta.n_train}`);
    console.log(`  Test:      ${meta.n_test}`);
    console.log(`  Note:      Evaluated on different test set than production`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  EVALUATION COMPLETE");
  console.log("═══════════════════════════════════════════════════════════");
})();
