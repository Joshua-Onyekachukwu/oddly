#!/usr/bin/env node

/**
 * Direct Prediction Engine — generates predictions for all scheduled fixtures
 * Runs the Poisson + Elo model directly against Supabase
 */

const { createClient } = require("@supabase/supabase-js");

const s = createClient(
  "https://ulelicrbgicgnhmuulup.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZWxpY3JiZ2ljZ25obXV1bHVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA0ODU1NCwiZXhwIjoyMTAyNjI0NTU0fQ.8Ku5TIXU04kWZAW2N_qQYSA9grTlq3btoTAUNmEC8L0"
);

function clamp(v, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}

function poissonProb(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function poissonGoals(hL, aL, max = 8) {
  const grid = [];
  for (let i = 0; i <= max; i++) {
    grid[i] = [];
    for (let j = 0; j <= max; j++)
      grid[i][j] = poissonProb(hL, i) * poissonProb(aL, j);
  }
  return grid;
}

function computeMarkets(grid) {
  const m = {};
  let pH = 0, pD = 0, pA = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = 0; j < grid[i].length; j++) {
      if (i > j) pH += grid[i][j];
      else if (i === j) pD += grid[i][j];
      else pA += grid[i][j];
    }
  m["1X2_Home"] = clamp(pH);
  m["1X2_Draw"] = clamp(pD);
  m["1X2_Away"] = clamp(pA);
  m["DC_1X"] = clamp(pH + pD);
  m["DC_X2"] = clamp(pD + pA);
  m["DC_12"] = clamp(pH + pA);
  const dnb = pH + pA;
  m["DNB_Home"] = dnb > 0 ? clamp(pH / dnb) : 0.5;
  m["DNB_Away"] = dnb > 0 ? clamp(pA / dnb) : 0.5;
  const totals = {};
  let cum = 0;
  for (let t = 0; t <= 9; t++) {
    for (let i = 0; i < grid.length; i++)
      for (let j = 0; j < grid[i].length; j++) if (i + j === t) cum += grid[i][j];
    totals[t] = cum;
  }
  for (const l of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    m[`OU_Over_${l}`] = clamp(1 - (totals[Math.floor(l)] || 0));
    m[`OU_Under_${l}`] = clamp(totals[Math.floor(l)] || 0);
  }
  let btts = 0;
  for (let i = 1; i < grid.length; i++)
    for (let j = 1; j < grid[i].length; j++) btts += grid[i][j];
  m["BTTS_Yes"] = clamp(btts);
  m["BTTS_No"] = clamp(1 - btts);
  return m;
}

async function main() {
  const startTime = Date.now();

  // 1. Load historical data for Elo + form
  console.log("[PREDICT] Loading historical data...");
  const eloMap = {};
  const formMap = {};

  const { data: histFixtures } = await s
    .from("fixtures")
    .select(
      "home_score, away_score, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)"
    )
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: true })
    .limit(3000);

  if (histFixtures) {
    for (const f of histFixtures) {
      const home = f.home?.canonical_name;
      const away = f.away?.canonical_name;
      if (!home || !away) continue;
      const hs = Number(f.home_score) || 0;
      const as = Number(f.away_score) || 0;
      const h = (eloMap[home] || 1500) + 65;
      const a = eloMap[away] || 1500;
      const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
      const actual = hs > as ? 1 : hs < as ? 0 : 0.5;
      eloMap[home] = (eloMap[home] || 1500) + 32 * (actual - eH);
      eloMap[away] = (eloMap[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
      if (!formMap[home]) formMap[home] = [];
      if (!formMap[away]) formMap[away] = [];
      formMap[home].push({ gf: hs, ga: as, isHome: true });
      formMap[away].push({ gf: as, ga: hs, isHome: false });
      if (formMap[home].length > 15) formMap[home].shift();
      if (formMap[away].length > 15) formMap[away].shift();
    }
  }
  console.log(`[PREDICT] Loaded ${histFixtures?.length || 0} historical matches, ${Object.keys(eloMap).length} team Elos`);

  // 2. Get all scheduled fixtures (paginate — Supabase default limit is 1000)
  let fixtures = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page } = await s
      .from("fixtures")
      .select("id, league_id, home_team_id, away_team_id, kickoff_time")
      .eq("status", "scheduled")
      .gte("kickoff_time", new Date().toISOString())
      .order("kickoff_time")
      .range(offset, offset + PAGE - 1);
    if (!page?.length) break;
    fixtures = fixtures.concat(page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`[PREDICT] Found ${fixtures.length} upcoming fixtures`);

  if (!fixtures.length) {
    console.log("No fixtures to predict.");
    return;
  }

  // 3. Get team names
  const teamIds = [
    ...new Set([...fixtures.map((f) => f.home_team_id), ...fixtures.map((f) => f.away_team_id)]),
  ];
  const { data: teams } = await s.from("teams").select("id, canonical_name").in("id", teamIds);
  const teamMap = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  // 4. Generate predictions
  const predictions = [];
  let batchCount = 0;

  for (const fixture of fixtures) {
    const home = teamMap[fixture.home_team_id];
    const away = teamMap[fixture.away_team_id];
    if (!home || !away) continue;

    const hHist = (formMap[home] || []).slice(-10);
    const aHist = (formMap[away] || []).slice(-10);
    const hPPG =
      hHist.length > 0
        ? hHist.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) /
          Math.min(hHist.length, 5)
        : 1.5;
    const aPPG =
      aHist.length > 0
        ? aHist.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) /
          Math.min(aHist.length, 5)
        : 1.5;
    const hGS =
      hHist.length > 0
        ? hHist.slice(-5).reduce((s, m) => s + m.gf, 0) / Math.min(hHist.length, 5)
        : 1.3;
    const aGS =
      aHist.length > 0
        ? aHist.slice(-5).reduce((s, m) => s + m.gf, 0) / Math.min(aHist.length, 5)
        : 1.3;
    const hGC =
      hHist.length > 0
        ? hHist.slice(-5).reduce((s, m) => s + m.ga, 0) / Math.min(hHist.length, 5)
        : 1.2;
    const aGC =
      aHist.length > 0
        ? aHist.slice(-5).reduce((s, m) => s + m.ga, 0) / Math.min(aHist.length, 5)
        : 1.2;
    const eloDiff = (eloMap[home] || 1500) - (eloMap[away] || 1500);

    // Poisson lambdas
    const hL = clamp(hGS * 1.1 * (aGC / 1.3) * (1 + eloDiff * 0.0004), 0.3, 4.5);
    const aL = clamp(aGS * 0.9 * (hGC / 1.3) * (1 - eloDiff * 0.0004), 0.3, 4.5);
    const grid = poissonGoals(hL, aL);
    const markets = computeMarkets(grid);

    for (const [mk, pr] of Object.entries(markets)) {
      predictions.push({
        fixture_id: fixture.id,
        market: mk.split("_")[0],
        selection: mk
          .split("_")
          .slice(1)
          .join("_"),
        model_probability: Math.round(pr * 10000) / 10000,
        model_version: "v4.2-poisson",
      });
    }
    batchCount++;

    // Batch insert every 100 fixtures
    if (predictions.length >= 2400) {
      const batch = predictions.splice(0);
      const { error } = await s.from("predictions").insert(batch);
      if (error) console.error("Insert error:", error.message);
      else console.log(`  ✅ Batch: ${batch.length} predictions inserted (${batchCount}/${fixtures.length} fixtures)`);
    }
  }

  // Final batch
  if (predictions.length > 0) {
    const { error } = await s.from("predictions").insert(predictions);
    if (error) console.error("Final insert error:", error.message);
    else console.log(`  ✅ Final batch: ${predictions.length} predictions inserted`);
  }

  const duration = Date.now() - startTime;
  console.log(`\n✅ Done! ${batchCount} fixtures → ${batchCount * 24} predictions in ${(duration / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error("❌ Fatal:", e.message);
  process.exit(1);
});
