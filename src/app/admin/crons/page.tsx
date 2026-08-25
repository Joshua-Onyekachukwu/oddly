"use client";

import React, { useState, useEffect } from "react";

/* ─── Types ──────────────────────────────────────────────── */

interface CronJob {
  name: string;
  description: string;
  schedule: string;
  scheduleHuman: string;
  owner: string;
  lastRun: string | null;
  lastCompleted: string | null;
  lastStatus: string;
  durationMs: number | null;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  predictionsGenerated: number;
  predictionsSettled: number;
  apiCalls: number;
  errorCount: number;
  errorMessage: string | null;
  consecutiveFailures: number;
  recentFailures24h: number;
  isOverdue: boolean;
  metadata: Record<string, any> | null;
}

interface CronData {
  jobs: CronJob[];
  summary: {
    totalJobs: number;
    totalRuns: number;
    successfulRuns: number;
    failedRuns24h: number;
    jobsOverdue: number;
    jobsFailing: number;
  };
  timestamp: string;
}

/* ─── Helpers ────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    SUCCESS: "bg-green-100 text-green-700",
    RUNNING: "bg-blue-100 text-blue-700",
    FAILED: "bg-red-100 text-red-700",
    WARNING: "bg-amber-100 text-amber-700",
    SKIPPED: "bg-gray-100 text-gray-500",
    NEVER_RUN: "bg-gray-100 text-gray-400",
  };
  const icons: Record<string, string> = {
    SUCCESS: "✓",
    RUNNING: "↻",
    FAILED: "✗",
    WARNING: "⚠",
    SKIPPED: "—",
    NEVER_RUN: "?",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${colors[status] || colors.NEVER_RUN}`}
    >
      {icons[status] || "?"} {status.replace("_", " ")}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon,
  color = "bg-blue-50 text-blue-600",
}: {
  label: string;
  value: string | number;
  icon: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-[14px] border border-gray-100 p-[16px]">
      <div className="flex items-center gap-[10px] mb-[8px]">
        <div
          className={`w-[32px] h-[32px] rounded-[10px] flex items-center justify-center ${color}`}
        >
          <i className={`${icon} text-[16px]`} />
        </div>
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="text-[28px] font-bold font-mono tabular-nums text-[#0A0F1C] leading-none">
        {value}
      </div>
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/* ─── Page ───────────────────────────────────────────────── */

export default function CronsPage() {
  const [data, setData] = useState<CronData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  async function fetchData() {
    try {
      const res = await fetch("/api/v1/admin/crons");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-gray-100 rounded" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-[14px]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C]">
            Cron Jobs
          </h1>
          <p className="text-[13px] text-gray-500 mt-1">
            Execution status for all scheduled jobs • Auto-refreshes every 30s
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-3 py-1.5 text-[12px] font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          <i className="ri-refresh-line mr-1" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">
          Error loading cron data: {error}
        </div>
      )}

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-[12px]">
          <StatCard
            label="Total Jobs"
            value={data.summary.totalJobs}
            icon="ri-timer-line"
            color="bg-blue-50 text-blue-600"
          />
          <StatCard
            label="Total Runs"
            value={data.summary.totalRuns}
            icon="ri-play-circle-line"
            color="bg-green-50 text-green-600"
          />
          <StatCard
            label="Successful"
            value={data.summary.successfulRuns}
            icon="ri-check-line"
            color="bg-green-50 text-green-600"
          />
          <StatCard
            label="Failed (24h)"
            value={data.summary.failedRuns24h}
            icon="ri-error-warning-line"
            color={
              data.summary.failedRuns24h > 0
                ? "bg-red-50 text-red-600"
                : "bg-gray-50 text-gray-400"
            }
          />
          <StatCard
            label="Overdue"
            value={data.summary.jobsOverdue}
            icon="ri-alarm-warning-line"
            color={
              data.summary.jobsOverdue > 0
                ? "bg-amber-50 text-amber-600"
                : "bg-gray-50 text-gray-400"
            }
          />
          <StatCard
            label="Failing"
            value={data.summary.jobsFailing}
            icon="ri-close-circle-line"
            color={
              data.summary.jobsFailing > 0
                ? "bg-red-50 text-red-600"
                : "bg-gray-50 text-gray-400"
            }
          />
        </div>
      )}

      {/* Job Cards */}
      {data?.jobs.map((job) => (
        <div
          key={job.name}
          className={`bg-white rounded-[14px] border p-[20px] ${
            job.lastStatus === "FAILED"
              ? "border-red-200"
              : job.isOverdue
                ? "border-amber-200"
                : "border-gray-100"
          }`}
        >
          {/* Job Header */}
          <div className="flex items-start justify-between mb-[16px]">
            <div className="flex-1">
              <div className="flex items-center gap-[10px] mb-[4px]">
                <h3 className="font-display text-[16px] font-bold text-[#0A0F1C]">
                  {job.name}
                </h3>
                <StatusBadge status={job.lastStatus} />
                {job.isOverdue && (
                  <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    OVERDUE
                  </span>
                )}
                {job.consecutiveFailures >= 3 && (
                  <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                    {job.consecutiveFailures} FAILURES
                  </span>
                )}
              </div>
              <p className="text-[12px] text-gray-500">{job.description}</p>
            </div>
            <div className="text-right text-[11px] text-gray-400">
              <div>{job.scheduleHuman}</div>
              <div className="font-mono">{job.schedule}</div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-8 gap-[12px]">
            <MetricItem
              label="Last Run"
              value={formatTime(job.lastRun)}
              icon="ri-time-line"
            />
            <MetricItem
              label="Duration"
              value={formatDuration(job.durationMs)}
              icon="ri-speed-line"
            />
            <MetricItem
              label="Processed"
              value={job.recordsProcessed.toLocaleString()}
              icon="ri-database-2-line"
            />
            <MetricItem
              label="Created"
              value={job.recordsCreated.toLocaleString()}
              icon="ri-add-circle-line"
            />
            <MetricItem
              label="Predictions"
              value={job.predictionsGenerated.toLocaleString()}
              icon="ri-crosshair-2-line"
            />
            <MetricItem
              label="Settled"
              value={job.predictionsSettled.toLocaleString()}
              icon="ri-checkbox-circle-line"
            />
            <MetricItem
              label="API Calls"
              value={job.apiCalls.toLocaleString()}
              icon="ri-plug-line"
            />
            <MetricItem
              label="Errors"
              value={job.errorCount.toLocaleString()}
              icon="ri-error-warning-line"
              danger={job.errorCount > 0}
            />
          </div>

          {/* Error Message */}
          {job.errorMessage && (
            <div className="mt-[12px] p-[10px] bg-red-50 rounded-[8px] text-[11px] text-red-600 font-mono">
              {job.errorMessage.slice(0, 200)}
            </div>
          )}
        </div>
      ))}

      {/* Footer */}
      {data && (
        <div className="text-center text-[11px] text-gray-400 py-4">
          Last updated: {new Date(data.timestamp).toLocaleTimeString()} •{" "}
          {data.summary.totalRuns} total executions tracked
        </div>
      )}
    </div>
  );
}

function MetricItem({
  label,
  value,
  icon,
  danger = false,
}: {
  label: string;
  value: string;
  icon: string;
  danger?: boolean;
}) {
  return (
    <div className="text-center">
      <i className={`${icon} text-[14px] ${danger ? "text-red-400" : "text-gray-300"} mb-1 block`} />
      <div
        className={`text-[14px] font-bold font-mono tabular-nums ${danger ? "text-red-600" : "text-[#0A0F1C]"}`}
      >
        {value}
      </div>
      <div className="text-[10px] text-gray-400 uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}
