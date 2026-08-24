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
  console.log("  ODDLY PREDICTION SYSTEM AUDIT (Quick)");
  console.log("═══════════════════════════════════════════════════════════\n");

  // 1. Dataset counts
  console.log("📊 DATASET");
  console.log("─".repeat(55));
  const [{ count: totalFixtures }, { count: scheduled }, { count: finished }, { count: totalPreds }, { count: totalTeams }, { count: totalLeagues }, { count: totalOdds }] = await Promise.all([
    sb.from("fixtures").select("*", { count: "exact", head: true }),
    sb.from("fixtures").select("*", { count: "exact", head: true }).eq("status", "scheduled"),
    sb.from("fixtures").select("*", { count: "exact", head: true }).eq("status", "finished"),
    sb.from("predictions").select("*", { count: "exact", head: true }),
    sb.from("teams").select("*", { count: "exact", head: true }),
    sb.from("leagues").select("*", { count: "exact", head: true }),
    sb.from("odds_snapshots").select("*", { count: "exact", head: true }),
  ]);

  // 2. Result distribution (sample-based for speed)
  const { data: samplePreds } = await sb.from("predictions")
    .select("result, model_probability, market, selection, model_version, settled_at")
    .limit(20000);

  const resultDist = { correct: 0, wrong: 0, pending: 0, total: 0 };
  const marketAcc = {};
  const eliteStats = { total: 0, correct: 0 };
  const confBuckets = {};
  const versionDist = {};

  for (const p of samplePreds || []) {
    resultDist.total++;
    if (p.result === "correct") resultDist.correct++;
    else if (p.result === "wrong") resultDist.wrong++;
    else resultDist.pending++;

    if (p.settled_at) {
      const mk = `${p.market}/${p.selection}`;
      if (!marketAcc[mk]) marketAcc[mk] = { total: 0, correct: 0 };
      marketAcc[mk].total++;
      if (p.result === "correct") marketAcc[mk].correct++;
    }

    if (p.model_probability >= 0.70 && p.settled_at) {
      eliteStats.total++;
      if (p.result === "correct") eliteStats.correct++;
    }

    if (p.settled_at && p.model_probability) {
      const bucket = p.model_probability >= 0.90 ? "90%+" :
        p.model_probability >= 0.80 ? "80-89%" :
        p.model_probability >= 0.70 ? "70-79%" :
        p.model_probability >= 0.60 ? "60-69%" : "50-59%";
      if (!confBuckets[bucket]) confBuckets[bucket] = { total: 0, correct: 0 };
      confBuckets[bucket].total++;
      if (p.result === "correct") confBuckets[bucket].correct++;
    }

    if (p.model_version) versionDist[p.model_version] = (versionDist[p.model_version] || 0) + 1;
  }

  console.log(`  Fixtures:        ${totalFixtures?.toLocaleString()}`);
  console.log(`    Scheduled:     ${scheduled?.toLocaleString()}`);
  console.log(`    Finished:      ${finished?.toLocaleString()}`);
  console.log(`  Predictions:     ${totalPreds?.toLocaleString()}`);
  console.log(`  Teams:           ${totalTeams?.toLocaleString()}`);
  console.log(`  Leagues:         ${totalLeagues?.toLocaleString()}`);
  console.log(`  Odds Snapshots:  ${totalOdds?.toLocaleString()}`);
  console.log(`  Sample size:     ${samplePreds?.length || 0}`);

  // 3. Result distribution
  console.log("\n📈 RESULT DISTRIBUTION (sample)");
  console.log("─".repeat(55));
  const settled = resultDist.correct + resultDist.wrong;
  console.log(`  Correct:    ${resultDist.correct.toLocaleString()} (${settled > 0 ? ((resultDist.correct / settled) * 100).toFixed(1) : 0}%)`);
  console.log(`  Wrong:      ${resultDist.wrong.toLocaleString()} (${settled > 0 ? ((resultDist.wrong / settled) * 100).toFixed(1) : 0}%)`);
  console.log(`  Pending:    ${resultDist.pending.toLocaleString()}`);
  console.log(`  Overall:    ${settled > 0 ? ((resultDist.correct / settled) * 100).toFixed(1) : 0}%`);

  // 4. ELITE
  console.log("\n👑 ELITE (model_probability >= 0.70)");
  console.log("─".repeat(55));
  const eliteAcc = eliteStats.total > 0 ? ((eliteStats.correct / eliteStats.total) * 100).toFixed(1) : "N/A";
  console.log(`  Total:      ${eliteStats.total}`);
  console.log(`  Correct:    ${eliteStats.correct}`);
  console.log(`  Accuracy:   ${eliteAcc}%`);

  // 5. Confidence buckets
  console.log("\n📊 BY CONFIDENCE");
  console.log("─".repeat(55));
  for (const [b, s] of Object.entries(confBuckets).sort((a, b) => b[0].localeCompare(a[0]))) {
    const acc = s.total > 0 ? ((s.correct / s.total) * 100).toFixed(1) : "N/A";
    console.log(`  ${b.padEnd(12)} ${acc.padStart(5)}% (${s.correct}/${s.total})`);
  }

  // 6. Top markets
  console.log("\n📊 TOP MARKETS");
  console.log("─".repeat(55));
  const sorted = Object.entries(marketAcc)
    .map(([k, v]) => ({ m: k, t: v.total, c: v.correct, a: v.total > 0 ? ((v.correct / v.total) * 100).toFixed(1) : "0" }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 12);
  for (const m of sorted) {
    console.log(`  ${m.m.padEnd(25)} ${m.a.padStart(5)}% (${m.c}/${m.t})`);
  }

  // 7. Model versions
  console.log("\n🔧 MODEL VERSIONS");
  console.log("─".repeat(55));
  for (const [v, c] of Object.entries(versionDist).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${v.padEnd(30)} ${c.toLocaleString()}`);
  }

  // 8. XGBoost
  console.log("\n🤖 XGBOOST V5");
  console.log("─".repeat(55));
  const xgbMeta = "models/xgboost_metadata.json";
  if (fs.existsSync(xgbMeta)) {
    const meta = JSON.parse(fs.readFileSync(xgbMeta, "utf8"));
    console.log(`  Type:       ${meta.model_type || "?"}`);
    console.log(`  Features:   ${meta.total_features || "?"}`);
    console.log(`  Trained:    ${meta.trained_at || "?"}`);
    console.log(`  Markets:    ${Object.keys(meta.markets || {}).join(", ")}`);
  } else {
    console.log("  Not found");
  }

  // 9. Leagues
  console.log("\n🏆 LEAGUES");
  console.log("─".repeat(55));
  const { data: leagues } = await sb.from("leagues").select("id, name").order("name");
  for (const l of leagues || []) {
    const { count: fx } = await sb.from("fixtures").select("*", { count: "exact", head: true }).eq("league_id", l.id);
    console.log(`  ${l.name.padEnd(25)} ${fx?.toLocaleString()} fixtures`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
})();
