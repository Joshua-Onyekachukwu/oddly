"use client";

import React, { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

// ─── Inline UI Components (matching admin theme) ──────────────

function StatCard({
  label,
  value,
  icon,
  color = "bg-blue-50 text-blue-600",
  subtitle,
}: {
  label: string;
  value: string | number;
  icon: string;
  color?: string;
  subtitle?: string;
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
        <p className="text-[11px] text-gray-400 mt-[4px]">{subtitle}</p>
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
  variant?: "success" | "danger" | "warning" | "default";
}) {
  const colors = {
    success: "bg-green-50 text-green-600",
    danger: "bg-red-50 text-red-600",
    warning: "bg-amber-50 text-amber-600",
    default: "bg-gray-100 text-gray-600",
  };
  return (
    <span
      className={`text-[10px] font-bold px-[8px] py-[3px] rounded-full ${colors[variant]}`}
    >
      {children}
    </span>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────

export default function ConvexHealthPage() {
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Real-time Convex queries
  const liveStats = useQuery(api.realtime.getLiveStats);
  const latestPredictions = useQuery(api.realtime.getLatestPredictions, {
    limit: 20,
  });
  const settlementUpdates = useQuery(api.realtime.getSettlementUpdates, {
    limit: 20,
  });
  const valuePicks = useQuery(api.realtime.getValuePicksLive, { limit: 30 });
  const marketAccuracy = useQuery(api.realtime.getSettlementByMarket);

  // Convex stats (via predictions module)
  const convexStats = useQuery(api.predictions.getStats);

  // Auto-refresh timestamp
  useEffect(() => {
    const interval = setInterval(() => setLastRefresh(new Date()), 10000);
    return () => clearInterval(interval);
  }, []);

  const isLoading =
    liveStats === undefined ||
    latestPredictions === undefined ||
    convexStats === undefined;

  const totalConvex =
    convexStats
      ? Object.values(convexStats).reduce(
          (a, b) => (a as number) + (typeof b === "number" ? b : 0),
          0,
        ) as number
      : 0;

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
            Real-time data from Convex cold storage — predictions, xG, referees,
            value picks.
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <div className="w-[8px] h-[8px] rounded-full bg-green-500 animate-pulse" />
          <span className="text-[11px] text-gray-400">
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="flex items-center gap-[16px] p-[12px] bg-white rounded-[12px] border border-gray-100">
        <div className="flex items-center gap-[6px]">
          <div className="w-[6px] h-[6px] rounded-full bg-green-500" />
          <span className="text-[12px] font-medium text-gray-600">
            Supabase (Hot)
          </span>
        </div>
        <div className="w-px h-[16px] bg-gray-200" />
        <div className="flex items-center gap-[6px]">
          <div className="w-[6px] h-[6px] rounded-full bg-green-500" />
          <span className="text-[12px] font-medium text-gray-600">
            Convex (Cold)
          </span>
        </div>
        <div className="w-px h-[16px] bg-gray-200" />
        <span className="text-[11px] text-gray-400">
          Hybrid Architecture Active — URL: limitless-mole-387.convex.cloud
        </span>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
        <StatCard
          label="Convex Records"
          value={isLoading ? "—" : totalConvex.toLocaleString()}
          icon="ri-database-2-line"
          color="bg-purple-50 text-purple-600"
          subtitle="Total across all tables"
        />
        <StatCard
          label="Teams"
          value={isLoading ? "—" : (convexStats?.teams ?? 0).toLocaleString()}
          icon="ri-team-line"
          color="bg-blue-50 text-blue-600"
        />
        <StatCard
          label="xG Profiles"
          value={isLoading ? "—" : (convexStats?.xgFeatures ?? 0).toLocaleString()}
          icon="ri-line-chart-line"
          color="bg-green-50 text-green-600"
        />
        <StatCard
          label="Referees"
          value={isLoading ? "—" : (convexStats?.referees ?? 0).toLocaleString()}
          icon="ri-user-star-line"
          color="bg-amber-50 text-amber-600"
        />
      </div>

      {/* Live Accuracy from Convex */}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
        {/* Market Accuracy from Convex */}
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
                  <div
                    key={m.market}
                    className="flex items-center gap-[12px] p-[10px] bg-gray-50 rounded-[8px]"
                  >
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
                            m.accuracy >= 65
                              ? "bg-green-500"
                              : m.accuracy >= 55
                                ? "bg-amber-500"
                                : "bg-red-500"
                          }`}
                          style={{ width: `${Math.min(m.accuracy, 100)}%` }}
                        />
                      </div>
                      <span
                        className={`text-[13px] font-bold font-mono ${
                          m.accuracy >= 65
                            ? "text-green-600"
                            : m.accuracy >= 55
                              ? "text-amber-600"
                              : "text-red-600"
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

        {/* Live Value Picks */}
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
                  <div
                    key={i}
                    className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]"
                  >
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

      {/* Recent Settlements Feed */}
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
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">
                      Market
                    </th>
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">
                      Selection
                    </th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">
                      Probability
                    </th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">
                      Model Version
                    </th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">
                      Result
                    </th>
                    <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">
                      Settled
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {settlementUpdates.map((pred) => (
                    <tr
                      key={pred._id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
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
                        {pred.settledAt
                          ? new Date(pred.settledAt).toLocaleString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Latest Predictions */}
      <Card>
        <CardHeader
          title="Latest Predictions"
          description="Most recent settled predictions from Convex"
        />
        <div className="p-[16px]">
          {!latestPredictions || latestPredictions.length === 0 ? (
            <div className="text-center py-[24px] text-gray-400">
              <i className="ri-file-list-3-line text-[24px] block mb-[4px] opacity-50" />
              <p className="text-[12px]">No predictions in Convex</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[8px]">
              {latestPredictions.slice(0, 10).map((pred) => (
                <div
                  key={pred._id}
                  className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]"
                >
                  <div className="flex items-center gap-[8px]">
                    <div
                      className={`w-[6px] h-[6px] rounded-full ${
                        pred.result === "correct"
                          ? "bg-green-500"
                          : pred.result === "wrong"
                            ? "bg-red-500"
                            : "bg-gray-300"
                      }`}
                    />
                    <div>
                      <span className="text-[11px] font-semibold text-[#0A0F1C] capitalize block">
                        {pred.market.replace(/_/g, " ")} —{" "}
                        {pred.selection.replace(/_/g, " ")}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        Fixture: {pred.fixtureId?.slice(0, 8)}…
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[13px] font-bold font-mono">
                      {Math.round(pred.modelProbability * 100)}%
                    </span>
                    <span
                      className={`text-[9px] font-bold ml-[4px] ${
                        pred.result === "correct"
                          ? "text-green-600"
                          : pred.result === "wrong"
                            ? "text-red-600"
                            : "text-gray-400"
                      }`}
                    >
                      {pred.result === "correct" ? "✓" : pred.result === "wrong" ? "✗" : "…"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Architecture Footer */}
      <Card>
        <div className="p-[16px]">
          <pre className="text-[10px] text-gray-400 font-mono bg-gray-50 p-[12px] rounded-[8px] overflow-x-auto">
{`Hybrid Architecture
====================
Supabase (Hot)                    Convex (Cold/Realtime)
├── Auth & Users                   ├── 838 Teams
├── Active Predictions             ├── ~30,000+ Predictions
├── Odds Snapshots                 ├── 946 xG Feature Profiles
├── User Accumulators              ├── 113 Referee Profiles
└── Profile & Subscription         ├── Value Picks
                                   └── Training Datasets

Real-time Subscriptions: ✓ Active
Convex URL: limitless-mole-387.convex.cloud
Dashboard: dashboard.convex.dev`}
          </pre>
        </div>
      </Card>
    </div>
  );
}
