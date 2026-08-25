import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) { console.error('[CRON] CRITICAL: VERCEL_CRON_SECRET not set — cron auth disabled'); return false; }
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * POST /api/v1/cron/learn
 *
 * Continuous learning step:
 * 1. Compute accuracy metrics from settled predictions
 * 2. Update model calibration data
 * 3. Record performance snapshots
 * 4. Log learning outcomes for the training pipeline
 */
export async function POST(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const startTime = Date.now();
    console.log("[LEARN] Starting learning cycle...");

    // 1. Compute accuracy by market (use materialized view if available)
    let settledPreds: any[] = [];
    try {
      const { data: mv } = await supabaseAdmin.from("mv_market_accuracy").select("*");
      if (mv && mv.length > 0) {
        // Use materialized view — zero disk I/O
        console.log("[LEARN] Using materialized view for market accuracy");
        return NextResponse.json({ success: true, source: "materialized_view", data: mv });
      }
    } catch {}
    // Fallback: indexed query with limit
    const { data: preds } = await supabaseAdmin
      .from("predictions")
      .select("market, selection, model_probability, result, fixture_id")
      .not("result", "is", null)
      .neq("result", "pending")
      .gte("settled_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(20000);
    settledPreds = preds || [];

    if (!settledPreds || settledPreds.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No newly settled predictions to learn from",
        duration: `${Date.now() - startTime}ms`,
      });
    }

    // Group by market
    const marketStats: Record<string, { total: number; correct: number; probabilities: number[] }> = {};
    for (const p of settledPreds) {
      const mkt = p.market || "unknown";
      if (!marketStats[mkt]) marketStats[mkt] = { total: 0, correct: 0, probabilities: [] };
      marketStats[mkt].total++;
      if (p.result === "correct") marketStats[mkt].correct++;
      if (p.model_probability) marketStats[mkt].probabilities.push(p.model_probability);
    }

    // 2. Compute calibration per confidence bucket
    const buckets: Record<string, { predicted: number[]; actual: number[] }> = {};
    for (const p of settledPreds) {
      if (!p.model_probability) continue;
      const bucket = Math.floor(p.model_probability * 10) * 10;
      const key = `${bucket}-${bucket + 10}`;
      if (!buckets[key]) buckets[key] = { predicted: [], actual: [] };
      buckets[key].predicted.push(p.model_probability);
      buckets[key].actual.push(p.result === "correct" ? 1 : 0);
    }

    const calibration = Object.entries(buckets).map(([range, data]) => ({
      range,
      avgPredicted: data.predicted.reduce((a, b) => a + b, 0) / data.predicted.length,
      actualAccuracy: data.actual.reduce((a, b) => a + b, 0) / data.actual.length,
      samples: data.predicted.length,
    }));

    // 3. Overall metrics
    const totalPreds = settledPreds.length;
    const totalCorrect = settledPreds.filter(p => p.result === "correct").length;
    const overallAccuracy = totalCorrect / totalPreds;

    // High-confidence accuracy
    const highConf = settledPreds.filter(p => (p.model_probability || 0) >= 0.7);
    const highConfCorrect = highConf.filter(p => p.result === "correct").length;
    const highConfAccuracy = highConf.length > 0 ? highConfCorrect / highConf.length : 0;

    // Brier score
    const brier = settledPreds.reduce((sum, p) => {
      const prob = p.model_probability || 0.5;
      const actual = p.result === "correct" ? 1 : 0;
      return sum + Math.pow(prob - actual, 2);
    }, 0) / totalPreds;

    // 4. Record performance snapshot
    const snapshot = {
      timestamp: new Date().toISOString(),
      total_predictions: totalPreds,
      correct: totalCorrect,
      overall_accuracy: overallAccuracy,
      high_confidence_accuracy: highConfAccuracy,
      high_confidence_count: highConf.length,
      brier_score: brier,
      calibration: calibration,
      market_breakdown: Object.entries(marketStats).map(([market, stats]) => ({
        market,
        accuracy: stats.correct / stats.total,
        total: stats.total,
        correct: stats.correct,
      })),
    };

    // Store snapshot in a table (if it exists)
    try {
      await supabaseAdmin.from("learning_snapshots").insert({
        snapshot_type: "daily",
        metrics: snapshot,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Table might not exist — that's fine
    }

    // Refresh materialized views for analytics (reduces disk I/O on next query)
    try {
      await supabaseAdmin.rpc("refresh_analytics_views");
      console.log("[LEARN] Refreshed analytics materialized views");
    } catch {}

    const duration = Date.now() - startTime;
    console.log(`[LEARN] Done: ${(overallAccuracy * 100).toFixed(1)}% overall, ${(highConfAccuracy * 100).toFixed(1)}% high-conf (${duration}ms)`);

    return NextResponse.json({
      success: true,
      accuracy: `${(overallAccuracy * 100).toFixed(1)}%`,
      highConfidence: `${(highConfAccuracy * 100).toFixed(1)}%`,
      brier: brier.toFixed(4),
      totalPredictions: totalPreds,
      marketBreakdown: snapshot.market_breakdown,
      calibration: calibration.filter(c => c.samples >= 5),
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[LEARN] Error:", error);
    return NextResponse.json({ error: "Learn failed" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ready",
    endpoint: "POST /api/v1/cron/learn",
    description: "Computes accuracy metrics and records learning snapshots",
  });
}
