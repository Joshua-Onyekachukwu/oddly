import { NextRequest, NextResponse } from "next/server";
import { generateTodayPredictions, generateCrownJewel } from "@/lib/nvidia/prediction-engine";
import { notifyCrownJewel } from "@/lib/notifications";

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

  // Step 1: Generate predictions for all scheduled fixtures
  console.log("[PREDICT] Generating predictions for today's fixtures...");
  const predictions = await generateTodayPredictions();
  results.predictions = predictions;
  console.log(`[PREDICT] ${predictions.success}/${predictions.total} predictions generated`);

  // Step 2: Select Crown Jewel
  if (predictions.success > 0) {
    console.log("[PREDICT] Selecting Crown Jewel pick...");
    const crownJewel = await generateCrownJewel();
    results.crownJewel = crownJewel;

    if (crownJewel.success && crownJewel.selection) {
      console.log(`[PREDICT] Crown Jewel: ${crownJewel.selection.reasoning}`);

      // Step 3: Notify users about Crown Jewel
      try {
        const notified = await notifyCrownJewel(
          {
            homeTeam: crownJewel.selection.reasoning.split(" vs ")[0]?.split(": ").pop() || "Home",
            awayTeam: crownJewel.selection.reasoning.split(" vs ")[1]?.split(" (")[0] || "Away",
            league: crownJewel.selection.reasoning.split("(")[1]?.split(")")[0] || "Unknown",
          },
          {
            market: crownJewel.selection.market,
            selection: crownJewel.selection.selection,
            edge: crownJewel.selection.edge,
            confidence: crownJewel.selection.confidence,
          }
        );
        results.notifications = { crownJewel: notified };
        console.log(`[PREDICT] Crown Jewel notification sent to ${notified} users`);
      } catch (err) {
        console.error("[PREDICT] Failed to send Crown Jewel notification:", err);
      }
    } else {
      console.log(`[PREDICT] No Crown Jewel: ${crownJewel.error}`);
    }
  }

  const duration = Date.now() - startTime;

  return {
    success: true,
    duration: `${duration}ms`,
    results,
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
