"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { PageHeader, Button, Card, CardHeader, Badge, StatCard, EmptyState } from "@/components/ui";

interface ModelPerf {
  id: string;
  model_version: string;
  market: string | null;
  total_predictions: number | null;
  correct_predictions: number | null;
  brier_score: number | null;
  roi: number | null;
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
      <PageHeader
        title="Model Health"
        description="Monitor prediction model accuracy, calibration, and ROI."
        action={
          <Button
            onClick={trackAccuracy}
            loading={tracking}
            variant="secondary"
            icon="ri-refresh-line"
          >
            Track Accuracy
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[80px] bg-white rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Overall Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
            <StatCard
              label="Total Predictions"
              value={totalPreds.toLocaleString()}
              icon="ri-brain-line"
              color="bg-purple-50 text-purple-600"
            />
            <StatCard
              label="Overall Accuracy"
              value={`${overallAcc}%`}
              icon="ri-percent-line"
              color="bg-green-50 text-green-600"
            />
            <StatCard
              label="Avg Brier Score"
              value={avgBrier}
              icon="ri-chart-line"
              color="bg-blue-50 text-blue-600"
            />
            <StatCard
              label="Avg ROI"
              value={`${avgRoi}%`}
              icon="ri-line-chart-line"
              color={parseFloat(avgRoi) >= 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}
            />
          </div>

          {/* Daily Accuracy Trend */}
          {dailyStats.length > 0 && (
            <Card className="mb-[24px]">
              <CardHeader
                title="Daily Accuracy Trend"
                action={
                  <div className="flex gap-[4px]">
                    {([7, 14, 30] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setSelectedPeriod(p)}
                        className={`px-[10px] py-[4px] rounded-full text-[11px] font-semibold transition-all ${
                          selectedPeriod === p
                            ? "bg-[#1B2A4A] text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {p}d
                      </button>
                    ))}
                  </div>
                }
              />
              <div className="flex items-end gap-[6px] h-[120px]">
                {dailyStats.map((d) => (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-[4px]">
                    <span className="text-[9px] font-mono-data text-gray-400">{d.accuracy}%</span>
                    <div className="w-full bg-gray-100 rounded-[4px] relative" style={{ height: "80px" }}>
                      <div
                        className={`absolute bottom-0 w-full rounded-[4px] transition-all ${
                          d.accuracy >= 70
                            ? "bg-[#22c55e]"
                            : d.accuracy >= 50
                            ? "bg-[#D97706]"
                            : "bg-[#EF4444]"
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
            </Card>
          )}
        </>
      )}

      {/* Model breakdown */}
      {Object.keys(byModel).length === 0 ? (
        <EmptyState
          icon="ri-heart-pulse-line"
          title="No model data yet"
          description="Model health metrics will appear once predictions have been evaluated."
        />
      ) : (
        <div className="space-y-[12px]">
          {Object.entries(byModel).map(([version, periods]) => {
            const total = periods.reduce((a, p) => a + (p.total_predictions || 0), 0);
            const correct = periods.reduce((a, p) => a + (p.correct_predictions || 0), 0);
            const acc = total > 0 ? ((correct / total) * 100).toFixed(1) : "0.0";
            const mBrier =
              periods.length > 0
                ? (periods.reduce((a, p) => a + (p.brier_score || 0), 0) / periods.length).toFixed(4)
                : "—";
            const mRoi =
              periods.length > 0
                ? (periods.reduce((a, p) => a + (p.roi || 0), 0) / periods.length).toFixed(1)
                : "0.0";
            const health =
              parseFloat(acc) >= 70 && (mBrier === "—" || parseFloat(mBrier) < 0.15)
                ? "healthy"
                : parseFloat(acc) >= 50
                ? "degraded"
                : "critical";

            return (
              <Card key={version}>
                <div className="flex items-center justify-between mb-[12px]">
                  <div className="flex items-center gap-[8px]">
                    <h3 className="text-[14px] font-semibold text-[#0A0F1C]">{version}</h3>
                    <Badge
                      variant={health === "healthy" ? "success" : health === "degraded" ? "warning" : "danger"}
                      size="sm"
                    >
                      {health}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    {periods.length} evaluation{periods.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-[8px]">
                  <div className="p-[10px] bg-gray-50 rounded-[8px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Accuracy</span>
                    <span className="text-[16px] font-mono-data font-bold text-[#0A0F1C]">{acc}%</span>
                  </div>
                  <div className="p-[10px] bg-gray-50 rounded-[8px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Predictions</span>
                    <span className="text-[16px] font-mono-data font-bold text-[#0A0F1C]">{total.toLocaleString()}</span>
                  </div>
                  <div className="p-[10px] bg-gray-50 rounded-[8px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Brier Score</span>
                    <span className="text-[16px] font-mono-data font-bold text-[#0A0F1C]">{mBrier}</span>
                  </div>
                  <div className="p-[10px] bg-gray-50 rounded-[8px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">ROI</span>
                    <span className={`text-[16px] font-mono-data font-bold ${parseFloat(mRoi) >= 0 ? "text-green-600" : "text-red-500"}`}>
                      {mRoi}%
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
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
