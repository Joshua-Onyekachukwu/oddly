import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { predictMatchEnsemble, checkPrediction } from "@/lib/models/ensemble";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) {
    console.error("[CRON] CRITICAL: VERCEL_CRON_SECRET not set");
    return false;
  }
  return authHeader === `Bearer ${cronSecret}`;
}

// ── POST /api/v1/cron/settle ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startTime = Date.now();
    console.log("[SETTLE] Starting prediction settlement with ensemble model...");

    // Load finished fixtures from last 7 days (not yet settled)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: fixtures, error: fixErr } = await supabaseAdmin
      .from("fixtures")
      .select(
        `id, home_team_id, away_team_id, league_id, kickoff_time,
         home_score, away_score, status,
         home_team:teams!fixtures_home_team_id_fkey(id, canonical_name),
         away_team:teams!fixtures_away_team_id_fkey(id, canonical_name)`
      )
      .eq("status", "finished")
      .not("home_score", "is", null)
      .gte("kickoff_time", sevenDaysAgo)
      .order("kickoff_time", { ascending: false })
      .limit(500);

    if (fixErr || !fixtures) {
      return NextResponse.json(
        { error: "Failed to load fixtures", detail: fixErr?.message },
        { status: 500 }
      );
    }

    console.log(`[SETTLE] Processing ${fixtures.length} finished fixtures...`);

    // Load existing predictions
    const fixtureIds = fixtures.map((f) => f.id);
    const { data: existingPreds } = await supabaseAdmin
      .from("predictions")
      .select("id, fixture_id, market, selection, model_probability, result")
      .in("fixture_id", fixtureIds);

    // Group predictions by fixture (only pending ones)
    const predByFixture: Record<
      string,
      Array<{
        id: string;
        market: string;
        selection: string;
        model_probability: number;
        result: string | null;
      }>
    > = {};
    for (const p of existingPreds || []) {
      if (!predByFixture[p.fixture_id]) predByFixture[p.fixture_id] = [];
      predByFixture[p.fixture_id].push(p);
    }

    // Pre-build Elo and form maps from these fixtures (shared across all predictions)
    const eloMap: Record<string, number> = {};
    const formMap: Record<string, Array<{ gf: number; ga: number; isHome: boolean }>> = {};
    const sortedFixtures = [...fixtures].sort(
      (a, b) => (a.kickoff_time || "").localeCompare(b.kickoff_time || "")
    );
    for (const f of sortedFixtures) {
      const hs = (f.home_team as any)?.canonical_name || "Home";
      const as = (f.away_team as any)?.canonical_name || "Away";
      const hg = f.home_score || 0;
      const ag = f.away_score || 0;

      // Elo update
      const h = (eloMap[hs] || 1500) + 65;
      const a = eloMap[as] || 1500;
      const eH = 1 / (1 + Math.pow(10, (a - h) / 400));
      const actual = hg > ag ? 1 : hg < ag ? 0 : 0.5;
      eloMap[hs] = (eloMap[hs] || 1500) + 32 * (actual - eH);
      eloMap[as] = (eloMap[as] || 1500) + 32 * (1 - actual - (1 - eH));

      // Form history
      if (!formMap[hs]) formMap[hs] = [];
      if (!formMap[as]) formMap[as] = [];
      formMap[hs].push({ gf: hg, ga: ag, isHome: true });
      formMap[as].push({ gf: ag, ga: hg, isHome: false });
      if (formMap[hs].length > 15) formMap[hs].shift();
      if (formMap[as].length > 15) formMap[as].shift();
    }

    let settled = 0;
    let correct = 0;
    let incorrect = 0;
    let ensembleHits = 0;
    let ensembleMisses = 0;

    // Settle each prediction using ensemble model
    for (const fixture of fixtures) {
      const preds = predByFixture[fixture.id] || [];
      if (preds.length === 0) continue;

      const hs = (fixture.home_team as any)?.canonical_name || "Home";
      const as = (fixture.away_team as any)?.canonical_name || "Away";
      const homeScore = fixture.home_score || 0;
      const awayScore = fixture.away_score || 0;

      // Run ensemble prediction for this match
      const ensemblePred = await predictMatchEnsemble(
        hs,
        as,
        fixture.league_id || undefined,
        eloMap,
        formMap as any
      );

      const pred: Record<string, any> = { ...(ensemblePred?.markets || {}) };
      if (ensemblePred) ensembleHits++;
      else ensembleMisses++;

      // Build smart selection from ensemble best pick
      if (ensemblePred?.bestPick) {
        const bp = ensemblePred.bestPick;
        const smartMarket = bp.market.startsWith("1X2")
          ? "1X2"
          : bp.market.startsWith("OU")
            ? bp.market.replace(/_\d+\.?\d*$/, "").toLowerCase()
            : bp.market.startsWith("DC")
              ? "double_chance"
              : bp.market.startsWith("BTTS")
                ? "btts"
                : bp.market;
        const smartSelection = bp.market
          .replace("1X2_", "")
          .replace("OU_", "")
          .replace("DC_", "")
          .replace("BTTS_", "")
          .toLowerCase();
        pred["smart_selection"] = {
          market: smartMarket,
          selection: smartSelection,
          probability: bp.probability,
        };
      }

      for (const p of preds) {
        if (p.result && p.result !== "pending") continue;
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
          .eq("result", "pending");
      }
    }

    // Archive settled predictions to Convex (non-blocking)
    let archived = 0;
    if (settled > 0 && process.env.CONVEX_URL) {
      try {
        const origin =
          process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : "http://localhost:3000";
        const archiveRes = await fetch(`${origin}/api/v1/cron/archive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: Math.min(settled * 2, 500) }),
        });
        if (archiveRes.ok) {
          const archiveData = await archiveRes.json();
          archived = archiveData.archived || 0;
          console.log(`[SETTLE] Archived ${archived} predictions to Convex`);
        }
      } catch (archiveErr) {
        console.error("[SETTLE] Archive warning (non-blocking):", archiveErr);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[SETTLE] Done: ${settled} settled, ${correct} correct, ${incorrect} incorrect ` +
        `(${ensembleHits} ensemble, ${ensembleMisses} fallback) (${duration}ms)`
    );

    return NextResponse.json({
      success: true,
      model: "meta-ensemble-v2.0",
      settled,
      correct,
      incorrect,
      accuracy: settled > 0 ? ((correct / settled) * 100).toFixed(1) + "%" : "N/A",
      ensembleHits,
      ensembleMisses,
      fixturesProcessed: fixtures.length,
      archived,
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
    model: "meta-ensemble-v2.0",
    description: "Settles predictions against actual match results using ensemble model",
  });
}
