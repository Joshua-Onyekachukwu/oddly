"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { StatCard, Card, CardHeader, Badge } from "@/components/ui";

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
  home_team?: string;
  away_team?: string;
  home_score?: number;
  away_score?: number;
  league?: string;
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
  const [highConfStats, setHighConfStats] = useState({ total: 0, correct: 0, accuracy: 0 });
  const [recentResults, setRecentResults] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Get all settled predictions with results
    const { data: settled } = await supabase
      .from("predictions")
      .select("*, fixtures(home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), home_score, away_score, league:leagues!fixtures_league_id_fkey(name))")
      .eq("result", "correct")
      .order("settled_at", { ascending: false })
      .limit(200);

    const { data: wrong } = await supabase
      .from("predictions")
      .select("*, fixtures(home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), home_score, away_score, league:leagues!fixtures_league_id_fkey(name))")
      .eq("result", "wrong")
      .order("settled_at", { ascending: false })
      .limit(200);

    const { data: pending } = await supabase
      .from("predictions")
      .select("*")
      .is("result", null)
      .limit(500);

    const correctData = settled || [];
    const incorrectData = wrong || [];
    const allSettled = [...correctData, ...incorrectData];
    const totalAll = allSettled.length + (pending?.length || 0);

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
    setDailyStats(
      Object.entries(dailyMap)
        .map(([date, stats]) => ({
          date,
          total: stats.total,
          correct: stats.correct,
          accuracy: Number(((stats.correct / stats.total) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
    );

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

    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
          Forward-Test Accuracy
        </h1>
        <p className="text-[13px] text-gray-500">
          Real-time model accuracy from live predictions and settled results.
        </p>
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

      {/* Daily Breakdown */}
      <Card className="mb-[16px]">
        <CardHeader
          title="Daily Performance"
          action={
            <button onClick={fetchData} className="text-[11px] text-gray-400 hover:text-[#1B2A4A] transition-colors flex items-center gap-[4px]">
              <i className="ri-refresh-line" /> Refresh
            </button>
          }
        />
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
              <p className="text-[13px]">No settled predictions yet. Results appear after matches finish.</p>
            </div>
          ) : (
            <div className="space-y-[4px]">
              {dailyStats.map((day) => (
                <div key={day.date} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
                  <span className="text-[13px] font-medium text-[#0A0F1C]">{day.date}</span>
                  <div className="flex items-center gap-[12px]">
                    <span className="text-[12px] text-gray-400">{day.correct}/{day.total} correct</span>
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
      {marketStats.length > 0 && (
        <Card className="mb-[16px]">
          <CardHeader title="Accuracy by Market" />
          <div className="p-[16px]">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
              {marketStats.map((m) => (
                <div key={m.market} className="p-[14px] bg-gray-50 rounded-[10px]">
                  <div className="text-[12px] font-semibold text-gray-600 uppercase mb-[4px]">{m.market}</div>
                  <div className="text-[22px] font-bold text-[#0A0F1C]">{m.accuracy}%</div>
                  <div className="text-[11px] text-gray-400 mt-[2px]">{m.correct}/{m.total} correct</div>
                  <div className="mt-[6px] h-[4px] bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${m.accuracy >= 65 ? "bg-green-500" : m.accuracy >= 55 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ width: `${Math.min(m.accuracy, 100)}%` }}
                    />
                  </div>
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
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Probability</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {recentResults.map((pred) => (
                    <tr key={pred.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="py-[10px] px-[12px]">
                        <span className="text-[#0A0F1C]">
                          {pred.fixtures?.home_team?.canonical_name || "?"} vs {pred.fixtures?.away_team?.canonical_name || "?"}
                        </span>
                      </td>
                      <td className="py-[10px] px-[12px] text-gray-500 uppercase text-[11px]">{pred.market}</td>
                      <td className="text-center py-[10px] px-[12px] font-medium">{pred.selection}</td>
                      <td className="text-center py-[10px] px-[12px] font-mono">{Math.round(pred.model_probability * 100)}%</td>
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
