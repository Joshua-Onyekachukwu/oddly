"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";

interface ModelPerf {
  id: string;
  model_version: string;
  market: string | null;
  total_predictions: number | null;
  correct_predictions: number | null;
  brier_score: number | null;
  roi: number | null;
  calibration_data: unknown;
  created_at: string;
}

interface DailyStats {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

export default function ModelHealthPage() {
  const { session } = useAuth();
  const [models, setModels] = useState<ModelPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<7 | 14 | 30>(7);

  const fetchModels = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("model_performance")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (!error && data) {
      setModels(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  async function trackAccuracy() {
    if (!session?.access_token) return;
    setTracking(true);
    try {
      await fetch("/api/v1/admin/model-performance", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      await fetchModels();
    } catch (e) {
      console.error("Tracking failed:", e);
    } finally {
      setTracking(false);
    }
  }

  // Build daily accuracy trend
  const dailyStats: DailyStats[] = [];
  const byDate = models.reduce((acc, m) => {
    const d = m.created_at.split("T")[0];
    if (!acc[d]) acc[d] = { total: 0, correct: 0 };
    acc[d].total += m.total_predictions || 0;
    acc[d].correct += m.correct_predictions || 0;
    return acc;
  }, {} as Record<string, { total: number; correct: number }>);

  const sortedDates = Object.keys(byDate).sort().slice(-selectedPeriod);
  for (const d of sortedDates) {
    const { total, correct } = byDate[d];
    dailyStats.push({
      date: d,
      total,
      correct,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    });
  }

  // Overall stats
  const totalPreds = models.reduce((a, m) => a + (m.total_predictions || 0), 0);
  const totalCorrect = models.reduce((a, m) => a + (m.correct_predictions || 0), 0);
  const overallAcc = totalPreds > 0 ? ((totalCorrect / totalPreds) * 100).toFixed(1) : "0.0";
  const avgBrier = models.length > 0
    ? (models.reduce((a, m) => a + (m.brier_score || 0), 0) / models.length).toFixed(4)
    : "—";
  const avgRoi = models.length > 0
    ? (models.reduce((a, m) => a + (m.roi || 0), 0) / models.length).toFixed(1)
    : "0.0";

  // Group by model_version
  const byModel = models.reduce(
    (acc, m) => {
      if (!acc[m.model_version]) acc[m.model_version] = [];
      acc[m.model_version].push(m);
      return acc;
    },
    {} as Record<string, ModelPerf[]>
  );

  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          Model Health
        </h1>
        <p className="text-[14px] text-gray-500">
          Monitor prediction model accuracy, calibration, and ROI.
        </p>
      </div>

      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[80px] bg-white rounded-[14px] animate-pulse"></div>
          ))}
        </div>
      ) : (
        <>
          {/* Overall Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
            <div className="bg-white rounded-[14px] p-[16px] border border-gray-100">
              <span className="block text-[10px] text-gray-400 mb-[4px]">Total Predictions</span>
              <span className="text-[20px] font-mono-data font-bold text-[#0A0F1C]">{totalPreds.toLocaleString()}</span>
            </div>
            <div className="bg-white rounded-[14px] p-[16px] border border-gray-100">
              <span className="block text-[10px] text-gray-400 mb-[4px]">Overall Accuracy</span>
              <span className={`text-[20px] font-mono-data font-bold ${parseFloat(overallAcc) >= 70 ? "text-[#22c55e]" : parseFloat(overallAcc) >= 50 ? "text-[#D97706]" : "text-[#EF4444]"}`}>{overallAcc}%</span>
            </div>
            <div className="bg-white rounded-[14px] p-[16px] border border-gray-100">
              <span className="block text-[10px] text-gray-400 mb-[4px]">Avg Brier Score</span>
              <span className="text-[20px] font-mono-data font-bold text-[#0A0F1C]">{avgBrier}</span>
            </div>
            <div className="bg-white rounded-[14px] p-[16px] border border-gray-100">
              <span className="block text-[10px] text-gray-400 mb-[4px]">Avg ROI</span>
              <span className={`text-[20px] font-mono-data font-bold ${parseFloat(avgRoi) >= 0 ? "text-[#22c55e]" : "text-[#EF4444]"}`}>{avgRoi}%</span>
            </div>
          </div>

          {/* Daily Accuracy Trend */}
          {dailyStats.length > 0 && (
            <div className="bg-white rounded-[14px] p-[20px] border border-gray-100 mb-[24px]">
              <div className="flex items-center justify-between mb-[16px]">
                <h3 className="text-[14px] font-semibold text-[#0A0F1C]">Daily Accuracy Trend</h3>
                <div className="flex gap-[4px]">
                  {([7, 14, 30] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setSelectedPeriod(p)}
                      className={`px-[10px] py-[4px] rounded-full text-[11px] font-semibold transition-all ${
                        selectedPeriod === p ? "bg-[#1B2A4A] text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {p}d
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-end gap-[6px] h-[120px]">
                {dailyStats.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-[4px]">
                    <span className="text-[9px] font-mono-data text-gray-400">{d.accuracy}%</span>
                    <div className="w-full bg-gray-100 rounded-[4px] relative" style={{ height: "80px" }}>
                      <div
                        className={`absolute bottom-0 w-full rounded-[4px] transition-all ${
                          d.accuracy >= 70 ? "bg-[#22c55e]" : d.accuracy >= 50 ? "bg-[#D97706]" : "bg-[#EF4444]"
                        }`}
                        style={{ height: `${Math.min(d.accuracy, 100)}%` }}
                      />
                    </div>
                    <span className="text-[8px] text-gray-300 font-mono-data">
                      {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Track Accuracy Button */}
          <div className="flex justify-end mb-[16px]">
            <button
              onClick={trackAccuracy}
              disabled={tracking}
              className="h-[36px] px-[14px] rounded-[10px] bg-[#8B5CF6] text-white text-[13px] font-semibold transition-all hover:bg-[#7C3AED] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
            >
              {tracking ? (
                <div className="w-[14px] h-[14px] border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <i className="ri-refresh-line text-[14px]" />
              )}
              {tracking ? "Tracking..." : "Track Accuracy Now"}
            </button>
          </div>
        </>
      )}

      {Object.keys(byModel).length === 0 ? (
        <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
          <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-purple-50 mb-[12px]">
            <i className="ri-heart-pulse-line text-[22px] text-purple-500"></i>
          </div>
          <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
            No model data yet
          </h3>
          <p className="text-[13px] text-gray-400">
            Model health metrics will appear once predictions have been evaluated.
          </p>
        </div>
      ) : (
        <div className="space-y-[16px]">
          {Object.entries(byModel).map(([version, periods]) => {
            const total = periods.reduce((a, p) => a + (p.total_predictions || 0), 0);
            const correct = periods.reduce((a, p) => a + (p.correct_predictions || 0), 0);
            const acc = total > 0 ? ((correct / total) * 100).toFixed(1) : "0.0";
            const avgBrier =
              periods.length > 0
                ? (periods.reduce((a, p) => a + (p.brier_score || 0), 0) / periods.length).toFixed(4)
                : "—";
            const avgRoi =
              periods.length > 0
                ? (periods.reduce((a, p) => a + (p.roi || 0), 0) / periods.length).toFixed(1)
                : "0.0";
            const health =
              parseFloat(acc) >= 70 && (avgBrier === "—" || parseFloat(avgBrier) < 0.15)
                ? "healthy"
                : parseFloat(acc) >= 50
                ? "degraded"
                : "critical";

            const healthColor =
              health === "healthy"
                ? "bg-green-50 text-green-600"
                : health === "degraded"
                ? "bg-amber-50 text-amber-600"
                : "bg-red-50 text-red-600";

            return (
              <div
                key={version}
                className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
              >
                <div className="flex items-center justify-between mb-[16px]">
                  <div className="flex items-center gap-[10px]">
                    <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C]">
                      {version}
                    </h3>
                    <span className={`text-[10px] font-semibold px-[8px] py-[3px] rounded-full ${healthColor}`}>
                      {health.toUpperCase()}
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    {periods.length} evaluation{periods.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
                  <div className="p-[12px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Accuracy</span>
                    <span className="text-[16px] font-mono-data font-bold text-[#0A0F1C]">{acc}%</span>
                  </div>
                  <div className="p-[12px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Predictions</span>
                    <span className="text-[16px] font-mono-data font-bold text-[#0A0F1C]">{total.toLocaleString()}</span>
                  </div>
                  <div className="p-[12px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Brier Score</span>
                    <span className="text-[16px] font-mono-data font-bold text-[#0A0F1C]">{avgBrier}</span>
                  </div>
                  <div className="p-[12px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">ROI</span>
                    <span className={`text-[16px] font-mono-data font-bold ${parseFloat(avgRoi) >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {avgRoi}%
                    </span>
                  </div>
                </div>

                {/* Accuracy bar */}
                <div className="mt-[12px]">
                  <div className="w-full bg-gray-100 rounded-full h-[3px]">
                    <div
                      className={`h-[3px] rounded-full transition-all ${
                        health === "healthy" ? "bg-green-500" : health === "degraded" ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min(parseFloat(acc), 100)}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
