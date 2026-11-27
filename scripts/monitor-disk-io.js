#!/usr/bin/env node
/**
 * Disk IO Monitor for Oddly
 * Run periodically to track database load after deployment.
 * Usage: node scripts/monitor-disk-io.js
 */

const { createClient } = require("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key);

async function monitor() {
  const report = {
    timestamp: new Date().toISOString(),
    baseline: { diskIO: "97%", cronFrequency: "89/day", tableScans: "599K rows/query" },
    current: {},
  };

  console.log("=".repeat(60));
  console.log("  ODDLY DISK IO MONITOR");
  console.log("=".repeat(60));
  console.log(`  Time: ${report.timestamp}\n`);

  // 1. Cron execution frequency
  const { data: runs24h } = await sb
    .from("cron_runs")
    .select("job_name, status, started_at, duration_ms")
    .gte("started_at", new Date(Date.now() - 86400000).toISOString());

  const { data: runs7d } = await sb
    .from("cron_runs")
    .select("job_name, status, started_at, duration_ms")
    .gte("started_at", new Date(Date.now() - 7 * 86400000).toISOString());

  console.log("📊 CRON EXECUTION FREQUENCY");
  console.log("-".repeat(40));
  console.log(`  Last 24h: ${runs24h?.length || 0} runs`);
  console.log(`  Last 7d:  ${runs7d?.length || 0} runs`);

  if (runs24h?.length > 0) {
    const byJob = {};
    for (const r of runs24h) {
      byJob[r.job_name] = (byJob[r.job_name] || 0) + 1;
    }
    console.log("  By job (24h):");
    for (const [job, count] of Object.entries(byJob)) {
      console.log(`    ${job}: ${count}x`);
    }
    const avgDuration = Math.round(
      runs24h.filter((r) => r.duration_ms).reduce((a, r) => a + r.duration_ms, 0) /
        runs24h.filter((r) => r.duration_ms).length
    );
    console.log(`  Avg duration: ${avgDuration}ms`);
  }
  console.log();

  // 2. Materialized view freshness
  console.log("📦 MATERIALIZED VIEWS (pre-computed analytics)");
  console.log("-".repeat(40));
  const views = [
    { name: "mv_settlement_summary", label: "Settlement summary" },
    { name: "mv_market_accuracy", label: "Market accuracy" },
    { name: "mv_calibration_buckets", label: "Calibration buckets" },
    { name: "mv_daily_accuracy", label: "Daily accuracy" },
    { name: "mv_draw_performance", label: "Draw performance" },
    { name: "mv_draw_trend", label: "Draw trend" },
    { name: "mv_draw_probability_buckets", label: "Draw prob buckets" },
    { name: "mv_model_accuracy", label: "Model accuracy" },
    { name: "mv_cron_status", label: "Cron status" },
  ];

  for (const v of views) {
    const { count, error } = await sb
      .from(v.name)
      .select("*", { count: "exact", head: true });
    const status = error ? "❌" : count > 0 ? "✅" : "⚠️";
    console.log(`  ${status} ${v.label}: ${error ? error.message : count + " rows"}`);
  }
  console.log();

  // 3. Query performance test (materialized view vs full table scan)
  console.log("⚡ QUERY PERFORMANCE");
  console.log("-".repeat(40));

  // Test: materialized view query
  const t0 = Date.now();
  await sb.from("mv_settlement_summary").select("*").limit(1);
  const viewTime = Date.now() - t0;

  // Test: RPC function
  const t1 = Date.now();
  await sb.rpc("get_settlement_summary");
  const rpcTime = Date.now() - t1;

  // Test: calibration buckets view
  const t2 = Date.now();
  await sb.from("mv_calibration_buckets").select("*").limit(1);
  const calTime = Date.now() - t2;

  console.log(`  Materialized view (settlement): ${viewTime}ms`);
  console.log(`  RPC function (settlement):      ${rpcTime}ms`);
  console.log(`  Materialized view (calibration): ${calTime}ms`);
  console.log("  Baseline: full table scan on 184K+ rows = seconds");
  console.log();

  // 4. Table sizes
  console.log("📏 TABLE SIZES");
  console.log("-".repeat(40));
  const tables = [
    { name: "predictions", label: "Predictions" },
    { name: "fixtures", label: "Fixtures" },
    { name: "odds_snapshots", label: "Odds snapshots" },
    { name: "cron_runs", label: "Cron runs" },
    { name: "cron_locks", label: "Cron locks" },
    { name: "cron_alerts", label: "Cron alerts" },
  ];

  for (const t of tables) {
    const { count, error } = await sb
      .from(t.name)
      .select("*", { count: "exact", head: true });
    console.log(`  ${t.label}: ${error ? "N/A" : count?.toLocaleString()}`);
  }
  console.log();

  // 5. Pending predictions (stale data)
  console.log("⏳ DATA HEALTH");
  console.log("-".repeat(40));
  const { data: modelVersions } = await sb
    .from("predictions")
    .select("model_version")
    .limit(5000);

  if (modelVersions?.length > 0) {
    const versions = {};
    for (const r of modelVersions) {
      const v = r.model_version || "unknown";
      versions[v] = (versions[v] || 0) + 1;
    }
    console.log("  Model versions in use:");
    for (const [v, c] of Object.entries(versions).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${v}: ${c}`);
    }
  }

  // 6. Lock state
  const { data: locks } = await sb.from("cron_locks").select("job_name, acquired_at");
  console.log(`\n  Active locks: ${locks?.length || 0}`);
  if (locks?.length > 0) {
    for (const l of locks) {
      console.log(`    ${l.job_name} locked at ${l.acquired_at}`);
    }
  }

  // 7. Alerts
  const { data: alerts } = await sb
    .from("cron_alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log(`\n  Recent alerts: ${alerts?.length || 0}`);
  if (alerts?.length > 0) {
    for (const a of alerts) {
      console.log(`    [${a.severity}] ${a.job_name}: ${a.message}`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("  COMPARISON: Before vs After");
  console.log("=".repeat(60));
  console.log(`  Cron frequency:   89/day → ${(runs24h?.length || 0)}/day`);
  console.log(`  Table scans:      599K rows → pre-computed views`);
  console.log(`  Disk IO (target): 97% → monitoring...`);
  console.log(`  Avg query time:   seconds → ${viewTime}ms (views)`);
  console.log("=".repeat(60));
  console.log("\n  ⚠️  Check Supabase Dashboard → Database → Reports");
  console.log("     for actual Disk IO % after 24h of production traffic.\n");
}

monitor().catch(console.error);
