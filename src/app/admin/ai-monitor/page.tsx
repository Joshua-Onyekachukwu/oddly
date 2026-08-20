"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface MonitorData {
  nvidia: {
    activeKeys: number;
    keyUsage: { keyPreview: string; requestCount: number }[];
    baseUrl: string;
  };
  cache: {
    totalEntries: number;
    todayEntries: number;
    todayChatCalls: number;
    todayPredictCalls: number;
    hitRate: number;
    byModel: Record<string, number>;
    recentEntries: {
      cache_key: string;
      model_used: string | null;
      created_at: string;
    }[];
  };
  predictions: {
    total: number;
    today: number;
    correct: number;
    wrong: number;
    accuracy: number;
    modelPerformance: {
      id: string;
      model_version: string;
      market: string | null;
      total_predictions: number | null;
      correct_predictions: number | null;
      brier_score: number | null;
      roi: number | null;
      created_at: string;
    }[];
  };
  recommendations: {
    total: number;
    recommended: number;
    topEdge: {
      edge: number;
      market: string;
      selection: string;
    }[];
  };
  trend: Record<string, { total: number; chat: number; predict: number }>;
  models: Record<string, string>;
  timestamp: string;
}

export default function AdminAIMonitorPage() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setError("Not authenticated");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/v1/ai-monitor", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const body = await res.json();
        setError(body.error || "Failed to fetch data");
        setLoading(false);
        return;
      }

      const monitorData = await res.json();
      setData(monitorData);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div>
        <div className="mb-[24px]">
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            AI Monitor
          </h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse"
            >
              <div className="h-[11px] w-[60px] bg-gray-200 rounded mb-[8px]" />
              <div className="h-[20px] w-[40px] bg-gray-200 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <div className="mb-[24px]">
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            AI Monitor
          </h1>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-[14px] p-[24px] text-center">
          <p className="text-[14px] text-red-600 mb-[12px]">
            <i className="ri-error-warning-line mr-[4px]" />
            {error}
          </p>
          <button
            onClick={fetchData}
            className="px-[16px] py-[8px] bg-red-600 text-white rounded-[8px] text-[13px] font-medium hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const d = data!;

  // Build trend chart data
  const trendDays = Object.keys(d.trend).sort();
  const maxTrend = Math.max(...trendDays.map((k) => d.trend[k].total), 1);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            AI Monitor
          </h1>
          <p className="text-[13px] text-gray-500">
            NVIDIA API usage, cache performance, and model analytics
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <span className="text-[11px] text-gray-400">
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={fetchData}
            className="px-[12px] py-[6px] bg-white border border-gray-200 rounded-[8px] text-[12px] font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center gap-[4px]"
          >
            <i className="ri-refresh-line" />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-[10px] p-[12px] mb-[16px] text-[13px] text-yellow-700">
          <i className="ri-alert-line mr-[4px]" />
          {error} — showing cached data
        </div>
      )}

      {/* Key Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
        <StatCard
          label="Total API Calls"
          value={d.cache.totalEntries.toLocaleString()}
          icon="ri-speed-line"
          color="blue"
          sub={`Today: ${d.cache.todayEntries}`}
        />
        <StatCard
          label="Active NVIDIA Keys"
          value={d.nvidia.activeKeys.toString()}
          icon="ri-key-2-line"
          color="green"
          sub={`Max: 10`}
        />
        <StatCard
          label="Chat Calls Today"
          value={d.cache.todayChatCalls.toLocaleString()}
          icon="ri-chat-1-line"
          color="purple"
          sub={`Predict: ${d.cache.todayPredictCalls}`}
        />
        <StatCard
          label="Prediction Accuracy"
          value={
            d.predictions.accuracy > 0 ? `${d.predictions.accuracy}%` : "—"
          }
          icon="ri-line-chart-line"
          color={d.predictions.accuracy >= 70 ? "green" : "orange"}
          sub={`${d.predictions.correct}W / ${d.predictions.wrong}L`}
        />
        <StatCard
          label="Total Predictions"
          value={d.predictions.total.toLocaleString()}
          icon="ri-brain-line"
          color="indigo"
          sub={`Today: ${d.predictions.today}`}
        />
        <StatCard
          label="Cache Hit Rate"
          value={d.cache.hitRate > 0 ? `${d.cache.hitRate}%` : "—"}
          icon="ri-database-2-line"
          color="teal"
          sub="Predict cache hits"
        />
        <StatCard
          label="Recommendations"
          value={d.recommendations.recommended.toLocaleString()}
          icon="ri-star-line"
          color="amber"
          sub={`of ${d.recommendations.total} total`}
        />
        <StatCard
          label="Top Edge"
          value={
            d.recommendations.topEdge.length > 0
              ? `+${(d.recommendations.topEdge[0].edge * 100).toFixed(1)}%`
              : "—"
          }
          icon="ri-fire-line"
          color="red"
          sub={
            d.recommendations.topEdge.length > 0
              ? d.recommendations.topEdge[0].market
              : "No value bets"
          }
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[24px]">
        {/* NVIDIA Key Usage */}
        <div className="bg-white rounded-[14px] border border-gray-100 p-[20px]">
          <div className="flex items-center gap-[8px] mb-[16px]">
            <div className="w-[32px] h-[32px] rounded-[8px] bg-green-50 flex items-center justify-center">
              <i className="ri-key-2-line text-[16px] text-green-600" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[#0A0F1C]">
                NVIDIA Key Rotation
              </h3>
              <p className="text-[11px] text-gray-400">
                Round-robin across {d.nvidia.activeKeys} active keys
              </p>
            </div>
          </div>

          {d.nvidia.keyUsage.length > 0 ? (
            <div className="space-y-[8px]">
              {d.nvidia.keyUsage
                .sort((a, b) => b.requestCount - a.requestCount)
                .map((key, i) => {
                  const maxCount = Math.max(
                    ...d.nvidia.keyUsage.map((k) => k.requestCount),
                    1
                  );
                  const pct = (key.requestCount / maxCount) * 100;
                  return (
                    <div key={i} className="flex items-center gap-[8px]">
                      <span className="text-[11px] font-mono text-gray-500 w-[100px] shrink-0">
                        {key.keyPreview}
                      </span>
                      <div className="flex-1 h-[6px] bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono font-medium text-gray-700 w-[32px] text-right">
                        {key.requestCount}
                      </span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 py-[16px] text-center">
              No API calls yet — keys will show usage after the first request
            </p>
          )}
        </div>

        {/* Model Map */}
        <div className="bg-white rounded-[14px] border border-gray-100 p-[20px]">
          <div className="flex items-center gap-[8px] mb-[16px]">
            <div className="w-[32px] h-[32px] rounded-[8px] bg-indigo-50 flex items-center justify-center">
              <i className="ri-robot-line text-[16px] text-indigo-600" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[#0A0F1C]">
                Model Map
              </h3>
              <p className="text-[11px] text-gray-400">
                NVIDIA models assigned to each task
              </p>
            </div>
          </div>

          <div className="space-y-[6px]">
            {Object.entries(d.models).map(([task, model]) => {
              const callsToday = d.cache.byModel[task] || 0;
              return (
                <div
                  key={task}
                  className="flex items-center justify-between py-[6px] px-[8px] rounded-[6px] hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-[8px]">
                    <span className="inline-flex items-center px-[6px] py-[2px] rounded-[4px] bg-gray-100 text-[10px] font-mono font-medium text-gray-600 uppercase">
                      {task}
                    </span>
                    <span className="text-[11px] text-gray-500 font-mono truncate max-w-[200px]">
                      {model}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-gray-400">
                    {callsToday > 0 ? `${callsToday} calls` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 7-Day Trend */}
      <div className="bg-white rounded-[14px] border border-gray-100 p-[20px] mb-[24px]">
        <div className="flex items-center gap-[8px] mb-[16px]">
          <div className="w-[32px] h-[32px] rounded-[8px] bg-blue-50 flex items-center justify-center">
            <i className="ri-bar-chart-grouped-line text-[16px] text-blue-600" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-[#0A0F1C]">
              7-Day API Usage Trend
            </h3>
            <p className="text-[11px] text-gray-400">
              Daily API calls (chat + predictions)
            </p>
          </div>
        </div>

        {trendDays.length > 0 ? (
          <div className="flex items-end gap-[4px] h-[120px]">
            {trendDays.map((day) => {
              const dayData = d.trend[day];
              const totalHeight = (dayData.total / maxTrend) * 100;
              const chatHeight = (dayData.chat / maxTrend) * 100;
              const predictHeight = (dayData.predict / maxTrend) * 100;
              return (
                <div
                  key={day}
                  className="flex-1 flex flex-col items-center gap-[4px]"
                >
                  <div
                    className="w-full rounded-t-[4px] relative"
                    style={{ height: `${totalHeight}%` }}
                  >
                    {/* Predict layer */}
                    <div
                      className="absolute bottom-0 w-full bg-indigo-400 rounded-b-[4px]"
                      style={{ height: `${predictHeight}%` }}
                    />
                    {/* Chat layer */}
                    <div
                      className="absolute bottom-0 w-full bg-blue-500 rounded-b-[4px]"
                      style={{ height: `${chatHeight}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 font-mono">
                    {day.substring(5)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[12px] text-gray-400 py-[32px] text-center">
            No trend data yet — will populate after API calls are made
          </p>
        )}

        {/* Legend */}
        {trendDays.length > 0 && (
          <div className="flex items-center gap-[16px] mt-[12px] justify-center">
            <div className="flex items-center gap-[4px]">
              <div className="w-[8px] h-[8px] rounded-[2px] bg-blue-500" />
              <span className="text-[10px] text-gray-500">Chat</span>
            </div>
            <div className="flex items-center gap-[4px]">
              <div className="w-[8px] h-[8px] rounded-[2px] bg-indigo-400" />
              <span className="text-[10px] text-gray-500">Predictions</span>
            </div>
          </div>
        )}
      </div>

      {/* Model Performance & Recent Cache */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[24px]">
        {/* Model Performance Table */}
        <div className="bg-white rounded-[14px] border border-gray-100 p-[20px]">
          <div className="flex items-center gap-[8px] mb-[16px]">
            <div className="w-[32px] h-[32px] rounded-[8px] bg-purple-50 flex items-center justify-center">
              <i className="ri-line-chart-line text-[16px] text-purple-600" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[#0A0F1C]">
                Model Performance
              </h3>
              <p className="text-[11px] text-gray-400">
                Accuracy metrics per model version
              </p>
            </div>
          </div>

          {d.predictions.modelPerformance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[8px] text-gray-500 font-medium">
                      Model
                    </th>
                    <th className="text-left py-[8px] text-gray-500 font-medium">
                      Market
                    </th>
                    <th className="text-right py-[8px] text-gray-500 font-medium">
                      Predictions
                    </th>
                    <th className="text-right py-[8px] text-gray-500 font-medium">
                      Accuracy
                    </th>
                    <th className="text-right py-[8px] text-gray-500 font-medium">
                      Brier
                    </th>
                    <th className="text-right py-[8px] text-gray-500 font-medium">
                      ROI
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.predictions.modelPerformance.map((perf) => {
                    const accuracy =
                      perf.total_predictions && perf.correct_predictions
                        ? Math.round(
                            (perf.correct_predictions /
                              perf.total_predictions) *
                              100
                          )
                        : null;
                    return (
                      <tr
                        key={perf.id}
                        className="border-b border-gray-50 last:border-0"
                      >
                        <td className="py-[8px] font-mono text-[10px] text-gray-600">
                          {perf.model_version}
                        </td>
                        <td className="py-[8px] text-gray-600">
                          {perf.market || "all"}
                        </td>
                        <td className="py-[8px] text-right font-mono text-gray-600">
                          {perf.total_predictions || 0}
                        </td>
                        <td className="py-[8px] text-right">
                          {accuracy !== null ? (
                            <span
                              className={`font-mono font-medium ${
                                accuracy >= 70
                                  ? "text-green-600"
                                  : accuracy >= 50
                                  ? "text-yellow-600"
                                  : "text-red-600"
                              }`}
                            >
                              {accuracy}%
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-[8px] text-right font-mono text-gray-500">
                          {perf.brier_score != null
                            ? perf.brier_score.toFixed(3)
                            : "—"}
                        </td>
                        <td className="py-[8px] text-right">
                          {perf.roi != null ? (
                            <span
                              className={`font-mono font-medium ${
                                perf.roi >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {perf.roi >= 0 ? "+" : ""}
                              {(perf.roi * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 py-[24px] text-center">
              No model performance data yet — runs after prediction settling
            </p>
          )}
        </div>

        {/* Recent API Calls */}
        <div className="bg-white rounded-[14px] border border-gray-100 p-[20px]">
          <div className="flex items-center gap-[8px] mb-[16px]">
            <div className="w-[32px] h-[32px] rounded-[8px] bg-orange-50 flex items-center justify-center">
              <i className="ri-time-line text-[16px] text-orange-600" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[#0A0F1C]">
                Recent API Calls
              </h3>
              <p className="text-[11px] text-gray-400">
                Last {d.cache.recentEntries.length} cached responses
              </p>
            </div>
          </div>

          {d.cache.recentEntries.length > 0 ? (
            <div className="space-y-[4px] max-h-[300px] overflow-y-auto">
              {d.cache.recentEntries.map((entry, i) => {
                const model = entry.model_used || "unknown";
                const isChat = model.startsWith("chat:");
                const isPredict = model.startsWith("predict:");
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between py-[6px] px-[8px] rounded-[6px] hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-[8px] min-w-0">
                      <span
                        className={`inline-flex items-center px-[5px] py-[1px] rounded-[3px] text-[9px] font-mono font-medium shrink-0 ${
                          isChat
                            ? "bg-blue-50 text-blue-600"
                            : isPredict
                            ? "bg-indigo-50 text-indigo-600"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {isChat ? "CHAT" : isPredict ? "PRED" : "CACHE"}
                      </span>
                      <span className="text-[11px] text-gray-500 font-mono truncate">
                        {entry.cache_key.substring(0, 40)}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0 ml-[8px]">
                      {new Date(entry.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[12px] text-gray-400 py-[24px] text-center">
              No API calls yet — entries appear after first requests
            </p>
          )}
        </div>
      </div>

      {/* Top Edge Bets */}
      {d.recommendations.topEdge.length > 0 && (
        <div className="bg-white rounded-[14px] border border-gray-100 p-[20px] mb-[24px]">
          <div className="flex items-center gap-[8px] mb-[16px]">
            <div className="w-[32px] h-[32px] rounded-[8px] bg-red-50 flex items-center justify-center">
              <i className="ri-fire-line text-[16px] text-red-600" />
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-[#0A0F1C]">
                Top Value Bets (by Edge)
              </h3>
              <p className="text-[11px] text-gray-400">
                Highest edge recommendations from the prediction engine
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-[8px]">
            {d.recommendations.topEdge.map((bet, i) => (
              <div
                key={i}
                className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-[10px] p-[12px] text-center"
              >
                <div className="text-[20px] font-bold text-green-700 font-mono">
                  +{(bet.edge * 100).toFixed(1)}%
                </div>
                <div className="text-[11px] font-medium text-green-800 mt-[4px]">
                  {bet.market}
                </div>
                <div className="text-[10px] text-green-600 mt-[2px]">
                  {bet.selection}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Stat Card Component
function StatCard({
  label,
  value,
  icon,
  color,
  sub,
}: {
  label: string;
  value: string;
  icon: string;
  color: string;
  sub?: string;
}) {
  const colorMap: Record<string, { bg: string; icon: string; ring: string }> = {
    blue: { bg: "bg-blue-50", icon: "text-blue-600", ring: "ring-blue-100" },
    green: {
      bg: "bg-green-50",
      icon: "text-green-600",
      ring: "ring-green-100",
    },
    purple: {
      bg: "bg-purple-50",
      icon: "text-purple-600",
      ring: "ring-purple-100",
    },
    indigo: {
      bg: "bg-indigo-50",
      icon: "text-indigo-600",
      ring: "ring-indigo-100",
    },
    teal: { bg: "bg-teal-50", icon: "text-teal-600", ring: "ring-teal-100" },
    amber: {
      bg: "bg-amber-50",
      icon: "text-amber-600",
      ring: "ring-amber-100",
    },
    red: { bg: "bg-red-50", icon: "text-red-600", ring: "ring-red-100" },
    orange: {
      bg: "bg-orange-50",
      icon: "text-orange-600",
      ring: "ring-orange-100",
    },
  };

  const c = colorMap[color] || colorMap.blue;

  return (
    <div className="bg-white rounded-[14px] p-[16px] border border-gray-100">
      <div className="flex items-center gap-[8px] mb-[8px]">
        <div
          className={`w-[28px] h-[28px] rounded-[7px] ${c.bg} ring-1 ${c.ring} flex items-center justify-center`}
        >
          <i className={`${icon} text-[14px] ${c.icon}`} />
        </div>
        <span className="text-[11px] text-gray-400">{label}</span>
      </div>
      <span className="block text-[22px] font-mono-data font-bold text-[#0A0F1C]">
        {value}
      </span>
      {sub && (
        <span className="block text-[10px] text-gray-400 mt-[2px]">{sub}</span>
      )}
    </div>
  );
}
