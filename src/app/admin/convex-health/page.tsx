"use client";

import React, { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

// ─── Inline UI Components ──────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  color = "bg-blue-50 text-blue-600",
  subtitle,
  trend,
}: {
  label: string;
  value: string | number;
  icon: string;
  color?: string;
  subtitle?: string;
  trend?: "up" | "down" | "stable";
}) {
  return (
    <div className="bg-white rounded-[14px] border border-gray-100 p-[16px]">
      <div className="flex items-center gap-[10px] mb-[8px]">
        <div className={`w-[32px] h-[32px] rounded-[10px] flex items-center justify-center ${color}`}>
          <i className={`${icon} text-[16px]`} />
        </div>
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="text-[28px] font-bold font-mono tabular-nums text-[#0A0F1C] leading-none">
        {value}
      </div>
      {subtitle && (
        <div className="flex items-center gap-[4px] mt-[4px]">
          {trend && (
            <i
              className={`text-[10px] ${
                trend === "up"
                  ? "ri-arrow-up-line text-green-500"
                  : trend === "down"
                    ? "ri-arrow-down-line text-red-500"
                    : "ri-subtract-line text-gray-400"
              }`}
            />
          )}
          <p className="text-[11px] text-gray-400">{subtitle}</p>
        </div>
      )}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-[14px] border border-gray-100 ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-[20px] py-[16px] border-b border-gray-50 flex items-center justify-between">
      <div>
        <h3 className="text-[14px] font-semibold text-[#0A0F1C]">{title}</h3>
        {description && (
          <p className="text-[11px] text-gray-400 mt-[2px]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "success" | "danger" | "warning" | "default" | "info";
}) {
  const colors = {
    success: "bg-green-50 text-green-600",
    danger: "bg-red-50 text-red-600",
    warning: "bg-amber-50 text-amber-600",
    info: "bg-blue-50 text-blue-600",
    default: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`text-[10px] font-bold px-[8px] py-[3px] rounded-full ${colors[variant]}`}>
      {children}
    </span>
  );
}

// ─── Migration Status Data ──────────────────────────────────────

// Slim schema — only real-time tables remain in Convex
const MIGRATION_TABLES = [
  { name: "Leagues", convexKey: "leagues", supabaseTable: "leagues", icon: "ri-trophy-line" },
  { name: "Teams", convexKey: "teams", supabaseTable: "teams", icon: "ri-team-line" },
  { name: "Live Pick", convexKey: "livePick", supabaseTable: null, icon: "ri-crosshair-2-line" },
  { name: "Value Picks", convexKey: "valuePicks", supabaseTable: null, icon: "ri-money-dollar-circle-line" },
  { name: "Settlement Feed", convexKey: "settlementFeed", supabaseTable: "predictions", icon: "ri-file-list-3-line" },
  { name: "Live Stats", convexKey: "liveStats", supabaseTable: null, icon: "ri-pulse-line" },
];

// ─── Main Dashboard ───────────────────────────────────────────

export default function ConvexHealthPage() {
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [supabaseCounts, setSupabaseCounts] = useState<Record<string, number>>({});
  const [loadingSupabase, setLoadingSupabase] = useState(true);

  // Real-time Convex queries
  const liveStats = useQuery(api.realtime.getLiveStats);
  const latestPredictions = useQuery(api.realtime.getSettlementUpdates, { limit: 20 });
  const settlementUpdates = useQuery(api.realtime.getSettlementUpdates, { limit: 20 });
  const valuePicks = useQuery(api.realtime.getValuePicksLive, { limit: 30 });
  const marketAccuracy = useQuery(api.realtime.getSettlementByMarket);
  const convexStats = useQuery(api.predictions.getStats);

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(() => setLastRefresh(new Date()), 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Supabase counts
  useEffect(() => {
    async function fetchSupabase() {
      try {
        const res = await fetch("/api/v1/admin/db-health");
        const data = await res.json();
        if (data.data?.supabase?.tables) {
          setSupabaseCounts(data.data.supabase.tables);
        }
      } catch {}
      setLoadingSupabase(false);
    }
    fetchSupabase();
    const interval = setInterval(fetchSupabase, 60000);
    return () => clearInterval(interval);
  }, []);

  const isLoading = liveStats === undefined || convexStats === undefined;

  // Parse Convex stats (handles number or string values)
  function parseConvexCount(val: string | number | undefined): number {
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const match = val.match(/[\d.]+/);
      if (match) {
        const n = parseFloat(match[0]);
        if (val.includes("K")) return Math.round(n * 1000);
        if (val.includes("M")) return Math.round(n * 1000000);
        return Math.round(n);
      }
    }
    return 0;
  }

  function getConvexCount(key: string): number {
    return parseConvexCount((convexStats as any)?.[key]);
  }

  function getSupabaseCount(table: string): number {
    return supabaseCounts[table] || 0;
  }

  function getMigrationPct(convex: number, supabase: number): number {
    if (supabase === 0) return convex > 0 ? 100 : 0;
    return Math.min(Math.round((convex / supabase) * 100), 100);
  }

  const totalConvex = MIGRATION_TABLES.reduce(
    (sum, t) => sum + getConvexCount(t.convexKey),
    0,
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-[8px] mb-[4px]">
            <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C]">
              Convex Health
            </h1>
            <Badge variant="success">LIVE</Badge>
          </div>
          <p className="text-[13px] text-gray-500">
            Convex (real-time only) — 7 lightweight tables. Heavy data (599K predictions, 15K odds) lives in Supabase.
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <div className="w-[8px] h-[8px] rounded-full bg-green-500 animate-pulse" />
          <span className="text-[11px] text-gray-400">
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Connection Status */}
      <div className="flex items-center gap-[16px] p-[12px] bg-white rounded-[12px] border border-gray-100">
        <div className="flex items-center gap-[6px]">
          <div className="w-[6px] h-[6px] rounded-full bg-green-500" />
          <span className="text-[12px] font-medium text-gray-600">Supabase (Hot)</span>
        </div>
        <div className="w-px h-[16px] bg-gray-200" />
        <div className="flex items-center gap-[6px]">
          <div className="w-[6px] h-[6px] rounded-full bg-green-500" />
          <span className="text-[12px] font-medium text-gray-600">Convex (Cold/Realtime)</span>
        </div>
        <div className="w-px h-[16px] bg-gray-200" />
        <span className="text-[11px] text-gray-400">
          Hybrid Architecture Active — limitless-mole-387.convex.cloud
        </span>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-[12px]">
        <StatCard
          label="Convex Records"
          value={isLoading ? "—" : totalConvex.toLocaleString()}
          icon="ri-database-2-line"
          color="bg-purple-50 text-purple-600"
          subtitle="7 lightweight tables"
        />
        <StatCard
          label="Teams"
          value={isLoading ? "—" : getConvexCount("teams").toLocaleString()}
          icon="ri-team-line"
          color="bg-blue-50 text-blue-600"
          subtitle={`${getSupabaseCount("teams")} in Supabase`}
        />
        <StatCard
          label="Leagues"
          value={isLoading ? "—" : getConvexCount("leagues").toLocaleString()}
          icon="ri-trophy-line"
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Live Pick"
          value={isLoading ? "—" : getConvexCount("livePick")}
          icon="ri-crosshair-2-line"
          color="bg-green-50 text-green-600"
          subtitle="Current pick of the day"
        />
        <StatCard
          label="Value Picks"
          value={isLoading ? "—" : getConvexCount("valuePicks")}
          icon="ri-money-dollar-circle-line"
          color="bg-cyan-50 text-cyan-600"
          subtitle="Live value bets"
        />
      </div>

      {/* ─── Migration Status Table ─────────────────────────── */}
      <Card>
        <CardHeader
          title="Migration Status"
          description="Supabase vs Convex data comparison — are all records migrated?"
          action={
            loadingSupabase ? (
              <Badge variant="default">Loading...</Badge>
            ) : (
              <Badge variant="info">{MIGRATION_TABLES.length} tables</Badge>
            )
          }
        />
        <div className="p-[16px]">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Table</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Supabase</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Convex</th>
                  <th className="text-center py-[8px] px-[10px] font-medium text-gray-500 min-w-[140px]">Progress</th>
                  <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {MIGRATION_TABLES.map((table) => {
                  const convex = getConvexCount(table.convexKey);
                  const supabase = table.supabaseTable
                    ? getSupabaseCount(table.supabaseTable)
                    : 0;
                  const pct = getMigrationPct(convex, supabase);
                  const status =
                    table.supabaseTable === null
                      ? convex > 0
                        ? "convex-only"
                        : "empty"
                      : pct >= 100
                        ? "complete"
                        : pct > 0
                          ? "partial"
                          : "pending";

                  return (
                    <tr
                      key={table.name}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                    >
                      <td className="py-[10px] px-[10px]">
                        <div className="flex items-center gap-[8px]">
                          <i className={`${table.icon} text-[14px] text-gray-400`} />
                          <span className="font-semibold text-[#0A0F1C]">{table.name}</span>
                        </div>
                      </td>
                      <td className="text-right py-[10px] px-[10px] font-mono tabular-nums text-gray-600">
                        {loadingSupabase ? (
                          <div className="inline-block w-[40px] h-[14px] bg-gray-100 rounded animate-pulse" />
                        ) : table.supabaseTable ? (
                          supabase.toLocaleString()
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="text-right py-[10px] px-[10px] font-mono tabular-nums font-semibold text-[#0A0F1C]">
                        {convex.toLocaleString()}
                      </td>
                      <td className="py-[10px] px-[10px]">
                        <div className="flex items-center gap-[8px]">
                          <div className="flex-1 h-[6px] bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                pct >= 100
                                  ? "bg-green-500"
                                  : pct > 50
                                    ? "bg-amber-500"
                                    : pct > 0
                                      ? "bg-red-500"
                                      : "bg-gray-200"
                              }`}
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-gray-400 w-[32px] text-right">
                            {pct}%
                          </span>
                        </div>
                      </td>
                      <td className="text-center py-[10px] px-[10px]">
                        {status === "complete" ? (
                          <Badge variant="success">✓ Complete</Badge>
                        ) : status === "convex-only" ? (
                          <Badge variant="info">Convex Only</Badge>
                        ) : status === "partial" ? (
                          <Badge variant="warning">{pct}% Migrated</Badge>
                        ) : status === "empty" ? (
                          <Badge variant="danger">Empty</Badge>
                        ) : (
                          <Badge variant="default">Pending</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="py-[10px] px-[10px] text-[#0A0F1C]">Total</td>
                  <td className="text-right py-[10px] px-[10px] font-mono">
                    {loadingSupabase
                      ? "—"
                      : MIGRATION_TABLES.reduce(
                          (sum, t) =>
                            sum + (t.supabaseTable ? getSupabaseCount(t.supabaseTable) : 0),
                          0,
                        ).toLocaleString()}
                  </td>
                  <td className="text-right py-[10px] px-[10px] font-mono">
                    {totalConvex.toLocaleString()}
                  </td>
                  <td />
                  <td className="text-center py-[10px] px-[10px]">
                    {(() => {
                      const supTotal = MIGRATION_TABLES.reduce(
                        (sum, t) =>
                          sum + (t.supabaseTable ? getSupabaseCount(t.supabaseTable) : 0),
                        0,
                      );
                      const overall = supTotal > 0 ? Math.round((totalConvex / supTotal) * 100) : 100;
                      return (
                        <Badge variant={overall >= 90 ? "success" : overall >= 50 ? "warning" : "danger"}>
                          {overall}% Overall
                        </Badge>
                      );
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Card>

      {/* ─── Live Accuracy ─────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Live Prediction Accuracy"
          description="Real-time settled prediction stats from Convex"
        />
        <div className="p-[20px]">
          {isLoading ? (
            <div className="grid grid-cols-4 gap-[12px]">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[60px] bg-gray-50 rounded-[8px] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
              <div className="text-center p-[12px] bg-gray-50 rounded-[10px]">
                <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-[4px]">
                  Settled
                </div>
                <div className="text-[24px] font-bold font-mono text-[#0A0F1C]">
                  {(liveStats?.totalPredictions ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="text-center p-[12px] bg-green-50 rounded-[10px]">
                <div className="text-[11px] font-semibold text-green-600 uppercase tracking-wider mb-[4px]">
                  Correct
                </div>
                <div className="text-[24px] font-bold font-mono text-green-600">
                  {(liveStats?.correct ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="text-center p-[12px] bg-red-50 rounded-[10px]">
                <div className="text-[11px] font-semibold text-red-600 uppercase tracking-wider mb-[4px]">
                  Wrong
                </div>
                <div className="text-[24px] font-bold font-mono text-red-600">
                  {(liveStats?.wrong ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="text-center p-[12px] bg-blue-50 rounded-[10px]">
                <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider mb-[4px]">
                  Accuracy
                </div>
                <div className="text-[24px] font-bold font-mono text-blue-600">
                  {liveStats?.accuracy ?? 0}%
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ─── Market Accuracy + Value Picks ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
        <Card>
          <CardHeader
            title="Accuracy by Market"
            description="Convex settled predictions breakdown"
          />
          <div className="p-[16px]">
            {!marketAccuracy || marketAccuracy.length === 0 ? (
              <div className="text-center py-[24px] text-gray-400">
                <i className="ri-bar-chart-line text-[24px] block mb-[4px] opacity-50" />
                <p className="text-[12px]">No market data in Convex yet</p>
              </div>
            ) : (
              <div className="space-y-[6px]">
                {marketAccuracy.map((m) => (
                  <div key={m.market} className="flex items-center gap-[12px] p-[10px] bg-gray-50 rounded-[8px]">
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] font-semibold text-[#0A0F1C] block capitalize">
                        {m.market.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {m.correct}/{m.total} correct
                      </span>
                    </div>
                    <div className="flex items-center gap-[8px] flex-none">
                      <div className="w-[60px] h-[4px] bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            m.accuracy >= 65 ? "bg-green-500" : m.accuracy >= 55 ? "bg-amber-500" : "bg-red-500"
                          }`}
                          style={{ width: `${Math.min(m.accuracy, 100)}%` }}
                        />
                      </div>
                      <span
                        className={`text-[13px] font-bold font-mono ${
                          m.accuracy >= 65 ? "text-green-600" : m.accuracy >= 55 ? "text-amber-600" : "text-red-600"
                        }`}
                      >
                        {m.accuracy}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Live Value Picks"
            description="Real-time value detection from Convex"
            action={
              valuePicks && valuePicks.length > 0 ? (
                <Badge variant="success">{valuePicks.length} active</Badge>
              ) : undefined
            }
          />
          <div className="p-[16px]">
            {!valuePicks || valuePicks.length === 0 ? (
              <div className="text-center py-[24px] text-gray-400">
                <i className="ri-search-eye-line text-[24px] block mb-[4px] opacity-50" />
                <p className="text-[12px]">No value picks detected yet</p>
              </div>
            ) : (
              <div className="space-y-[6px] max-h-[260px] overflow-y-auto">
                {valuePicks.slice(0, 10).map((pick, i) => (
                  <div key={i} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-[6px]">
                        <span
                          className={`text-[10px] font-bold px-[6px] py-[1px] rounded-full ${
                            pick.tier === "ELITE"
                              ? "bg-green-100 text-green-700"
                              : pick.tier === "HIGH"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {pick.tier}
                        </span>
                        <span className="text-[12px] font-semibold text-[#0A0F1C] truncate">
                          {pick.matchName || "Unknown Match"}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 capitalize">
                        {pick.market.replace(/_/g, " ")} — {pick.selection}
                      </span>
                    </div>
                    <div className="text-right flex-none ml-[8px]">
                      <div className="text-[14px] font-bold font-mono text-green-600">
                        +{((pick.edge ?? 0) * 100).toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {(pick.modelProb * 100).toFixed(0)}% vs implied
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ─── Settlement Feed ────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Settlement Feed"
          description="Latest settled predictions from Convex — updates in real-time"
        />
        <div className="p-[16px]">
          {!settlementUpdates || settlementUpdates.length === 0 ? (
            <div className="text-center py-[24px] text-gray-400">
              <i className="ri-checkbox-circle-line text-[24px] block mb-[4px] opacity-50" />
              <p className="text-[12px]">No settlement data yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Market</th>
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Selection</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Probability</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Version</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Result</th>
                    <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Settled</th>
                  </tr>
                </thead>
                <tbody>
                  {settlementUpdates.map((pred) => (
                    <tr
                      key={pred._id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                    >
                      <td className="py-[8px] px-[10px] font-medium text-[#0A0F1C] capitalize">
                        {pred.market.replace(/_/g, " ")}
                      </td>
                      <td className="py-[8px] px-[10px] text-gray-600 capitalize">
                        {pred.selection.replace(/_/g, " ")}
                      </td>
                      <td className="text-center py-[8px] px-[10px] font-mono tabular-nums">
                        {Math.round(pred.modelProbability * 100)}%
                      </td>
                      <td className="text-center py-[8px] px-[10px] text-gray-400">
                        {pred.modelVersion}
                      </td>
                      <td className="text-center py-[8px] px-[10px]">
                        {pred.result === "correct" ? (
                          <Badge variant="success">✓ Correct</Badge>
                        ) : (
                          <Badge variant="danger">✗ Wrong</Badge>
                        )}
                      </td>
                      <td className="text-right py-[8px] px-[10px] text-gray-400 font-mono text-[10px]">
                        {pred.settledAt ? new Date(pred.settledAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* ─── Architecture Diagram ───────────────────────────── */}
      <Card>
        <CardHeader
          title="Architecture"
          description="Data flow between Supabase (hot) and Convex (cold/realtime)"
        />
        <div className="p-[16px]">
          <pre className="text-[10px] text-gray-500 font-mono bg-gray-50 p-[16px] rounded-[10px] overflow-x-auto leading-[1.6]">
{`┌─────────────────────────────────┐     ┌─────────────────────────────────┐
│       SUPABASE (Primary)        │     │       CONVEX (Real-time Only)   │
├─────────────────────────────────┤     ├─────────────────────────────────┤
│ ✓ ${String(getSupabaseCount("fixtures") || "~14K").padStart(6)} Fixtures              │     │ ✓ ${String(getConvexCount("teams")).padStart(6)} Teams (reference)          │
│ ✓ ~599K Predictions (Historical)│     │ ✓ ${String(getConvexCount("leagues")).padStart(6)} Leagues (reference)        │
│ ✓ ~15K Odds Snapshots           │     │ ✓ Live Pick (real-time)              │
│ ✓ Auth & User Sessions          │     │ ✓ Value Picks (real-time)             │
│ ✓ User Accumulators             │     │ ✓ Settlement Feed (last 500)          │
│ ✓ xG, Referee, Injury Data      │     │ ✓ Live Stats Counters                 │
│ ✓ Model Performance History     │     │                                       │
│ ✓ Team/Player Features          │     │   7 tables, ~1.5K rows total          │
└──────────────┬──────────────────┘     └──────────────┬──────────────────┘
               │                                        │
               └────────────┬───────────────────────────┘
                            │
                  ┌─────────▼─────────┐
                  │   VERCEL (Edge)    │
                  │  Next.js App Router │
                  │  5 Cron Jobs        │
                  └────────────────────┘

  Real-time: ConvexReactClient → limitless-mole-387.convex.cloud
  Pipeline: Ensemble v2.0 → CLV Tracker → One-Game Pick Engine
  Analytics: /api/v1/analytics (Supabase) → calibration, markets, daily stats
  Cron: pipeline(30m) • settle(1h) • predict(2h) • sync(6h) • daily(6am)`}
          </pre>
        </div>
      </Card>
    </div>
  );
}
