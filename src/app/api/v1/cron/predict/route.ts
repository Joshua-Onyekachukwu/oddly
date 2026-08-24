import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notifyCrownJewel } from "@/lib/notifications";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

import * as fs from "fs";
import * as path from "path";

function clamp(v: number, lo = 0.01, hi = 0.99) { return Math.max(lo, Math.min(hi, v)); }

// ─── xG Data (StatsBomb + Understat) ──────────────────────────────────────
let xgLookup: Record<string, any> = {};
try {
  const xgPath = path.join(process.cwd(), "data", "statsbomb-xg.json");
  const raw = JSON.parse(fs.readFileSync(xgPath, "utf8"));
  const features = raw.features || {};
  for (const [name, feat] of Object.entries(features)) {
    xgLookup[name.toLowerCase()] = feat;
  }
  console.log(`[PREDICT] Loaded StatsBomb xG for ${Object.keys(xgLookup).length} teams`);
} catch {
  console.log("[PREDICT] No StatsBomb xG data");
}
// Load Understat xG (broader coverage: 484 teams)
try {
  const uPath = path.join(process.cwd(), "data", "understat-xg.json");
  const uRaw = JSON.parse(fs.readFileSync(uPath, "utf8"));
  const teams = uRaw.teams || {};
  let added = 0;
  for (const [key, feat] of Object.entries(teams) as [string, any][]) {
    const name = key.split(/_EPL_|_La_liga_|_Bundesliga_|_Serie_A_|_Ligue_1_/)[0].toLowerCase();
    if (!xgLookup[name]) { xgLookup[name] = feat; added++; }
  }
  console.log(`[PREDICT] Loaded Understat xG: ${added} new teams (total: ${Object.keys(xgLookup).length})`);
} catch {
  console.log("[PREDICT] No Understat xG data");
}

const TEAM_ALIASES: Record<string, string> = {
  'psg': 'Paris Saint Germain', 'man utd': 'Manchester United',
  'man united': 'Manchester United', 'man city': 'Manchester City',
  'inter milan': 'Internazionale', 'inter': 'Internazionale',
  'barca': 'Barcelona', 'bayern': 'Bayern Munich',
  'leverkusen': 'Bayer Leverkusen', 'dortmund': 'Borussia Dortmund',
  'atletico': 'Atletico Madrid', 'sporting cp': 'Sporting CP',
};

function findXG(teamName: string): any {
  if (!teamName) return null;
  const resolved = TEAM_ALIASES[teamName.toLowerCase()] || teamName;
  const lower = resolved.toLowerCase();
  if (xgLookup[lower]) return xgLookup[lower];
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
  if (xgLookup[cap]) return xgLookup[cap];
  for (const [key, val] of Object.entries(xgLookup)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  const words = lower.split(/\s+/);
  for (const [key, val] of Object.entries(xgLookup)) {
    const keyWords = key.split(/\s+/);
    const overlap = words.filter(w => keyWords.some(kw => kw.includes(w) || w.includes(kw)));
    if (overlap.length >= 2) return val;
  }
  return null;
}

// ─── Poisson Model ───────────────────────────────────────────────────────
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
  const dnb = pH + pA;
  m["DNB_Home"] = dnb > 0 ? clamp(pH / dnb) : 0.5;
  m["DNB_Away"] = dnb > 0 ? clamp(pA / dnb) : 0.5;
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

/**
 * Verify the request is from Vercel Cron or an authorized caller.
 */
function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) return true;
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * Run the full prediction pipeline:
 * 1. Generate predictions for all scheduled fixtures
 * 2. Auto-generate recommendations (value bets) from predictions
 * 3. Select Crown Jewel pick
 * 4. Notify users about Crown Jewel
 */
async function runPredictionPipeline() {
  const startTime = Date.now();
  const results: Record<string, unknown> = {};

  // Load historical data for model calibration
  console.log("[PREDICT] Loading historical data...");
  const eloMap: Record<string, number> = {};
  const formMap: Record<string, { gf: number; ga: number; isHome: boolean }[]> = {};

  const { data: histFixtures } = await supabaseAdmin
    .from("fixtures")
    .select("home_score, away_score, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .order("kickoff_time", { ascending: true })
    .limit(2000);

  if (histFixtures) {
    for (const f of histFixtures) {
      const home = (f as any).home?.canonical_name;
      const away = (f as any).away?.canonical_name;
      if (!home || !away) continue;
      // Elo update
      const h = (eloMap[home] || 1500) + 65;
      const a = eloMap[away] || 1500;
      const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
      const actual = f.home_score > f.away_score ? 1 : f.home_score < f.away_score ? 0 : 0.5;
      eloMap[home] = (eloMap[home] || 1500) + 32 * (actual - eH);
      eloMap[away] = (eloMap[away] || 1500) + 32 * ((1 - actual) - (1 - eH));
      // Form
      if (!formMap[home]) formMap[home] = [];
      if (!formMap[away]) formMap[away] = [];
      formMap[home].push({ gf: f.home_score, ga: f.away_score, isHome: true });
      formMap[away].push({ gf: f.away_score, ga: f.home_score, isHome: false });
      if (formMap[home].length > 15) formMap[home].shift();
      if (formMap[away].length > 15) formMap[away].shift();
    }
  }
  console.log(`[PREDICT] Loaded ${histFixtures?.length || 0} historical matches`);

  // Get upcoming fixtures
  const { data: fixtures } = await supabaseAdmin
    .from("fixtures")
    .select("id, league_id, home_team_id, away_team_id")
    .eq("status", "scheduled")
    .gte("kickoff_time", new Date().toISOString())
    .order("kickoff_time")
    .limit(200);

  if (!fixtures?.length) {
    return { success: true, duration: `${Date.now() - startTime}ms`, results: { message: "No upcoming fixtures" }, timestamp: new Date().toISOString() };
  }
  console.log(`[PREDICT] Found ${fixtures.length} upcoming fixtures`);

  // Get team names
  const teamIds = [...new Set([...fixtures.map(f => f.home_team_id), ...fixtures.map(f => f.away_team_id)])];
  const { data: teams } = await supabaseAdmin.from("teams").select("id, canonical_name").in("id", teamIds);
  const teamMap: Record<string, string> = {};
  for (const t of teams || []) teamMap[t.id] = t.canonical_name;

  // Generate enhanced predictions
  const predictions: any[] = [];
  for (const fixture of fixtures) {
    const home = teamMap[fixture.home_team_id];
    const away = teamMap[fixture.away_team_id];
    if (!home || !away) continue;

    // Get features
    const hHist = (formMap[home] || []).slice(-10);
    const aHist = (formMap[away] || []).slice(-10);
    const hPPG = hHist.length > 0 ? hHist.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(hHist.length, 5) : 1.5;
    const aPPG = aHist.length > 0 ? aHist.slice(-5).reduce((s, m) => s + (m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0), 0) / Math.min(aHist.length, 5) : 1.5;
    const hGS = hHist.length > 0 ? hHist.slice(-5).reduce((s, m) => s + m.gf, 0) / Math.min(hHist.length, 5) : 1.3;
    const aGS = aHist.length > 0 ? aHist.slice(-5).reduce((s, m) => s + m.gf, 0) / Math.min(aHist.length, 5) : 1.3;
    const hGC = hHist.length > 0 ? hHist.slice(-5).reduce((s, m) => s + m.ga, 0) / Math.min(hHist.length, 5) : 1.2;
    const aGC = aHist.length > 0 ? aHist.slice(-5).reduce((s, m) => s + m.ga, 0) / Math.min(aHist.length, 5) : 1.2;
    const eloDiff = (eloMap[home] || 1500) - (eloMap[away] || 1500);

    // xG lookup
    const homeXG = findXG(home);
    const awayXG = findXG(away);

    // Optimized formula (from coordinate descent optimization)
    let prob = 0.5 + (eloDiff - 100) * 0.0018;
    prob += (hPPG - 1.6) * 0.003;
    prob -= (aPPG - 1.2) * 0.06;
    prob += (hGS - 1.3) * 0.04;
    prob -= (aGS - 1.3) * 0.04;
    prob -= (hGC - 1.2) * 0.04;
    prob += (aGC - 1.2) * 0.04;
    if (homeXG) prob += (homeXG.home_avg_xg || homeXG.avg_xg || 0) * 0.08;
    if (awayXG) prob -= (awayXG.away_avg_xg || awayXG.avg_xg || 0) * 0.08;
    if (eloDiff > 200) prob += 0.10;
    prob = clamp(prob);

    // Poisson lambdas (blend xG when available)
    const baseHL = hGS * 1.1 * (aGC / 1.3);
    const baseAL = aGS * 0.9 * (hGC / 1.3);
    let hL: number, aL: number;
    if (homeXG && awayXG) {
      hL = clamp((homeXG.home_avg_xg || homeXG.avg_xg) * 0.6 + baseHL * 0.4, 0.3, 4.5);
      aL = clamp((awayXG.away_avg_xg || awayXG.avg_xg) * 0.6 + baseAL * 0.4, 0.3, 4.5);
    } else if (homeXG) {
      hL = clamp((homeXG.home_avg_xg || homeXG.avg_xg) * 0.5 + baseHL * 0.5, 0.3, 4.5);
      aL = clamp(baseAL, 0.3, 4.5);
    } else if (awayXG) {
      hL = clamp(baseHL, 0.3, 4.5);
      aL = clamp((awayXG.away_avg_xg || awayXG.avg_xg) * 0.5 + baseAL * 0.5, 0.3, 4.5);
    } else {
      hL = clamp(baseHL * (1 + eloDiff * 0.0004), 0.3, 4.5);
      aL = clamp(baseAL * (1 - eloDiff * 0.0004), 0.3, 4.5);
    }
    const grid = poissonGoals(hL, aL);
    const markets = computeMarkets(grid);

    // Find best market
    let bestMk = "OU_Over_0.5";
    let bestPr = 0;
    for (const [mk, pr] of Object.entries(markets)) {
      if (pr > bestPr) { bestPr = pr; bestMk = mk; }
    }

    // Store predictions
    for (const [mk, pr] of Object.entries(markets)) {
      predictions.push({
        fixture_id: fixture.id,
        market: mk.split("_")[0],
        selection: mk.split("_").slice(1).join("_"),
        model_probability: Math.round(pr * 10000) / 10000,
        model_version: homeXG || awayXG ? "v5.1-xg-cron" : "v5.1-cron",
      });
    }
  }

  // Batch insert
  for (let i = 0; i < predictions.length; i += 50) {
    await supabaseAdmin.from("predictions").insert(predictions.slice(i, i + 50));
  }

  const duration = Date.now() - startTime;
  console.log(`[PREDICT] Generated ${predictions.length} predictions in ${duration}ms`);

  return {
    success: true,
    duration: `${duration}ms`,
    results: { total: fixtures.length, predictions: predictions.length },
    timestamp: new Date().toISOString(),
  };
}

/**
 * GET /api/v1/cron/predict
 *
 * Called by Vercel Cron Jobs (daily at 08:00 UTC).
 * Generates NVIDIA predictions for all scheduled fixtures.
 */
export async function GET(request: NextRequest) {
  try {
    if (isAuthorizedCron(request)) {
      const authHeader = request.headers.get("authorization");
      const cronSecret = process.env.VERCEL_CRON_SECRET;

      if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        console.log("[CRON] Starting prediction pipeline...");
        const result = await runPredictionPipeline();
        console.log(`[CRON] Prediction pipeline completed in ${result.duration}`);
        return NextResponse.json(result);
      }
    }

    // Status check
    return NextResponse.json({
      status: "ready",
      schedule: "Daily at 08:00 UTC (0 8 * * *)",
      description: "Generates NVIDIA AI predictions for all scheduled fixtures",
      endpoints: {
        POST: "Manually trigger prediction generation",
      },
    });
  } catch (error) {
    console.error("[CRON] Prediction pipeline error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/cron/predict
 *
 * Manually trigger prediction generation.
 * Can be called from admin dashboard.
 */
export async function POST(request: NextRequest) {
  try {
    console.log("[MANUAL] Prediction pipeline triggered");
    const result = await runPredictionPipeline();
    console.log(`[MANUAL] Prediction pipeline completed in ${result.duration}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[MANUAL] Prediction pipeline error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
