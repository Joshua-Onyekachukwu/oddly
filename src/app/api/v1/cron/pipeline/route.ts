/**
 * GET /api/v1/cron/pipeline
 *
 * Unified betting pipeline — runs every 30 minutes.
 * Auto-detects what needs to run based on fixture timing:
 *
 *   - Settlement:     finished fixtures (last 4h)
 *   - Predictions:    12–48h before kickoff
 *   - CLV Snapshots:  30min–2h before kickoff
 *   - Pre-Match:      30min–2h before kickoff (Phase 2)
 *   - Final Pick:     5–45min before kickoff (Phase 3)
 *
 * Replaces the daily cron as the primary orchestrator.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

/* ── Auth ─────────────────────────────────────────────────── */

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) {
    console.error("[PIPELINE] CRITICAL: VERCEL_CRON_SECRET not set");
    return false;
  }
  return authHeader === `Bearer ${cronSecret}`;
}

/* ── Helpers ──────────────────────────────────────────────── */

function clamp(v: number, lo = 0.01, hi = 0.99) {
  return Math.max(lo, Math.min(hi, v));
}

function loadPipelineState(): Record<string, any> {
  try {
    const p = path.join(process.cwd(), "data", "pipeline-state.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return { phases: {}, picks: [], lastRun: null };
}

function savePipelineState(state: Record<string, any>) {
  try {
    const p = path.join(process.cwd(), "data", "pipeline-state.json");
    fs.writeFileSync(p, JSON.stringify(state, null, 2));
  } catch {}
}

function loadCLVFeatures(): Record<string, any> {
  try {
    const p = path.join(process.cwd(), "data", "clv-features.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")).features || {};
  } catch {}
  return {};
}

function loadCLVSnapshots(): Record<string, any> {
  try {
    const p = path.join(process.cwd(), "data", "clv-snapshots.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {}
  return { snapshots: {}, meta: {} };
}

function saveCLVSnapshots(data: Record<string, any>) {
  try {
    const p = path.join(process.cwd(), "data", "clv-snapshots.json");
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch {}
}

function saveCLVFeatures(features: Record<string, any>, count: number) {
  try {
    const p = path.join(process.cwd(), "data", "clv-features.json");
    fs.writeFileSync(
      p,
      JSON.stringify({ computed_at: new Date().toISOString(), count, features }, null, 2)
    );
  } catch {}
}

/* ── Poisson Model (for predictions) ──────────────────────── */

function poissonProb(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda;
  for (let i = 1; i <= k; i++) logP += Math.log(lambda) - Math.log(i);
  return Math.exp(logP);
}

function poissonGoals(hL: number, aL: number, max = 8): number[][] {
  const grid: number[][] = [];
  for (let i = 0; i <= max; i++) {
    grid[i] = [];
    for (let j = 0; j <= max; j++) grid[i][j] = poissonProb(hL, i) * poissonProb(aL, j);
  }
  return grid;
}

function computeMarkets(grid: number[][]): Record<string, number> {
  const m: Record<string, number> = {};
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

  const totals: Record<number, number> = {};
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

/* ── Phases ───────────────────────────────────────────────── */

interface PhaseResult {
  success: boolean;
  count?: number;
  duration?: string;
  details?: string;
}

/** Phase: Settle recently finished fixtures */
async function phaseSettle(now: Date): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const { data: fixtures, error } = await supabaseAdmin
      .from("fixtures")
      .select("id, home_team_id, away_team_id, home_score, away_score")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .gte("updated_at", fourHoursAgo.toISOString())
      .limit(200);

    if (error || !fixtures?.length) {
      return { success: true, count: 0, details: "No recently finished fixtures", duration: `${Date.now() - start}ms` };
    }

    const fixtureIds = fixtures.map((f) => f.id);
    const { data: preds } = await supabaseAdmin
      .from("predictions")
      .select("id, fixture_id, market, selection, result")
      .in("fixture_id", fixtureIds);

    let settled = 0;
    let correct = 0;

    for (const fixture of fixtures) {
      const predsFor = (preds || []).filter((p) => p.fixture_id === fixture.id);
      const total = (fixture.home_score || 0) + (fixture.away_score || 0);
      const homeWin = (fixture.home_score || 0) > (fixture.away_score || 0);
      const draw = (fixture.home_score || 0) === (fixture.away_score || 0);
      const bothScore = (fixture.home_score || 0) > 0 && (fixture.away_score || 0) > 0;

      for (const p of predsFor) {
        if (p.result && p.result !== "pending") continue;
        const sel = (p.selection || "").toLowerCase();
        let isCorrect = false;

        if (p.market === "1X2") {
          isCorrect = (sel === "home" && homeWin) || (sel === "draw" && draw) || (sel === "away" && !homeWin && !draw);
        } else if (p.market === "ou_over_0.5" || p.selection === "Over_0.5") isCorrect = total > 0.5;
        else if (p.market === "ou_over_1.5" || p.selection === "Over_1.5") isCorrect = total > 1.5;
        else if (p.market === "ou_over_2.5" || p.selection === "Over_2.5") isCorrect = total > 2.5;
        else if (p.market === "ou_over_3.5" || p.selection === "Over_3.5") isCorrect = total > 3.5;
        else if (p.market === "ou_over_4.5" || p.selection === "Over_4.5") isCorrect = total > 4.5;
        else if (p.market === "ou_under_0.5" || p.selection === "Under_0.5") isCorrect = total < 0.5;
        else if (p.market === "ou_under_1.5" || p.selection === "Under_1.5") isCorrect = total < 1.5;
        else if (p.market === "ou_under_2.5" || p.selection === "Under_2.5") isCorrect = total < 2.5;
        else if (p.market === "ou_under_3.5" || p.selection === "Under_3.5") isCorrect = total < 3.5;
        else if (p.market === "ou_under_4.5" || p.selection === "Under_4.5") isCorrect = total < 4.5;
        else if (p.market === "btts") isCorrect = sel === "yes" ? bothScore : !bothScore;
        else if (p.market === "dc_1x") isCorrect = (fixture.home_score || 0) >= (fixture.away_score || 0);
        else if (p.market === "dc_x2") isCorrect = (fixture.home_score || 0) <= (fixture.away_score || 0);
        else if (p.market === "dc_12") isCorrect = !draw;

        if (isCorrect) correct++;
        settled++;

        await supabaseAdmin
          .from("predictions")
          .update({ result: isCorrect ? "correct" : "wrong", settled_at: new Date().toISOString() })
          .eq("id", p.id)
          .eq("result", "pending");
      }
    }

    return {
      success: true,
      count: settled,
      details: `${settled} settled, ${correct} correct (${settled > 0 ? ((correct / settled) * 100).toFixed(1) : 0}%)`,
      duration: `${Date.now() - start}ms`,
    };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/** Phase: Generate predictions for fixtures 12–48h out */
async function phasePredict(now: Date): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Load historical form data
    const eloMap: Record<string, number> = {};
    const formMap: Record<string, { gf: number; ga: number; isHome: boolean }[]> = {};

    const { data: histFixtures } = await supabaseAdmin
      .from("fixtures")
      .select("home_score, away_score, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
      .eq("status", "finished")
      .not("home_score", "is", null)
      .order("kickoff_time", { ascending: true })
      .limit(2000);

    for (const f of histFixtures || []) {
      const home = (f as any).home?.canonical_name;
      const away = (f as any).away?.canonical_name;
      if (!home || !away) continue;
      const h = (eloMap[home] || 1500) + 65;
      const a = eloMap[away] || 1500;
      const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
      const actual = (f.home_score as number) > (f.away_score as number) ? 1 : (f.home_score as number) < (f.away_score as number) ? 0 : 0.5;
      eloMap[home] = (eloMap[home] || 1500) + 32 * (actual - eH);
      eloMap[away] = (eloMap[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
      if (!formMap[home]) formMap[home] = [];
      if (!formMap[away]) formMap[away] = [];
      formMap[home].push({ gf: f.home_score as number, ga: f.away_score as number, isHome: true });
      formMap[away].push({ gf: f.away_score as number, ga: f.home_score as number, isHome: false });
      if (formMap[home].length > 15) formMap[home].shift();
      if (formMap[away].length > 15) formMap[away].shift();
    }

    // Get fixtures needing predictions
    const { data: fixtures } = await supabaseAdmin
      .from("fixtures")
      .select("id, league_id, home_team_id, away_team_id")
      .eq("status", "scheduled")
      .gte("kickoff_time", in12h.toISOString())
      .lte("kickoff_time", in48h.toISOString())
      .order("kickoff_time")
      .limit(200);

    if (!fixtures?.length) {
      return { success: true, count: 0, details: "No fixtures in prediction window", duration: `${Date.now() - start}ms` };
    }

    const teamIds = [...new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))];
    const { data: teams } = await supabaseAdmin.from("teams").select("id, canonical_name").in("id", teamIds);
    const teamMap: Record<string, string> = {};
    for (const t of teams || []) teamMap[t.id] = t.canonical_name;

    // IDEMPOTENCY: Check which fixtures already have pending predictions
    const fixtureIds = fixtures.map((f) => f.id);
    const { data: existingPreds } = await supabaseAdmin
      .from("predictions")
      .select("fixture_id")
      .in("fixture_id", fixtureIds)
      .eq("result", "pending");
    const existingFixtureIds = new Set((existingPreds || []).map((p) => p.fixture_id));
    if (existingFixtureIds.size > 0) {
      console.log(`[PIPELINE] Skipping ${existingFixtureIds.size} fixtures with existing pending predictions`);
    }

    const predictions: any[] = [];
    for (const fixture of fixtures) {
      // IDEMPOTENCY: Skip fixtures that already have pending predictions
      if (existingFixtureIds.has(fixture.id)) continue;

      const home = teamMap[fixture.home_team_id];
      const away = teamMap[fixture.away_team_id];
      if (!home || !away) continue;

      const hHist = (formMap[home] || []).slice(-10);
      const aHist = (formMap[away] || []).slice(-10);
      const hPPG = hHist.length > 0 ? hHist.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(hHist.length, 5) : 1.5;
      const aPPG = aHist.length > 0 ? aHist.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(aHist.length, 5) : 1.5;
      const hGS = hHist.length > 0 ? hHist.slice(-5).reduce((s, m) => s + m.gf, 0) / Math.min(hHist.length, 5) : 1.3;
      const aGS = aHist.length > 0 ? aHist.slice(-5).reduce((s, m) => s + m.gf, 0) / Math.min(aHist.length, 5) : 1.3;
      const hGC = hHist.length > 0 ? hHist.slice(-5).reduce((s, m) => s + m.ga, 0) / Math.min(hHist.length, 5) : 1.2;
      const aGC = aHist.length > 0 ? aHist.slice(-5).reduce((s, m) => s + m.ga, 0) / Math.min(aHist.length, 5) : 1.2;
      const eloDiff = (eloMap[home] || 1500) - (eloMap[away] || 1500);

      const baseHL = hGS * 1.1 * (aGC / 1.3);
      const baseAL = aGS * 0.9 * (hGC / 1.3);
      const hL = clamp(baseHL * (1 + eloDiff * 0.0004), 0.3, 4.5);
      const aL = clamp(baseAL * (1 - eloDiff * 0.0004), 0.3, 4.5);
      const grid = poissonGoals(hL, aL);
      const markets = computeMarkets(grid);

      for (const [mk, pr] of Object.entries(markets)) {
        predictions.push({
          fixture_id: fixture.id,
          market: mk.split("_")[0],
          selection: mk.split("_").slice(1).join("_"),
          model_probability: Math.round(pr * 10000) / 10000,
          model_version: "v5.1-pipeline",
        });
      }
    }

    for (let i = 0; i < predictions.length; i += 50) {
      await supabaseAdmin.from("predictions").insert(predictions.slice(i, i + 50));
    }

    return {
      success: true,
      count: predictions.length,
      details: `${predictions.length} predictions for ${fixtures.length} fixtures`,
      duration: `${Date.now() - start}ms`,
    };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/** Phase: CLV snapshot for fixtures 30min–2h out */
async function phaseCLVSnapshot(now: Date): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const in30m = new Date(now.getTime() + 30 * 60 * 1000);
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const { data: fixtures } = await supabaseAdmin
      .from("fixtures")
      .select("id, home_team_id, away_team_id, kickoff_time")
      .eq("status", "scheduled")
      .gte("kickoff_time", in30m.toISOString())
      .lte("kickoff_time", in2h.toISOString())
      .order("kickoff_time");

    if (!fixtures?.length) {
      return { success: true, count: 0, details: "No fixtures in CLV window", duration: `${Date.now() - start}ms` };
    }

    const teamIds = [...new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))];
    const { data: teams } = await supabaseAdmin.from("teams").select("id, canonical_name").in("id", teamIds);
    const teamMap: Record<string, string> = {};
    for (const t of teams || []) teamMap[t.id] = t.canonical_name;

    const clvData = loadCLVSnapshots();
    let snapshotCount = 0;

    for (const fixture of fixtures) {
      const home = teamMap[fixture.home_team_id] || "Unknown";
      const away = teamMap[fixture.away_team_id] || "Unknown";
      const kickoff = new Date(fixture.kickoff_time);
      const hoursUntil = (kickoff.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Determine snapshot type
      let snapshotType: string;
      if (hoursUntil > 24) snapshotType = "opening";
      else if (hoursUntil > 6) snapshotType = "mid";
      else if (hoursUntil > 0.5) snapshotType = "closing";
      else snapshotType = "pre_match";

      // Get current odds
      const { data: odds } = await supabaseAdmin
        .from("odds_snapshots")
        .select("*")
        .eq("fixture_id", fixture.id);

      if (!odds?.length) continue;

      // Group odds by bookmaker
      const oddsByBookmaker: Record<string, Record<string, number[]>> = {};
      for (const o of odds) {
        if (!oddsByBookmaker[o.bookmaker]) oddsByBookmaker[o.bookmaker] = {};
        if (!oddsByBookmaker[o.bookmaker][o.selection]) oddsByBookmaker[o.bookmaker][o.selection] = [];
        oddsByBookmaker[o.bookmaker][o.selection].push((o as any).odds_value || o.odds);
      }

      // Average odds
      const avgOdds = { home: 0, draw: 0, away: 0 };
      const counts = { home: 0, draw: 0, away: 0 };
      for (const selections of Object.values(oddsByBookmaker)) {
        const hv = selections["Home"]?.[0] || selections["home"]?.[0];
        const dv = selections["Draw"]?.[0] || selections["draw"]?.[0];
        const av = selections["Away"]?.[0] || selections["away"]?.[0];
        if (hv) { avgOdds.home += hv; counts.home++; }
        if (dv) { avgOdds.draw += dv; counts.draw++; }
        if (av) { avgOdds.away += av; counts.away++; }
      }
      if (counts.home > 0) avgOdds.home /= counts.home;
      if (counts.draw > 0) avgOdds.draw /= counts.draw;
      if (counts.away > 0) avgOdds.away /= counts.away;
      if (avgOdds.home === 0 && avgOdds.draw === 0 && avgOdds.away === 0) continue;

      const overround =
        avgOdds.home > 0 && avgOdds.draw > 0 && avgOdds.away > 0
          ? Math.round(((1 / avgOdds.home + 1 / avgOdds.draw + 1 / avgOdds.away) - 1) * 10000) / 10000
          : 0;

      const snapshot = {
        timestamp: now.toISOString(),
        type: snapshotType,
        hoursUntilKickoff: Math.round(hoursUntil * 10) / 10,
        homeTeam: home,
        awayTeam: away,
        kickoffTime: fixture.kickoff_time,
        odds: { home: avgOdds.home, draw: avgOdds.draw, away: avgOdds.away },
        impliedProbs: {
          home: avgOdds.home > 0 ? Math.round((1 / avgOdds.home) * 10000) / 10000 : 0,
          draw: avgOdds.draw > 0 ? Math.round((1 / avgOdds.draw) * 10000) / 10000 : 0,
          away: avgOdds.away > 0 ? Math.round((1 / avgOdds.away) * 10000) / 10000 : 0,
        },
        bookmakerCount: Object.keys(oddsByBookmaker).length,
        overround,
      };

      if (!clvData.snapshots[fixture.id]) clvData.snapshots[fixture.id] = [];
      clvData.snapshots[fixture.id].push(snapshot);
      snapshotCount++;
    }

    clvData.meta = {
      lastSnapshot: now.toISOString(),
      snapshotCount: snapshotCount,
      fixturesTracked: Object.keys(clvData.snapshots).length,
    };

    saveCLVSnapshots(clvData);

    return {
      success: true,
      count: snapshotCount,
      details: `${snapshotCount} snapshots for ${fixtures.length} fixtures`,
      duration: `${Date.now() - start}ms`,
    };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/** Phase: Compute CLV features from snapshots */
async function phaseCLVCompute(): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const data = loadCLVSnapshots();
    const features: Record<string, any> = {};
    let computed = 0;

    for (const [fixtureKey, snapshots] of Object.entries(data.snapshots) as [string, any[]][]) {
      if (snapshots.length < 2) continue;
      const sorted = snapshots.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const opening = sorted[0];
      const closing = sorted[sorted.length - 1];

      const clvHome = opening.odds.home > 0 ? closing.odds.home - opening.odds.home : 0;
      const clvDraw = opening.odds.draw > 0 ? closing.odds.draw - opening.odds.draw : 0;
      const clvAway = opening.odds.away > 0 ? closing.odds.away - opening.odds.away : 0;

      const sharpHome = clvHome < 0 ? 1 : 0;
      const sharpDraw = clvDraw < 0 ? 1 : 0;
      const sharpAway = clvAway < 0 ? 1 : 0;

      const movementHome = opening.odds.home > 0 ? Math.abs(clvHome / opening.odds.home) : 0;
      const movementDraw = opening.odds.draw > 0 ? Math.abs(clvDraw / opening.odds.draw) : 0;
      const movementAway = opening.odds.away > 0 ? Math.abs(clvAway / opening.odds.away) : 0;

      const impliedShiftHome = opening.impliedProbs.home - closing.impliedProbs.home;
      const impliedShiftDraw = opening.impliedProbs.draw - closing.impliedProbs.draw;
      const impliedShiftAway = opening.impliedProbs.away - closing.impliedProbs.away;

      const consensusStrength = Math.min(closing.bookmakerCount / 5, 1);
      const overroundChange = closing.overround - opening.overround;

      features[fixtureKey] = {
        homeTeam: closing.homeTeam,
        awayTeam: closing.awayTeam,
        kickoffTime: closing.kickoffTime,
        clvHome: Math.round(clvHome * 10000) / 10000,
        clvDraw: Math.round(clvDraw * 10000) / 10000,
        clvAway: Math.round(clvAway * 10000) / 10000,
        sharpMoneyHome: sharpHome,
        sharpMoneyDraw: sharpDraw,
        sharpMoneyAway: sharpAway,
        movementHome: Math.round(movementHome * 10000) / 10000,
        movementDraw: Math.round(movementDraw * 10000) / 10000,
        movementAway: Math.round(movementAway * 10000) / 10000,
        impliedShiftHome: Math.round(impliedShiftHome * 10000) / 10000,
        impliedShiftDraw: Math.round(impliedShiftDraw * 10000) / 10000,
        impliedShiftAway: Math.round(impliedShiftAway * 10000) / 10000,
        consensusStrength: Math.round(consensusStrength * 100) / 100,
        overroundChange: Math.round(overroundChange * 10000) / 10000,
        closingOverround: closing.overround,
        bestCLV: Math.max(clvHome, clvDraw, clvAway),
        sharpestSide: clvHome < clvDraw && clvHome < clvAway ? "Home" : clvAway < clvDraw ? "Away" : "Draw",
        snapshotCount: sorted.length,
        firstSnapshot: opening.timestamp,
        lastSnapshot: closing.timestamp,
      };
      computed++;
    }

    saveCLVFeatures(features, computed);

    return {
      success: true,
      count: computed,
      details: `${computed} CLV features computed`,
      duration: `${Date.now() - start}ms`,
    };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/** Phase: Pre-match update — adjust predictions with lineup + CLV (Phase 2) */
async function phasePreMatchUpdate(now: Date): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const in30m = new Date(now.getTime() + 30 * 60 * 1000);
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const { data: fixtures } = await supabaseAdmin
      .from("fixtures")
      .select("id, home_team_id, away_team_id, kickoff_time")
      .eq("status", "scheduled")
      .gte("kickoff_time", in30m.toISOString())
      .lte("kickoff_time", in2h.toISOString())
      .order("kickoff_time");

    if (!fixtures?.length) {
      return { success: true, count: 0, details: "No fixtures in pre-match window", duration: `${Date.now() - start}ms` };
    }

    const teamIds = [...new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))];
    const { data: teams } = await supabaseAdmin.from("teams").select("id, canonical_name").in("id", teamIds);
    const teamMap: Record<string, string> = {};
    for (const t of teams || []) teamMap[t.id] = t.canonical_name;

    const clvFeatures = loadCLVFeatures();
    let updated = 0;

    for (const fixture of fixtures) {
      const home = teamMap[fixture.home_team_id] || "Unknown";
      const away = teamMap[fixture.away_team_id] || "Unknown";
      const hoursUntil = (new Date(fixture.kickoff_time).getTime() - now.getTime()) / (1000 * 60 * 60);

      const { data: preds } = await supabaseAdmin
        .from("predictions")
        .select("*")
        .eq("fixture_id", fixture.id);

      if (!preds?.length) continue;

      const clv = clvFeatures[fixture.id] || {};

      // CLV adjustment
      let clvAdjustment = 0;
      if (clv.clvHome !== undefined) {
        clvAdjustment = clv.clvHome < -0.05 ? 0.02 : clv.clvHome > 0.05 ? -0.02 : 0;
      }

      for (const pred of preds) {
        const oldProb = pred.model_probability || 0.5;
        let newProb = oldProb;

        if (pred.selection === "Home") {
          newProb += clvAdjustment;
        } else if (pred.selection === "Away") {
          newProb -= clvAdjustment;
        } else if (pred.selection === "Draw") {
          newProb -= Math.abs(clvAdjustment) * 0.3;
        }

        newProb = Math.max(0.05, Math.min(0.95, newProb));

        if (Math.abs(newProb - oldProb) > 0.005) {
          await supabaseAdmin
            .from("predictions")
            .update({
              model_probability: Math.round(newProb * 10000) / 10000,
              model_version: "v5.1-phase2",
            })
            .eq("id", pred.id);
          updated++;
        }
      }
    }

    return {
      success: true,
      count: updated,
      details: `${updated} predictions updated for ${fixtures.length} fixtures`,
      duration: `${Date.now() - start}ms`,
    };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/** Phase: Final pick — one game decision engine (Phase 3) */
async function phaseFinalPick(now: Date): Promise<PhaseResult> {
  const start = Date.now();
  try {
    const in5m = new Date(now.getTime() + 5 * 60 * 1000);
    const in45m = new Date(now.getTime() + 45 * 60 * 1000);

    const { data: fixtures } = await supabaseAdmin
      .from("fixtures")
      .select("id, home_team_id, away_team_id, kickoff_time")
      .eq("status", "scheduled")
      .gte("kickoff_time", in5m.toISOString())
      .lte("kickoff_time", in45m.toISOString())
      .order("kickoff_time");

    if (!fixtures?.length) {
      return { success: true, count: 0, details: "No fixtures in final pick window", duration: `${Date.now() - start}ms` };
    }

    const teamIds = [...new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))];
    const { data: teams } = await supabaseAdmin.from("teams").select("id, canonical_name").in("id", teamIds);
    const teamMap: Record<string, string> = {};
    for (const t of teams || []) teamMap[t.id] = t.canonical_name;

    const clvFeatures = loadCLVFeatures();
    const candidates: any[] = [];

    for (const fixture of fixtures) {
      const home = teamMap[fixture.home_team_id] || "Unknown";
      const away = teamMap[fixture.away_team_id] || "Unknown";
      const minutesUntil = (new Date(fixture.kickoff_time).getTime() - now.getTime()) / (1000 * 60);

      const { data: preds } = await supabaseAdmin
        .from("predictions")
        .select("*")
        .eq("fixture_id", fixture.id)
        .order("model_probability", { ascending: false });

      if (!preds?.length) continue;
      const best = preds[0];
      const bestProb = best.model_probability || 0;

      // Get odds
      const { data: odds } = await supabaseAdmin
        .from("odds_snapshots")
        .select("*")
        .eq("fixture_id", fixture.id);

      const avgOdds = { home: 0, draw: 0, away: 0 };
      const counts = { home: 0, draw: 0, away: 0 };
      for (const o of odds || []) {
        const sel = (o.selection || "").toLowerCase();
        const val = (o as any).odds_value || o.odds || 0;
        if (sel === "home" || sel === "1") { avgOdds.home += val; counts.home++; }
        else if (sel === "draw" || sel === "x") { avgOdds.draw += val; counts.draw++; }
        else if (sel === "away" || sel === "2") { avgOdds.away += val; counts.away++; }
      }
      if (counts.home > 0) avgOdds.home /= counts.home;
      if (counts.draw > 0) avgOdds.draw /= counts.draw;
      if (counts.away > 0) avgOdds.away /= counts.away;

      const selKey = (best.selection || "").toLowerCase();
      const selectionOdds =
        selKey === "home" || selKey === "1" ? avgOdds.home :
        selKey === "draw" || selKey === "x" ? avgOdds.draw :
        selKey === "away" || selKey === "2" ? avgOdds.away : 0;
      const impliedProb = selectionOdds > 0 ? 1 / selectionOdds : 0;
      const edge = bestProb - impliedProb;

      const clv = clvFeatures[fixture.id] || {};
      const compositeScore =
        bestProb * 40 +
        Math.max(0, edge) * 100 * 30 +
        (clv.consensusStrength || 0.5) * 15 +
        ((clv.sharpMoneyHome === 1 && best.selection === "Home") ||
        (clv.sharpMoneyAway === 1 && best.selection === "Away")
          ? 15
          : 0);

      candidates.push({
        fixture_id: fixture.id,
        match: `${home} vs ${away}`,
        bestPrediction: { market: best.market, selection: best.selection, probability: bestProb },
        odds: { selection: selectionOdds, impliedProb, edge },
        clv: { sharpMoney: clv.sharpestSide || "none", consensusStrength: clv.consensusStrength || 0 },
        compositeScore: Math.round(compositeScore * 100) / 100,
        confidenceTier: bestProb >= 0.7 ? "ELITE" : bestProb >= 0.6 ? "HIGH" : "MEDIUM",
        minutesUntil: Math.round(minutesUntil),
      });
    }

    candidates.sort((a, b) => b.compositeScore - a.compositeScore);

    if (candidates.length === 0) {
      return { success: true, count: 0, details: "No candidates for final pick", duration: `${Date.now() - start}ms` };
    }

    const thePick = candidates[0];
    const decision = thePick.odds.edge > 0.02 && thePick.confidenceTier !== "MEDIUM" ? "BET" : "WATCH";

    // Save to pipeline state
    const state = loadPipelineState();
    state.picks.push({
      ...thePick,
      decided_at: now.toISOString(),
      decision,
      all_candidates: candidates,
    });
    state.lastRun = now.toISOString();
    state.phases[`phase3_${now.toISOString().slice(0, 10)}`] = {
      updated_at: now.toISOString(),
      candidates: candidates.length,
      pick: thePick.match,
      decision,
    };
    savePipelineState(state);

    return {
      success: true,
      count: 1,
      details: `Pick: ${thePick.match} (${thePick.bestPrediction.selection}) — ${decision} [score: ${thePick.compositeScore}]`,
      duration: `${Date.now() - start}ms`,
    };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/* ── Main Handler ─────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startTime = Date.now();
    const now = new Date();
    console.log(`[PIPELINE] Starting at ${now.toISOString()}`);

    const results: Record<string, PhaseResult> = {};

    // 1. Settle finished matches first
    console.log("[PIPELINE] Phase: Settlement...");
    results.settle = await phaseSettle(now);
    console.log(`[PIPELINE] Settle: ${results.settle.details}`);

    // 2. Generate predictions for 12–48h fixtures
    console.log("[PIPELINE] Phase: Predict...");
    results.predict = await phasePredict(now);
    console.log(`[PIPELINE] Predict: ${results.predict.details}`);

    // 3. CLV snapshots for 30min–2h fixtures
    console.log("[PIPELINE] Phase: CLV Snapshot...");
    results.clvSnapshot = await phaseCLVSnapshot(now);
    console.log(`[PIPELINE] CLV Snapshot: ${results.clvSnapshot.details}`);

    // 4. Compute CLV features
    console.log("[PIPELINE] Phase: CLV Compute...");
    results.clvCompute = await phaseCLVCompute();
    console.log(`[PIPELINE] CLV Compute: ${results.clvCompute.details}`);

    // 5. Pre-match update (Phase 2)
    console.log("[PIPELINE] Phase: Pre-Match Update...");
    results.preMatch = await phasePreMatchUpdate(now);
    console.log(`[PIPELINE] Pre-Match: ${results.preMatch.details}`);

    // 6. Final pick (Phase 3)
    console.log("[PIPELINE] Phase: Final Pick...");
    results.finalPick = await phaseFinalPick(now);
    console.log(`[PIPELINE] Final Pick: ${results.finalPick.details}`);

    const totalDuration = Date.now() - startTime;
    const phasesRun = Object.values(results).filter((r) => r.success).length;
    const totalActions = Object.values(results).reduce((s, r) => s + (r.count || 0), 0);

    console.log(`[PIPELINE] Complete: ${phasesRun} phases, ${totalActions} actions, ${totalDuration}ms`);

    return NextResponse.json({
      success: true,
      duration: `${totalDuration}ms`,
      phasesRun,
      totalActions,
      results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("[PIPELINE] Fatal error:", error);
    return NextResponse.json({ error: "Pipeline failed" }, { status: 500 });
  }
}

/** POST — manual trigger from admin dashboard */
export async function POST(request: NextRequest) {
  try {
    const { requireAdmin } = await import("@/lib/api/utils");
    await requireAdmin(request);

    console.log("[MANUAL] Pipeline triggered from admin");
    const startTime = Date.now();
    const now = new Date();

    const results: Record<string, PhaseResult> = {};
    results.settle = await phaseSettle(now);
    results.predict = await phasePredict(now);
    results.clvSnapshot = await phaseCLVSnapshot(now);
    results.clvCompute = await phaseCLVCompute();
    results.preMatch = await phasePreMatchUpdate(now);
    results.finalPick = await phaseFinalPick(now);

    const totalDuration = Date.now() - startTime;
    const totalActions = Object.values(results).reduce((s, r) => s + (r.count || 0), 0);

    return NextResponse.json({
      success: true,
      duration: `${totalDuration}ms`,
      totalActions,
      results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("[MANUAL] Pipeline error:", error);
    return NextResponse.json({ error: "Pipeline failed" }, { status: 500 });
  }
}
