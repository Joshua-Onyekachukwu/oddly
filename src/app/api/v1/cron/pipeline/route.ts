/**
 * GET /api/v1/cron/pipeline
 *
 * Unified betting pipeline. Runs every hour.
 * Uses the ensemble wrapper for predictions (no inline Poisson).
 * Has time-of-day awareness: skips heavy phases during peak hours.
 * Includes cron logging and execution locking.
 *
 * Schedule: every hour (vercel.json)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { predictMatchEnsemble } from "@/lib/models/ensemble";
import { withLock } from "@/lib/cron/lock";
import { startRun, completeRun, type CronRunResult } from "@/lib/cron/logger";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

/* ── Config ──────────────────────────────────────────────── */

// Peak hours: avoid heavy work (adjust as needed)
const PEAK_START_HOUR = 14; // 2pm
const PEAK_END_HOUR = 22;   // 10pm

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
    fs.writeFileSync(p, JSON.stringify({ computed_at: new Date().toISOString(), count, features }, null, 2));
  } catch {}
}

/* ── Time-of-day awareness ──────────────────────────────── */

function isPeakHour(now: Date): boolean {
  const hour = now.getHours();
  return hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR;
}

/* ── Phases ───────────────────────────────────────────────── */

interface PhaseResult {
  success: boolean;
  count?: number;
  duration?: string;
  details?: string;
  skipped?: boolean;
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

/** Phase: Generate predictions for fixtures 12-48h out using ENSEMBLE */
async function phasePredict(now: Date, isPeak: boolean): Promise<PhaseResult> {
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
      .select("id, league_id, home_team_id, away_team_id, kickoff_time")
      .eq("status", "scheduled")
      .gte("kickoff_time", in12h.toISOString())
      .lte("kickoff_time", in48h.toISOString())
      .order("kickoff_time")
      .limit(isPeak ? 50 : 200); // During peak: limit to reduce load

    if (!fixtures?.length) {
      return { success: true, count: 0, details: "No fixtures in prediction window", duration: `${Date.now() - start}ms` };
    }

    const teamIds = [...new Set(fixtures.flatMap((f) => [f.home_team_id, f.away_team_id]))];
    const { data: teams } = await supabaseAdmin.from("teams").select("id, canonical_name").in("id", teamIds);
    const teamMap: Record<string, string> = {};
    for (const t of teams || []) teamMap[t.id] = t.canonical_name;

    // IDEMPOTENCY: Skip fixtures with existing pending predictions
    const fixtureIds = fixtures.map((f) => f.id);
    const { data: existingPreds } = await supabaseAdmin
      .from("predictions")
      .select("fixture_id")
      .in("fixture_id", fixtureIds)
      .eq("result", "pending");
    const existingFixtureIds = new Set((existingPreds || []).map((p) => p.fixture_id));

    // Generate predictions using ENSEMBLE (no more inline Poisson!)
    const predictions: any[] = [];
    let ensembleHits = 0;
    let ensembleMisses = 0;

    for (const fixture of fixtures) {
      if (existingFixtureIds.has(fixture.id)) continue;

      const home = teamMap[fixture.home_team_id];
      const away = teamMap[fixture.away_team_id];
      if (!home || !away) continue;

      try {
        const result = await predictMatchEnsemble(home, away, fixture.league_id, eloMap, formMap, fixture.kickoff_time);
        if (!result) { ensembleMisses++; continue; }

        ensembleHits++;
        for (const [market, prob] of Object.entries(result.markets)) {
          const parts = market.split("_");
          predictions.push({
            fixture_id: fixture.id,
            market: parts[0],
            selection: parts.slice(1).join("_").toLowerCase(),
            model_probability: Math.round(prob * 10000) / 10000,
            model_version: result.modelVersion,
          });
        }
      } catch (err: any) {
        console.error(`[PIPELINE] Ensemble failed for ${home} vs ${away}:`, err.message);
        ensembleMisses++;
      }
    }

    for (let i = 0; i < predictions.length; i += 50) {
      await supabaseAdmin.from("predictions").insert(predictions.slice(i, i + 50));
    }

    return {
      success: true,
      count: predictions.length,
      details: `${predictions.length} predictions for ${fixtures.length} fixtures (ensemble: ${ensembleHits}, misses: ${ensembleMisses})`,
      duration: `${Date.now() - start}ms`,
    };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/** Phase: CLV snapshot for fixtures 30min-2h out */
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

      let snapshotType: string;
      if (hoursUntil > 24) snapshotType = "opening";
      else if (hoursUntil > 6) snapshotType = "mid";
      else if (hoursUntil > 0.5) snapshotType = "closing";
      else snapshotType = "pre_match";

      const { data: odds } = await supabaseAdmin
        .from("odds_snapshots")
        .select("*")
        .eq("fixture_id", fixture.id);

      if (!odds?.length) continue;

      const oddsByBookmaker: Record<string, Record<string, number[]>> = {};
      for (const o of odds) {
        if (!oddsByBookmaker[o.bookmaker]) oddsByBookmaker[o.bookmaker] = {};
        if (!oddsByBookmaker[o.bookmaker][o.selection]) oddsByBookmaker[o.bookmaker][o.selection] = [];
        oddsByBookmaker[o.bookmaker][o.selection].push((o as any).odds_value || o.odds);
      }

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
        homeTeam: home, awayTeam: away,
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

    clvData.meta = { lastSnapshot: now.toISOString(), snapshotCount, fixturesTracked: Object.keys(clvData.snapshots).length };
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

      features[fixtureKey] = {
        homeTeam: closing.homeTeam, awayTeam: closing.awayTeam, kickoffTime: closing.kickoffTime,
        clvHome: Math.round(clvHome * 10000) / 10000,
        clvDraw: Math.round(clvDraw * 10000) / 10000,
        clvAway: Math.round(clvAway * 10000) / 10000,
        sharpMoneyHome: clvHome < -0.05 ? 1 : 0,
        sharpMoneyDraw: clvDraw < -0.05 ? 1 : 0,
        sharpMoneyAway: clvAway < -0.05 ? 1 : 0,
        movementHome: opening.odds.home > 0 ? Math.round((Math.abs(clvHome / opening.odds.home)) * 10000) / 10000 : 0,
        movementDraw: opening.odds.draw > 0 ? Math.round((Math.abs(clvDraw / opening.odds.draw)) * 10000) / 10000 : 0,
        movementAway: opening.odds.away > 0 ? Math.round((Math.abs(clvAway / opening.odds.away)) * 10000) / 10000 : 0,
        impliedShiftHome: Math.round((opening.impliedProbs.home - closing.impliedProbs.home) * 10000) / 10000,
        impliedShiftDraw: Math.round((opening.impliedProbs.draw - closing.impliedProbs.draw) * 10000) / 10000,
        impliedShiftAway: Math.round((opening.impliedProbs.away - closing.impliedProbs.away) * 10000) / 10000,
        consensusStrength: Math.round(Math.min(closing.bookmakerCount / 5, 1) * 100) / 100,
        overroundChange: Math.round((closing.overround - opening.overround) * 10000) / 10000,
        closingOverround: closing.overround,
        bestCLV: Math.max(clvHome, clvDraw, clvAway),
        sharpestSide: clvHome < clvDraw && clvHome < clvAway ? "Home" : clvAway < clvDraw ? "Away" : "Draw",
        snapshotCount: sorted.length,
      };
      computed++;
    }

    saveCLVFeatures(features, computed);
    return { success: true, count: computed, details: `${computed} CLV features computed`, duration: `${Date.now() - start}ms` };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/** Phase: Pre-match update */
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
      const { data: preds } = await supabaseAdmin
        .from("predictions")
        .select("*")
        .eq("fixture_id", fixture.id);

      if (!preds?.length) continue;

      const clv = clvFeatures[fixture.id] || {};
      let clvAdjustment = 0;
      if (clv.clvHome !== undefined) {
        clvAdjustment = clv.clvHome < -0.05 ? 0.02 : clv.clvHome > 0.05 ? -0.02 : 0;
      }

      for (const pred of preds) {
        const oldProb = pred.model_probability || 0.5;
        let newProb = oldProb;
        if (pred.selection === "Home") newProb += clvAdjustment;
        else if (pred.selection === "Away") newProb -= clvAdjustment;
        else if (pred.selection === "Draw") newProb -= Math.abs(clvAdjustment) * 0.3;
        newProb = Math.max(0.05, Math.min(0.95, newProb));

        if (Math.abs(newProb - oldProb) > 0.005) {
          await supabaseAdmin
            .from("predictions")
            .update({ model_probability: Math.round(newProb * 10000) / 10000, model_version: "v5.1-phase2" })
            .eq("id", pred.id);
          updated++;
        }
      }
    }

    return { success: true, count: updated, details: `${updated} predictions updated`, duration: `${Date.now() - start}ms` };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/** Phase: Final pick */
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
        (clv.sharpMoneyAway === 1 && best.selection === "Away") ? 15 : 0);

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

    const state = loadPipelineState();
    state.picks.push({ ...thePick, decided_at: now.toISOString(), decision, all_candidates: candidates });
    state.lastRun = now.toISOString();
    state.phases[`phase3_${now.toISOString().slice(0, 10)}`] = {
      updated_at: now.toISOString(), candidates: candidates.length, pick: thePick.match, decision,
    };
    savePipelineState(state);

    return {
      success: true, count: 1,
      details: `Pick: ${thePick.match} (${thePick.bestPrediction.selection}) -- ${decision} [score: ${thePick.compositeScore}]`,
      duration: `${Date.now() - start}ms`,
    };
  } catch (e) {
    return { success: false, details: e instanceof Error ? e.message : "Unknown", duration: `${Date.now() - start}ms` };
  }
}

/* ── Main Handler ─────────────────────────────────────────── */

async function runPipeline() {
  const now = new Date();
  const peak = isPeakHour(now);
  console.log(`[PIPELINE] Starting at ${now.toISOString()} (peak: ${peak})`);

  const results: Record<string, PhaseResult> = {};

  // Settlement always runs
  console.log("[PIPELINE] Phase: Settlement...");
  results.settle = await phaseSettle(now);
  console.log(`[PIPELINE] Settle: ${results.settle.details}`);

  // Predictions: limit scope during peak hours
  console.log("[PIPELINE] Phase: Predict...");
  results.predict = await phasePredict(now, peak);
  console.log(`[PIPELINE] Predict: ${results.predict.details}`);

  // CLV phases: skip during peak
  if (peak) {
    console.log("[PIPELINE] Skipping CLV phases (peak hours)");
    results.clvSnapshot = { success: true, count: 0, details: "Skipped (peak hours)", skipped: true };
    results.clvCompute = { success: true, count: 0, details: "Skipped (peak hours)", skipped: true };
    results.preMatch = { success: true, count: 0, details: "Skipped (peak hours)", skipped: true };
    results.finalPick = { success: true, count: 0, details: "Skipped (peak hours)", skipped: true };
  } else {
    console.log("[PIPELINE] Phase: CLV Snapshot...");
    results.clvSnapshot = await phaseCLVSnapshot(now);
    console.log(`[PIPELINE] CLV Snapshot: ${results.clvSnapshot.details}`);

    console.log("[PIPELINE] Phase: CLV Compute...");
    results.clvCompute = await phaseCLVCompute();
    console.log(`[PIPELINE] CLV Compute: ${results.clvCompute.details}`);

    console.log("[PIPELINE] Phase: Pre-Match Update...");
    results.preMatch = await phasePreMatchUpdate(now);
    console.log(`[PIPELINE] Pre-Match: ${results.preMatch.details}`);

    console.log("[PIPELINE] Phase: Final Pick...");
    results.finalPick = await phaseFinalPick(now);
    console.log(`[PIPELINE] Final Pick: ${results.finalPick.details}`);
  }

  const totalActions = Object.values(results).reduce((s, r) => s + (r.count || 0), 0);
  const phasesRun = Object.values(results).filter((r) => r.success && !r.skipped).length;

  return { results, phasesRun, totalActions, isPeak: peak };
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const executionId = await startRun("pipeline", "cron");
    const lockResult = await withLock("pipeline", runPipeline, { leaseSeconds: 900 });

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, {
        status: "FAILED", errorMessage: lockResult.error, durationMs: lockResult.durationMs,
      });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const { results, phasesRun, totalActions, isPeak } = lockResult.result!;
    const cronResult: CronRunResult = {
      status: "SUCCESS",
      recordsProcessed: totalActions,
      metadata: { phasesRun, isPeak, results },
    };

    await completeRun(executionId, cronResult);

    return NextResponse.json({
      success: true,
      duration: `${lockResult.durationMs}ms`,
      phasesRun,
      totalActions,
      isPeak,
      results,
      timestamp: new Date().toISOString(),
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
    const lockResult = await withLock("pipeline", runPipeline, { leaseSeconds: 900 });

    if (!lockResult.acquired) {
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const { results, phasesRun, totalActions, isPeak } = lockResult.result!;
    return NextResponse.json({
      success: true,
      duration: `${lockResult.durationMs}ms`,
      phasesRun,
      totalActions,
      isPeak,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[MANUAL] Pipeline error:", error);
    return NextResponse.json({ error: "Pipeline failed" }, { status: 500 });
  }
}
