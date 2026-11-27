"use client";

import React, { useState, useEffect, useCallback } from "react";
import { StatCard, Card, CardHeader, Badge } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

interface DBHealth {
  supabase: {
    connected: boolean;
    tables: Record<string, number>;
    totalRows: number;
    settledPredictions: number;
    unsettledPredictions: number;
  };
  convex: {
    connected: boolean;
    deprecated?: boolean;
    note?: string;
    tables: Record<string, number>;
    totalRows: number;
    error?: string;
  };
  ownership: Array<{
    dataset: string;
    supabase: boolean;
    convex: boolean;
    sourceOfTruth: string;
  }>;
  timestamp: string;
}

export default function DBHealthPage() {
  const [data, setData] = useState<DBHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/v1/admin/db-health", {
        cache: "no-store",
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data || json);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-gray-100 rounded" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-32 bg-gray-50 rounded" />
            <div className="h-32 bg-gray-50 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 mb-4">
          <span className="text-2xl">!</span>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Unable to Load</h2>
        <p className="text-sm text-gray-500">{error || "No data available"}</p>
        <button onClick={fetchData} className="mt-4 px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">
          Retry
        </button>
      </div>
    );
  }

  const sb = data.supabase;
  const cv = data.convex;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C]">Database Health</h1>
          <p className="text-[13px] text-gray-500 mt-1">
            Supabase table counts and settlement coverage — Last updated: {new Date(data.timestamp).toLocaleTimeString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${sb.connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-xs text-gray-500">Supabase {sb.connected ? "OK" : "Down"}</span>
        </div>
        <button
          onClick={fetchData}
          aria-label="Refresh database health"
          className="px-[10px] py-[5px] rounded-[8px] text-[11px] font-semibold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-all flex items-center gap-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <i className="ri-refresh-line" /> Refresh
        </button>
      </div>

      {/* Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Supabase */}
        <Card>
          <CardHeader title="Supabase (Operational)" />
          <div className="p-4">
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(sb.tables).map(([table, count]) => (
                <div key={table} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                  <span className="text-xs text-gray-600 truncate">{table}</span>
                  <span className="text-xs font-mono font-semibold text-gray-900">{(count as number).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Total Rows</span>
              <span className="text-sm font-bold text-gray-900">{sb.totalRows.toLocaleString()}</span>
            </div>
          </div>
        </Card>

        {/* Convex — deprecated */}
        <Card>
          <CardHeader title="Convex (Deprecated)" />
          <div className="p-4">
            <div className="text-center py-8 text-gray-400">
              <i className="ri-archive-line text-[28px] block mb-[8px] opacity-50" />
              <p className="text-sm">Convex has been fully migrated to Supabase</p>
              <p className="text-xs mt-1">{cv.note || "All data now lives in Supabase"}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Data Ownership Matrix */}
      <Card>
        <CardHeader title="Data Ownership Matrix" />
        <div className="p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-gray-500 font-medium">Dataset</th>
                <th className="text-center py-2 text-gray-500 font-medium">Supabase</th>
                <th className="text-center py-2 text-gray-500 font-medium">Convex</th>
                <th className="text-center py-2 text-gray-500 font-medium">Source of Truth</th>
              </tr>
            </thead>
            <tbody>
              {data.ownership.map((row) => (
                <tr key={row.dataset} className="border-b border-gray-50 last:border-0">
                  <td className="py-2 text-gray-700">{row.dataset}</td>
                  <td className="py-2 text-center">{row.supabase ? "Yes" : "-"}</td>
                  <td className="py-2 text-center">{row.convex ? "Yes" : "-"}</td>
                  <td className="py-2 text-center">
                    <Badge variant={row.sourceOfTruth === "Convex" ? "success" : "default"}>
                      {row.sourceOfTruth}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Architecture Diagram */}
      <Card>
        <CardHeader title="System Architecture" />
        <div className="p-4">
          <pre className="text-xs text-gray-600 font-mono bg-gray-50 p-4 rounded-lg overflow-x-auto">
{`                    Vercel (Application / API + Cron)
                      |
                Application/API Layer
                      |
                      v
                  Supabase
            All Data (Operational + Historical)
            * Auth & User Sessions
            * Fixtures, Predictions, Odds
            * xG Features, Referee Data
            * Training Sets & Snapshots
            * Realtime: live_pick, value_picks,
              settlement_feed, live_stats
                      |
                      v
              Cron Jobs (pipeline, settle,
              predict, sync, daily, learn)`}
          </pre>
        </div>
      </Card>
    </div>
  );
}
