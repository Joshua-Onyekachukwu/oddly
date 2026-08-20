"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";

interface MarketPerformance {
  market: string;
  correct: number;
  total: number;
  accuracy: number;
  avgLogLoss: number;
  avgBrier: number;
}

interface TierPerformance {
  tier: string;
  correct: number;
  total: number;
  accuracy: number;
}

interface PerformanceStats {
  success: boolean;
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  avgLogLoss: number;
  avgBrier: number;
  byMarket: MarketPerformance[];
  byTier: TierPerformance[];
}

export default function PerformancePage() {
  const { session } = useAuth();
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tracking, setTracking] = useState(false);

  useEffect(() => {
    fetchStats();
  }, [session?.access_token]);

  async function fetchStats() {
    if (!session?.access_token) return;
    setLoading(true);

    try {
      const res = await fetch("/api/v1/admin/model-performance", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (data.success) {
        setStats(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch performance stats:", error);
    } finally {
      setLoading(false);
    }
  }

  async function trackAccuracy() {
    if (!session?.access_token) return;
    setTracking(true);

    try {
      const res = await fetch("/api/v1/admin/model-performance", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();

      if (data.success) {
        // Refresh stats
        await fetchStats();
      }
    } catch (error) {
      console.error("Failed to track accuracy:", error);
    } finally {
      setTracking(false);
    }
  }

  function getMarketLabel(market: string): string {
    switch (market) {
      case "h2h": return "Match Winner";
      case "totals": return "Over/Under 2.5";
      case "btts": return "Both Teams Score";
      case "spreads": return "Handicap";
      default: return market;
    }
  }

  function getMarketIcon(market: string): string {
    switch (market) {
      case "h2h": return "ri-trophy-line";
      case "totals": return "ri-hashtag";
      case "btts": return "ri-ball-pen-line";
      case "spreads": return "ri-scales-3-line";
      default: return "ri-chart-line";
    }
  }

  function getAccuracyColor(accuracy: number): string {
    if (accuracy >= 70) return "text-[#22c55e]";
    if (accuracy >= 55) return "text-[#D97706]";
    return "text-[#EF4444]";
  }

  function getAccuracyBg(accuracy: number): string {
    if (accuracy >= 70) return "bg-[#22c55e]/10";
    if (accuracy >= 55) return "bg-[#D97706]/10";
    return "bg-[#EF4444]/10";
  }

  function getTierColor(tier: string): string {
    switch (tier) {
      case "very_high": return "bg-[#22c55e]/10 text-[#22c55e]";
      case "high": return "bg-[#2563EB]/10 text-[#2563EB]";
      case "medium": return "bg-[#D97706]/10 text-[#D97706]";
      default: return "bg-gray-100 text-gray-500";
    }
  }

  return (
    <div className="max-w-[900px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            Model Performance
          </h1>
          <p className="text-[14px] text-gray-500">
            Track prediction accuracy and calibration metrics
          </p>
        </div>
        <button
          onClick={trackAccuracy}
          disabled={tracking}
          className="h-[36px] px-[14px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
        >
          {tracking ? (
            <div className="w-[14px] h-[14px] border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <i className="ri-refresh-line text-[14px]" />
          )}
          {tracking ? "Tracking..." : "Track Accuracy"}
        </button>
      </div>

      {loading ? (
        <div className="space-y-[16px]">
          <div className="grid grid-cols-4 gap-[12px]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
                <div className="h-[12px] w-[80px] bg-gray-100 rounded mb-[8px]" />
                <div className="h-[28px] w-[60px] bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : !stats || stats.totalPredictions === 0 ? (
        <div className="text-center py-[80px]">
          <div className="w-[64px] h-[64px] bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-[16px]">
            <i className="ri-line-chart-line text-[28px] text-gray-300" />
          </div>
          <h3 className="text-[16px] font-semibold text-gray-400 mb-[4px]">
            No predictions tracked yet
          </h3>
          <p className="text-[13px] text-gray-300 max-w-[320px] mx-auto">
            Accuracy data will appear here once matches finish and predictions are evaluated.
          </p>
          <button
            onClick={trackAccuracy}
            disabled={tracking}
            className="mt-[20px] h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50"
          >
            {tracking ? "Tracking..." : "Track Now"}
          </button>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
            {[
              {
                label: "Total Predictions",
                value: stats.totalPredictions.toLocaleString(),
                icon: "ri-brain-line",
                color: "bg-purple-50 text-purple-600",
              },
              {
                label: "Accuracy",
                value: `${stats.accuracy}%`,
                icon: "ri-check-double-line",
                color: getAccuracyBg(stats.accuracy),
                valueColor: getAccuracyColor(stats.accuracy),
              },
              {
                label: "Avg Log Loss",
                value: stats.avgLogLoss.toFixed(3),
                icon: "ri-line-chart-line",
                color: "bg-[#2563EB]/10 text-[#2563EB]",
              },
              {
                label: "Brier Score",
                value: stats.avgBrier.toFixed(3),
                icon: "ri-target-line",
                color: "bg-[#D97706]/10 text-[#D97706]",
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
              >
                <div className="flex items-center gap-[10px] mb-[8px]">
                  <span
                    className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center ${stat.color}`}
                  >
                    <i className={`${stat.icon} text-[16px]`} />
                  </span>
                  <span className="text-[11px] text-gray-400">{stat.label}</span>
                </div>
                <span
                  className={`text-[22px] font-mono-data font-bold ${stat.valueColor || "text-[#0A0F1C]"}`}
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>

          {/* Per-Market Breakdown */}
          {stats.byMarket.length > 0 && (
            <div className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] mb-[24px]">
              <h2 className="text-[16px] font-semibold text-[#0A0F1C] mb-[16px]">
                Performance by Market
              </h2>
              <div className="space-y-[12px]">
                {stats.byMarket.map((market) => (
                  <div
                    key={market.market}
                    className="flex items-center gap-[16px] p-[12px] bg-gray-50 rounded-[10px]"
                  >
                    <div className="w-[36px] h-[36px] bg-white rounded-[10px] flex items-center justify-center border border-gray-100">
                      <i
                        className={`${getMarketIcon(market.market)} text-[16px] text-gray-400`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-[4px]">
                        <span className="text-[13px] font-semibold text-[#0A0F1C]">
                          {getMarketLabel(market.market)}
                        </span>
                        <span
                          className={`text-[13px] font-bold font-mono-data ${getAccuracyColor(market.accuracy)}`}
                        >
                          {market.accuracy}%
                        </span>
                      </div>
                      <div className="w-full h-[4px] bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#22c55e] rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, market.accuracy)}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-[16px] mt-[6px]">
                        <span className="text-[11px] text-gray-400">
                          {market.correct}/{market.total} correct
                        </span>
                        <span className="text-[11px] text-gray-400">
                          Log Loss: {market.avgLogLoss.toFixed(3)}
                        </span>
                        <span className="text-[11px] text-gray-400">
                          Brier: {market.avgBrier.toFixed(3)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confidence Tier Breakdown */}
          {stats.byTier.length > 0 && (
            <div className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
              <h2 className="text-[16px] font-semibold text-[#0A0F1C] mb-[16px]">
                Accuracy by Confidence Tier
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
                {stats.byTier.map((tier) => (
                  <div
                    key={tier.tier}
                    className="p-[12px] bg-gray-50 rounded-[10px] text-center"
                  >
                    <span
                      className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full ${getTierColor(tier.tier)}`}
                    >
                      {tier.tier.replace("_", " ").toUpperCase()}
                    </span>
                    <div className="mt-[8px]">
                      <span
                        className={`text-[20px] font-bold font-mono-data ${getAccuracyColor(tier.accuracy)}`}
                      >
                        {tier.accuracy}%
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 block mt-[2px]">
                      {tier.correct}/{tier.total} correct
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info Note */}
          <div className="mt-[24px] p-[16px] bg-[#BFFF00]/5 rounded-[14px] border border-[#BFFF00]/20">
            <div className="flex items-start gap-[10px]">
              <i className="ri-information-line text-[16px] text-[#1B2A4A] mt-[1px]" />
              <div>
                <p className="text-[13px] text-[#1B2A4A] font-medium">
                  How accuracy tracking works
                </p>
                <p className="text-[12px] text-gray-500 mt-[4px] leading-[1.5]">
                  After matches finish (status=FT), click &quot;Track Accuracy&quot; to evaluate
                  how accurate each prediction was. The system compares the predicted
                  probability against the actual outcome and logs accuracy, log loss,
                  and Brier scores. Low log loss and Brier scores indicate well-calibrated
                  predictions.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
