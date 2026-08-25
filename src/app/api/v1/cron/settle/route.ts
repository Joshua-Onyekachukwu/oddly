import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function clamp(v: number, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) { console.error('[CRON] CRITICAL: VERCEL_CRON_SECRET not set — cron auth disabled'); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

// ─── Poisson Model (same as predict route) ──────────────────────────────
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
      if (i > j) pH += grid[i][j]; else if (i === j) pD += grid[i][j]; else pA += grid[i][j];
    }
  m["1X2_Home"] = clamp(pH); m["1X2_Draw"] = clamp(pD); m["1X2_Away"] = clamp(pA);
  m["DC_1X"] = clamp(pH + pD); m["DC_X2"] = clamp(pD + pA); m["DC_12"] = clamp(pH + pA);
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
  m["BTTS_Yes"] = clamp(btts); m["BTTS_No"] = clamp(1 - btts);
  return m;
}

// ─── Smart Tracker ──────────────────────────────────────────────────────
class SimpleTracker {
  history: Record<string, Array<{gf: number, ga: number, isHome: boolean}>> = {};
  elo: Record<string, number> = {};
  h2h: Record<string, Array<{home: string, away: string, hg: number, ag: number}>> = {};
  leagueAvg: Record<string, number> = {};
  leagueCount: Record<string, number> = {};

  recordMatch(home: string, away: string, hg: number, ag: number, leagueId?: string) {
    if (!this.history[home]) this.history[home] = [];
    if (!this.history[away]) this.history[away] = [];
    this.history[home].push({ gf: hg, ga: ag, isHome: true });
    this.history[away].push({ gf: ag, ga: hg, isHome: false });
    if (this.history[home].length > 50) this.history[home].shift();
    if (this.history[away].length > 50) this.history[away].shift();
    const key = [home, away].sort().join(" vs ");
    if (!this.h2h[key]) this.h2h[key] = [];
    this.h2h[key].push({ home, away, hg, ag });
    if (leagueId) {
      if (!this.leagueAvg[leagueId]) { this.leagueAvg[leagueId] = 0; this.leagueCount[leagueId] = 0; }
      this.leagueAvg[leagueId] += hg + ag;
      this.leagueCount[leagueId]++;
    }
    const h = (this.elo[home] || 1500) + 65, a = this.elo[away] || 1500;
    const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
    const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
    this.elo[home] = (this.elo[home] || 1500) + 32 * (actual - eH);
    this.elo[away] = (this.elo[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
  }

  getTeamStats(t: string) {
    const h = (this.history[t] || []).slice(-15);
    if (h.length < 3) return { ppg: 1.5, homeGF: 1.4, homeGA: 1.1, awayGF: 1.0, awayGA: 1.3, scoresRate: 0.7, concedesRate: 0.75 };
    const r10 = h.slice(-10);
    const home = h.filter(m => m.isHome).slice(-8), away = h.filter(m => !m.isHome).slice(-8);
    return {
      ppg: h.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(5, h.length),
      homeGF: home.reduce((s, m) => s + m.gf, 0) / Math.max(1, home.length),
      homeGA: home.reduce((s, m) => s + m.ga, 0) / Math.max(1, home.length),
      awayGF: away.reduce((s, m) => s + m.gf, 0) / Math.max(1, away.length),
      awayGA: away.reduce((s, m) => s + m.ga, 0) / Math.max(1, away.length),
      scoresRate: r10.filter(m => m.gf > 0).length / Math.max(1, r10.length),
      concedesRate: r10.filter(m => m.ga > 0).length / Math.max(1, r10.length),
    };
  }

  getLeagueAvgGoals(lid: string) {
    return (this.leagueAvg[lid] || 0) / Math.max(1, this.leagueCount[lid] || 1) || 2.6;
  }
}

function predictMatch(hs: ReturnType<SimpleTracker["getTeamStats"]>, as: ReturnType<SimpleTracker["getTeamStats"]>, tracker: SimpleTracker, leagueId?: string): Record<string, any> {
  const eloDiff = (tracker.elo[hs.ppg as unknown as string] || 1500) - (tracker.elo[as.ppg as unknown as string] || 1500);
  const leagueGoals = leagueId ? tracker.getLeagueAvgGoals(leagueId) : 2.6;
  const homeLambda = Math.max(0.3, (hs.homeGF * 0.4 + leagueGoals * 0.3 + (hs.ppg / 3) * 0.3));
  const awayLambda = Math.max(0.3, (as.awayGF * 0.4 + leagueGoals * 0.3 + (as.ppg / 3) * 0.3));
  const grid = poissonGoals(homeLambda, awayLambda);
  return computeMarkets(grid);
}

function checkPrediction(pred: Record<string, any>, market: string, selection: string, homeScore: number, awayScore: number): boolean {
  const total = homeScore + awayScore;
  const homeWin = homeScore > awayScore;
  const draw = homeScore === awayScore;
  const awayWin = homeScore < awayScore;
  const bothScore = homeScore > 0 && awayScore > 0;

  // Normalize selection to lowercase
  const sel = (selection || "").toLowerCase();

  // 1X2
  if (market === "1X2") {
    return (sel === "home" && homeWin) || (sel === "draw" && draw) || (sel === "away" && awayWin);
  }

  // Over/Under
  if (market === "ou_over_0.5" || selection === "Over_0.5") return total > 0.5;
  if (market === "ou_under_0.5" || selection === "Under_0.5") return total < 0.5;
  if (market === "ou_over_1.5" || selection === "Over_1.5") return total > 1.5;
  if (market === "ou_under_1.5" || selection === "Under_1.5") return total < 1.5;
  if (market === "ou_over_2.5" || selection === "Over_2.5") return total > 2.5;
  if (market === "ou_under_2.5" || selection === "Under_2.5") return total < 2.5;
  if (market === "ou_over_3.5" || selection === "Over_3.5") return total > 3.5;
  if (market === "ou_under_3.5" || selection === "Under_3.5") return total < 3.5;
  if (market === "ou_over_4.5" || selection === "Over_4.5") return total > 4.5;
  if (market === "ou_under_4.5" || selection === "Under_4.5") return total < 4.5;

  // BTTS
  if (market === "btts") return sel === "yes" ? bothScore : !bothScore;

  // Double Chance
  if (market === "dc_1x") return homeScore >= awayScore;
  if (market === "dc_x2") return homeScore <= awayScore;
  if (market === "dc_12") return homeScore !== awayScore;

  // Draw No Bet
  if (market === "dnb_home") return homeWin;
  if (market === "dnb_away") return awayWin;

  // Team Goals
  if (market === "homegoals_over_0.5") return homeScore > 0.5;
  if (market === "homegoals_over_1.5") return homeScore > 1.5;
  if (market === "awaygoals_over_0.5") return awayScore > 0.5;
  if (market === "awaygoals_over_1.5") return awayScore > 1.5;

  // Smart selection (fallback)
  if (market === "smart_selection") {
    const ss = pred["smart_selection"];
    if (!ss) return false;
    return checkPrediction(pred, ss.market, ss.selection, homeScore, awayScore);
  }

  // If we can't determine the result, mark as void
  return false;
}

// ─── POST /api/v1/cron/settle ───────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startTime = Date.now();
    console.log("[SETTLE] Starting prediction settlement...");

    // Load finished fixtures from last 7 days (not yet settled)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: fixtures, error: fixErr } = await supabaseAdmin
      .from("fixtures")
      .select(`
        id, home_team_id, away_team_id, league_id, kickoff_time,
        home_score, away_score, status,
        home_team:teams!fixtures_home_team_id_fkey(id, canonical_name),
        away_team:teams!fixtures_away_team_id_fkey(id, canonical_name)
      `)
      .eq("status", "finished")
      .not("home_score", "is", null)
      .gte("kickoff_time", sevenDaysAgo)
      .order("kickoff_time", { ascending: false })
      .limit(500);

    if (fixErr || !fixtures) {
      return NextResponse.json({ error: "Failed to load fixtures", detail: fixErr?.message }, { status: 500 });
    }

    console.log(`[SETTLE] Processing ${fixtures.length} finished fixtures...`);

    // Load existing predictions
    const fixtureIds = fixtures.map(f => f.id);
    const { data: existingPreds } = await supabaseAdmin
      .from("predictions")
      .select("id, fixture_id, market, selection, model_probability, result")
      .in("fixture_id", fixtureIds);

    // Group predictions by fixture (only pending ones)
    const predByFixture: Record<string, Array<{id: string, market: string, selection: string, model_probability: number, result: string | null}>> = {};
    for (const p of existingPreds || []) {
      if (!predByFixture[p.fixture_id]) predByFixture[p.fixture_id] = [];
      predByFixture[p.fixture_id].push(p);
    }

    // Build tracker from historical matches
    const tracker = new SimpleTracker();
    const sortedFixtures = [...fixtures].sort((a, b) => (a.kickoff_time || "").localeCompare(b.kickoff_time || ""));
    for (const f of sortedFixtures) {
      const hs = (f.home_team as any)?.canonical_name || "Home";
      const as = (f.away_team as any)?.canonical_name || "Away";
      tracker.recordMatch(hs, as, f.home_score || 0, f.away_score || 0, f.league_id);
    }

    let settled = 0;
    let correct = 0;
    let incorrect = 0;

    // Settle each prediction
    for (const fixture of fixtures) {
      const preds = predByFixture[fixture.id] || [];
      const hs = (fixture.home_team as any)?.canonical_name || "Home";
      const as = (fixture.away_team as any)?.canonical_name || "Away";
      const homeScore = fixture.home_score || 0;
      const awayScore = fixture.away_score || 0;

      // Generate smart prediction for this match
      const ht = tracker.getTeamStats(hs);
      const at = tracker.getTeamStats(as);
      const pred = predictMatch(ht, at, tracker, fixture.league_id);

      // Find best market for smart selection
      let bestMarket = "ou_over_0.5";
      let bestProb = 0;
      for (const [mkt, prob] of Object.entries(pred)) {
        if (mkt.startsWith("smart")) continue;
        const isYes = prob > 0.5;
        if (isYes && prob > bestProb) { bestProb = prob; bestMarket = mkt; }
      }
      const smartSelection = bestMarket.replace("1X2_", "").replace("OU_", "").replace("DC_", "").replace("BTTS_", "").toLowerCase();
      const smartMarket = bestMarket.startsWith("1X2") ? "1X2" : bestMarket.startsWith("OU") ? bestMarket.replace(/_\d+\.\d+/, "").toLowerCase() : bestMarket.startsWith("DC") ? "double_chance" : bestMarket.startsWith("BTTS") ? "btts" : bestMarket;

      pred["smart_selection"] = { market: smartMarket, selection: smartSelection, probability: bestProb };

      for (const p of preds) {
        if (p.result && p.result !== "pending") continue; // Already settled
        const isCorrect = checkPrediction(pred, p.market, p.selection, homeScore, awayScore);
        settled++;
        if (isCorrect) correct++;
        else incorrect++;

        await supabaseAdmin
          .from("predictions")
          .update({
            result: isCorrect ? "correct" : "wrong",
            settled_at: new Date().toISOString(),
          })
          .eq("id", p.id)
          .eq("result", "pending"); // Safety: only update pending predictions
      }
    }

    // Archive settled predictions to Convex (non-blocking)
    let archived = 0;
    if (settled > 0 && process.env.CONVEX_URL) {
      try {
        const origin = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        const archiveRes = await fetch(`${origin}/api/v1/cron/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: Math.min(settled * 2, 500) }),
        });
        if (archiveRes.ok) {
          const archiveData = await archiveRes.json();
          archived = archiveData.archived || 0;
          console.log(`[SETTLE] Archived ${archived} predictions to Convex`);
        }
      } catch (archiveErr) {
        console.error('[SETTLE] Archive warning (non-blocking):', archiveErr);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[SETTLE] Done: ${settled} settled, ${correct} correct, ${incorrect} incorrect (${duration}ms)`);

    return NextResponse.json({
      success: true,
      settled,
      correct,
      incorrect,
      accuracy: settled > 0 ? ((correct / settled) * 100).toFixed(1) + "%" : "N/A",
      fixturesProcessed: fixtures.length,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[SETTLE] Error:", error);
    return NextResponse.json({ error: "Settle failed" }, { status: 500 });
  }
}

// GET for status check
export async function GET() {
  return NextResponse.json({
    status: "ready",
    endpoint: "POST /api/v1/cron/settle",
    description: "Settles predictions against actual match results",
  });
}
