#!/usr/bin/env node

/**
 * ODDLY Walk-Forward Validation (Full)
 *
 * Evaluates ACTUAL ensemble predictions against real fixture results.
 * No synthetic models — only real stored predictions.
 *
 * Usage: node scripts/walk-forward-full.js [--model-version v2.0-meta-ensemble]
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

// Load env
const env = {};
fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
  .split("\n")
  .forEach((l) => {
    if (l.startsWith("#") || !l.includes("=")) return;
    const idx = l.indexOf("=");
    const key = l.substring(0, idx).trim();
    let val = l.substring(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[key] = val;
  });

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const modelVersion = process.argv.includes("--model-version")
    ? process.argv[process.argv.indexOf("--model-version") + 1]
    : null;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ODDLY Walk-Forward Validation (Full)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Model filter: ${modelVersion || "ALL models"}`);

  // 1. Get all finished fixtures with scores
  console.log("\n📊 Loading fixtures...");
  const { data: fixtures, error: fixErr } = await sb
    .from("fixtures")
    .select(
      `id, home_score, away_score, kickoff_time, league_id,
       home:teams!fixtures_home_team_id_fkey(canonical_name),
       away:teams!fixtures_away_team_id_fkey(canonical_name)`
    )
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: true });

  if (fixErr) {
    console.error("Error loading fixtures:", fixErr);
    return;
  }

  // Index fixtures by ID
  const fixtureMap = {};
  for (const f of fixtures) {
    fixtureMap[f.id] = {
      home: f.home?.canonical_name,
      away: f.away?.canonical_name,
      homeScore: f.home_score,
      awayScore: f.away_score,
      date: f.kickoff_time,
      league: f.league_id,
    };
  }

  console.log(`  ${fixtures.length} finished fixtures loaded`);

  // 2. Get all settled predictions
  console.log("\n📊 Loading predictions...");
  let query = sb
    .from("predictions")
    .select("id, fixture_id, market, selection, model_probability, model_version, result, created_at")
    .not("result", "is", null)
    .neq("result", "pending")
    .order("created_at", { ascending: true });

  if (modelVersion) {
    query = query.eq("model_version", modelVersion);
  }

  const { data: predictions, error: predErr } = await query.limit(50000);

  if (predErr) {
    console.error("Error loading predictions:", predErr);
    return;
  }

  console.log(`  ${predictions.length} settled predictions loaded`);

  // 3. Evaluate predictions
  console.log("\n🔍 Evaluating predictions...\n");

  // Filter to predictions with matching fixtures
  const evaluable = predictions.filter((p) => fixtureMap[p.fixture_id]);

  // Group by market
  const byMarket = {};
  for (const pred of evaluable) {
    const mkt = pred.market?.toLowerCase() || "unknown";
    if (!byMarket[mkt]) byMarket[mkt] = [];
    byMarket[mkt].push(pred);
  }

  // ─── 1X2 Evaluation ───
  console.log("═".repeat(60));
  console.log("  1X2 MARKET");
  console.log("═".repeat(60));

  const preds1x2 = byMarket["1x2"] || [];
  if (preds1x2.length > 0) {
    const conf = { home: { correct: 0, total: 0 }, draw: { correct: 0, total: 0 }, away: { correct: 0, total: 0 } };
    const confusion = { home_home: 0, home_draw: 0, home_away: 0, draw_home: 0, draw_draw: 0, draw_away: 0, away_home: 0, away_draw: 0, away_away: 0 };
    let correct = 0, total = 0;
    const probabilities = [];

    for (const pred of preds1x2) {
      const fx = fixtureMap[pred.fixture_id];
      if (!fx) continue;

      const sel = pred.selection?.toLowerCase();
      const actualResult =
        fx.homeScore > fx.awayScore ? "home" :
        fx.homeScore === fx.awayScore ? "draw" : "away";

      const isCorrect = pred.result === "correct";
      if (isCorrect) correct++;
      total++;

      if (conf[sel]) {
        conf[sel].total++;
        if (isCorrect) conf[sel].correct++;
      }

      confusion[`${sel}_${actualResult}`]++;
      probabilities.push(pred.model_probability);
    }

    const acc = total > 0 ? (correct / total * 100).toFixed(1) : "N/A";
    console.log(`\n  Total 1X2 predictions evaluated: ${total}`);
    console.log(`  Overall accuracy: ${acc}%`);
    console.log(`  Baseline (always predict home): ${(preds1x2.filter(p => fixtureMap[p.fixture_id]?.homeScore > fixtureMap[p.fixture_id]?.awayScore).length / total * 100).toFixed(1)}%`);

    console.log("\n  Per-selection accuracy:");
    for (const [sel, data] of Object.entries(conf)) {
      const pct = data.total > 0 ? (data.correct / data.total * 100).toFixed(1) : "N/A";
      console.log(`    ${sel.padEnd(8)} ${data.correct}/${data.total} = ${pct}%`);
    }

    console.log("\n  Confusion matrix (predicted → actual):");
    console.log("              home    draw    away");
    for (const pred of ["home", "draw", "away"]) {
      const row = [conf[`${pred}_home`], conf[`${pred}_draw`], conf[`${pred}_away`]];
      console.log(`    ${pred.padEnd(8)} ${row.map((v) => String(v).padStart(5)).join("    ")}`);
    }

    // Calibration
    console.log("\n  Calibration (confidence buckets):");
    const buckets = {};
    for (const pred of preds1x2) {
      const bucket = Math.floor(pred.model_probability * 10) * 10;
      const key = `${bucket}-${bucket + 10}`;
      if (!buckets[key]) buckets[key] = { correct: 0, total: 0 };
      buckets[key].total++;
      if (pred.result === "correct") buckets[key].correct++;
    }
    for (const [key, data] of Object.entries(buckets).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
      const actualPct = data.total > 0 ? (data.correct / data.total * 100).toFixed(1) : "N/A";
      console.log(`    ${key.padEnd(8)} predicted: ${key.split("-")[0]}%  actual: ${actualPct}%  n=${data.total}`);
    }

    // Brier score
    let brier = 0;
    for (const pred of preds1x2) {
      const fx = fixtureMap[pred.fixture_id];
      if (!fx) continue;
      const actualResult = fx.homeScore > fx.awayScore ? "home" : fx.homeScore === fx.awayScore ? "draw" : "away";
      const sel = pred.selection?.toLowerCase();
      const isActual = sel === actualResult ? 1 : 0;
      brier += Math.pow(pred.model_probability - isActual, 2);
    }
    console.log(`\n  Brier score: ${(brier / total).toFixed(4)} (lower is better, 0.25 = random)`);
  } else {
    console.log("  No 1X2 predictions found");
  }

  // ─── Over/Under Evaluation ───
  console.log("\n" + "═".repeat(60));
  console.log("  OVER/UNDER MARKET");
  console.log("═".repeat(60));

  const predsOU = byMarket["over_under"] || [];
  if (predsOU.length > 0) {
    let correct = 0, total = 0;
    const byLine = {};

    for (const pred of predsOU) {
      const fx = fixtureMap[pred.fixture_id];
      if (!fx) continue;

      const sel = pred.selection?.toLowerCase() || "";
      const line = parseFloat(sel.split("_").pop() || "2.5");
      const totalGoals = fx.homeScore + fx.awayScore;
      const isOver = sel.startsWith("over");
      const expectedGoals = isOver ? totalGoals > line : totalGoals < line;

      if (!byLine[line]) byLine[line] = { over: { correct: 0, total: 0 }, under: { correct: 0, total: 0 } };

      const side = isOver ? "over" : "under";
      byLine[line][side].total++;
      if (pred.result === "correct") {
        byLine[line][side].correct++;
        correct++;
      }
      total++;
    }

    console.log(`\n  Total OU predictions evaluated: ${total}`);
    console.log(`  Overall accuracy: ${total > 0 ? (correct / total * 100).toFixed(1) : "N/A"}%`);

    console.log("\n  By line:");
    for (const [line, data] of Object.entries(byLine).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
      const overAcc = data.over.total > 0 ? (data.over.correct / data.over.total * 100).toFixed(1) : "N/A";
      const underAcc = data.under.total > 0 ? (data.under.correct / data.under.total * 100).toFixed(1) : "N/A";
      console.log(`    ${line.padEnd(5)} over:  ${overAcc.padStart(5)}% (${data.over.correct}/${data.over.total})  under: ${underAcc.padStart(5)}% (${data.under.correct}/${data.under.total})`);
    }
  } else {
    console.log("  No OU predictions found");
  }

  // ─── BTTS Evaluation ───
  console.log("\n" + "═".repeat(60));
  console.log("  BTTS MARKET");
  console.log("═".repeat(60));

  const predsBTTS = byMarket["btts"] || [];
  if (predsBTTS.length > 0) {
    let yes = { correct: 0, total: 0 }, no = { correct: 0, total: 0 };
    for (const pred of predsBTTS) {
      const fx = fixtureMap[pred.fixture_id];
      if (!fx) continue;
      const bothScored = fx.homeScore > 0 && fx.awayScore > 0;
      const sel = pred.selection?.toLowerCase();
      if (sel === "yes") {
        yes.total++;
        if (pred.result === "correct") yes.correct++;
      } else {
        no.total++;
        if (pred.result === "correct") no.correct++;
      }
    }
    const totalBTTS = yes.total + no.total;
    const correctBTTS = yes.correct + no.correct;
    console.log(`\n  Total BTTS predictions: ${totalBTTS}`);
    console.log(`  Overall accuracy: ${totalBTTS > 0 ? (correctBTTS / totalBTTS * 100).toFixed(1) : "N/A"}%`);
    console.log(`  BTTS Yes: ${yes.total > 0 ? (yes.correct / yes.total * 100).toFixed(1) : "N/A"}% (${yes.correct}/${yes.total})`);
    console.log(`  BTTS No: ${no.total > 0 ? (no.correct / no.total * 100).toFixed(1) : "N/A"}% (${no.correct}/${no.total})`);
  } else {
    console.log("  No BTTS predictions found");
  }

  // ─── Overall Summary ───
  console.log("\n" + "═".repeat(60));
  console.log("  OVERALL SUMMARY");
  console.log("═".repeat(60));

  let totalCorrect = 0, totalPreds = 0;
  for (const pred of evaluable) {
    totalPreds++;
    if (pred.result === "correct") totalCorrect++;
  }

  console.log(`  Total predictions evaluated: ${totalPreds}`);
  console.log(`  Overall accuracy: ${totalPreds > 0 ? (totalCorrect / totalPreds * 100).toFixed(1) : "N/A"}%`);
  console.log(`  Markets evaluated: ${Object.keys(byMarket).join(", ")}`);
  console.log(`  Model versions: ${[...new Set(evaluable.map((p) => p.model_version))].join(", ")}`);

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    modelVersion: modelVersion || "ALL",
    totalFixtures: fixtures.length,
    totalPredictions: totalPreds,
    totalCorrect,
    overallAccuracy: totalPreds > 0 ? (totalCorrect / totalPreds * 100).toFixed(1) : "N/A",
    byMarket: {},
  };

  for (const [mkt, preds] of Object.entries(byMarket)) {
    const correct = preds.filter((p) => p.result === "correct").length;
    report.byMarket[mkt] = {
      total: preds.length,
      correct,
      accuracy: preds.length > 0 ? (correct / preds.length * 100).toFixed(1) : "N/A",
    };
  }

  const reportPath = path.join(__dirname, "..", "data", "walk-forward-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n  Report saved to ${reportPath}`);

  console.log("\n" + "═".repeat(60));
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
