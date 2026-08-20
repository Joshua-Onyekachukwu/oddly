"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";

interface SyncStatus {
  lastSync: string | null;
  fixturesToday: number;
  totalFixtures: number;
  totalPredictions: number;
  totalRecommendations: number;
  activeLeagues: number;
  pendingFixtures: number;
}

interface ApiUsage {
  oddsApi: { used: number; remaining: number; resetDate: string } | null;
  apiFootball: { requestsToday: number } | null;
}

interface SyncResult {
  success: boolean;
  type: string;
  duration: string;
  results: {
    fixtures?: { created?: number; updated?: number; errors?: string[] };
    odds?: { synced?: number; errors?: string[] };
    notifications?: { valueBets?: number };
  };
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

export default function AdminPipelinePage() {
  const { session } = useAuth();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    lastSync: null,
    fixturesToday: 0,
    totalFixtures: 0,
    totalPredictions: 0,
    totalRecommendations: 0,
    activeLeagues: 0,
    pendingFixtures: 0,
  });
  const [apiUsage, setApiUsage] = useState<ApiUsage>({
    oddsApi: null,
    apiFootball: null,
  });
  const [syncing, setSyncing] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState(true);
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

    const [fixturesToday, totalFixtures, predictions, recommendations, leagues, lastOdds] = await Promise.all([
      supabase.from("fixtures").select("id", { count: "exact", head: true })
        .gte("kickoff_time", `${today}T00:00:00Z`)
        .lte("kickoff_time", `${today}T23:59:59Z`),
      supabase.from("fixtures").select("id", { count: "exact", head: true }),
      supabase.from("predictions").select("id", { count: "exact", head: true }),
      supabase.from("recommendations").select("id", { count: "exact", head: true }).eq("is_recommended", true),
      supabase.from("leagues").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("odds_snapshots").select("snapshot_time").order("snapshot_time", { ascending: false }).limit(1),
    ]);

    setSyncStatus({
      lastSync: lastOdds.data?.[0]?.snapshot_time || null,
      fixturesToday: fixturesToday.count || 0,
      totalFixtures: totalFixtures.count || 0,
      totalPredictions: predictions.count || 0,
      totalRecommendations: recommendations.count || 0,
      activeLeagues: leagues.count || 0,
      pendingFixtures: 0,
    });

    setLoading(false);
  }, []);

  // Fetch API usage from cron endpoint
  const fetchApiUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/cron/sync");
      const data = await res.json();
      if (data.usage) {
        setApiUsage(data.usage);
      }
    } catch {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchApiUsage();
  }, [fetchStatus, fetchApiUsage]);

  // Manual prediction trigger
  const triggerPredictions = async () => {
    setSyncing("predict");
    const now = new Date().toISOString();

    setStages((prev) =>
      prev.map((s) => ({
        ...s,
        status: s.name === "Prediction Engine" || s.name === "Crown Jewel Selection" || s.name === "Value Detection"
          ? "running" as const
          : s.status,
      }))
    );

    try {
      const res = await fetch("/api/v1/cron/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      setStages((prev) =>
        prev.map((s) => {
          if (s.name === "Prediction Engine") {
            return {
              ...s,
              status: data.results?.predictions?.failed > 0 ? "warning" : "success",
              lastRun: now,
              duration: data.duration,
            };
          }
          if (s.name === "Crown Jewel Selection") {
            return {
              ...s,
              status: data.results?.crownJewel?.success ? "success" : "idle",
              lastRun: now,
              duration: null,
            };
          }
          if (s.name === "Value Detection") {
            return {
              ...s,
              status: data.results?.predictions?.success > 0 ? "success" : "idle",
              lastRun: now,
              duration: null,
            };
          }
          return s;
        })
      );

      await fetchStatus();
    } catch (error) {
      setStages((prev) =>
        prev.map((s) => ({
          ...s,
          status: s.status === "running" ? "error" : s.status,
        }))
      );
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
      const res = await fetch("/api/v1/cron/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

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

      await fetchStatus();
    } catch {
      setStages((prev) =>
        prev.map((s) => ({
          ...s,
          status: s.name === "Data Cleanup" ? "error" : s.status,
        }))
      );
    }

    setSyncing(null);
  };

  // Manual sync triggers
  const triggerSync = async (type: "fixtures" | "odds" | "all") => {
    setSyncing(type);
    const now = new Date().toISOString();

    // Update stages to running
    setStages((prev) =>
      prev.map((s) => ({
        ...s,
        status: (type === "all" || type === "fixtures" && s.name === "Fixture Sync" || type === "odds" && s.name === "Odds Fetch")
          ? "running" as const
          : s.status,
      }))
    );

    try {
      const res = await fetch("/api/v1/cron/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data: SyncResult = await res.json();

      setLastResult(data);

      // Update stages based on results
      setStages((prev) =>
        prev.map((s) => {
          if (type === "all" || type === "fixtures") {
            if (s.name === "Fixture Sync") {
              const fixtureResult = data.results.fixtures;
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
              const oddsResult = data.results.odds;
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
                status: data.results.notifications?.valueBets ? "warning" : "success",
                lastRun: now,
                duration: null,
              };
            }
            if (s.name === "Notification Dispatch") {
              return {
                ...s,
                status: data.results.notifications?.valueBets ? "success" : "idle",
                lastRun: now,
                duration: null,
              };
            }
          }
          return s;
        })
      );

      // Refresh status after sync
      await fetchStatus();
    } catch (error) {
      setStages((prev) =>
        prev.map((s) => ({
          ...s,
          status: s.status === "running" ? "error" : s.status,
        }))
      );
    }

    setSyncing(null);
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
        <div className="flex gap-[8px]">
          <button
            onClick={() => triggerSync("fixtures")}
            disabled={syncing !== null}
            className="h-[36px] px-[14px] rounded-[10px] bg-white border border-gray-200 text-[13px] font-semibold text-[#0A0F1C] transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
          >
            <i className="ri-calendar-check-line text-[14px]"></i>
            Sync Fixtures
          </button>
          <button
            onClick={() => triggerSync("odds")}
            disabled={syncing !== null}
            className="h-[36px] px-[14px] rounded-[10px] bg-white border border-gray-200 text-[13px] font-semibold text-[#0A0F1C] transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
          >
            <i className="ri-bar-chart-box-line text-[14px]"></i>
            Sync Odds
          </button>
          <button
            onClick={triggerPredictions}
            disabled={syncing !== null}
            className="h-[36px] px-[14px] rounded-[10px] bg-[#8B5CF6] text-white text-[13px] font-semibold transition-all hover:bg-[#7C3AED] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
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
            className="h-[36px] px-[14px] rounded-[10px] bg-white border border-gray-200 text-[13px] font-semibold text-[#0A0F1C] transition-all hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
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
            className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
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
              <h3 className="text-[13px] font-semibold text-[#0A0F1C] mb-[12px]">
                Last Sync Result
              </h3>
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
              {lastResult.results.fixtures && (
                <div className="mt-[8px] p-[10px] bg-gray-50 rounded-[10px] text-[11px] text-gray-500">
                  Fixtures: {lastResult.results.fixtures.created || 0} created, {lastResult.results.fixtures.updated || 0} updated
                  {lastResult.results.fixtures.errors?.length ? ` · ${lastResult.results.fixtures.errors.length} errors` : ""}
                </div>
              )}
              {lastResult.results.odds && (
                <div className="mt-[8px] p-[10px] bg-gray-50 rounded-[10px] text-[11px] text-gray-500">
                  Odds: {lastResult.results.odds.synced || 0} synced
                  {lastResult.results.odds.errors?.length ? ` · ${lastResult.results.odds.errors.length} errors` : ""}
                </div>
              )}
              <div className="mt-[8px] text-[10px] text-gray-300">
                {new Date(lastResult.timestamp).toLocaleString()}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — API Usage + Cron */}
        <div className="space-y-[16px]">
          {/* API Usage */}
          <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
              API Usage
            </h3>
            <div className="space-y-[12px]">
              {/* The Odds API */}
              <div className="p-[12px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center justify-between mb-[6px]">
                  <span className="text-[12px] font-semibold text-[#0A0F1C]">The Odds API</span>
                  <span className="text-[10px] text-gray-400">Live odds</span>
                </div>
                {apiUsage.oddsApi ? (
                  <>
                    <div className="flex items-center justify-between mb-[4px]">
                      <span className="text-[11px] text-gray-400">Used this month</span>
                      <span className="text-[12px] font-mono-data font-semibold text-[#0A0F1C]">
                        {apiUsage.oddsApi.used.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-[4px]">
                      <div
                        className="bg-[#1B2A4A] h-[4px] rounded-full transition-all"
                        style={{ width: `${Math.min((apiUsage.oddsApi.used / 800) * 100, 100)}%` }}
                      ></div>
                    </div>
                    <div className="flex items-center justify-between mt-[4px]">
                      <span className="text-[10px] text-gray-300">Resets: {apiUsage.oddsApi.resetDate}</span>
                      <span className="text-[10px] text-gray-300">{apiUsage.oddsApi.remaining} remaining</span>
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-gray-400">Not configured</p>
                )}
              </div>

              {/* API-Football */}
              <div className="p-[12px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center justify-between mb-[6px]">
                  <span className="text-[12px] font-semibold text-[#0A0F1C]">API-Football</span>
                  <span className="text-[10px] text-gray-400">Fixtures</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">Requests today</span>
                  <span className="text-[12px] font-mono-data font-semibold text-[#0A0F1C]">
                    {apiUsage.apiFootball?.requestsToday || 0}
                  </span>
                </div>
              </div>

              {/* NVIDIA AI */}
              <div className="p-[12px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-[#0A0F1C]">NVIDIA AI</span>
                  <span className="text-[10px] text-gray-400">10 keys</span>
                </div>
                <span className="text-[11px] text-gray-400 block mt-[4px]">Key rotation active</span>
              </div>
            </div>
          </div>

          {/* Cron Configuration */}
          <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
              Cron Schedule
            </h3>
            <div className="space-y-[10px]">
              <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center gap-[8px]">
                  <i className="ri-refresh-line text-[14px] text-gray-400"></i>
                  <span className="text-[12px] font-medium text-[#0A0F1C]">Odds Sync</span>
                </div>
                <span className="text-[11px] font-mono-data text-gray-500">Every 6h</span>
              </div>
              <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center gap-[8px]">
                  <i className="ri-brain-line text-[14px] text-purple-400"></i>
                  <span className="text-[12px] font-medium text-[#0A0F1C]">Predictions</span>
                </div>
                <span className="text-[11px] font-mono-data text-gray-500">Daily 08:00</span>
              </div>
              <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]">
                <div className="flex items-center gap-[8px]">
                  <i className="ri-delete-bin-line text-[14px] text-gray-400"></i>
                  <span className="text-[12px] font-medium text-[#0A0F1C]">Data Cleanup</span>
                </div>
                <span className="text-[11px] font-mono-data text-gray-500">Daily 03:00</span>
              </div>
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
                Vercel cron automatically syncs fixtures, odds, and triggers value bet notifications every 6 hours.
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
                { name: "NVIDIA NIM", purpose: "AI predictions (7 models)", status: "active" },
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
  );
}
