const fs = require("fs");
const env = {};
fs.readFileSync(".env.local", "utf8").split("\n").forEach((l) => {
  if (l.startsWith("#") || !l.includes("=")) return;
  const i = l.indexOf("=");
  let v = l.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  env[l.slice(0, i).trim()] = v;
});
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ODDLY PREDICTION SYSTEM AUDIT");
  console.log("═══════════════════════════════════════════════════════════\n");

  // 1. Dataset Overview
  console.log("📊 DATASET OVERVIEW");
  console.log("─".repeat(55));
  const { count: totalFixtures } = await sb.from("fixtures").select("*", { count: "exact", head: true });
  const { count: scheduled } = await sb.from("fixtures").select("*", { count: "exact", head: true }).eq("status", "scheduled");
  const { count: finished } = await sb.from("fixtures").select("*", { count: "exact", head: true }).eq("status", "finished");
  const { count: totalPreds } = await sb.from("predictions").select("*", { count: "exact", head: true });
  const { count: settled } = await sb.from("predictions").select("*", { count: "exact", head: true }).not("settled_at", "is", null);
  const { count: correct } = await sb.from("predictions").select("*", { count: "exact", head: true }).eq("result", "correct");
  const { count: wrong } = await sb.from("predictions").select("*", { count: "exact", head: true }).eq("result", "wrong");
  const { count: pending } = await sb.from("predictions").select("*", { count: "exact", head: true }).eq("result", "pending");
  const { count: totalTeams } = await sb.from("teams").select("*", { count: "exact", head: true });
  const { count: totalLeagues } = await sb.from("leagues").select("*", { count: "exact", head: true });
  const { count: totalOdds } = await sb.from("odds_snapshots").select("*", { count: "exact", head: true });

  console.log(`  Fixtures:        ${totalFixtures?.toLocaleString()}`);
  console.log(`    Scheduled:     ${scheduled?.toLocaleString()}`);
  console.log(`    Finished:      ${finished?.toLocaleString()}`);
  console.log(`  Predictions:     ${totalPreds?.toLocaleString()}`);
  console.log(`    Settled:       ${settled?.toLocaleString()}`);
  console.log(`    Correct:       ${correct?.toLocaleString()}`);
  console.log(`    Wrong:         ${wrong?.toLocaleString()}`);
  console.log(`    Pending:       ${pending?.toLocaleString()}`);
  console.log(`  Teams:           ${totalTeams?.toLocaleString()}`);
  console.log(`  Leagues:         ${totalLeagues?.toLocaleString()}`);
  console.log(`  Odds Snapshots:  ${totalOdds?.toLocaleString()}`);

  // 2. Accuracy Calculation
  console.log("\n📈 ACCURACY METRICS");
  console.log("─".repeat(55));
  const overallAcc = settled > 0 ? ((correct / settled) * 100).toFixed(1) : "N/A";
  console.log(`  Overall (correct/settled): ${overallAcc}%`);

  // 3. Accuracy by market
  console.log("\n📊 ACCURACY BY MARKET");
  console.log("─".repeat(55));
  const { data: marketData } = await sb.from("predictions")
    .select("market, selection, result, model_probability")
    .not("settled_at", "is", null)
    .limit(50000);

  const marketStats = {};
  for (const p of marketData || []) {
    const key = `${p.market}/${p.selection}`;
    if (!marketStats[key]) marketStats[key] = { total: 0, correct: 0 };
    marketStats[key].total++;
    if (p.result === "correct") marketStats[key].correct++;
  }

  const sorted = Object.entries(marketStats)
    .map(([k, v]) => ({ market: k, total: v.total, correct: v.correct, acc: v.total > 0 ? ((v.correct / v.total) * 100).toFixed(1) : "0" }))
    .sort((a, b) => b.total - a.total);

  for (const m of sorted.slice(0, 15)) {
    console.log(`  ${m.market.padEnd(25)} ${m.acc.padStart(5)}% (${m.correct}/${m.total})`);
  }

  // 4. ELITE Accuracy
  console.log("\n👑 ELITE ACCURACY (model_probability >= 0.70)");
  console.log("─".repeat(55));
  const { count: eliteTotal } = await sb.from("predictions").select("*", { count: "exact", head: true })
    .not("settled_at", "is", null).gte("model_probability", 0.70);
  const { count: eliteCorrect } = await sb.from("predictions").select("*", { count: "exact", head: true })
    .not("settled_at", "is", null).eq("result", "correct").gte("model_probability", 0.70);
  const { count: eliteWrong } = await sb.from("predictions").select("*", { count: "exact", head: true })
    .not("settled_at", "is", null).eq("result", "wrong").gte("model_probability", 0.70);
  const eliteAcc = eliteTotal > 0 ? ((eliteCorrect / eliteTotal) * 100).toFixed(1) : "N/A";
  console.log(`  ELITE Total:     ${eliteTotal?.toLocaleString()}`);
  console.log(`  ELITE Correct:   ${eliteCorrect?.toLocaleString()}`);
  console.log(`  ELITE Wrong:     ${eliteWrong?.toLocaleString()}`);
  console.log(`  ELITE Accuracy:  ${eliteAcc}%`);

  // 5. Accuracy by confidence bucket
  console.log("\n📊 ACCURACY BY CONFIDENCE BUCKET");
  console.log("─".repeat(55));
  const buckets = [
    { label: "90%+", min: 0.90, max: 1.01 },
    { label: "80-89%", min: 0.80, max: 0.90 },
    { label: "70-79%", min: 0.70, max: 0.80 },
    { label: "60-69%", min: 0.60, max: 0.70 },
    { label: "50-59%", min: 0.50, max: 0.60 },
  ];
  for (const b of buckets) {
    const { count: bTotal } = await sb.from("predictions").select("*", { count: "exact", head: true })
      .not("settled_at", "is", null).gte("model_probability", b.min).lt("model_probability", b.max);
    const { count: bCorrect } = await sb.from("predictions").select("*", { count: "exact", head: true })
      .not("settled_at", "is", null).eq("result", "correct").gte("model_probability", b.min).lt("model_probability", b.max);
    const bAcc = bTotal > 0 ? ((bCorrect / bTotal) * 100).toFixed(1) : "N/A";
    console.log(`  ${b.label.padEnd(12)} ${bAcc.padStart(5)}% (${bCorrect?.toLocaleString()}/${bTotal?.toLocaleString()})`);
  }

  // 6. League distribution
  console.log("\n🏆 LEAGUES IN DATABASE");
  console.log("─".repeat(55));
  const { data: leagues } = await sb.from("leagues").select("id, name").order("name");
  for (const l of leagues || []) {
    const { count: fxCount } = await sb.from("fixtures").select("*", { count: "exact", head: true }).eq("league_id", l.id);
    console.log(`  ${l.name.padEnd(25)} ${fxCount?.toLocaleString()} fixtures`);
  }

  // 7. Model versions in predictions
  console.log("\n🔧 MODEL VERSIONS IN PREDICTIONS");
  console.log("─".repeat(55));
  const { data: versions } = await sb.from("predictions")
    .select("model_version")
    .not("model_version", "is", null)
    .limit(10000);
  const versionCounts = {};
  for (const v of versions || []) {
    versionCounts[v.model_version] = (versionCounts[v.model_version] || 0) + 1;
  }
  for (const [v, c] of Object.entries(versionCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.padEnd(30)} ${c.toLocaleString()}`);
  }

  // 8. Check learn endpoint data
  console.log("\n🧠 LEARNING DATA");
  console.log("─".repeat(55));
  const { count: learnSnapshots } = await sb.from("learning_snapshots").select("*", { count: "exact", head: true }).catch(() => ({ count: 0 }));
  console.log(`  Learning snapshots: ${learnSnapshots || "table not found"}`);

  // 9. XGBoost v5 check
  console.log("\n🤖 XGBOOST V5 STATUS");
  console.log("─".repeat(55));
  const xgbPath = "models/xgboost_v5.json";
  const xgbMetaPath = "models/xgboost_metadata.json";
  console.log(`  Model file exists: ${fs.existsSync(xgbPath)}`);
  console.log(`  Metadata exists: ${fs.existsSync(xgbMetaPath)}`);
  if (fs.existsSync(xgbMetaPath)) {
    const meta = JSON.parse(fs.readFileSync(xgbMetaPath, "utf8"));
    console.log(`  Model type: ${meta.model_type || "unknown"}`);
    console.log(`  Features: ${meta.total_features || "unknown"}`);
    console.log(`  Trained: ${meta.trained_at || "unknown"}`);
    console.log(`  Markets: ${Object.keys(meta.markets || {}).join(", ")}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  AUDIT COMPLETE");
  console.log("═══════════════════════════════════════════════════════════");
})();
