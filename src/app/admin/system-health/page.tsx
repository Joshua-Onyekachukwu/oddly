"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface SystemStats {
  totalFixtures: number;
  scheduledFixtures: number;
  finishedFixtures: number;
  totalPredictions: number;
  settledPredictions: number;
  pendingPredictions: number;
  correctPredictions: number;
  wrongPredictions: number;
  totalTeams: number;
  totalLeagues: number;
  totalOddsSnapshots: number;
  totalUsers: number;
  activeUsers: number;
}

interface APIStatus {
  oddsApi: { status: string; used: number; remaining: number; resetDate: string };
  footballData: { status: string; plan: string; requestsToday: number };
  statsBomb: { status: string; matchesCollected: number | null; teamsWithXG: number | null };
}

interface PipelineHealth {
  lastSyncTime: string | null;
  lastPredictTime: string | null;
  lastSettleTime: string | null;
  syncHealthy: boolean;
  predictHealthy: boolean;
  cronNextRun: string;
  dailySyncEnabled: boolean;
}

interface DataFreshness {
  table: string;
  rowCount: number;
  latestUpdate: string | null;
  oldestRecord: string | null;
  status: "fresh" | "stale" | "empty" | "error";
}

interface MarketAccuracy {
  market: string;
  total: number;
  correct: number;
  accuracy: number;
  eliteCorrect: number;
  eliteTotal: number;
  eliteAccuracy: number;
}

const REFRESH_INTERVAL = 30000;

export default function SystemHealthPage() {
  const [loading, setLoading] = useState(true);
  const [systemStats, setSystemStats] = useState<SystemStats>({
    totalFixtures: 0, scheduledFixtures: 0, finishedFixtures: 0,
    totalPredictions: 0, settledPredictions: 0, pendingPredictions: 0,
    correctPredictions: 0, wrongPredictions: 0,
    totalTeams: 0, totalLeagues: 0, totalOddsSnapshots: 0,
    totalUsers: 0, activeUsers: 0,
  });
  const [apiStatus, setApiStatus] = useState<APIStatus>({
    oddsApi: { status: "unknown", used: 0, remaining: 0, resetDate: "" },
    footballData: { status: "unknown", plan: "Free", requestsToday: 0 },
    statsBomb: { status: "unknown", matchesCollected: 0, teamsWithXG: 0 },
  });
  const [pipelineHealth, setPipelineHealth] = useState<PipelineHealth>({
    lastSyncTime: null, lastPredictTime: null, lastSettleTime: null,
    syncHealthy: false, predictHealthy: false, cronNextRun: "",
    dailySyncEnabled: true,
  });
  const [dataFreshness, setDataFreshness] = useState<DataFreshness[]>([]);
  const [marketAccuracy, setMarketAccuracy] = useState<MarketAccuracy[]>([]);
  const [calibrationBuckets, setCalibrationBuckets] = useState<{ label: string; predicted: number; actual: number; total: number }[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchAll = useCallback(async () => {
    const sb = createClient();
    const now = new Date();

    // ─── System Stats ─────────────────────────────────────────────
    const [
      fixtures, scheduled, finished,
      predictions, settled, pending, correct, wrong,
      teams, leagues, odds, users, activeUsers,
    ] = await Promise.all([
      sb.from("fixtures").select("id", { count: "exact", head: true }),
      sb.from("fixtures").select("id", { count: "exact", head: true }).eq("status", "scheduled"),
      sb.from("fixtures").select("id", { count: "exact", head: true }).eq("status", "finished"),
      sb.from("predictions").select("id", { count: "exact", head: true }),
      sb.from("predictions").select("id", { count: "exact", head: true }).not("settled_at", "is", null),
      sb.from("predictions").select("id", { count: "exact", head: true }).eq("result", "pending"),
      sb.from("predictions").select("id", { count: "exact", head: true }).eq("result", "correct"),
      sb.from("predictions").select("id", { count: "exact", head: true }).eq("result", "wrong"),
      sb.from("teams").select("id", { count: "exact", head: true }),
      sb.from("leagues").select("id", { count: "exact", head: true }),
      sb.from("odds_snapshots").select("id", { count: "exact", head: true }),
      sb.from("profiles").select("id", { count: "exact", head: true }),
      // profiles has no last_sign_in_at — proxy "active" with signups in last 7 days
      sb.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", new Date(now.getTime() - 7 * 86400000).toISOString()),
    ]);

    setSystemStats({
      totalFixtures: fixtures.count || 0,
      scheduledFixtures: scheduled.count || 0,
      finishedFixtures: finished.count || 0,
      totalPredictions: predictions.count || 0,
      settledPredictions: settled.count || 0,
      pendingPredictions: pending.count || 0,
      correctPredictions: correct.count || 0,
      wrongPredictions: wrong.count || 0,
      totalTeams: teams.count || 0,
      totalLeagues: leagues.count || 0,
      totalOddsSnapshots: odds.count || 0,
      totalUsers: users.count || 0,
      activeUsers: activeUsers.count || 0,
    });

    // ─── API Status ───────────────────────────────────────────────
    let oddsApiStatus = { status: "unknown", used: 0, remaining: 0, resetDate: "" };
    try {
      const res = await fetch("/api/v1/cron/sync");
      const data = await res.json();
      if (data.usage?.oddsApi) {
        oddsApiStatus = {
          status: "active",
          used: data.usage.oddsApi.used || 0,
          remaining: data.usage.oddsApi.remaining || 0,
          resetDate: data.usage.oddsApi.resetDate || "",
        };
      }
    } catch { /* silent */ }

    // StatsBomb/xG data — real row count from match_stats table
    const { count: matchStatsCount } = await sb
      .from("match_stats")
      .select("id", { count: "exact", head: true });
    const statsBombStatus = {
      status: (matchStatsCount || 0) > 0 ? "active" : "unknown",
      matchesCollected: matchStatsCount ?? null,
      teamsWithXG: null, // not tracked in a queryable table
    };

    setApiStatus({
      oddsApi: oddsApiStatus,
      // football-data.org usage is not exposed to admin endpoints
      footballData: { status: "unknown", plan: "Free (10 req/min)", requestsToday: 0 },
      statsBomb: statsBombStatus,
    });

    // ─── Pipeline Health ──────────────────────────────────────────
    const [lastOdds, lastPred] = await Promise.all([
      sb.from("odds_snapshots").select("snapshot_time").order("snapshot_time", { ascending: false }).limit(1),
      sb.from("predictions").select("created_at").order("created_at", { ascending: false }).limit(1),
    ]);

    const lastSync = lastOdds.data?.[0]?.snapshot_time || null;
    const lastPredTime = lastPred.data?.[0]?.created_at || null;

    // Health thresholds: sync within 7 days is healthy for free tier (500 req/month)
    // Predictions within 24 hours is healthy
    const syncAge = lastSync ? now.getTime() - new Date(lastSync).getTime() : Infinity;
    const predAge = lastPredTime ? now.getTime() - new Date(lastPredTime).getTime() : Infinity;

    // Next cron run: 06:00 UTC tomorrow
    const nextCron = new Date(now);
    nextCron.setUTCHours(6, 0, 0, 0);
    if (nextCron <= now) nextCron.setUTCDate(nextCron.getUTCDate() + 1);

    setPipelineHealth({
      lastSyncTime: lastSync,
      lastPredictTime: lastPredTime,
      lastSettleTime: null,
      // Sync healthy if within 7 days (free tier = 500 req/month)
      syncHealthy: syncAge < 7 * 24 * 3600000,
      // Predictions healthy if within 48 hours
      predictHealthy: predAge < 48 * 3600000,
      cronNextRun: nextCron.toISOString(),
      dailySyncEnabled: true,
    });

    // ─── Data Freshness ───────────────────────────────────────────
    const tables = ["fixtures", "predictions", "odds_snapshots", "teams", "leagues", "profiles"];
    const freshness: DataFreshness[] = [];

    for (const table of tables) {
      const { count } = await sb.from(table).select("id", { count: "exact", head: true });
      const { data: latest } = await sb.from(table).select("*").order("created_at", { ascending: false }).limit(1) as { data: any[] };
      const { data: oldest } = await sb.from(table).select("*").order("created_at", { ascending: true }).limit(1) as { data: any[] };

      const latestDate = latest?.[0]?.created_at || null;
      const oldestDate = oldest?.[0]?.created_at || null;
      const age = latestDate ? now.getTime() - new Date(latestDate).getTime() : Infinity;

      freshness.push({
        table,
        rowCount: count || 0,
        latestUpdate: latestDate,
        oldestRecord: oldestDate,
        status: (count || 0) === 0 ? "empty" : age > 7 * 86400000 ? "stale" : "fresh",
      });
    }
    setDataFreshness(freshness);

    // ─── Market Accuracy ──────────────────────────────────────────
    const { data: settledPreds } = await sb
      .from("predictions")
      .select("market, selection, result, model_probability, settled_at")
      .not("settled_at", "is", null)
      .limit(10000) as { data: any[] };

    const marketMap: Record<string, { total: number; correct: number; eliteTotal: number; eliteCorrect: number }> = {};
    // Calibration buckets by predicted probability
    const calibRanges = [
      { min: 0.5, max: 0.6, label: "50-60%" },
      { min: 0.6, max: 0.7, label: "60-70%" },
      { min: 0.7, max: 0.8, label: "70-80%" },
      { min: 0.8, max: 0.9, label: "80-90%" },
      { min: 0.9, max: 1.01, label: "90%+" },
    ];
    const calibMap: Record<string, { total: number; correct: number; probSum: number }> = {};
    for (const r of calibRanges) calibMap[r.label] = { total: 0, correct: 0, probSum: 0 };

    for (const p of settledPreds || []) {
      // Only count definitively settled predictions — "pending" results are not accuracy data
      if (p.result !== "correct" && p.result !== "wrong") continue;
      const isCorrect = p.result === "correct";

      const key = `${p.market}/${p.selection}`;
      if (!marketMap[key]) marketMap[key] = { total: 0, correct: 0, eliteTotal: 0, eliteCorrect: 0 };
      marketMap[key].total++;
      if (isCorrect) marketMap[key].correct++;
      if (p.model_probability >= 0.70) {
        marketMap[key].eliteTotal++;
        if (isCorrect) marketMap[key].eliteCorrect++;
      }

      const prob = Number(p.model_probability) || 0;
      const bucket = calibRanges.find((r) => prob >= r.min && prob < r.max);
      if (bucket) {
        calibMap[bucket.label].total++;
        calibMap[bucket.label].probSum += prob;
        if (isCorrect) calibMap[bucket.label].correct++;
      }
    }

    setCalibrationBuckets(
      calibRanges
        .map((r) => {
          const b = calibMap[r.label];
          return {
            label: r.label,
            predicted: b.total > 0 ? Math.round((b.probSum / b.total) * 100) : 0,
            actual: b.total > 0 ? Math.round((b.correct / b.total) * 1000) / 10 : 0,
            total: b.total,
          };
        })
        .filter((b) => b.total > 0),
    );

    const marketAccArr: MarketAccuracy[] = Object.entries(marketMap)
      .map(([market, stats]) => ({
        market,
        total: stats.total,
        correct: stats.correct,
        accuracy: stats.total > 0 ? Number(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
        eliteCorrect: stats.eliteCorrect,
        eliteTotal: stats.eliteTotal,
        eliteAccuracy: stats.eliteTotal > 0 ? Number(((stats.eliteCorrect / stats.eliteTotal) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.accuracy - a.accuracy);

    setMarketAccuracy(marketAccArr);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchAll, REFRESH_INTERVAL);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll, autoRefresh]);

  // Compute accuracy considering both new (result=correct/wrong) and old (result=pending but settled) predictions
  const overallAccuracy = systemStats.settledPredictions > 0
    ? ((systemStats.correctPredictions / systemStats.settledPredictions) * 100).toFixed(1)
    : "0";
  // Real high-confidence (70%+ probability) accuracy aggregated from market breakdown
  const eliteTotals = marketAccuracy.reduce((s, m) => s + m.eliteTotal, 0);
  const eliteCorrect = marketAccuracy.reduce((s, m) => s + m.eliteCorrect, 0);
  const highConfAccuracy = eliteTotals > 0
    ? ((eliteCorrect / eliteTotals) * 100).toFixed(1)
    : null;

  const healthScore = [
    pipelineHealth.syncHealthy,
    pipelineHealth.predictHealthy,
    systemStats.totalFixtures > 0,
    systemStats.totalPredictions > 0,
    systemStats.correctPredictions > 0,
  ].filter(Boolean).length * 20;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-[24px]">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
            System Health
          </h1>
          <p className="text-[13px] text-gray-500">
            API usage, sync status, and prediction pipeline health at a glance.
          </p>
        </div>
        <div className="flex items-center gap-[12px]">
          <div className="flex items-center gap-[6px]">
            <div className={`w-[8px] h-[8px] rounded-full ${autoRefresh ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
            <span className="text-[11px] text-gray-400">
              {autoRefresh ? "Live" : "Paused"} · {lastRefresh.toLocaleTimeString()}
            </span>
          </div>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-[10px] py-[5px] rounded-[8px] text-[11px] font-semibold transition-all ${
              autoRefresh ? "bg-green-50 text-green-600 hover:bg-green-100" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {autoRefresh ? "⏸ Pause" : "▶ Resume"}
          </button>
          <button
            onClick={fetchAll}
            className="px-[10px] py-[5px] rounded-[8px] text-[11px] font-semibold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-all flex items-center gap-[4px]"
          >
            <i className="ri-refresh-line" /> Refresh
          </button>
        </div>
      </div>

      {/* Health Score + Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-[12px] mb-[24px]">
        {/* Health Score */}
        <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <span className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center ${
              healthScore >= 80 ? "bg-green-50 text-green-600" :
              healthScore >= 60 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"
            }`}>
              <i className="ri-heart-pulse-line text-[16px]" />
            </span>
            <span className="text-[11px] text-gray-400">Health Score</span>
          </div>
          <span className={`text-[22px] font-mono font-bold ${
            healthScore >= 80 ? "text-green-600" : healthScore >= 60 ? "text-amber-600" : "text-red-600"
          }`}>
            {healthScore}%
          </span>
        </div>

        {/* Active Leagues */}
        <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <span className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center bg-blue-50 text-blue-600">
              <i className="ri-trophy-line text-[16px]" />
            </span>
            <span className="text-[11px] text-gray-400">Leagues</span>
          </div>
          <span className="text-[22px] font-mono font-bold text-[#0A0F1C]">
            {loading ? "—" : systemStats.totalLeagues}
          </span>
        </div>

        {/* Total Fixtures */}
        <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <span className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center bg-purple-50 text-purple-600">
              <i className="ri-calendar-check-line text-[16px]" />
            </span>
            <span className="text-[11px] text-gray-400">Fixtures</span>
          </div>
          <span className="text-[22px] font-mono font-bold text-[#0A0F1C]">
            {loading ? "—" : systemStats.totalFixtures.toLocaleString()}
          </span>
          <div className="flex items-center gap-[6px] mt-[2px]">
            <span className="text-[10px] text-green-600">{systemStats.finishedFixtures} finished</span>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-blue-600">{systemStats.scheduledFixtures} upcoming</span>
          </div>
        </div>

        {/* Overall Accuracy */}
        <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <span className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center ${
              parseFloat(overallAccuracy) >= 70 ? "bg-green-50 text-green-600" :
              parseFloat(overallAccuracy) >= 55 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"
            }`}>
              <i className="ri-percent-line text-[16px]" />
            </span>
            <span className="text-[11px] text-gray-400">Accuracy</span>
          </div>
          <span className={`text-[22px] font-mono font-bold ${
            parseFloat(overallAccuracy) >= 70 ? "text-green-600" :
            parseFloat(overallAccuracy) >= 55 ? "text-amber-600" : "text-red-600"
          }`}>
            {loading ? "—" : `${overallAccuracy}%`}
          </span>
          <div className="text-[10px] text-gray-400 mt-[2px]">
            {systemStats.correctPredictions.toLocaleString()} / {systemStats.settledPredictions.toLocaleString()} settled
          </div>
        </div>

        {/* Active Users */}
        <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <span className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center bg-amber-50 text-amber-600">
              <i className="ri-user-line text-[16px]" />
            </span>
            <span className="text-[11px] text-gray-400">Users</span>
          </div>
          <span className="text-[22px] font-mono font-bold text-[#0A0F1C]">
            {loading ? "—" : systemStats.totalUsers}
          </span>
          <div className="text-[10px] text-green-600 mt-[2px]">
            {systemStats.activeUsers} new (7d)
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-[16px]">
        {/* Main Column */}
        <div className="space-y-[16px]">
          {/* API Status */}
          <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">API Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[10px]">
              {/* The Odds API */}
              <div className="p-[14px] bg-gray-50 rounded-[12px]">
                <div className="flex items-center justify-between mb-[10px]">
                  <div className="flex items-center gap-[8px]">
                    <span className={`w-[8px] h-[8px] rounded-full ${
                      apiStatus.oddsApi.status === "active" ? "bg-green-500" : "bg-gray-300"
                    }`} />
                    <span className="text-[13px] font-semibold text-[#0A0F1C]">The Odds API</span>
                  </div>
                  <span className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full ${
                    apiStatus.oddsApi.status === "active" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"
                  }`}>
                    {apiStatus.oddsApi.status === "active" ? "ACTIVE" : "UNKNOWN"}
                  </span>
                </div>
                <div className="space-y-[6px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Plan</span>
                    <span className="text-[11px] font-mono text-[#0A0F1C]">Free (500/mo)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Used</span>
                    <span className="text-[11px] font-mono font-semibold text-[#0A0F1C]">
                      {apiStatus.oddsApi.used.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-[4px]">
                    <div
                      className={`h-[4px] rounded-full transition-all ${
                        apiStatus.oddsApi.used > 400 ? "bg-red-500" :
                        apiStatus.oddsApi.used > 300 ? "bg-amber-500" : "bg-green-500"
                      }`}
                      style={{ width: `${Math.min((apiStatus.oddsApi.used / 500) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-300">Remaining</span>
                    <span className="text-[10px] font-mono text-gray-500">{apiStatus.oddsApi.remaining}</span>
                  </div>
                </div>
              </div>

              {/* football-data.org */}
              <div className="p-[14px] bg-gray-50 rounded-[12px]">
                <div className="flex items-center justify-between mb-[10px]">
                  <div className="flex items-center gap-[8px]">
                    <span className={`w-[8px] h-[8px] rounded-full ${
                      apiStatus.footballData.status === "active" ? "bg-green-500" : "bg-gray-300"
                    }`} />
                    <span className="text-[13px] font-semibold text-[#0A0F1C]">football-data.org</span>
                  </div>
                  <span className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full ${
                    apiStatus.footballData.status === "active" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"
                  }`}>
                    {apiStatus.footballData.status === "active" ? "ACTIVE" : "UNKNOWN"}
                  </span>
                </div>
                <div className="space-y-[6px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Plan</span>
                    <span className="text-[11px] font-mono text-[#0A0F1C]">Free (10/min)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Use case</span>
                    <span className="text-[11px] text-[#0A0F1C]">Historical data</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Status</span>
                    <span className="text-[11px] text-gray-500">
                      {apiStatus.footballData.status === "active" ? "Connected" : "Not monitored"}
                    </span>
                  </div>
                </div>
              </div>

              {/* StatsBomb */}
              <div className="p-[14px] bg-gray-50 rounded-[12px]">
                <div className="flex items-center justify-between mb-[10px]">
                  <div className="flex items-center gap-[8px]">
                    <span className={`w-[8px] h-[8px] rounded-full ${
                      apiStatus.statsBomb.status === "active" ? "bg-green-500" : "bg-gray-300"
                    }`} />
                    <span className="text-[13px] font-semibold text-[#0A0F1C]">StatsBomb</span>
                  </div>
                  <span className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full ${
                    apiStatus.statsBomb.status === "active" ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"
                  }`}>
                    {apiStatus.statsBomb.status === "active" ? "LOADED" : "NO DATA"}
                  </span>
                </div>
                <div className="space-y-[6px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Source</span>
                    <span className="text-[11px] text-[#0A0F1C]">GitHub (free)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Matches</span>
                    <span className="text-[11px] font-mono font-semibold text-[#0A0F1C]">
                      {apiStatus.statsBomb.matchesCollected !== null ? apiStatus.statsBomb.matchesCollected.toLocaleString() : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Teams with xG</span>
                    <span className="text-[11px] font-mono text-[#0A0F1C]">
                      {apiStatus.statsBomb.teamsWithXG !== null ? apiStatus.statsBomb.teamsWithXG.toLocaleString() : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pipeline Health */}
          <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">Pipeline Health</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
              {[
                {
                  label: "Fixture Sync",
                  healthy: pipelineHealth.syncHealthy,
                  lastRun: pipelineHealth.lastSyncTime,
                  icon: "ri-calendar-check-line",
                  color: "bg-blue-50 text-blue-600",
                },
                {
                  label: "Predictions",
                  healthy: pipelineHealth.predictHealthy,
                  lastRun: pipelineHealth.lastPredictTime,
                  icon: "ri-brain-line",
                  color: "bg-purple-50 text-purple-600",
                },
                {
                  label: "Daily Cron",
                  healthy: pipelineHealth.dailySyncEnabled,
                  lastRun: pipelineHealth.cronNextRun,
                  icon: "ri-refresh-line",
                  color: "bg-green-50 text-green-600",
                  isFuture: true,
                },
                {
                  label: "Data Pipeline",
                  healthy: systemStats.totalFixtures > 0 && systemStats.totalPredictions > 0,
                  lastRun: null,
                  icon: "ri-database-2-line",
                  color: "bg-amber-50 text-amber-600",
                },
              ].map((item) => (
                <div key={item.label} className="p-[14px] bg-gray-50 rounded-[12px]">
                  <div className="flex items-center justify-between mb-[8px]">
                    <div className="flex items-center gap-[6px]">
                      <span className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center ${item.color}`}>
                        <i className={`${item.icon} text-[14px]`} />
                      </span>
                    </div>
                    <span className={`w-[8px] h-[8px] rounded-full ${item.healthy ? "bg-green-500" : "bg-red-500"}`} />
                  </div>
                  <span className="text-[12px] font-semibold text-[#0A0F1C] block">{item.label}</span>
                  <span className={`text-[11px] font-semibold ${item.healthy ? "text-green-600" : "text-red-500"}`}>
                    {item.healthy ? "Healthy" : "Needs Attention"}
                  </span>
                  {item.lastRun && (
                    <span className="text-[10px] text-gray-400 block mt-[4px]">
                      {item.isFuture ? "Next: " : "Last: "}
                      {new Date(item.lastRun).toLocaleString("en-US", {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Real-Time Forward-Test Accuracy */}
          <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-[14px]">
              <h2 className="text-[14px] font-semibold text-[#0A0F1C]">Forward-Test Accuracy</h2>
              <div className="flex items-center gap-[6px]">
                <div className="w-[6px] h-[6px] rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] text-gray-400">Live</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
              <div className="p-[12px] bg-green-50 rounded-[10px] text-center">
                <span className="text-[20px] font-bold text-green-600 font-mono">{overallAccuracy}%</span>
                <span className="text-[10px] text-green-600/60 block mt-[2px]">Overall</span>
              </div>
              <div className="p-[12px] bg-[#1B2A4A]/5 rounded-[10px] text-center">
                <span className="text-[20px] font-bold text-[#1B2A4A] font-mono">
                  {highConfAccuracy !== null ? `${highConfAccuracy}%` : "—"}
                </span>
                <span className="text-[10px] text-[#1B2A4A]/60 block mt-[2px]">ELITE (70%+ prob)</span>
              </div>
              <div className="p-[12px] bg-blue-50 rounded-[10px] text-center">
                <span className="text-[20px] font-bold text-blue-600 font-mono">
                  {calibrationBuckets.find((b) => b.label === "90%+")?.actual.toFixed(1) ?? "—"}%
                </span>
                <span className="text-[10px] text-blue-600/60 block mt-[2px]">90%+ Confidence</span>
              </div>
              <div className="p-[12px] bg-amber-50 rounded-[10px] text-center">
                <span className="text-[20px] font-bold text-amber-600 font-mono">{systemStats.settledPredictions.toLocaleString()}</span>
                <span className="text-[10px] text-amber-600/60 block mt-[2px]">Settled</span>
              </div>
            </div>
            {/* Confidence Calibration Mini-Chart — computed from settled predictions */}
            <div className="mt-[14px] p-[12px] bg-gray-50 rounded-[10px]">
              <span className="text-[11px] font-semibold text-gray-500 mb-[8px] block">Confidence Calibration</span>
              {calibrationBuckets.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-[12px] text-center">No settled predictions in the 50%+ probability range yet.</p>
              ) : (
                <>
                  <div className="flex items-end gap-[4px] h-[40px]">
                    {calibrationBuckets.map((b) => (
                      <div key={b.label} className="flex-1 flex flex-col items-center">
                        <div className="w-full bg-gray-200 rounded-[3px] relative" style={{ height: "30px" }}>
                          <div
                            className="absolute bottom-0 w-full bg-[#1B2A4A] rounded-[3px] transition-all"
                            style={{ height: `${Math.min(b.actual, 100) * 0.3}px` }}
                          />
                        </div>
                        <span className="text-[8px] text-gray-400 mt-[2px]">{b.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-[4px]">
                    <span className="text-[9px] text-gray-300">Bar height = actual accuracy (n={calibrationBuckets.reduce((s, b) => s + b.total, 0)})</span>
                    <span className="text-[9px] text-gray-300">Avg predicted shown per bucket</span>
                  </div>
                  <div className="flex flex-wrap gap-[6px] mt-[4px]">
                    {calibrationBuckets.map((b) => (
                      <span key={b.label} className="text-[9px] text-gray-400 font-mono">
                        {b.label}: pred {b.predicted}% → actual {b.actual}% ({b.total})
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Market Accuracy Breakdown */}
          {marketAccuracy.length > 0 && (
            <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
              <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">Market Accuracy Breakdown</h2>
              <div className="space-y-[6px]">
                {marketAccuracy.map((m) => (
                  <div key={m.market} className="flex items-center gap-[12px] p-[10px] bg-gray-50 rounded-[10px]">
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] font-semibold text-[#0A0F1C] block">{m.market}</span>
                      <span className="text-[10px] text-gray-400">{m.correct}/{m.total} correct</span>
                    </div>
                    <div className="flex items-center gap-[8px] flex-none">
                      <div className="w-[80px] h-[4px] bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            m.accuracy >= 70 ? "bg-green-500" : m.accuracy >= 55 ? "bg-amber-500" : "bg-red-500"
                          }`}
                          style={{ width: `${Math.min(m.accuracy, 100)}%` }}
                        />
                      </div>
                      <span className={`text-[13px] font-bold font-mono ${
                        m.accuracy >= 70 ? "text-green-600" : m.accuracy >= 55 ? "text-amber-600" : "text-red-600"
                      }`}>
                        {m.accuracy}%
                      </span>
                    </div>
                    {m.eliteTotal > 0 && (
                      <div className="text-right flex-none">
                        <span className="text-[10px] text-gray-400 block">ELITE</span>
                        <span className="text-[11px] font-mono font-semibold text-[#0A0F1C]">
                          {m.eliteAccuracy}%
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-[16px]">
          {/* Data Freshness */}
          <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">Data Freshness</h3>
            <div className="space-y-[6px]">
              {dataFreshness.map((d) => (
                <div key={d.table} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]">
                  <div className="flex items-center gap-[8px]">
                    <span className={`w-[6px] h-[6px] rounded-full ${
                      d.status === "fresh" ? "bg-green-500" :
                      d.status === "stale" ? "bg-amber-500" : "bg-gray-300"
                    }`} />
                    <span className="text-[12px] font-medium text-[#0A0F1C]">{d.table}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-mono font-semibold text-[#0A0F1C] block">
                      {d.rowCount.toLocaleString()}
                    </span>
                    {d.latestUpdate && (
                      <span className="text-[9px] text-gray-400">
                        {new Date(d.latestUpdate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">Quick Actions</h3>
            <div className="space-y-[6px]">
              {[
                { label: "Run Predictions", icon: "ri-brain-line", href: "/admin/pipeline", color: "text-purple-600" },
                { label: "View Accuracy", icon: "ri-line-chart-line", href: "/admin/accuracy", color: "text-green-600" },
                { label: "User Management", icon: "ri-user-settings-line", href: "/admin/users", color: "text-blue-600" },
                { label: "Model Health", icon: "ri-heart-pulse-line", href: "/admin/model-health", color: "text-amber-600" },
              ].map((action) => (
                <a
                  key={action.label}
                  href={action.href}
                  className="flex items-center gap-[8px] p-[10px] bg-gray-50 rounded-[10px] hover:bg-gray-100 transition-colors"
                >
                  <i className={`${action.icon} text-[14px] ${action.color}`} />
                  <span className="text-[12px] font-medium text-[#0A0F1C]">{action.label}</span>
                  <i className="ri-arrow-right-s-line text-[14px] text-gray-300 ml-auto" />
                </a>
              ))}
            </div>
          </div>

          {/* System Info */}
          <div className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">System Info</h3>
            <div className="space-y-[6px]">
              {[
                { label: "Odds Snapshots", value: systemStats.totalOddsSnapshots.toLocaleString() },
                { label: "Teams Tracked", value: systemStats.totalTeams.toString() },
                { label: "Predictions/Match", value: systemStats.finishedFixtures > 0 ? `${Math.round(systemStats.totalPredictions / systemStats.finishedFixtures)}` : "—" },
                { label: "Settlement Rate", value: systemStats.totalPredictions > 0 ? `${((systemStats.settledPredictions / systemStats.totalPredictions) * 100).toFixed(0)}%` : "0%" },
                { label: "Platform", value: "Vercel + Supabase" },
                { label: "Model", value: "Poisson + Elo + xG v4.2" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between p-[8px] rounded-[8px]">
                  <span className="text-[11px] text-gray-400">{item.label}</span>
                  <span className="text-[11px] font-mono font-semibold text-[#0A0F1C]">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
