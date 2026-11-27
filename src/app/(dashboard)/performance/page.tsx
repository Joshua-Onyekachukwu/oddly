"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, EmptyState, StatCard, Button } from "@/components/ui";

interface SettledPrediction {
  id: string;
  market: string;
  model_probability: number;
  result: "correct" | "wrong" | "void" | "pending";
  settled_at: string | null;
}

interface MarketPerformance {
  market: string;
  label: string;
  icon: string;
  correct: number;
  total: number;
  accuracy: number;
}

interface BandPerformance {
  label: string;
  min: number;
  max: number;
  correct: number;
  total: number;
  accuracy: number | null;
}

/** Group raw market keys into user-friendly categories. */
function normalizeMarket(market: string): { key: string; label: string; icon: string } {
  const m = (market || "").toLowerCase();
  if (m === "1x2" || m === "match_result" || m === "h2h" || m === "match_winner") {
    return { key: "match_winner", label: "Match Winner", icon: "ri-trophy-line" };
  }
  if (m === "btts" || m.includes("btts")) {
    return { key: "btts", label: "Both Teams Score", icon: "ri-ball-pen-line" };
  }
  if (m.startsWith("ou_") || m === "totals" || m.includes("over") || m.includes("under")) {
    return { key: "totals", label: "Over/Under", icon: "ri-hashtag" };
  }
  if (m.startsWith("hc_") || m === "spreads" || m.includes("handicap") || m.includes("asian")) {
    return { key: "handicap", label: "Handicap", icon: "ri-scales-3-line" };
  }
  return { key: "other", label: market || "Other", icon: "ri-football-line" };
}

const CONFIDENCE_BANDS: { label: string; min: number; max: number }[] = [
  { label: "< 60%", min: 0, max: 0.6 },
  { label: "60–70%", min: 0.6, max: 0.7 },
  { label: "70–80%", min: 0.7, max: 0.8 },
  { label: "80%+", min: 0.8, max: 1.01 },
];

function clamp(p: number, eps = 1e-6): number {
  return Math.min(1 - eps, Math.max(eps, p));
}

export default function PerformancePage() {
  const { user } = useAuth();
  const [predictions, setPredictions] = useState<SettledPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    // Settled predictions from the last 180 days. The predictions table is
    // publicly readable (SELECT policy), so this works for all users.
    const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error: queryError } = await supabase
      .from("predictions")
      .select("id, market, model_probability, result, settled_at")
      .in("result", ["correct", "wrong"])
      .gte("created_at", since)
      .order("settled_at", { ascending: false, nullsFirst: false })
      .limit(2000);

    if (queryError) {
      console.error("Failed to fetch prediction performance:", queryError);
      setError("Could not load performance data. Please try again.");
      setPredictions([]);
    } else {
      setPredictions((data as SettledPrediction[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) fetchStats();
    else setLoading(false);
  }, [user, fetchStats]);

  // ── Derived metrics ──────────────────────────────────────────
  const total = predictions.length;
  const correct = predictions.filter((p) => p.result === "correct").length;
  const accuracy = total > 0 ? (correct / total) * 100 : 0;

  let brierSum = 0;
  let logLossSum = 0;
  for (const p of predictions) {
    const prob = clamp(Number(p.model_probability) || 0);
    const y = p.result === "correct" ? 1 : 0;
    brierSum += (prob - y) ** 2;
    logLossSum += -(y * Math.log(prob) + (1 - y) * Math.log(1 - prob));
  }
  const avgBrier = total > 0 ? brierSum / total : 0;
  const avgLogLoss = total > 0 ? logLossSum / total : 0;

  // Per-market breakdown
  const marketMap = new Map<string, MarketPerformance>();
  for (const p of predictions) {
    const { key, label, icon } = normalizeMarket(p.market);
    const existing = marketMap.get(key) || {
      market: key,
      label,
      icon,
      correct: 0,
      total: 0,
      accuracy: 0,
    };
    existing.total += 1;
    if (p.result === "correct") existing.correct += 1;
    marketMap.set(key, existing);
  }
  const byMarket: MarketPerformance[] = Array.from(marketMap.values())
    .map((m) => ({ ...m, accuracy: (m.correct / m.total) * 100 }))
    .sort((a, b) => b.total - a.total);

  // Accuracy by predicted-probability band (calibration view)
  const bands: BandPerformance[] = CONFIDENCE_BANDS.map((band) => {
    const inBand = predictions.filter((p) => {
      const prob = Number(p.model_probability) || 0;
      return prob >= band.min && prob < band.max;
    });
    const bandCorrect = inBand.filter((p) => p.result === "correct").length;
    return {
      label: band.label,
      min: band.min,
      max: band.max,
      correct: bandCorrect,
      total: inBand.length,
      accuracy: inBand.length > 0 ? (bandCorrect / inBand.length) * 100 : null,
    };
  });

  function getAccuracyColor(acc: number): string {
    if (acc >= 70) return "text-green-600";
    if (acc >= 55) return "text-amber-600";
    return "text-red-500";
  }

  return (
    <div className="max-w-[900px] mx-auto">
      <PageHeader
        title="Model Performance"
        description="How the prediction model has performed on settled matches"
      />

      {loading ? (
        <div className="space-y-[20px]">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <div className="h-[11px] w-[70px] bg-gray-100 rounded mb-[8px]" />
                <div className="h-[24px] w-[50px] bg-gray-100 rounded" />
              </Card>
            ))}
          </div>
          <Card className="animate-pulse">
            <div className="h-[14px] w-[180px] bg-gray-100 rounded mb-[14px]" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-[44px] bg-gray-50 rounded-[8px] mb-[8px]" />
            ))}
          </Card>
        </div>
      ) : error ? (
        <EmptyState
          icon="ri-error-warning-line"
          title="Something went wrong"
          description={error}
          action={
            <Button onClick={fetchStats} icon="ri-refresh-line" size="sm" variant="secondary">
              Try again
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          icon="ri-line-chart-line"
          title="No settled predictions yet"
          description="Accuracy data will appear here once matches finish and predictions are graded."
        />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-[20px]">
            <StatCard label="Settled Predictions" value={total.toLocaleString()} icon="ri-brain-line" color="bg-purple-50 text-purple-600" />
            <StatCard label="Accuracy" value={`${accuracy.toFixed(1)}%`} icon="ri-check-double-line" color="bg-blue-50 text-blue-600" />
            <StatCard label="Avg Brier Score" value={avgBrier.toFixed(3)} icon="ri-target-line" color="bg-amber-50 text-amber-600" />
            <StatCard label="Avg Log Loss" value={avgLogLoss.toFixed(3)} icon="ri-line-chart-line" color="bg-gray-50 text-gray-600" />
          </div>

          <p className="text-[11px] text-gray-400 mb-[16px]">
            Based on {total.toLocaleString()} settled predictions from the last 180 days.
          </p>

          {/* Per-Market Breakdown */}
          {byMarket.length > 0 && (
            <Card className="mb-[20px]">
              <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">
                Performance by Market
              </h2>
              <div className="space-y-[8px]">
                {byMarket.map((market) => (
                  <div key={market.market} className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[8px]">
                    <div className="flex items-center gap-[10px]">
                      <div className="w-[28px] h-[28px] rounded-[6px] bg-white flex items-center justify-center">
                        <i className={`${market.icon} text-[14px] text-gray-500`} />
                      </div>
                      <div>
                        <span className="text-[13px] font-medium text-[#0A0F1C]">
                          {market.label}
                        </span>
                        <span className="text-[11px] text-gray-400 ml-[8px]">
                          {market.correct}/{market.total} correct
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-[12px]">
                      <div className="w-[80px] bg-gray-200 rounded-full h-[3px]">
                        <div
                          className="bg-[#1B2A4A] h-[3px] rounded-full transition-all"
                          style={{ width: `${Math.min(100, market.accuracy)}%` }}
                        />
                      </div>
                      <span className={`text-[13px] font-mono-data font-bold ${getAccuracyColor(market.accuracy)}`}>
                        {market.accuracy.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Calibration by predicted probability */}
          <Card>
            <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[4px]">
              Accuracy by Predicted Confidence
            </h2>
            <p className="text-[11px] text-gray-400 mb-[12px]">
              Actual win rate grouped by the probability the model assigned.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[8px]">
              {bands.map((band) => (
                <div key={band.label} className="p-[12px] bg-gray-50 rounded-[8px] text-center">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-[6px]">
                    {band.label}
                  </div>
                  <div className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">
                    {band.accuracy !== null ? `${band.accuracy.toFixed(1)}%` : "—"}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {band.correct}/{band.total}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
