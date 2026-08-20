"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface ModelPerf {
  id: string;
  model_version: string;
  market: string | null;
  total_predictions: number | null;
  correct_predictions: number | null;
  brier_score: number | null;
  roi: number | null;
  calibration_data: any;
  created_at: string;
}

export default function ModelHealthPage() {
  const [models, setModels] = useState<ModelPerf[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchModels = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("model_performance")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      setModels(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

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
      ) : Object.keys(byModel).length === 0 ? (
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
