"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { ErrorBoundary } from "@/components/ui";

interface SyncStatus {
  lastSync: string | null;
  fixturesToday: number;
  totalFixtures: number;
  totalPredictions: number;
  totalRecommendations: number;
  activeLeagues: number;
  totalNotifications: number;
  unreadNotifications: number;
}

interface AiUsage {
  activeKeys: number;
  todayChatCalls: number;
  todayPredictCalls: number;
}

interface CronJobInfo {
  name: string;
  description: string;
  scheduleHuman: string;
  lastRun: string | null;
  lastStatus: string;
  isOverdue: boolean;
  consecutiveFailures: number;
}

interface SyncResult {
  success: boolean;
  type: string;
  duration: string;
  results: Record<string, unknown>;
  timestamp: string;
}

interface CleanupResult {
  success: boolean;
  results: Array<{ table: string; deleted: number; error?: string }>;
  duration: string;
  totalDeleted: number;
  timestamp: string;
}

interface PipelineStage {
  name: string;
  status: "idle" | "running" | "success" | "error" | "warning";
  icon: string;
  desc: string;
  lastRun: string | null;
  duration: string | null;
}

interface SyncLog {
  id: string;
  type: string;
  status: string;
  duration: string;
  details: string;
  timestamp: string;
}

export default function AdminPipelinePage() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSync: null,
    fixturesToday: 0,
    totalFixtures: 0,
    totalPredictions: 0,
    totalRecommendations: 0,
    activeLeagues: 0,
    totalNotifications: 0,
    unreadNotifications: 0,
  });
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncLog, setSyncLog] = useState<SyncLog[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([
    { name: "Fixture Sync", status: "idle", icon: "ri-calendar-check-line", desc: "Fetches matches from API-Football", lastRun: null, duration: null },
    { name: "Odds Fetch", status: "idle", icon: "ri-bar-chart-box-line", desc: "Pulls live odds from bookmakers", lastRun: null, duration: null },
    { name: "Prediction Engine", status: "idle", icon: "ri-brain-line", desc: "NVIDIA AI generates predictions for fixtures", lastRun: null, duration: null },
    { name: "Value Detection", status: "idle", icon: "ri-search-eye-line", desc: "Scans for edges between model and market", lastRun: null, duration: null },
    { name: "Crown Jewel Selection", status: "idle", icon: "ri-star-line", desc: "Picks the single best bet of the day", lastRun: null, duration: null },
    { name: "Notification Dispatch", status: "idle", icon: "ri-notification-3-line", desc: "Sends alerts for value bets and milestones", lastRun: null, duration: null },
    { name: "Data Cleanup", status: "idle", icon: "ri-delete-bin-line", desc: "Purges old notifications, stale odds, and expired data", lastRun: null, duration: null },
  ]);

  const fetchStatus = useCallback(async () => {
    const supabase = createClient();
    const today = new Date().toISOString().split("T")[0];

    const [
      fixturesToday,
      totalFixtures,
      predictions,
      recommendations,
      leagues,
      lastOdds,
      totalNotifs,
      unreadNotifs,
    ] = await Promise.all([
      supabase.from("fixtures").select("id", { count: "exact", head: true })
        .gte("kickoff_time", `${today}T00:00:00Z`)
        .lte("kickoff_time", `${today}T23:59:59Z`),
      supabase.from("fixtures").select("id", { count: "exact", head: true }),
      supabase.from("predictions").select("id", { count: "exact", head: true }),
      supabase.from("recommendations").select("id", { count: "exact", head: true }).eq("is_recommended", true),
      supabase.from("leagues").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("odds_snapshots").select("snapshot_time").order("snapshot_time", { ascending: false }).limit(1),
      supabase.from("notifications").select("id", { count: "exact", head: true }),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("is_read", false),
    ]);

    setSyncStatus({
      lastSync: lastOdds.data?.[0]?.snapshot_time || null,
      fixturesToday: fixturesToday.count || 0,
      totalFixtures: totalFixtures.count || 0,
      totalPredictions: predictions.count || 0,
      totalRecommendations: recommendations.count || 0,
      activeLeagues: leagues.count || 0,
      totalNotifications: totalNotifs.count || 0,
      unreadNotifications: unreadNotifs.count || 0,
    });

    setLoading(false);
  }, []);

  // Helper: admin Bearer token for protected endpoints
  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token
      ? { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }
      : { "Content-Type": "application/json" };
  }, []);

  // Fetch NVIDIA AI usage stats (real data from ai_cache)
  const fetchAiUsage = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/v1/ai-monitor", { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (data.nvidia && data.cache) {
        setAiUsage({
          activeKeys: data.nvidia.activeKeys ?? 0,
          todayChatCalls: data.cache.todayChatCalls ?? 0,
          todayPredictCalls: data.cache.todayPredictCalls ?? 0,
        });
      }
    } catch {
      // Silent fail — section shows "unavailable"
    }
  }, [getAuthHeaders]);

  // Fetch real cron job status from the admin crons endpoint
  const fetchCronHealth = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/v1/admin/crons", { headers });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.jobs)) {
        setCronJobs(data.jobs.map((j: any) => ({
          name: j.name,
          description: j.description,
          scheduleHuman: j.scheduleHuman,
          lastRun: j.lastRun,
          lastStatus: j.lastStatus,
          isOverdue: j.isOverdue,
          consecutiveFailures: j.consecutiveFailures,
        })));
      }
    } catch {
      // Silent fail
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchStatus();
    fetchAiUsage();
    fetchCronHealth();
  }, [fetchStatus, fetchAiUsage, fetchCronHealth]);

  // Add log entry
  const addLog = (type: string, status: string, duration: string, details: string) => {
    setSyncLog((prev) => [
      {
        id: Date.now().toString(),
        type,
        status,
        duration,
        details,
        timestamp: new Date().toISOString(),
      },
      ...prev.slice(0, 19),
    ]);
  };

  // Manual prediction trigger
  const triggerPredictions = async () => {
    setSyncing("predict");
    const now = new Date().toISOString();

    setStages((prev) =>
      prev.map((s) => ({
        ...s,
        status: s.name === "Prediction Engine" ? "running" as const : s.status,
      }))
    );

    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/v1/cron/predict", {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const duration = data.duration || `${Date.now() - new Date(now).getTime()}ms`;
      const predicted = data.results?.predictions ?? 0;

      setStages((prev) =>
        prev.map((s) => {
          if (s.name === "Prediction Engine") {
            return {
              ...s,
              status: predicted > 0 || data.skipped ? "success" : "warning",
              lastRun: now,
              duration,
            };
          }
          return s;
        })
      );

      addLog(
        "Predictions",
        "success",
        duration,
        data.skipped
          ? `Skipped — another run holds the lock (${data.reason || "in progress"})`
          : `Generated ${predicted} predictions for today's fixtures`,
      );
      await fetchStatus();
      await fetchCronHealth();
    } catch (e) {
      setStages((prev) =>
        prev.map((s) => ({
          ...s,
          status: s.status === "running" ? "error" : s.status,
        }))
      );
      addLog("Predictions", "error", "0ms", e instanceof Error ? e.message : "Failed to run predictions");
    }

    setSyncing(null);
  };

  // Manual cleanup trigger
  const triggerCleanup = async () => {
    setSyncing("cleanup");
    const now = new Date().toISOString();

    setStages((prev) =>
      prev.map((s) => ({
        ...s,
        status: s.name === "Data Cleanup" ? "running" as const : s.status,
      }))
    );

    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/v1/cron/cleanup", {
        method: "POST",
        headers,
      });
      const data: CleanupResult = await res.json();
      if (!res.ok || (data as any).error) {
        throw new Error((data as any).error || `HTTP ${res.status}`);
      }

      setCleanupResult(data);

      setStages((prev) =>
        prev.map((s) => {
          if (s.name === "Data Cleanup") {
            return {
              ...s,
              status: data.totalDeleted > 0 ? "success" : "idle",
              lastRun: now,
              duration: data.duration,
            };
          }
          return s;
        })
      );

      addLog("Cleanup", "success", data.duration, `Purged ${data.totalDeleted} rows across ${data.results.length} tables`);
      await fetchStatus();
      await fetchCronHealth();
    } catch (e) {
      setStages((prev) =>
        prev.map((s) => ({
          ...s,
          status: s.name === "Data Cleanup" ? "error" : s.status,
        }))
      );
      addLog("Cleanup", "error", "0ms", e instanceof Error ? e.message : "Failed to run cleanup");
    }

    setSyncing(null);
  };

  // Manual sync triggers
  const triggerSync = async (type: "fixtures" | "odds" | "all") => {
    setSyncing(type);
    const now = new Date().toISOString();

    setStages((prev) =>
      prev.map((s) => ({
        ...s,
        status: (type === "all" || (type === "fixtures" && s.name === "Fixture Sync") || (type === "odds" && s.name === "Odds Fetch"))
          ? "running" as const
          : s.status,
      }))
    );

    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/v1/cron/sync", {
        method: "POST",
        headers,
        body: JSON.stringify({ type }),
      });
      const data: SyncResult = await res.json();
      if (!res.ok || (data as any).error) {
        throw new Error((data as any).error || `HTTP ${res.status}`);
      }
      if ((data as any).skipped) {
        addLog(type, "warning", "0ms", `Skipped — ${(data as any).reason || "another run in progress"}`);
        setStages((prev) =>
          prev.map((s) => ({
            ...s,
            status: s.status === "running" ? "idle" : s.status,
          }))
        );
        setSyncing(null);
        return;
      }

      setLastResult(data);

      setStages((prev) =>
        prev.map((s) => {
          if (type === "all" || type === "fixtures") {
            if (s.name === "Fixture Sync") {
              const fixtureResult = data.results.fixtures as { errors?: string[]; created?: number; updated?: number } | undefined;
              return {
                ...s,
                status: fixtureResult?.errors?.length ? "error" : "success",
                lastRun: now,
                duration: data.duration,
              };
            }
          }
          if (type === "all" || type === "odds") {
            if (s.name === "Odds Fetch") {
              const oddsResult = data.results.odds as { errors?: string[]; synced?: number } | undefined;
              return {
                ...s,
                status: oddsResult?.errors?.length ? "error" : "success",
                lastRun: now,
                duration: data.duration,
              };
            }
            if (s.name === "Value Detection") {
              return {
                ...s,
                status: "success",
                lastRun: now,
                duration: null,
              };
            }
            if (s.name === "Notification Dispatch") {
              return {
                ...s,
                status: "success",
                lastRun: now,
                duration: null,
              };
            }
          }
          return s;
        })
      );

      addLog(type, "success", data.duration, `Synced ${type} successfully`);
      await fetchStatus();
      await fetchCronHealth();
    } catch (e) {
      setStages((prev) =>
        prev.map((s) => ({
          ...s,
          status: s.status === "running" ? "error" : s.status,
        }))
      );
      addLog(type, "error", "0ms", e instanceof Error ? e.message : `Failed to sync ${type}`);
    }

    setSyncing(null);
  };

  // Full pipeline: sync → predict → settle → learn (server-orchestrated)
  const runFullPipeline = async () => {
    setRunningPipeline(true);
    const now = new Date().toISOString();
    setStages((prev) =>
      prev.map((s) => ({
        ...s,
        status: ["Fixture Sync", "Odds Fetch", "Prediction Engine", "Value Detection", "Crown Jewel Selection", "Notification Dispatch"].includes(s.name)
          ? "running" as const
          : s.status,
      }))
    );

    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/v1/admin/run-pipeline", {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const steps = ["sync", "predict", "settle", "learn"] as const;
      const stepLabels: Record<string, string> = {
        sync: "Fixture Sync",
        predict: "Prediction Engine",
        settle: "Data Cleanup",
        learn: "Crown Jewel Selection",
      };
      setStages((prev) =>
        prev.map((s) => {
          const step = steps.find((k) => stepLabels[k] === s.name);
          if (step) {
            const stepResult = data.results?.[step];
            const failed = stepResult?.error || (stepResult && stepResult.success === false);
            return { ...s, status: failed ? "error" as const : "success" as const, lastRun: now, duration: data.duration || null };
          }
          if (s.status === "running") return { ...s, status: "idle" as const };
          return s;
        })
      );

      addLog("Full Pipeline", "success", data.duration || "—", "Ran sync → predict → settle → learn");
      await fetchStatus();
      await fetchCronHealth();
    } catch (e) {
      setStages((prev) =>
        prev.map((s) => ({ ...s, status: s.status === "running" ? "error" as const : s.status }))
      );
      addLog("Full Pipeline", "error", "0ms", e instanceof Error ? e.message : "Pipeline failed");
    } finally {
      setRunningPipeline(false);
    }
  };

  const statusColor = (status: PipelineStage["status"]) => {
    switch (status) {
      case "success": return "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/20";
      case "error": return "bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/20";
      case "running": return "bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/20";
      case "warning": return "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20";
      default: return "bg-gray-50 text-gray-400 border-gray-100";
    }
  };

  return (
    <ErrorBoundary>
      <div>
        {/* Header */}
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            Data Pipeline
          </h1>
          <p className="text-[14px] text-gray-500">
            Monitor data flow, API usage, and trigger manual syncs.
          </p>
        </div>
        <div className="flex gap-[8px] flex-wrap">
          <button
            onClick={runFullPipeline}
            disabled={syncing !== null || runningPipeline}
            className="h-[36px] px-[16px] rounded-[10px] bg-[#BFFF00] text-[#1B2A4A] text-[13px] font-semibold transition-all hover:bg-[#cfff33] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            {runningPipeline ? (
              <div className="w-[14px] h-[14px] border-2 border-[#1B2A4A]/30 border-t-[#1B2A4A] rounded-full animate-spin"></div>
            ) : (
              <i className="ri-play-circle-line text-[14px]"></i>
            )}
            {runningPipeline ? "Running..." : "Run Full Pipeline"}
          </button>
          <button
            onClick={() => triggerSync("fixtures")}
            disabled={syncing !== null}
            className="h-[36px] px-[14px] rounded-[10px] bg-white border border-gray-200 text-[13px] font-semibold text-[#0A0F1C] transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <i className="ri-calendar-check-line text-[14px]"></i>
            Sync Fixtures
          </button>
          <button
            onClick={() => triggerSync("odds")}
            disabled={syncing !== null}
            className="h-[36px] px-[14px] rounded-[10px] bg-white border border-gray-200 text-[13px] font-semibold text-[#0A0F1C] transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <i className="ri-bar-chart-box-line text-[14px]"></i>
            Sync Odds
          </button>
          <button
            onClick={triggerPredictions}
            disabled={syncing !== null}
            className="h-[36px] px-[14px] rounded-[10px] bg-[#8B5CF6] text-white text-[13px] font-semibold transition-all hover:bg-[#7C3AED] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            {syncing === "predict" ? (
              <div className="w-[14px] h-[14px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <i className="ri-brain-line text-[14px]"></i>
            )}
            {syncing === "predict" ? "Predicting..." : "Run Predictions"}
          </button>
          <button
            onClick={triggerCleanup}
            disabled={syncing !== null}
            className="h-[36px] px-[14px] rounded-[10px] bg-white border border-gray-200 text-[13px] font-semibold text-[#0A0F1C] transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            {syncing === "cleanup" ? (
              <div className="w-[14px] h-[14px] border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
            ) : (
              <i className="ri-delete-bin-line text-[14px]"></i>
            )}
            {syncing === "cleanup" ? "Cleaning..." : "Clean Data"}
          </button>
          <button
            onClick={() => triggerSync("all")}
            disabled={syncing !== null}
            className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            {syncing === "all" ? (
              <div className="w-[14px] h-[14px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            ) : (
              <i className="ri-refresh-line text-[14px]"></i>
            )}
            {syncing === "all" ? "Syncing..." : "Sync All"}
          </button>
        </div>
      </div>

      {/* Sync Status Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
        {[
          { label: "Fixtures Today", value: syncStatus.fixturesToday, icon: "ri-calendar-event-line", color: "bg-[#BFFF00]/10 text-[#1B2A4A]" },
          { label: "Total Fixtures", value: syncStatus.totalFixtures, icon: "ri-calendar-line", color: "bg-[#1B2A4A]/5 text-[#1B2A4A]" },
          { label: "Predictions", value: syncStatus.totalPredictions, icon: "ri-brain-line", color: "bg-purple-50 text-purple-600" },
          { label: "Value Bets", value: syncStatus.totalRecommendations, icon: "ri-search-eye-line", color: "bg-[#22c55e]/10 text-[#22c55e]" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
          >
            <div className="flex items-center gap-[10px] mb-[8px]">
              <span className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center ${stat.color}`}>
                <i className={`${stat.icon} text-[16px]`}></i>
              </span>
              <span className="text-[11px] text-gray-400">{stat.label}</span>
            </div>
            <span className="text-[22px] font-mono-data font-bold text-[#0A0F1C]">
              {loading ? "—" : stat.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* Cron Health Bar */}
      <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] mb-[24px]">
        <div className="flex items-center justify-between mb-[12px]">
          <h2 className="text-[14px] font-semibold text-[#0A0F1C]">Cron Job Health</h2>
          <button
            onClick={fetchCronHealth}
            className="text-[11px] text-gray-400 hover:text-[#1B2A4A] transition-colors flex items-center gap-[4px]"
          >
            <i className="ri-refresh-line"></i>
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px]">
          {cronJobs.length === 0 ? (
            <div className="col-span-full p-[16px] bg-gray-50 rounded-[10px] text-center text-[12px] text-gray-400">
              Cron status unavailable — check the <a href="/admin/crons" className="text-[#1B2A4A] font-semibold underline">Cron Jobs</a> page.
            </div>
          ) : (
            cronJobs.map((job) => (
              <div key={job.name} className="p-[12px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center justify-between mb-[6px]">
                  <div className="flex items-center gap-[6px] min-w-0">
                    <i className="ri-timer-line text-[14px] text-gray-400 flex-none"></i>
                    <span className="text-[12px] font-semibold text-[#0A0F1C] truncate">{job.name}</span>
                  </div>
                  <span className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full flex-none ml-[6px] ${
                    job.lastStatus === "SUCCESS" ? "bg-[#22c55e]/10 text-[#22c55e]" :
                    job.lastStatus === "FAILED" ? "bg-[#EF4444]/10 text-[#EF4444]" :
                    job.lastStatus === "RUNNING" ? "bg-[#2563EB]/10 text-[#2563EB]" :
                    "bg-gray-100 text-gray-400"
                  }`}>
                    {job.isOverdue ? "OVERDUE" : (job.lastStatus || "NEVER").replace("_", " ")}
                  </span>
                </div>
                <span className="text-[11px] font-mono-data text-gray-400 block">{job.scheduleHuman}</span>
                {job.lastRun && (
                  <span className="text-[10px] text-gray-300 block mt-[4px]">
                    Last: {new Date(job.lastRun).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                {job.consecutiveFailures >= 3 && (
                  <span className="text-[10px] text-[#EF4444] font-semibold block mt-[2px]">
                    {job.consecutiveFailures} consecutive failures
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-[24px]">
        {/* Pipeline Stages */}
        <div>
          <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">
            Pipeline Stages
          </h2>
          <div className="space-y-[6px]">
            {stages.map((stage, i) => (
              <div
                key={stage.name}
                className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] flex items-center gap-[16px]"
              >
                <span className="text-[11px] font-mono-data text-gray-300 w-[24px] text-right">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className={`w-[36px] h-[36px] rounded-[10px] flex items-center justify-center flex-none border ${statusColor(stage.status)}`}>
                  {stage.status === "running" ? (
                    <div className="w-[16px] h-[16px] border-2 border-current/30 border-t-current rounded-full animate-spin"></div>
                  ) : (
                    <i className={`${stage.icon} text-[16px]`}></i>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <span className="text-[13px] font-semibold text-[#0A0F1C]">{stage.name}</span>
                    <span className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full border ${statusColor(stage.status)}`}>
                      {stage.status.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400">{stage.desc}</span>
                </div>
                <div className="text-right flex-none">
                  {stage.lastRun && (
                    <span className="text-[10px] text-gray-400 block">
                      {new Date(stage.lastRun).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  {stage.duration && (
                    <span className="text-[10px] font-mono-data text-gray-300">{stage.duration}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Last Sync Result */}
          {lastResult && (
            <div className="mt-[16px] bg-white rounded-[14px] p-[16px] border border-gray-100">
              <h3 className="text-[13px] font-semibold text-[#0A0F1C] mb-[12px]">Last Sync Result</h3>
              <div className="grid grid-cols-3 gap-[12px]">
                <div className="p-[10px] bg-gray-50 rounded-[10px]">
                  <span className="block text-[10px] text-gray-400 mb-[2px]">Type</span>
                  <span className="text-[13px] font-mono-data font-semibold text-[#0A0F1C]">{lastResult.type}</span>
                </div>
                <div className="p-[10px] bg-gray-50 rounded-[10px]">
                  <span className="block text-[10px] text-gray-400 mb-[2px]">Duration</span>
                  <span className="text-[13px] font-mono-data font-semibold text-[#0A0F1C]">{lastResult.duration}</span>
                </div>
                <div className="p-[10px] bg-gray-50 rounded-[10px]">
                  <span className="block text-[10px] text-gray-400 mb-[2px]">Status</span>
                  <span className={`text-[13px] font-semibold ${lastResult.success ? "text-[#22c55e]" : "text-[#EF4444]"}`}>
                    {lastResult.success ? "Success" : "Failed"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Cleanup Result */}
          {cleanupResult && (
            <div className="mt-[16px] bg-white rounded-[14px] p-[16px] border border-gray-100">
              <h3 className="text-[13px] font-semibold text-[#0A0F1C] mb-[12px]">Last Cleanup Result</h3>
              <div className="flex items-center gap-[12px] mb-[8px]">
                <span className="text-[13px] font-mono-data font-semibold text-[#0A0F1C]">
                  {cleanupResult.totalDeleted.toLocaleString()} rows deleted
                </span>
                <span className="text-[11px] text-gray-400">in {cleanupResult.duration}</span>
              </div>
              <div className="grid grid-cols-2 gap-[6px]">
                {cleanupResult.results.filter((r) => r.deleted > 0).map((r) => (
                  <div key={r.table} className="flex items-center justify-between p-[6px] bg-gray-50 rounded-[6px] text-[11px]">
                    <span className="text-gray-500">{r.table}</span>
                    <span className="font-mono-data font-semibold text-[#0A0F1C]">{r.deleted}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sync Log */}
          {syncLog.length > 0 && (
            <div className="mt-[16px] bg-white rounded-[14px] p-[16px] border border-gray-100">
              <h3 className="text-[13px] font-semibold text-[#0A0F1C] mb-[12px]">Activity Log</h3>
              <div className="space-y-[6px] max-h-[200px] overflow-y-auto">
                {syncLog.map((log) => (
                  <div key={log.id} className="flex items-center gap-[10px] p-[8px] bg-gray-50 rounded-[8px]">
                    <span className={`w-[6px] h-[6px] rounded-full flex-none ${log.status === "success" ? "bg-[#22c55e]" : "bg-[#EF4444]"}`}></span>
                    <span className="text-[12px] font-semibold text-[#0A0F1C] w-[80px] flex-none">{log.type}</span>
                    <span className="text-[11px] text-gray-400 flex-1 truncate">{log.details}</span>
                    <span className="text-[10px] font-mono-data text-gray-300 flex-none">{log.duration}</span>
                    <span className="text-[10px] text-gray-300 flex-none">
                      {new Date(log.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — API Usage + Cron + Data Sources */}
        <div className="space-y-[16px]">
          {/* API Usage */}
          <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
              API Usage
            </h3>
            <div className="space-y-[12px]">
              {/* NVIDIA AI — real usage from ai_cache */}
              <div className="p-[12px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center justify-between mb-[6px]">
                  <span className="text-[12px] font-semibold text-[#0A0F1C]">NVIDIA AI</span>
                  <span className="text-[10px] text-gray-400">{aiUsage ? `${aiUsage.activeKeys} keys` : "—"}</span>
                </div>
                {aiUsage ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-400">Chat calls today</span>
                      <span className="text-[12px] font-mono-data font-semibold text-[#0A0F1C]">
                        {aiUsage.todayChatCalls.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-[4px]">
                      <span className="text-[11px] text-gray-400">Predict calls today</span>
                      <span className="text-[12px] font-mono-data font-semibold text-[#0A0F1C]">
                        {aiUsage.todayPredictCalls.toLocaleString()}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-300 block mt-[4px]">Key rotation active</span>
                  </>
                ) : (
                  <p className="text-[11px] text-gray-400">Usage data unavailable</p>
                )}
              </div>

              {/* External API quota — not exposed to admin endpoints */}
              <div className="p-[12px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center justify-between mb-[6px]">
                  <span className="text-[12px] font-semibold text-[#0A0F1C]">The Odds API</span>
                  <span className="text-[10px] text-gray-400">Quota</span>
                </div>
                <p className="text-[11px] text-gray-400">
                  Monthly quota is only visible via the cron-secret endpoint — not tracked here.
                </p>
              </div>

              {/* Notifications */}
              <div className="p-[12px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center justify-between mb-[4px]">
                  <span className="text-[12px] font-semibold text-[#0A0F1C]">Notifications</span>
                  <span className="text-[10px] text-gray-400">Real-time</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">Total / Unread</span>
                  <span className="text-[12px] font-mono-data font-semibold text-[#0A0F1C]">
                    {syncStatus.totalNotifications} / {syncStatus.unreadNotifications}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Cron Configuration */}
          <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
              Cron Schedule
            </h3>
            <div className="space-y-[10px]">
              {cronJobs.length === 0 ? (
                <p className="text-[11px] text-gray-400">Cron schedule unavailable — see <a href="/admin/crons" className="text-[#1B2A4A] font-semibold underline">Cron Jobs</a>.</p>
              ) : (
                cronJobs.map((job) => (
                  <div key={job.name} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]">
                    <div className="flex items-center gap-[8px] min-w-0">
                      <i className="ri-time-line text-[14px] text-gray-400 flex-none"></i>
                      <span className="text-[12px] font-medium text-[#0A0F1C] truncate">{job.name}</span>
                    </div>
                    <span className="text-[11px] font-mono-data text-gray-500 flex-none ml-[8px]">{job.scheduleHuman}</span>
                  </div>
                ))
              )}
              <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center gap-[8px]">
                  <i className="ri-earth-line text-[14px] text-gray-400"></i>
                  <span className="text-[12px] font-medium text-[#0A0F1C]">Timezone</span>
                </div>
                <span className="text-[11px] font-mono-data text-gray-500">UTC</span>
              </div>
            </div>
            <div className="mt-[12px] p-[10px] bg-[#BFFF00]/5 border border-[#BFFF00]/20 rounded-[10px]">
              <p className="text-[11px] text-[#1B2A4A]">
                <i className="ri-information-line mr-[4px]"></i>
                Vercel cron runs all jobs automatically. Use the buttons above for manual triggers.
              </p>
            </div>
          </div>

          {/* Data Sources */}
          <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
              Data Sources
            </h3>
            <div className="space-y-[8px]">
              {[
                { name: "API-Football", purpose: "Fixtures & live scores", status: "active" },
                { name: "The Odds API", purpose: "Bookmaker odds", status: "active" },
                { name: "Odds API IO", purpose: "Additional odds feed", status: "active" },
                { name: "NVIDIA NIM", purpose: "AI predictions", status: "active" },
              ].map((source) => (
                <div key={source.name} className="flex items-center justify-between p-[8px] rounded-[8px] hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-[8px]">
                    <span className="w-[6px] h-[6px] rounded-full bg-[#22c55e]"></span>
                    <span className="text-[12px] font-medium text-[#0A0F1C]">{source.name}</span>
                  </div>
                  <span className="text-[10px] text-gray-400">{source.purpose}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}
