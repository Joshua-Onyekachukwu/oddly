/**
 * GET /api/v1/admin/crons
 *
 * Returns cron execution status for the /admin/crons dashboard.
 * Shows all registered cron jobs with their last run status.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/api/utils";

export const dynamic = "force-dynamic";

// Registered cron jobs with expected schedules
const REGISTERED_JOBS = [
  {
    name: "pipeline",
    description: "Main orchestrator — settlement, predictions, CLV, pre-match, final pick",
    schedule: "*/30 * * * *",
    scheduleHuman: "Every 30 minutes",
    owner: "pipeline",
  },
  {
    name: "settle",
    description: "Catches finished fixtures for prediction settlement",
    schedule: "0 * * * *",
    scheduleHuman: "Every hour",
    owner: "settle",
  },
  {
    name: "predict",
    description: "Generates new predictions for upcoming matches",
    schedule: "0 */2 * * *",
    scheduleHuman: "Every 2 hours",
    owner: "predict",
  },
  {
    name: "sync",
    description: "Fetches fixtures and odds from external APIs",
    schedule: "0 */6 * * *",
    scheduleHuman: "Every 6 hours",
    owner: "sync",
  },
  {
    name: "daily",
    description: "Daily housekeeping and reporting",
    schedule: "0 6 * * *",
    scheduleHuman: "Daily at 6am",
    owner: "daily",
  },
  {
    name: "learn",
    description: "Weekly model learning + analytics view refresh",
    schedule: "0 3 * * 0",
    scheduleHuman: "Weekly Sunday 3am",
    owner: "learn",
  },
];

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireAdmin(request);

    // Use service_role for cron_runs (table not in public schema types)
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    );

    // Get latest runs per job
    const { data: latestRuns } = await (serviceClient as any)
      .from("cron_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(100);

    // Get failure counts in last 24h
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentFailures } = await (serviceClient as any)
      .from("cron_runs")
      .select("job_name, status")
      .gte("started_at", oneDayAgo)
      .eq("status", "FAILED");

    // Build status map: latest run per job
    const latestByJob: Record<string, any> = {};
    for (const run of latestRuns || []) {
      if (!latestByJob[run.job_name]) {
        latestByJob[run.job_name] = run;
      }
    }

    // Count consecutive failures per job
    const consecutiveFailures: Record<string, number> = {};
    for (const job of REGISTERED_JOBS) {
      const jobRuns = (latestRuns || []).filter((r: any) => r.job_name === job.name);
      let failures = 0;
      for (const run of jobRuns) {
        if (run.status === "FAILED") failures++;
        else break;
      }
      consecutiveFailures[job.name] = failures;
    }

    // Build response
    const jobs = REGISTERED_JOBS.map((job) => {
      const latest = latestByJob[job.name];
      const failureCount = (recentFailures || []).filter(
        (f: any) => f.job_name === job.name
      ).length;

      // Determine if job is overdue
      let isOverdue = false;
      if (latest && latest.completed_at) {
        const lastRun = new Date(latest.completed_at).getTime();
        const now = Date.now();
        // Parse schedule to determine expected interval
        const intervalMs = parseScheduleToMs(job.schedule);
        if (intervalMs && now - lastRun > intervalMs * 1.5) {
          isOverdue = true;
        }
      } else if (!latest) {
        isOverdue = true; // Never run
      }

      return {
        ...job,
        lastRun: latest?.started_at || null,
        lastCompleted: latest?.completed_at || null,
        lastStatus: latest?.status || "NEVER_RUN",
        durationMs: latest?.duration_ms || null,
        recordsProcessed: latest?.records_processed || 0,
        recordsCreated: latest?.records_created || 0,
        recordsUpdated: latest?.records_updated || 0,
        predictionsGenerated: latest?.predictions_generated || 0,
        predictionsSettled: latest?.predictions_settled || 0,
        apiCalls: latest?.api_calls || 0,
        errorCount: latest?.error_count || 0,
        errorMessage: latest?.error_message || null,
        consecutiveFailures: consecutiveFailures[job.name] || 0,
        recentFailures24h: failureCount,
        isOverdue,
        metadata: latest?.metadata || null,
      };
    });

    // Summary stats
    const totalRuns = latestRuns?.length || 0;
    const successfulRuns = (latestRuns || []).filter(
      (r: any) => r.status === "SUCCESS"
    ).length;
    const failedRuns = (recentFailures || []).length;

    return NextResponse.json({
      jobs,
      summary: {
        totalJobs: REGISTERED_JOBS.length,
        totalRuns,
        successfulRuns: successfulRuns,
        failedRuns24h: failedRuns,
        jobsOverdue: jobs.filter((j) => j.isOverdue).length,
        jobsFailing: jobs.filter((j) => j.consecutiveFailures >= 3).length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("GET /api/v1/admin/crons error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function parseScheduleToMs(schedule: string): number | null {
  // Simple parser for common cron schedules
  const parts = schedule.split(" ");
  if (parts.length !== 5) return null;

  const [min, hour, , , dow] = parts;

  // */30 * * * * = 30 minutes
  if (min.startsWith("*/")) return parseInt(min.slice(2)) * 60 * 1000;
  // 0 * * * * = 1 hour
  if (min === "0" && hour === "*") return 60 * 60 * 1000;
  // 0 */2 * * * = 2 hours
  if (min === "0" && hour.startsWith("*/"))
    return parseInt(hour.slice(2)) * 60 * 60 * 1000;
  // 0 */6 * * * = 6 hours
  if (min === "0" && hour.startsWith("*/"))
    return parseInt(hour.slice(2)) * 60 * 60 * 1000;
  // 0 6 * * * = 24 hours (daily)
  if (min !== "*" && hour !== "*" && dow === "*") return 24 * 60 * 60 * 1000;
  // 0 3 * * 0 = 7 days (weekly)
  if (dow !== "*") return 7 * 24 * 60 * 60 * 1000;

  return null;
}
