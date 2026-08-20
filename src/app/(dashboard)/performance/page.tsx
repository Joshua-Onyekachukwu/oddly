"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ModelPerf {
  id: string;
  model_version: string;
  period_start: string;
  period_end: string;
  market: string;
  total_predictions: number;
  correct_predictions: number;
  brier_score: number;
  roi: number;
  calibration_data: any;
}

export default function PerformancePage() {
  const [performance, setPerformance] = useState<ModelPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");

  const fetchPerformance = useCallback(async () => {
    const supabase = createClient();
    let query = supabase
      .from("model_performance")
      .select("*")
      .order("period_end", { ascending: false })
      .limit(20);

    if (period !== "all") {
      const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
      const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
      query = query.gte("period_start", since);
    }

    const { data, error } = await query;
    if (!error && data) {
      setPerformance(data);
    }
    setLoading(false);
  }, [period]);

  useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance]);

  // Aggregate stats
  const totalPreds = performance.reduce((acc, p) => acc + (p.total_predictions || 0), 0);
  const totalCorrect = performance.reduce((acc, p) => acc + (p.correct_predictions || 0), 0);
  const accuracy = totalPreds > 0 ? ((totalCorrect / totalPreds) * 100).toFixed(1) : "0.0";
  const avgBrier =
    performance.length > 0
      ? (performance.reduce((acc, p) => acc + (p.brier_score || 0), 0) / performance.length).toFixed(4)
      : "—";
  const avgRoi =
    performance.length > 0
      ? (performance.reduce((acc, p) => acc + (p.roi || 0), 0) / performance.length).toFixed(1)
      : "0.0";

  // Group by model_version
  const byModel = performance.reduce(
    (acc, p) => {
      if (!acc[p.model_version]) acc[p.model_version] = [];
      acc[p.model_version].push(p);
      return acc;
    },
    {} as Record<string, ModelPerf[]>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            Model Performance
          </h1>
          <p className="text-[14px] text-gray-500">
            Track prediction accuracy, calibration, and ROI across all models.
          </p>
        </div>
        <div className="flex gap-[4px] bg-gray-50 rounded-[10px] p-[4px]">
          {(["7d", "30d", "90d", "all"] as const).map((p) => (
            <button
              key={p}
              onClick={() => {
                setPeriod(p);
                setLoading(true);
              }}
              className={`px-[12px] py-[6px] rounded-[8px] text-[12px] font-semibold transition-all ${
                period === p
                  ? "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {p === "all" ? "All" : p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
        {[
          {
            label: "Total Predictions",
            value: totalPreds.toLocaleString(),
            sub: `${performance.length} periods`,
          },
          {
            label: "Accuracy",
            value: `${accuracy}%`,
            sub: `${totalCorrect} correct`,
            color: parseFloat(accuracy) >= 70 ? "text-green-600" : "text-amber-600",
          },
          {
            label: "Brier Score",
            value: avgBrier,
            sub: "lower = better",
            color: avgBrier !== "—" && parseFloat(avgBrier) < 0.15 ? "text-green-600" : "text-amber-600",
          },
          {
            label: "Avg ROI",
            value: `${avgRoi}%`,
            sub: "across all models",
            color: parseFloat(avgRoi) >= 0 ? "text-green-600" : "text-red-500",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
          >
            <span className="block text-[11px] text-gray-400 mb-[4px]">{stat.label}</span>
            <span className={`text-[20px] font-mono-data font-bold ${stat.color || "text-[#0A0F1C]"}`}>
              {stat.value}
            </span>
            <span className="block text-[10px] text-gray-300 mt-[2px]">{stat.sub}</span>
          </div>
        ))}
      </div>

      {/* Model breakdown */}
      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[14px] p-[20px] border border-gray-100 animate-pulse">
              <div className="h-[16px] w-[140px] bg-gray-100 rounded-full mb-[12px]"></div>
              <div className="h-[4px] w-full bg-gray-100 rounded-full"></div>
            </div>
          ))}
        </div>
      ) : performance.length === 0 ? (
        <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
          <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-gray-50 mb-[12px]">
            <i className="ri-bar-chart-box-line text-[22px] text-gray-300"></i>
          </div>
          <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
            No performance data yet
          </h3>
          <p className="text-[13px] text-gray-400">
            Performance metrics will appear once predictions have been settled.
          </p>
        </div>
      ) : (
        <div className="space-y-[16px]">
          {Object.entries(byModel).map(([model, periods]) => {
            const modelPreds = periods.reduce((acc, p) => acc + (p.total_predictions || 0), 0);
            const modelCorrect = periods.reduce((acc, p) => acc + (p.correct_predictions || 0), 0);
            const modelAcc = modelPreds > 0 ? ((modelCorrect / modelPreds) * 100).toFixed(1) : "0.0";

            return (
              <div
                key={model}
                className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
              >
                <div className="flex items-center justify-between mb-[12px]">
                  <div>
                    <span className="text-[14px] font-semibold text-[#0A0F1C]">{model}</span>
                    <span className="text-[11px] text-gray-400 ml-[8px]">
                      {periods.length} period{periods.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <span className="text-[16px] font-mono-data font-bold text-[#0A0F1C]">
                    {modelAcc}%
                  </span>
                </div>

                {/* Accuracy bar */}
                <div className="w-full bg-gray-100 rounded-full h-[4px] mb-[12px]">
                  <div
                    className="bg-[#1B2A4A] h-[4px] rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min(parseFloat(modelAcc), 100)}%` }}
                  ></div>
                </div>

                {/* Periods */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[8px]">
                  {periods.slice(0, 6).map((p) => (
                    <div key={p.id} className="p-[10px] bg-gray-50 rounded-[10px]">
                      <div className="flex items-center justify-between mb-[4px]">
                        <span className="text-[11px] text-gray-400">
                          {p.period_start} — {p.period_end}
                        </span>
                        <span className="text-[10px] text-gray-400">{p.market || "All"}</span>
                      </div>
                      <div className="flex items-center gap-[12px]">
                        <span className="text-[12px] font-mono-data font-medium text-[#0A0F1C]">
                          {p.correct_predictions}/{p.total_predictions}
                        </span>
                        <span className="text-[11px] text-gray-400">
                          Brier: {p.brier_score?.toFixed(4) || "—"}
                        </span>
                        {p.roi != null && (
                          <span
                            className={`text-[11px] font-mono-data ${
                              p.roi >= 0 ? "text-green-600" : "text-red-500"
                            }`}
                          >
                            ROI: {p.roi.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
