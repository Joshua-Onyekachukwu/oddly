/**
 * GET /api/v1/cron/validate
 *
 * Daily walk-forward validation cron job.
 * Runs validation metrics and stores results for trend analysis.
 *
 * Schedule: Daily at 2am (vercel.json)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { withLock } from "@/lib/cron/lock";
import { startRun, completeRun, type CronRunResult } from "@/lib/cron/logger";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

/* ── Auth ─────────────────────────────────────────────────── */

function isAuthorizedCron(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;
  if (!cronSecret) {
    console.error("[VALIDATE] CRITICAL: VERCEL_CRON_SECRET not set");
    return false;
  }
  return authHeader === `Bearer ${cronSecret}`;
}

/* ── Validation Logic ─────────────────────────────────────── */

interface ValidationMetrics {
  accuracy: number;
  balancedAccuracy: number;
  logLoss: number;
  brierScore: number;
  sampleSize: number;
  perClass: {
    home: { precision: number; recall: number; f1: number };
    draw: { precision: number; recall: number; f1: number };
    away: { precision: number; recall: number; f1: number };
  };
}

function calculateMetrics(preds: any[]): ValidationMetrics {
  let correct = 0;
  const total = preds.length;
  
  const classMetrics = {
    home: { tp: 0, fp: 0, fn: 0 },
    draw: { tp: 0, fp: 0, fn: 0 },
    away: { tp: 0, fp: 0, fn: 0 },
  };
  
  let logLoss = 0;
  let brierScore = 0;
  
  for (const pred of preds) {
    const selection = (pred.selection || "").toLowerCase();
    const result = (pred.result || "").toLowerCase();
    
    if (selection === result) {
      correct++;
      classMetrics[result as keyof typeof classMetrics].tp++;
    } else {
      classMetrics[selection as keyof typeof classMetrics].fp++;
      classMetrics[result as keyof typeof classMetrics].fn++;
    }
    
    const prob = pred.model_probability || 0.5;
    const actualProb = selection === result ? 1 : 0;
    
    logLoss -= actualProb * Math.log(prob + 1e-10) + (1 - actualProb) * Math.log(1 - prob + 1e-10);
    brierScore += Math.pow(prob - actualProb, 2);
  }
  
  const accuracy = total > 0 ? correct / total : 0;
  logLoss = total > 0 ? logLoss / total : 0;
  brierScore = total > 0 ? brierScore / total : 0;
  
  const perClass: any = {};
  for (const [cls, metrics] of Object.entries(classMetrics)) {
    const precision = metrics.tp + metrics.fp > 0 ? metrics.tp / (metrics.tp + metrics.fp) : 0;
    const recall = metrics.tp + metrics.fn > 0 ? metrics.tp / (metrics.tp + metrics.fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    perClass[cls] = { precision, recall, f1 };
  }
  
  const perClassValues = Object.values(perClass) as Array<{ precision: number; recall: number; f1: number }>;
  const balancedAccuracy = perClassValues.reduce((sum, m) => sum + m.recall, 0) / 3;
  
  return {
    accuracy,
    balancedAccuracy,
    logLoss,
    brierScore,
    sampleSize: total,
    perClass,
  };
}

async function runValidation() {
  const now = new Date();
  console.log(`[VALIDATE] Starting validation at ${now.toISOString()}`);

  // Get baseline predictions (1X2 market)
  const { data: baselinePreds, error: baselineError } = await supabaseAdmin
    .from("predictions")
    .select("selection, model_probability, result, fixture_id, created_at")
    .eq("market", "1X2")
    .not("result", "is", null)
    .limit(5000);

  if (baselineError) {
    console.error("[VALIDATE] Error fetching baseline predictions:", baselineError);
    throw new Error(`Failed to fetch baseline predictions: ${baselineError.message}`);
  }

  if (!baselinePreds?.length) {
    console.log("[VALIDATE] No settled predictions found");
    return { success: true, message: "No settled predictions to validate" };
  }

  // Calculate baseline metrics
  const baselineMetrics = calculateMetrics(baselinePreds);
  console.log(`[VALIDATE] Baseline: ${baselinePreds.length} predictions, accuracy: ${(baselineMetrics.accuracy * 100).toFixed(1)}%`);

  // Get predictions with injury features
  const { data: injuryPreds } = await supabaseAdmin
    .from("predictions")
    .select("selection, model_probability, result, fixture_id, injury_features_used")
    .eq("market", "1X2")
    .not("result", "is", null)
    .not("injury_features_used", "is", null)
    .limit(5000);

  let injuryMetrics: ValidationMetrics | null = null;
  if (injuryPreds?.length) {
    injuryMetrics = calculateMetrics(injuryPreds);
    console.log(`[VALIDATE] Injury-enhanced: ${injuryPreds.length} predictions, accuracy: ${(injuryMetrics.accuracy * 100).toFixed(1)}%`);
  }

  // Calculate improvement
  let improvement = null;
  if (injuryMetrics) {
    improvement = {
      accuracy: injuryMetrics.accuracy - baselineMetrics.accuracy,
      balancedAccuracy: injuryMetrics.balancedAccuracy - baselineMetrics.balancedAccuracy,
      logLoss: injuryMetrics.logLoss - baselineMetrics.logLoss,
      brierScore: injuryMetrics.brierScore - baselineMetrics.brierScore,
    };
  }

  // Get accuracy by market
  const { data: marketData } = await supabaseAdmin
    .from("predictions")
    .select("market, result")
    .not("result", "is", null)
    .limit(10000);

  const accuracyByMarket: Record<string, { correct: number; total: number; accuracy: number }> = {};
  
  if (marketData) {
    for (const pred of marketData) {
      const market = pred.market || "unknown";
      if (!accuracyByMarket[market]) {
        accuracyByMarket[market] = { correct: 0, total: 0, accuracy: 0 };
      }
      accuracyByMarket[market].total++;
      if (pred.result === "correct") {
        accuracyByMarket[market].correct++;
      }
    }
    
    for (const market of Object.keys(accuracyByMarket)) {
      const { correct, total } = accuracyByMarket[market];
      accuracyByMarket[market].accuracy = total > 0 ? correct / total : 0;
    }
  }

  // Store validation results
  const validationResult = {
    timestamp: now.toISOString(),
    baseline: baselineMetrics,
    withInjuries: injuryMetrics,
    improvement,
    accuracyByMarket,
  };

  // Save to database (validation_results table — may not exist yet)
  try {
    const { error: insertError } = await supabaseAdmin
      .from("validation_results" as any)
      .upsert({
        validation_date: now.toISOString().split("T")[0],
        model_version: "v2.0-meta-ensemble",
        baseline_accuracy: baselineMetrics.accuracy,
        baseline_balanced_accuracy: baselineMetrics.balancedAccuracy,
        baseline_log_loss: baselineMetrics.logLoss,
        baseline_brier_score: baselineMetrics.brierScore,
        baseline_sample_size: baselineMetrics.sampleSize,
        injury_accuracy: injuryMetrics?.accuracy || null,
        injury_balanced_accuracy: injuryMetrics?.balancedAccuracy || null,
        injury_log_loss: injuryMetrics?.logLoss || null,
        injury_brier_score: injuryMetrics?.brierScore || null,
        injury_sample_size: injuryMetrics?.sampleSize || null,
        improvement_accuracy: improvement?.accuracy || null,
        improvement_balanced_accuracy: improvement?.balancedAccuracy || null,
        improvement_log_loss: improvement?.logLoss || null,
        improvement_brier_score: improvement?.brierScore || null,
        metrics_json: validationResult,
      }, { onConflict: "validation_date,model_version" });

    if (insertError) {
      console.error("[VALIDATE] Storage error (non-fatal):", insertError.message);
    } else {
      console.log("[VALIDATE] Results stored successfully");
    }
  } catch (storageErr) {
    console.error("[VALIDATE] Table may not exist yet, skipping storage:", (storageErr as Error).message);
  }

  return {
    success: true,
    baseline: {
      accuracy: baselineMetrics.accuracy,
      sampleSize: baselineMetrics.sampleSize,
    },
    injury: injuryMetrics ? {
      accuracy: injuryMetrics.accuracy,
      sampleSize: injuryMetrics.sampleSize,
    } : null,
    improvement: improvement ? {
      accuracy: improvement.accuracy,
    } : null,
  };
}

/* ── Main Handler ─────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCron(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const executionId = await startRun("validate", "cron");
    const lockResult = await withLock("validate", runValidation, { leaseSeconds: 300 });

    if (!lockResult.acquired) {
      await completeRun(executionId, { status: "SKIPPED", errorMessage: lockResult.error });
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      await completeRun(executionId, {
        status: "FAILED",
        errorMessage: lockResult.error,
        durationMs: lockResult.durationMs,
      });
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result as any;
    const cronResult: CronRunResult = {
      status: "SUCCESS",
      recordsProcessed: result?.baseline?.sampleSize || 0,
      metadata: {
        baselineAccuracy: result?.baseline?.accuracy,
        injuryAccuracy: result?.injury?.accuracy,
        improvement: result?.improvement?.accuracy,
      },
    };

    await completeRun(executionId, cronResult);

    return NextResponse.json({
      success: true,
      duration: `${lockResult.durationMs}ms`,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[VALIDATE] Fatal error:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}

/** POST — manual trigger from admin dashboard */
export async function POST(request: NextRequest) {
  try {
    const { requireAdmin } = await import("@/lib/api/utils");
    await requireAdmin(request);

    console.log("[MANUAL] Validation triggered from admin");
    const lockResult = await withLock("validate", runValidation, { leaseSeconds: 300 });

    if (!lockResult.acquired) {
      return NextResponse.json({ success: true, skipped: true, reason: lockResult.error });
    }

    if (lockResult.error) {
      return NextResponse.json({ error: lockResult.error }, { status: 500 });
    }

    const result = lockResult.result as any;
    return NextResponse.json({
      success: true,
      duration: `${lockResult.durationMs}ms`,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[MANUAL] Validation error:", error);
    return NextResponse.json({ error: "Validation failed" }, { status: 500 });
  }
}
