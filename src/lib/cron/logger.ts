/**
 * ODDLY Cron Execution Logger
 *
 * Centralized logging for all cron jobs. Every cron route should:
 * 1. Call `startRun(jobName)` at the beginning
 * 2. Call `completeRun(executionId, result)` at the end
 *
 * This provides:
 * - Execution tracking in /admin/crons
 * - Failure alerting
 * - Performance monitoring
 * - Duration tracking
 */

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export interface CronRunResult {
  status: "SUCCESS" | "FAILED" | "WARNING" | "SKIPPED";
  recordsProcessed?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  predictionsGenerated?: number;
  predictionsSettled?: number;
  apiCalls?: number;
  errorCount?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * Start a new cron execution. Returns an execution_id to pass to completeRun.
 */
export async function startRun(
  jobName: string,
  triggeredBy: "cron" | "manual" | "api" = "cron"
): Promise<string> {
  const executionId = `${jobName}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  try {
    await supabaseAdmin.rpc("start_cron_run", {
      p_job_name: jobName,
      p_triggered_by: triggeredBy,
    });
  } catch (err: any) {
    console.error(`[CRON-LOG] Failed to start run for ${jobName}:`, err.message);
  }

  return executionId;
}

/**
 * Complete a cron execution with results.
 */
export async function completeRun(
  executionId: string,
  result: CronRunResult
): Promise<void> {
  try {
    await supabaseAdmin.rpc("complete_cron_run", {
      p_execution_id: executionId,
      p_status: result.status,
      p_records_processed: result.recordsProcessed || 0,
      p_records_created: result.recordsCreated || 0,
      p_records_updated: result.recordsUpdated || 0,
      p_predictions_generated: result.predictionsGenerated || 0,
      p_predictions_settled: result.predictionsSettled || 0,
      p_api_calls: result.apiCalls || 0,
      p_error_count: result.errorCount || 0,
      p_error_message: result.errorMessage || null,
      p_metadata: result.metadata || null,
    });

    // Log to console for Vercel logs
    const icon = result.status === "SUCCESS" ? "✓" : result.status === "FAILED" ? "✗" : "⚠";
    console.log(`[CRON] ${icon} ${executionId}: ${result.status}`);

    // Check for consecutive failures (alerting)
    if (result.status === "FAILED") {
      await checkConsecutiveFailures(executionId);
    }
  } catch (err: any) {
    console.error(`[CRON-LOG] Failed to complete run ${executionId}:`, err.message);
  }
}

/**
 * Check if a job has consecutive failures and log a warning.
 */
async function checkConsecutiveFailures(executionId: string): Promise<void> {
  try {
    const jobName = executionId.split("_").slice(0, -2).join("_");
    const { data } = await supabaseAdmin
      .from("cron_runs")
      .select("status")
      .eq("job_name", jobName)
      .order("started_at", { ascending: false })
      .limit(5);

    if (!data) return;

    const consecutiveFailures = data.filter((r) => r.status === "FAILED").length;

    if (consecutiveFailures >= 3) {
      console.error(
        `[CRON-ALERT] ${jobName} has ${consecutiveFailures} consecutive failures!`
      );
    }
  } catch {
    // Non-critical
  }
}

/**
 * Refresh materialized views for cron dashboard.
 */
export async function refreshCronViews(): Promise<void> {
  try {
    await supabaseAdmin.rpc("refresh_cron_views");
  } catch (err: any) {
    console.error("[CRON-LOG] Failed to refresh cron views:", err.message);
  }
}

/**
 * Get the latest run status for a specific job.
 */
export async function getLatestRun(jobName: string) {
  const { data } = await supabaseAdmin
    .from("cron_runs")
    .select("*")
    .eq("job_name", jobName)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  return data;
}

/**
 * Get all cron statuses for the dashboard.
 */
export async function getCronStatuses() {
  const { data } = await supabaseAdmin
    .from("mv_cron_status")
    .select("*")
    .order("job_name");

  return data || [];
}

/**
 * Get cron history for a specific job.
 */
export async function getCronHistory(jobName: string, limit = 50) {
  const { data } = await supabaseAdmin
    .from("cron_runs")
    .select("*")
    .eq("job_name", jobName)
    .order("started_at", { ascending: false })
    .limit(limit);

  return data || [];
}
