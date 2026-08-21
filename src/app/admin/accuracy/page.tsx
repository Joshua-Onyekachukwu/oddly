"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { StatCard, Card, CardHeader, Badge } from "@/components/ui";
import { BettingTooltip, getMarketLabel, getSelectionLabel } from "@/components/ui/BettingTooltip";

interface PredictionRecord {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  model_probability: number;
  confidence_lower: number;
  confidence_upper: number;
  model_version: string;
  result: string | null;
  created_at: string;
  settled_at: string | null;
  fixtures?: {
    home_team?: { canonical_name: string } | null;
    away_team?: { canonical_name: string } | null;
    home_score: number | null;
    away_score: number | null;
    league?: { name: string } | null;
  };
}

interface DailyStats {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface MarketStats {
  market: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface ConfidenceBucket {
  range: string;
  min: number;
  max: number;
  total: number;
  correct: number;
  accuracy: number;
}

interface LeagueStats {
  league: string;
  total: number;
  correct: number;
  accuracy: number;
}

const REFRESH_INTERVAL = 30000; // 30 seconds

export default function AccuracyPage() {
  const [predictions, setPredictions] = useState<PredictionRecord[]>([]);
  const [settledPredictions, setSettledPredictions] = useState<PredictionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPreds, setTotalPreds] = useState(0);
  const [settledPreds, setSettledPreds] = useState(0);
  const [correctPreds, setCorrectPreds] = useState(0);
  const [overallAccuracy, setOverallAccuracy] = useState(0);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [marketStats, setMarketStats] = useState<MarketStats[]>([]);
  const [confidenceBuckets, setConfidenceBuckets] = useState<ConfidenceBucket[]>([]);
  const [leagueStats, setLeagueStats] = useState<LeagueStats[]>([]);
  const [highConfStats, setHighConfStats] = useState({ total: 0, correct: 0, accuracy: 0 });
  const [recentResults, setRecentResults] = useState<any[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [trend, setTrend] = useState<{ date: string; accuracy: number }[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Get all settled predictions with results
    const [correctRes, wrongRes, pendingRes] = await Promise.all([
      supabase
        .from("predictions")
        .select("*, fixtures(home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), home_score, away_score, league:leagues!fixtures_league_id_fkey(name))")
        .eq("result", "correct")
        .order("settled_at", { ascending: false })
        .limit(500),
      supabase
        .from("predictions")
        .select("*, fixtures(home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), home_score, away_score, league:leagues!fixtures_league_id_fkey(name))")
        .eq("result", "wrong")
        .order("settled_at", { ascending: false })
        .limit(500),
      supabase
        .from("predictions")
        .select("*")
        .is("result", null)
        .limit(1000),
    ]);

    const correctData = correctRes.data || [];
    const incorrectData = wrongRes.data || [];
    const allSettled = [...correctData, ...incorrectData];
    const totalAll = allSettled.length + (pendingRes.data?.length || 0);

    setTotalPreds(totalAll);
    setSettledPreds(allSettled.length);
    setCorrectPreds(correctData.length);

    if (allSettled.length > 0) {
      setOverallAccuracy(Number(((correctData.length / allSettled.length) * 100).toFixed(1)));
    }

    // Compute daily stats
    const dailyMap: Record<string, { correct: number; total: number }> = {};
    for (const p of allSettled) {
      const date = (p.settled_at || p.created_at).slice(0, 10);
      if (!dailyMap[date]) dailyMap[date] = { correct: 0, total: 0 };
      dailyMap[date].total++;
      if (p.result === "correct") dailyMap[date].correct++;
    }
    const dailyArr = Object.entries(dailyMap)
      .map(([date, stats]) => ({
        date,
        total: stats.total,
        correct: stats.correct,
        accuracy: Number(((stats.correct / stats.total) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    setDailyStats(dailyArr);

    // Trend data (daily accuracy for chart)
    setTrend(dailyArr.slice(0, 14).reverse());

    // Compute market stats
    const marketMap: Record<string, { correct: number; total: number }> = {};
    for (const p of allSettled) {
      const market = p.market || "unknown";
      if (!marketMap[market]) marketMap[market] = { correct: 0, total: 0 };
      marketMap[market].total++;
      if (p.result === "correct") marketMap[market].correct++;
    }
    setMarketStats(
      Object.entries(marketMap)
        .map(([market, stats]) => ({
          market,
          total: stats.total,
          correct: stats.correct,
          accuracy: Number(((stats.correct / stats.total) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.accuracy - a.accuracy)
    );

    // Confidence calibration buckets
    const buckets: { range: string; min: number; max: number; total: number; correct: number }[] = [
      { range: "50-59%", min: 0.50, max: 0.59, total: 0, correct: 0 },
      { range: "60-64%", min: 0.60, max: 0.64, total: 0, correct: 0 },
      { range: "65-69%", min: 0.65, max: 0.69, total: 0, correct: 0 },
      { range: "70-74%", min: 0.70, max: 0.74, total: 0, correct: 0 },
      { range: "75-79%", min: 0.75, max: 0.79, total: 0, correct: 0 },
      { range: "80-84%", min: 0.80, max: 0.84, total: 0, correct: 0 },
      { range: "85-89%", min: 0.85, max: 0.89, total: 0, correct: 0 },
      { range: "90%+", min: 0.90, max: 1.0, total: 0, correct: 0 },
    ];
    for (const p of allSettled) {
      for (const b of buckets) {
        if (p.model_probability >= b.min && p.model_probability <= b.max) {
          b.total++;
          if (p.result === "correct") b.correct++;
          break;
        }
      }
    }
    setConfidenceBuckets(
      buckets.map((b) => ({
        ...b,
        accuracy: b.total > 0 ? Number(((b.correct / b.total) * 100).toFixed(1)) : 0,
      }))
    );

    // League stats
    const leagueMap: Record<string, { correct: number; total: number }> = {};
    for (const p of allSettled) {
      const league = p.fixtures?.league?.name || "Unknown";
      if (!leagueMap[league]) leagueMap[league] = { correct: 0, total: 0 };
      leagueMap[league].total++;
      if (p.result === "correct") leagueMap[league].correct++;
    }
    setLeagueStats(
      Object.entries(leagueMap)
        .map(([league, stats]) => ({
          league,
          total: stats.total,
          correct: stats.correct,
          accuracy: Number(((stats.correct / stats.total) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.total - a.total)
    );

    // High confidence (model_probability >= 0.65)
    const highConf = allSettled.filter((p) => p.model_probability >= 0.65);
    const highConfCorrect = highConf.filter((p) => p.result === "correct");
    setHighConfStats({
      total: highConf.length,
      correct: highConfCorrect.length,
      accuracy: highConf.length > 0 ? Number(((highConfCorrect.length / highConf.length) * 100).toFixed(1)) : 0,
    });

    // Recent results (last 20 settled)
    const recent = allSettled
      .sort((a, b) => new Date(b.settled_at || b.created_at).getTime() - new Date(a.settled_at || a.created_at).getTime())
      .slice(0, 20);
    setRecentResults(recent);

    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  // Auto-refresh
  useEffect(() => {
    fetchData();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, autoRefresh]);

  return (
    <div>
      {/* Header with live indicator */}
      <div className="mb-[24px] flex items-start justify-between">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
            Forward-Test Accuracy
          </h1>
          <p className="text-[13px] text-gray-500">
            Real-time model accuracy from live predictions and settled results.
          </p>
        </div>
        <div className="flex items-center gap-[12px]">
          {/* Live indicator */}
          <div className="flex items-center gap-[6px]">
            <div className={`w-[8px] h-[8px] rounded-full ${autoRefresh ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
            <span className="text-[11px] text-gray-400">
              {autoRefresh ? "Live" : "Paused"} · {lastRefresh.toLocaleTimeString()}
            </span>
          </div>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-[10px] py-[5px] rounded-[8px] text-[11px] font-semibold transition-all ${
              autoRefresh ? "bg-green-50 text-green-600 hover:bg-green-100" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {autoRefresh ? "⏸ Pause" : "▶ Resume"}
          </button>
          <button
            onClick={fetchData}
            className="px-[10px] py-[5px] rounded-[8px] text-[11px] font-semibold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-all flex items-center gap-[4px]"
          >
            <i className="ri-refresh-line" /> Refresh
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
        <StatCard
          label="Total Predictions"
          value={loading ? "—" : String(totalPreds)}
          icon="ri-target-line"
          color="bg-blue-50 text-blue-600"
        />
        <StatCard
          label="Settled"
          value={loading ? "—" : String(settledPreds)}
          icon="ri-check-double-line"
          color="bg-gray-100 text-gray-600"
        />
        <StatCard
          label="Overall Accuracy"
          value={loading ? "—" : settledPreds > 0 ? `${overallAccuracy}%` : "Awaiting results"}
          icon="ri-percent-line"
          color={overallAccuracy >= 65 ? "bg-green-50 text-green-600" : overallAccuracy >= 55 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}
        />
        <StatCard
          label="High-Conf (65%+)"
          value={loading ? "—" : highConfStats.total > 0 ? `${highConfStats.accuracy}%` : "Awaiting results"}
          icon="ri-shield-check-line"
          color={highConfStats.accuracy >= 70 ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-600"}
        />
      </div>

      {/* Trend Chart (last 14 days) */}
      {trend.length > 0 && (
        <Card className="mb-[16px]">
          <CardHeader title="Accuracy Trend (Last 14 Days)" />
          <div className="p-[16px]">
            <div className="flex items-end gap-[4px] h-[120px]">
              {trend.map((day, i) => {
                const height = Math.max(day.accuracy * 1.2, 8);
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-[4px]">
                    <span className="text-[9px] font-mono text-gray-400">{day.accuracy}%</span>
                    <div
                      className={`w-full rounded-t-[4px] transition-all duration-300 ${
                        day.accuracy >= 65 ? "bg-green-400" : day.accuracy >= 55 ? "bg-amber-400" : "bg-red-400"
                      }`}
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-[8px] text-gray-300">{day.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Confidence Calibration */}
      {confidenceBuckets.some((b) => b.total > 0) && (
        <Card className="mb-[16px]">
          <CardHeader title="Confidence Calibration" />
          <div className="p-[16px]">
            <p className="text-[11px] text-gray-400 mb-[12px]">
              Does a predicted 80% confidence actually produce 80% correct results?
            </p>
            <div className="space-y-[6px]">
              {confidenceBuckets.filter((b) => b.total > 0).map((bucket) => (
                <div key={bucket.range} className="flex items-center gap-[12px]">
                  <span className="text-[11px] font-mono text-gray-500 w-[60px] flex-none">{bucket.range}</span>
                  <div className="flex-1 h-[20px] bg-gray-100 rounded-[4px] overflow-hidden relative">
                    <div
                      className={`h-full rounded-[4px] transition-all duration-500 ${
                        bucket.accuracy >= bucket.min * 100 - 5 ? "bg-green-400" :
                        bucket.accuracy >= bucket.min * 100 - 10 ? "bg-amber-400" : "bg-red-400"
                      }`}
                      style={{ width: `${Math.min(bucket.accuracy, 100)}%` }}
                    />
                    {/* Expected line */}
                    <div
                      className="absolute top-0 bottom-0 w-[2px] bg-gray-400"
                      style={{ left: `${bucket.min * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono font-semibold w-[40px] text-right flex-none">
                    {bucket.accuracy}%
                  </span>
                  <span className="text-[10px] text-gray-400 w-[50px] text-right flex-none">
                    {bucket.correct}/{bucket.total}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-[16px] mt-[12px] text-[10px] text-gray-400">
              <span className="flex items-center gap-[4px]">
                <div className="w-[8px] h-[8px] bg-gray-400 rounded-[2px]" /> Expected (model confidence)
              </span>
              <span className="flex items-center gap-[4px]">
                <div className="w-[8px] h-[8px] bg-green-400 rounded-[2px]" /> Well-calibrated (within 5%)
              </span>
              <span className="flex items-center gap-[4px]">
                <div className="w-[8px] h-[8px] bg-red-400 rounded-[2px]" /> Over/under-confident
              </span>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[16px]">
        {/* Daily Breakdown */}
        <Card>
          <CardHeader title="Daily Performance" />
          <div className="p-[16px]">
            {loading ? (
              <div className="space-y-[6px]">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-[40px] bg-gray-50 rounded-[8px] animate-pulse" />
                ))}
              </div>
            ) : dailyStats.length === 0 ? (
              <div className="text-center py-[32px] text-gray-400">
                <i className="ri-calendar-check-line text-[32px] block mb-[8px] opacity-50" />
                <p className="text-[13px]">No settled predictions yet.</p>
              </div>
            ) : (
              <div className="space-y-[4px] max-h-[300px] overflow-y-auto">
                {dailyStats.slice(0, 10).map((day) => (
                  <div key={day.date} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px] hover:bg-gray-100/50 transition-colors">
                    <span className="text-[13px] font-medium text-[#0A0F1C]">{day.date}</span>
                    <div className="flex items-center gap-[12px]">
                      <span className="text-[12px] text-gray-400">{day.correct}/{day.total}</span>
                      <span className={`text-[13px] font-semibold font-mono ${
                        day.accuracy >= 65 ? "text-green-600" : day.accuracy >= 55 ? "text-amber-600" : "text-red-600"
                      }`}>
                        {day.accuracy}%
                      </span>
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
            {marketStats.length === 0 ? (
              <div className="text-center py-[32px] text-gray-400">
                <i className="ri-bar-chart-line text-[32px] block mb-[8px] opacity-50" />
                <p className="text-[13px]">No market data yet.</p>
              </div>
            ) : (
              <div className="space-y-[6px] max-h-[300px] overflow-y-auto">
                {marketStats.map((m) => (
                  <div key={m.market} className="flex items-center gap-[12px] p-[10px] bg-gray-50 rounded-[8px]">
                    <div className="flex-1 min-w-0">
                      <span className="text-[12px] font-semibold text-[#0A0F1C] block">
                        <BettingTooltip term={m.market}>{getMarketLabel(m.market)}</BettingTooltip>
                      </span>
                      <span className="text-[10px] text-gray-400">{m.correct}/{m.total} correct</span>
                    </div>
                    <div className="flex items-center gap-[8px] flex-none">
                      <div className="w-[60px] h-[4px] bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${m.accuracy >= 65 ? "bg-green-500" : m.accuracy >= 55 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${Math.min(m.accuracy, 100)}%` }}
                        />
                      </div>
                      <span className={`text-[13px] font-bold font-mono ${
                        m.accuracy >= 65 ? "text-green-600" : m.accuracy >= 55 ? "text-amber-600" : "text-red-600"
                      }`}>
                        {m.accuracy}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* League Performance */}
      {leagueStats.length > 0 && (
        <Card className="mb-[16px]">
          <CardHeader title="Accuracy by League" />
          <div className="p-[16px]">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-[8px]">
              {leagueStats.map((l) => (
                <div key={l.league} className="p-[12px] bg-gray-50 rounded-[10px] text-center">
                  <div className="text-[11px] font-semibold text-gray-600 truncate">{l.league}</div>
                  <div className={`text-[20px] font-bold font-mono ${
                    l.accuracy >= 65 ? "text-green-600" : l.accuracy >= 55 ? "text-amber-600" : "text-red-600"
                  }`}>
                    {l.accuracy}%
                  </div>
                  <div className="text-[10px] text-gray-400">{l.total} predictions</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Recent Results */}
      {recentResults.length > 0 && (
        <Card>
          <CardHeader title="Recent Settled Predictions" />
          <div className="p-[16px]">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[10px] px-[12px] font-medium text-gray-500">Match</th>
                    <th className="text-left py-[10px] px-[12px] font-medium text-gray-500">Market</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Prediction</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Confidence</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Score</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {recentResults.map((pred) => (
                    <tr key={pred.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                      <td className="py-[10px] px-[12px]">
                        <span className="text-[#0A0F1C] font-medium">
                          {pred.fixtures?.home_team?.canonical_name || "?"} vs {pred.fixtures?.away_team?.canonical_name || "?"}
                        </span>
                      </td>
                      <td className="py-[10px] px-[12px] text-gray-500">
                        <BettingTooltip term={pred.market} showAbbrev>{getMarketLabel(pred.market)}</BettingTooltip>
                      </td>
                      <td className="text-center py-[10px] px-[12px] font-medium">
                        <BettingTooltip term={pred.selection} showAbbrev>{getSelectionLabel(pred.selection)}</BettingTooltip>
                      </td>
                      <td className="text-center py-[10px] px-[12px] font-mono tabular-nums">{Math.round(pred.model_probability * 100)}%</td>
                      <td className="text-center py-[10px] px-[12px] font-mono tabular-nums text-gray-400">
                        {pred.fixtures?.home_score ?? "-"} - {pred.fixtures?.away_score ?? "-"}
                      </td>
                      <td className="text-center py-[10px] px-[12px]">
                        {pred.result === "correct" ? (
                          <Badge variant="success">✓ Correct</Badge>
                        ) : pred.result === "wrong" ? (
                          <Badge variant="danger">✗ Wrong</Badge>
                        ) : (
                          <Badge variant="default">Pending</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
