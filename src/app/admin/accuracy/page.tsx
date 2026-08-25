"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useLiveStats, useSettlementFeed } from "@/hooks/useSupabaseRealtime";

// ─── UI Components ──────────────────────────────────────────

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
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-[28px] font-bold font-mono tabular-nums text-[#0A0F1C] leading-none">{value}</div>
      {subtitle && <p className="text-[11px] text-gray-400 mt-[4px]">{subtitle}</p>}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-[14px] border border-gray-100 ${className}`}>{children}</div>;
}

function CardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="px-[20px] py-[16px] border-b border-gray-50">
      <h3 className="text-[14px] font-semibold text-[#0A0F1C]">{title}</h3>
      {description && <p className="text-[11px] text-gray-400 mt-[2px]">{description}</p>}
    </div>
  );
}

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "success" | "danger" | "default" }) {
  const colors = { success: "bg-green-50 text-green-600", danger: "bg-red-50 text-red-600", default: "bg-gray-100 text-gray-600" };
  return <span className={`text-[10px] font-bold px-[8px] py-[3px] rounded-full ${colors[variant]}`}>{children}</span>;
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-gray-100 rounded-[8px] animate-pulse ${className}`} />;
}

// ─── Types ──────────────────────────────────────────────────

interface CalibrationBucket {
  range: string;
  total: number;
  correct: number;
  accuracy: number;
  avgPredicted: number;
}

interface MarketAccuracy {
  market: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface DailyStat {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface SettlementItem {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  model_probability: number;
  model_version: string;
  result: string;
  settled_at: string;
}

// ─── Main Dashboard ─────────────────────────────────────────

export default function AccuracyPage() {
  // Real-time stats from Supabase (replaces Convex)
  const liveStatsData = useLiveStats();
  const settlementData = useSettlementFeed(50);
  const liveStats = liveStatsData ? { totalPredictions: liveStatsData.total_predictions, correct: liveStatsData.correct_predictions, accuracy: liveStatsData.accuracy } : undefined;
  const settlementUpdates = settlementData;

  // Analytics from Supabase API (heavy queries)
  const [calibration, setCalibration] = useState<CalibrationBucket[]>([]);
  const [marketAccuracy, setMarketAccuracy] = useState<MarketAccuracy[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [feed, setFeed] = useState<SettlementItem[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const [calRes, mktRes, dayRes, feedRes] = await Promise.all([
        fetch("/api/v1/analytics?type=calibration&days=30"),
        fetch("/api/v1/analytics?type=markets&days=30"),
        fetch("/api/v1/analytics?type=daily&days=30"),
        fetch("/api/v1/analytics?type=feed&limit=30"),
      ]);
      const [cal, mkt, day, f] = await Promise.all([
        calRes.json(), mktRes.json(), dayRes.json(), feedRes.json(),
      ]);
      setCalibration(cal.data?.data || []);
      setMarketAccuracy(mkt.data?.data || []);
      setDailyStats(day.data?.data || []);
      setFeed(f.data?.data || []);
    } catch {}
    setAnalyticsLoading(false);
  }, []);

  useEffect(() => {
    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 60000);
    return () => clearInterval(interval);
  }, [fetchAnalytics]);

  const isLoading = liveStats === undefined;
  const isSettling = settlementUpdates === undefined;

  const totalPreds = liveStats?.totalPredictions ?? 0;
  const correctPreds = liveStats?.correct ?? 0;
  const overallAccuracy = liveStats?.accuracy ?? 0;

  // ELITE stats from calibration buckets
  const eliteBucket = calibration.find((b) => b.range === "70-74%" || b.range === "75-79%" || b.range === "80-84%" || b.range === "85-89%" || b.range === "90%+");
  const hcTotal = calibration.filter((b) => parseFloat(b.range) >= 70).reduce((s, b) => s + b.total, 0);
  const hcCorrect = calibration.filter((b) => parseFloat(b.range) >= 70).reduce((s, b) => s + b.correct, 0);
  const hcAccuracy = hcTotal > 0 ? Math.round((hcCorrect / hcTotal) * 1000) / 10 : 0;

  const trend = dailyStats.slice(0, 14).reverse();

  return (
    <div>
      {/* Header */}
      <div className="mb-[24px] flex items-start justify-between">
        <div>
          <div className="flex items-center gap-[8px] mb-[4px]">
            <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C]">Forward-Test Accuracy</h1>
            <Badge variant="success">LIVE</Badge>
          </div>
          <p className="text-[13px] text-gray-500">
            Real-time stats from Convex + analytics from Supabase.
          </p>
        </div>
        <div className="flex items-center gap-[8px]">
          <div className="w-[8px] h-[8px] rounded-full bg-green-500 animate-pulse" />
          <span className="text-[11px] text-gray-400">Hybrid real-time</span>
        </div>
      </div>

      {/* Hero Accuracy */}
      {isLoading ? (
        <Skeleton className="h-[120px] mb-[24px]" />
      ) : totalPreds > 0 ? (
        <div className="mb-[24px] bg-white rounded-[14px] border border-gray-100 p-[24px] flex items-center gap-[24px]">
          <div className="flex-1">
            <div className="flex items-center gap-[8px] mb-[4px]">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Overall Accuracy</span>
              <span className={`text-[10px] font-bold px-[6px] py-[2px] rounded-full ${overallAccuracy >= 65 ? "bg-green-50 text-green-600" : overallAccuracy >= 55 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}`}>
                {overallAccuracy >= 65 ? "Healthy" : overallAccuracy >= 55 ? "Moderate" : "Needs Attention"}
              </span>
            </div>
            <div className="text-[48px] font-bold font-mono tabular-nums text-[#0A0F1C] leading-none">{overallAccuracy}%</div>
            <p className="text-[12px] text-gray-400 mt-[6px]">
              {correctPreds.toLocaleString()} correct out of {totalPreds.toLocaleString()} settled
            </p>
          </div>
          {hcTotal > 0 && (
            <div className="text-center px-[24px] border-l border-gray-100">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-[4px]">ELITE Tier</div>
              <div className="text-[32px] font-bold font-mono tabular-nums text-[#D97706] leading-none">{hcAccuracy}%</div>
              <p className="text-[11px] text-gray-400 mt-[4px]">{hcCorrect}/{hcTotal}</p>
            </div>
          )}
        </div>
      ) : null}

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
        <StatCard label="Total Predictions" value={isLoading ? "—" : totalPreds.toLocaleString()} icon="ri-target-line" color="bg-blue-50 text-blue-600" />
        <StatCard label="Settled" value={isLoading ? "—" : totalPreds.toLocaleString()} icon="ri-check-double-line" color="bg-gray-100 text-gray-600" />
        <StatCard label="Correct" value={isLoading ? "—" : correctPreds.toLocaleString()} icon="ri-check-line" color="bg-green-50 text-green-600" />
        <StatCard label="ELITE Win Rate" value={isLoading ? "—" : hcTotal > 0 ? `${hcAccuracy}%` : "Awaiting"} icon="ri-shield-check-line" color={hcAccuracy >= 70 ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-600"} />
      </div>

      {/* Accuracy Trend */}
      {trend.length > 0 && (
        <Card className="mb-[16px]">
          <CardHeader title="Accuracy Trend (Last 14 Days)" description="From Supabase settlement data" />
          <div className="p-[16px]">
            <div className="flex items-end gap-[4px] h-[120px]">
              {trend.map((day) => {
                const height = Math.max(day.accuracy * 1.2, 8);
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-[4px]">
                    <span className="text-[9px] font-mono text-gray-400">{day.accuracy}%</span>
                    <div className={`w-full rounded-t-[4px] transition-all duration-300 ${day.accuracy >= 65 ? "bg-green-400" : day.accuracy >= 55 ? "bg-amber-400" : "bg-red-400"}`} style={{ height: `${height}%` }} />
                    <span className="text-[8px] text-gray-300">{day.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Confidence Calibration */}
      {calibration.length > 0 && (
        <Card className="mb-[16px]">
          <CardHeader title="Confidence Calibration" description="Does predicted confidence match actual accuracy?" />
          <div className="p-[16px]">
            <div className="space-y-[6px]">
              {calibration.map((bucket) => (
                <div key={bucket.range} className="flex items-center gap-[12px]">
                  <span className="text-[11px] font-mono text-gray-500 w-[60px] flex-none">{bucket.range}</span>
                  <div className="flex-1 h-[20px] bg-gray-100 rounded-[4px] overflow-hidden relative">
                    <div className={`h-full rounded-[4px] transition-all duration-500 ${bucket.accuracy >= bucket.avgPredicted - 5 ? "bg-green-400" : bucket.accuracy >= bucket.avgPredicted - 10 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${Math.min(bucket.accuracy, 100)}%` }} />
                    <div className="absolute top-0 bottom-0 w-[2px] bg-gray-400" style={{ left: `${bucket.avgPredicted}%` }} />
                  </div>
                  <span className="text-[11px] font-mono font-semibold w-[40px] text-right flex-none">{bucket.accuracy}%</span>
                  <span className="text-[10px] text-gray-400 w-[50px] text-right flex-none">{bucket.correct}/{bucket.total}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[16px]">
        {/* Daily Performance */}
        <Card>
          <CardHeader title="Daily Performance" />
          <div className="p-[16px]">
            {dailyStats.length === 0 ? (
              <div className="text-center py-[32px] text-gray-400"><p className="text-[13px]">Loading...</p></div>
            ) : (
              <div className="space-y-[4px] max-h-[300px] overflow-y-auto">
                {dailyStats.slice(0, 10).map((day) => (
                  <div key={day.date} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px] hover:bg-gray-100/50 transition-colors">
                    <span className="text-[13px] font-medium text-[#0A0F1C]">{day.date}</span>
                    <div className="flex items-center gap-[12px]">
                      <span className="text-[12px] text-gray-400">{day.correct}/{day.total}</span>
                      <span className={`text-[13px] font-semibold font-mono ${day.accuracy >= 65 ? "text-green-600" : day.accuracy >= 55 ? "text-amber-600" : "text-red-600"}`}>{day.accuracy}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Market Performance */}
        <Card>
          <CardHeader title="Accuracy by Market" />
          <div className="p-[16px]">
            {marketAccuracy.length === 0 ? (
              <div className="text-center py-[32px] text-gray-400"><p className="text-[13px]">Loading...</p></div>
            ) : (
              <div className="space-y-[6px] max-h-[300px] overflow-y-auto">
                {marketAccuracy.map((m) => (
                  <div key={m.market} className="flex items-center gap-[12px] p-[10px] bg-gray-50 rounded-[8px]">
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] font-semibold text-[#0A0F1C] block capitalize">{m.market.replace(/_/g, " ")}</span>
                      <span className="text-[10px] text-gray-400">{m.correct}/{m.total} correct</span>
                    </div>
                    <div className="flex items-center gap-[8px] flex-none">
                      <div className="w-[60px] h-[4px] bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${m.accuracy >= 65 ? "bg-green-500" : m.accuracy >= 55 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.min(m.accuracy, 100)}%` }} />
                      </div>
                      <span className={`text-[13px] font-bold font-mono ${m.accuracy >= 65 ? "text-green-600" : m.accuracy >= 55 ? "text-amber-600" : "text-red-600"}`}>{m.accuracy}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Settlement Feed */}
      <Card>
        <CardHeader title="Live Settlement Feed" description="Updates in real-time as predictions settle" />
        <div className="p-[16px]">
          {isSettling && feed.length === 0 ? (
            <div className="space-y-[6px]">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[40px]" />)}</div>
          ) : feed.length === 0 && settlementUpdates && settlementUpdates.length === 0 ? (
            <div className="text-center py-[32px] text-gray-400"><p className="text-[13px]">No settlement data yet.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Market</th>
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Selection</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Confidence</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Result</th>
                    <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Settled</th>
                  </tr>
                </thead>
                <tbody>
                  {(feed.length > 0 ? feed : (settlementUpdates || []).map((p: any) => ({
                    id: p._id, fixture_id: p.fixtureId, market: p.market, selection: p.selection,
                    model_probability: p.modelProbability, model_version: p.modelVersion,
                    result: p.result, settled_at: p.settledAt,
                  }))).slice(0, 20).map((pred: any) => (
                    <tr key={pred.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                      <td className="py-[8px] px-[10px] font-medium text-[#0A0F1C] capitalize">{(pred.market || "").replace(/_/g, " ")}</td>
                      <td className="py-[8px] px-[10px] text-gray-600 capitalize">{(pred.selection || "").replace(/_/g, " ")}</td>
                      <td className="text-center py-[8px] px-[10px] font-mono tabular-nums">{Math.round((pred.model_probability || 0) * 100)}%</td>
                      <td className="text-center py-[8px] px-[10px]">
                        {pred.result === "correct" ? <Badge variant="success">Correct</Badge> : <Badge variant="danger">Wrong</Badge>}
                      </td>
                      <td className="text-right py-[8px] px-[10px] text-gray-400 font-mono text-[10px]">
                        {pred.settled_at ? new Date(pred.settled_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
