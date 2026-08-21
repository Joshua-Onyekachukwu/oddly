"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { StatCard, Card, CardHeader, Badge } from "@/components/ui";

interface ModelAccuracy {
  name: string;
  accuracy: number;
  avgBrier: number;
  total: number;
  correct: number;
}

interface TierAccuracy {
  tier: string;
  accuracy: number;
  total: number;
  correct: number;
}

interface BacktestRun {
  evaluation_date: string;
  model_name: string;
  accuracy: number;
  brier_score: number;
  log_loss: number;
  total_predictions: number;
}

export default function AccuracyPage() {
  const [totalPredictions, setTotalPredictions] = useState(0);
  const [correctPredictions, setCorrectPredictions] = useState(0);
  const [accuracy, setAccuracy] = useState(0);
  const [avgBrier, setAvgBrier] = useState(0);
  const [byModel, setByModel] = useState<ModelAccuracy[]>([]);
  const [byTier, setByTier] = useState<TierAccuracy[]>([]);
  const [backtestHistory, setBacktestHistory] = useState<BacktestRun[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const supabase = createClient();

    // Get recent predictions with actual results
    const { data: predictions } = await supabase
      .from("model_predictions")
      .select("*")
      .not("actual_result", "is", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!predictions || predictions.length === 0) {
      setLoading(false);
      return;
    }

    // Compute aggregate stats
    const total = predictions.length;
    let correct = 0;
    let brierSum = 0;

    const modelMap: Record<string, { correct: number; total: number; brierSum: number }> = {};
    const tierMap: Record<string, { correct: number; total: number }> = {};

    for (const pred of predictions) {
      const hp = pred.home_win_prob ?? 0;
      const dp = pred.draw_prob ?? 0;
      const ap = pred.away_win_prob ?? 0;
      const predicted = Math.max(hp, dp, ap);
      const predictedResult =
        predicted === hp ? "home" : predicted === dp ? "draw" : "away";
      const isCorrect = predictedResult === pred.actual_result;

      brierSum += pred.brier_score || 0;
      if (isCorrect) correct++;

      // By model
      const model = pred.model_name || "ensemble";
      if (!modelMap[model]) modelMap[model] = { correct: 0, total: 0, brierSum: 0 };
      modelMap[model].total++;
      modelMap[model].brierSum += pred.brier_score || 0;
      if (isCorrect) modelMap[model].correct++;

      // By tier
      const tier = predicted >= 0.7 ? "high" : predicted >= 0.55 ? "medium" : "low";
      if (!tierMap[tier]) tierMap[tier] = { correct: 0, total: 0 };
      tierMap[tier].total++;
      if (isCorrect) tierMap[tier].correct++;
    }

    setTotalPredictions(total);
    setCorrectPredictions(correct);
    setAccuracy(Number(((correct / total) * 100).toFixed(1)));
    setAvgBrier(Number((brierSum / total).toFixed(4)));

    setByModel(
      Object.entries(modelMap).map(([name, stats]) => ({
        name,
        accuracy: stats.total > 0 ? Number(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
        avgBrier: stats.total > 0 ? Number((stats.brierSum / stats.total).toFixed(4)) : 0,
        total: stats.total,
        correct: stats.correct,
      }))
    );

    setByTier(
      Object.entries(tierMap).map(([tier, stats]) => ({
        tier,
        accuracy: stats.total > 0 ? Number(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
        total: stats.total,
        correct: stats.correct,
      }))
    );

    // Get backtest history
    const { data: history } = await supabase
      .from("model_performance_history")
      .select("*")
      .order("evaluation_date", { ascending: false })
      .limit(20);

    if (history) setBacktestHistory(history as any);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-[24px]">
        <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
          Model Accuracy Analysis
        </h1>
        <p className="text-[13px] text-gray-500">
          Backtesting results, prediction accuracy, and model performance metrics.
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
        <StatCard
          label="Total Predictions"
          value={loading ? "—" : totalPredictions.toLocaleString()}
          icon="ri-target-line"
          color="bg-blue-50 text-blue-600"
        />
        <StatCard
          label="Overall Accuracy"
          value={loading ? "—" : `${accuracy}%`}
          icon="ri-check-double-line"
          color={accuracy >= 65 ? "bg-green-50 text-green-600" : accuracy >= 55 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}
        />
        <StatCard
          label="Brier Score"
          value={loading ? "—" : avgBrier.toString()}
          icon="ri-pulse-line"
          color={avgBrier <= 0.2 ? "bg-green-50 text-green-600" : avgBrier <= 0.25 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"}
        />
        <StatCard
          label="Correct"
          value={loading ? "—" : `${correctPredictions}/${totalPredictions}`}
          icon="ri-thumb-up-line"
          color="bg-purple-50 text-purple-600"
        />
      </div>

      {/* Model Comparison */}
      <Card>
        <CardHeader
          title="Model Comparison"
          action={
            <button
              onClick={fetchData}
              className="text-[11px] text-gray-400 hover:text-[#1B2A4A] transition-colors flex items-center gap-[4px]"
            >
              <i className="ri-refresh-line" />
              Refresh
            </button>
          }
        />
        <div className="p-[16px]">
          {loading ? (
            <div className="space-y-[6px]">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[48px] bg-gray-50 rounded-[8px] animate-pulse" />
              ))}
            </div>
          ) : byModel.length === 0 ? (
            <div className="text-center py-[32px] text-gray-400">
              <i className="ri-brain-line text-[32px] block mb-[8px] opacity-50" />
              <p className="text-[13px]">
                No model predictions yet. Run:{" "}
                <code className="bg-gray-100 px-[6px] py-[2px] rounded text-[12px] font-mono">
                  npm run backtest
                </code>
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[10px] px-[12px] font-medium text-gray-500">Model</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Accuracy</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Brier Score</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Predictions</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Correct</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((model) => (
                    <tr key={model.name} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                      <td className="py-[10px] px-[12px]">
                        <div className="flex items-center gap-[8px]">
                          <i className="ri-brain-line text-[14px] text-gray-400" />
                          <span className="font-medium capitalize">{model.name}</span>
                        </div>
                      </td>
                      <td className="text-center py-[10px] px-[12px]">
                        <span
                          className={`font-mono font-medium ${
                            model.accuracy >= 65
                              ? "text-green-600"
                              : model.accuracy >= 55
                              ? "text-amber-600"
                              : "text-red-600"
                          }`}
                        >
                          {model.accuracy}%
                        </span>
                      </td>
                      <td className="text-center py-[10px] px-[12px] font-mono">{model.avgBrier}</td>
                      <td className="text-center py-[10px] px-[12px] text-gray-500">{model.total}</td>
                      <td className="text-center py-[10px] px-[12px] text-gray-500">{model.correct}</td>
                      <td className="text-center py-[10px] px-[12px]">
                        {model.accuracy >= 65 ? (
                          <Badge variant="success">Excellent</Badge>
                        ) : model.accuracy >= 55 ? (
                          <Badge variant="warning">Good</Badge>
                        ) : (
                          <Badge variant="danger">Needs Tuning</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Confidence Tier Analysis */}
      <Card>
        <CardHeader title="Accuracy by Confidence Tier" />
        <div className="p-[16px]">
          {byTier.length === 0 ? (
            <div className="text-center py-[32px] text-gray-400">
              <p className="text-[13px]">No tier data available yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
              {byTier.map((tier) => (
                <div
                  key={tier.tier}
                  className={`p-[16px] rounded-[10px] border ${
                    tier.tier === "high"
                      ? "border-green-200 bg-green-50/50"
                      : tier.tier === "medium"
                      ? "border-amber-200 bg-amber-50/50"
                      : "border-red-200 bg-red-50/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-[6px]">
                    <span className="text-[12px] font-semibold text-gray-600 capitalize">
                      {tier.tier} Confidence
                    </span>
                    <i
                      className={`text-[14px] ${
                        tier.tier === "high"
                          ? "ri-check-line text-green-600"
                          : tier.tier === "medium"
                          ? "ri-alert-line text-amber-600"
                          : "ri-close-line text-red-600"
                      }`}
                    />
                  </div>
                  <div className="text-[24px] font-bold text-[#0A0F1C]">{tier.accuracy}%</div>
                  <div className="text-[11px] text-gray-400 mt-[2px]">
                    {tier.correct}/{tier.total} correct
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Backtest History */}
      {backtestHistory.length > 0 && (
        <Card>
          <CardHeader title="Backtest History" />
          <div className="p-[16px]">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[10px] px-[12px] font-medium text-gray-500">Date</th>
                    <th className="text-left py-[10px] px-[12px] font-medium text-gray-500">Model</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Accuracy</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Brier</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Log Loss</th>
                    <th className="text-center py-[10px] px-[12px] font-medium text-gray-500">Predictions</th>
                  </tr>
                </thead>
                <tbody>
                  {backtestHistory.map((run, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-[10px] px-[12px] text-gray-500">{run.evaluation_date}</td>
                      <td className="py-[10px] px-[12px] font-medium capitalize">{run.model_name}</td>
                      <td className="text-center py-[10px] px-[12px] font-mono">{run.accuracy}%</td>
                      <td className="text-center py-[10px] px-[12px] font-mono">{run.brier_score}</td>
                      <td className="text-center py-[10px] px-[12px] font-mono">{run.log_loss}</td>
                      <td className="text-center py-[10px] px-[12px] text-gray-500">{run.total_predictions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* Data Pipeline Commands */}
      <Card>
        <CardHeader title="Data Pipeline" />
        <div className="p-[16px]">
          <div className="space-y-[8px]">
            {[
              { cmd: "npm run sync:historical", desc: "Collect historical match data from APIs", step: "1" },
              { cmd: "npm run compute:features", desc: "Engineer 30+ features from match data", step: "2" },
              { cmd: "npm run backtest", desc: "Test all models against historical data", step: "3" },
              { cmd: "npm run pipeline", desc: "Run the full pipeline end-to-end", step: "Full" },
            ].map((item) => (
              <div
                key={item.step}
                className="flex items-center justify-between p-[12px] bg-gray-50 rounded-[8px]"
              >
                <div>
                  <code className="text-[13px] font-mono font-medium text-[#0A0F1C]">{item.cmd}</code>
                  <p className="text-[11px] text-gray-400 mt-[2px]">{item.desc}</p>
                </div>
                <Badge variant={item.step === "Full" ? "success" : "default"}>
                  Step {item.step}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
