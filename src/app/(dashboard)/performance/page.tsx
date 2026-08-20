"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { PageHeader, Card, EmptyState, StatCard, Button, Badge } from "@/components/ui";

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
    if (accuracy >= 70) return "text-green-600";
    if (accuracy >= 55) return "text-amber-600";
    return "text-red-500";
  }

  function getAccuracyBg(accuracy: number): string {
    if (accuracy >= 70) return "bg-green-50 text-green-600";
    if (accuracy >= 55) return "bg-amber-50 text-amber-600";
    return "bg-red-50 text-red-500";
  }

  function getTierVariant(tier: string): "success" | "info" | "warning" | "default" {
    switch (tier) {
      case "very_high": return "success";
      case "high": return "info";
      case "medium": return "warning";
      default: return "default";
    }
  }

  return (
    <div className="max-w-[900px] mx-auto">
      <PageHeader
        title="Model Performance"
        description="Track prediction accuracy and calibration metrics"
        action={
          <Button onClick={trackAccuracy} loading={tracking} icon="ri-refresh-line" size="sm" variant="secondary">
            {tracking ? "Tracking..." : "Track Accuracy"}
          </Button>
        }
      />

      {loading ? (
        <div className="grid grid-cols-4 gap-[10px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-[11px] w-[70px] bg-gray-100 rounded mb-[8px]" />
              <div className="h-[24px] w-[50px] bg-gray-100 rounded" />
            </Card>
          ))}
        </div>
      ) : !stats || stats.totalPredictions === 0 ? (
        <EmptyState
          icon="ri-line-chart-line"
          title="No predictions tracked yet"
          description="Accuracy data will appear here once matches finish and predictions are evaluated."
          action={
            <Button onClick={trackAccuracy} loading={tracking} size="sm">
              {tracking ? "Tracking..." : "Track Now"}
            </Button>
          }
        />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-[20px]">
            <StatCard label="Total Predictions" value={stats.totalPredictions.toLocaleString()} icon="ri-brain-line" color="bg-purple-50 text-purple-600" />
            <StatCard label="Accuracy" value={`${stats.accuracy}%`} icon="ri-check-double-line" color={getAccuracyBg(stats.accuracy)} />
            <StatCard label="Avg Log Loss" value={stats.avgLogLoss.toFixed(3)} icon="ri-line-chart-line" color="bg-blue-50 text-blue-600" />
            <StatCard label="Brier Score" value={stats.avgBrier.toFixed(3)} icon="ri-target-line" color="bg-amber-50 text-amber-600" />
          </div>

          {/* Per-Market Breakdown */}
          {stats.byMarket.length > 0 && (
            <Card className="mb-[20px]">
              <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">
                Performance by Market
              </h2>
              <div className="space-y-[8px]">
                {stats.byMarket.map((market) => (
                  <div key={market.market} className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[8px]">
                    <div className="flex items-center gap-[10px]">
                      <div className="w-[28px] h-[28px] rounded-[6px] bg-white flex items-center justify-center">
                        <i className={`${getMarketIcon(market.market)} text-[14px] text-gray-500`} />
                      </div>
                      <div>
                        <span className="text-[13px] font-medium text-[#0A0F1C]">
                          {getMarketLabel(market.market)}
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
                          style={{ width: `${market.accuracy}%` }}
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

          {/* Confidence Tier Performance */}
          {stats.byTier.length > 0 && (
            <Card>
              <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">
                Performance by Confidence Tier
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-[8px]">
                {stats.byTier.map((tier) => (
                  <div key={tier.tier} className="p-[12px] bg-gray-50 rounded-[8px] text-center">
                    <Badge variant={getTierVariant(tier.tier)} size="sm" className="mb-[6px]">
                      {tier.tier.replace("_", " ")}
                    </Badge>
                    <div className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">
                      {tier.accuracy.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {tier.correct}/{tier.total}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
