"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface ValidationMetrics {
  accuracy: number;
  balancedAccuracy: number;
  logLoss: number;
  brierScore: number;
  sampleSize: number;
  perClass: {
    home: { precision: number; recall: number; f1: number };
    draw: { precision: number; recall: number; f1: number };
    away: { precision: number; recall: number; f1: number };
  };
}

interface ValidationResult {
  timestamp: string;
  baseline: ValidationMetrics | null;
  withInjuries: ValidationMetrics | null;
  improvement: {
    accuracy: number;
    balancedAccuracy: number;
    logLoss: number;
    brierScore: number;
  } | null;
}

interface InjuryAnalysis {
  highInjuryDiffAccuracy: number;
  lowInjuryDiffAccuracy: number;
  highInjuryDiffCount: number;
  lowInjuryDiffCount: number;
}

interface LiveMetrics {
  totalFixtures: number;
  settledPredictions: number;
  pendingPredictions: number;
  accuracyByMarket: Record<string, { correct: number; total: number; accuracy: number }>;
  recentPerformance: Array<{
    date: string;
    predictions: number;
    correct: number;
    accuracy: number;
  }>;
}

export default function WalkForwardPage() {
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const [injuryAnalysis, setInjuryAnalysis] = useState<InjuryAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningValidation, setRunningValidation] = useState(false);
  const [lastValidationRun, setLastValidationRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMetrics();
    // Refresh every 5 minutes
    const interval = setInterval(loadMetrics, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function loadMetrics() {
    setLoading(true);
    
    try {
      // Load validation results from file (simulated)
      const validationData = await loadValidationResults();
      setValidationResult(validationData);
      
      // Load live metrics from database
      const liveData = await loadLiveMetrics();
      setLiveMetrics(liveData);
      
      // Load injury analysis
      const injuryData = await loadInjuryAnalysis();
      setInjuryAnalysis(injuryData);
      
      setLastValidationRun(new Date().toISOString());
    } catch (error) {
      console.error("Error loading metrics:", error);
      setError("Failed to load validation metrics.");
    } finally {
      setLoading(false);
    }
  }

  // Derive actual match outcome (home/draw/away) from fixture scores
  async function loadOutcomeMap(fixtureIds: string[]): Promise<Record<string, string>> {
    const map: Record<string, string> = {};
    const unique = Array.from(new Set(fixtureIds.filter(Boolean)));
    for (let i = 0; i < unique.length; i += 200) {
      const { data: fixtures } = await supabase
        .from("fixtures")
        .select("id, home_score, away_score")
        .in("id", unique.slice(i, i + 200));
      for (const f of fixtures || []) {
        if (f.home_score == null || f.away_score == null) continue;
        map[f.id] =
          f.home_score > f.away_score ? "home" :
          f.home_score < f.away_score ? "away" : "draw";
      }
    }
    return map;
  }

  function normalizeSelection(selection: string): string | null {
    const s = (selection || "").toLowerCase();
    if (s.includes("home") || s === "1" || s === "h") return "home";
    if (s.includes("away") || s === "2" || s === "a") return "away";
    if (s.includes("draw") || s === "x" || s.includes("tie")) return "draw";
    return null;
  }

  async function loadValidationResults(): Promise<ValidationResult | null> {
    // Get baseline predictions (1X2 / match_result markets)
    const { data: baselinePreds } = await supabase
      .from("predictions")
      .select("selection, model_probability, result, fixture_id")
      .or("market.ilike.1x2,market.eq.match_result")
      .not("result", "is", null)
      .limit(1000);

    if (!baselinePreds?.length) {
      return null;
    }

    // Get predictions flagged as injury-enhanced
    const { data: injuryPreds } = await supabase
      .from("predictions")
      .select("selection, model_probability, result, fixture_id, injury_features_used")
      .or("market.ilike.1x2,market.eq.match_result")
      .not("result", "is", null)
      .not("injury_features_used", "is", null)
      .limit(1000);

    // Actual outcomes come from fixture scores — predictions.result is only correct/wrong
    const allFixtureIds = [
      ...baselinePreds.map((p) => p.fixture_id),
      ...(injuryPreds || []).map((p) => p.fixture_id),
    ];
    const outcomes = await loadOutcomeMap(allFixtureIds);

    const baselineMetrics = calculateMetrics(baselinePreds, outcomes);
    const injuryMetrics = injuryPreds?.length
      ? calculateMetrics(injuryPreds, outcomes)
      : null;

    // Calculate improvement
    let improvement = null;
    if (baselineMetrics && injuryMetrics) {
      improvement = {
        accuracy: injuryMetrics.accuracy - baselineMetrics.accuracy,
        balancedAccuracy: injuryMetrics.balancedAccuracy - baselineMetrics.balancedAccuracy,
        logLoss: injuryMetrics.logLoss - baselineMetrics.logLoss,
        brierScore: injuryMetrics.brierScore - baselineMetrics.brierScore,
      };
    }

    return {
      timestamp: new Date().toISOString(),
      baseline: baselineMetrics,
      withInjuries: injuryMetrics,
      improvement,
    };
  }

  function calculateMetrics(preds: any[], outcomes: Record<string, string>): ValidationMetrics {
    let correct = 0;
    let total = 0;

    const classMetrics = {
      home: { tp: 0, fp: 0, fn: 0 },
      draw: { tp: 0, fp: 0, fn: 0 },
      away: { tp: 0, fp: 0, fn: 0 },
    };

    let logLoss = 0;
    let brierScore = 0;

    for (const pred of preds) {
      const actual = outcomes[pred.fixture_id];
      const predicted = normalizeSelection(pred.selection || "");
      if (!actual || !predicted) continue;

      total++;
      const isCorrect = predicted === actual;
      if (isCorrect) correct++;

      if (isCorrect) {
        classMetrics[predicted as keyof typeof classMetrics].tp++;
      } else {
        classMetrics[predicted as keyof typeof classMetrics].fp++;
        classMetrics[actual as keyof typeof classMetrics].fn++;
      }

      // Log loss and Brier score vs binary outcome
      const prob = Math.min(Math.max(pred.model_probability || 0.5, 1e-6), 1 - 1e-6);
      const actualProb = isCorrect ? 1 : 0;

      logLoss -= actualProb * Math.log(prob) + (1 - actualProb) * Math.log(1 - prob);
      brierScore += Math.pow(prob - actualProb, 2);
    }
    
    const accuracy = total > 0 ? correct / total : 0;
    logLoss = total > 0 ? logLoss / total : 0;
    brierScore = total > 0 ? brierScore / total : 0;
    
    // Per-class metrics
    const perClass: any = {};
    for (const [cls, metrics] of Object.entries(classMetrics)) {
      const precision = metrics.tp + metrics.fp > 0 ? metrics.tp / (metrics.tp + metrics.fp) : 0;
      const recall = metrics.tp + metrics.fn > 0 ? metrics.tp / (metrics.tp + metrics.fn) : 0;
      const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
      
      perClass[cls] = { precision, recall, f1 };
    }
    
    // Balanced accuracy
    const perClassValues = Object.values(perClass) as Array<{ precision: number; recall: number; f1: number }>;
    const balancedAccuracy = perClassValues.reduce((sum, m) => sum + m.recall, 0) / 3;
    
    return {
      accuracy,
      balancedAccuracy,
      logLoss,
      brierScore,
      sampleSize: total,
      perClass,
    };
  }

  async function loadLiveMetrics(): Promise<LiveMetrics> {
    // Get total fixtures
    const { count: totalFixtures } = await supabase
      .from("fixtures")
      .select("*", { count: "exact", head: true });

    // Get predictions by status
    const { count: settledPredictions } = await supabase
      .from("predictions")
      .select("*", { count: "exact", head: true })
      .not("result", "is", null);

    const { count: pendingPredictions } = await supabase
      .from("predictions")
      .select("*", { count: "exact", head: true })
      .eq("result", "pending");

    // Get accuracy by market
    const { data: marketData } = await supabase
      .from("predictions")
      .select("market, result")
      .not("result", "is", null)
      .limit(5000);

    const accuracyByMarket: Record<string, { correct: number; total: number; accuracy: number }> = {};
    
    if (marketData) {
      for (const pred of marketData) {
        const market = pred.market || "unknown";
        if (!accuracyByMarket[market]) {
          accuracyByMarket[market] = { correct: 0, total: 0, accuracy: 0 };
        }
        accuracyByMarket[market].total++;
        if (pred.result === "correct") {
          accuracyByMarket[market].correct++;
        }
      }
      
      // Calculate accuracy
      for (const market of Object.keys(accuracyByMarket)) {
        const { correct, total } = accuracyByMarket[market];
        accuracyByMarket[market].accuracy = total > 0 ? correct / total : 0;
      }
    }

    // Get recent performance (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: recentData } = await supabase
      .from("predictions")
      .select("created_at, result")
      .gte("created_at", sevenDaysAgo.toISOString())
      .not("result", "is", null)
      .limit(1000);

    const recentPerformance: Array<{
      date: string;
      predictions: number;
      correct: number;
      accuracy: number;
    }> = [];

    if (recentData) {
      const byDate: Record<string, { predictions: number; correct: number }> = {};
      
      for (const pred of recentData) {
        const date = pred.created_at?.split("T")[0] || "unknown";
        if (!byDate[date]) {
          byDate[date] = { predictions: 0, correct: 0 };
        }
        byDate[date].predictions++;
        if (pred.result === "correct") {
          byDate[date].correct++;
        }
      }
      
      for (const [date, data] of Object.entries(byDate)) {
        recentPerformance.push({
          date,
          predictions: data.predictions,
          correct: data.correct,
          accuracy: data.predictions > 0 ? data.correct / data.predictions : 0,
        });
      }
      
      recentPerformance.sort((a, b) => a.date.localeCompare(b.date));
    }

    return {
      totalFixtures: totalFixtures || 0,
      settledPredictions: settledPredictions || 0,
      pendingPredictions: pendingPredictions || 0,
      accuracyByMarket,
      recentPerformance,
    };
  }

  async function loadInjuryAnalysis(): Promise<InjuryAnalysis | null> {
    // Get fixtures with injury features
    const { data: fixtures, error: fixturesError } = await supabase
      .from("fixture_injury_features" as any)
      .select("fixture_id, injury_difference")
      .order("created_at", { ascending: false })
      .limit(100);

    // Table may not exist or RLS may block reads — treat as no data
    if (fixturesError || !fixtures?.length) {
      return null;
    }

    let highCorrect = 0;
    let highTotal = 0;
    let lowCorrect = 0;
    let lowTotal = 0;

    for (const fixture of fixtures) {
      // Get prediction for this fixture
      const { data: prediction } = await supabase
        .from("predictions")
        .select("selection, result")
        .eq("fixture_id", fixture.fixture_id)
        .or("market.ilike.1x2,market.eq.match_result")
        .not("result", "is", null)
        .limit(1)
        .single();

      if (!prediction) continue;

      const isCorrect = prediction.result === "correct";
      const absInjuryDiff = Math.abs(fixture.injury_difference || 0);

      if (absInjuryDiff > 2) {
        highTotal++;
        if (isCorrect) highCorrect++;
      } else {
        lowTotal++;
        if (isCorrect) lowCorrect++;
      }
    }

    return {
      highInjuryDiffAccuracy: highTotal > 0 ? highCorrect / highTotal : 0,
      lowInjuryDiffAccuracy: lowTotal > 0 ? lowCorrect / lowTotal : 0,
      highInjuryDiffCount: highTotal,
      lowInjuryDiffCount: lowTotal,
    };
  }

  async function runValidation() {
    setRunningValidation(true);
    
    try {
      // Trigger validation via API — requires admin Bearer token
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/v1/admin/run-validation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });

      if (response.ok) {
        setError(null);
        // Reload metrics after validation
        await loadMetrics();
      } else {
        const body = await response.json().catch(() => ({}));
        setError(body.error || `Validation run failed (HTTP ${response.status})`);
      }
    } catch (error) {
      console.error("Error running validation:", error);
      setError("Validation request failed — check your connection.");
    } finally {
      setRunningValidation(false);
    }
  }

  function formatPercent(value: number) {
    return (value * 100).toFixed(1) + "%";
  }

  function formatMetric(value: number, decimals = 4) {
    return value.toFixed(decimals);
  }

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-1/4 mb-8"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-2">Walk-Forward Validation</h1>
            <p className="text-[13px] text-gray-500">Live validation metrics and model performance tracking</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={loadMetrics}
              className="px-4 py-2 bg-white border border-gray-200 text-[#0A0F1C] rounded-[10px] text-[13px] font-semibold hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              Refresh
            </button>
            <button
              onClick={runValidation}
              disabled={runningValidation}
              className="px-4 py-2 bg-[#1B2A4A] text-white rounded-[10px] text-[13px] font-semibold hover:bg-[#243B53] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              {runningValidation ? "Running..." : "Run Validation"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 flex items-center justify-between gap-[8px] bg-amber-50 border border-amber-200 rounded-[10px] p-[12px] text-[12px] text-amber-700">
            <span className="flex items-center gap-[6px]">
              <i className="ri-alert-line" /> {error}
            </span>
            <button
              onClick={loadMetrics}
              className="text-[11px] font-semibold underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-[4px] px-[4px]"
            >
              Retry
            </button>
          </div>
        )}

        {/* Last Updated */}
        {lastValidationRun && (
          <div className="mb-6 text-sm text-gray-500">
            Last updated: {new Date(lastValidationRun).toLocaleString()}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px]">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-[6px]">Total Fixtures</div>
            <div className="text-[24px] font-bold font-mono tabular-nums text-[#0A0F1C]">{liveMetrics?.totalFixtures || 0}</div>
          </div>
          <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px]">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-[6px]">Settled Predictions</div>
            <div className="text-[24px] font-bold font-mono tabular-nums text-green-600">{liveMetrics?.settledPredictions || 0}</div>
          </div>
          <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px]">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-[6px]">Pending Predictions</div>
            <div className="text-[24px] font-bold font-mono tabular-nums text-amber-600">{liveMetrics?.pendingPredictions || 0}</div>
          </div>
          <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px]">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-[6px]">Overall Accuracy</div>
            <div className="text-[24px] font-bold font-mono tabular-nums text-blue-600">
              {liveMetrics?.settledPredictions ? 
                formatPercent(
                  Object.values(liveMetrics.accuracyByMarket).reduce((sum, m) => sum + m.correct, 0) /
                  Math.max(1, Object.values(liveMetrics.accuracyByMarket).reduce((sum, m) => sum + m.total, 0))
                ) : "N/A"}
            </div>
          </div>
        </div>

        {/* Model Comparison */}
        <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px] mb-8">
          <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">Model Comparison: Baseline vs Injury-Enhanced</h2>
          
          {validationResult ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Baseline Model */}
              <div className="border border-gray-100 rounded-[10px] p-[14px]">
                <h3 className="font-medium text-gray-700 mb-3">Baseline Model</h3>
                {validationResult.baseline ? (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Accuracy:</span>
                      <span className="font-medium">{formatPercent(validationResult.baseline.accuracy)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Balanced Accuracy:</span>
                      <span className="font-medium">{formatPercent(validationResult.baseline.balancedAccuracy)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Log Loss:</span>
                      <span className="font-medium">{formatMetric(validationResult.baseline.logLoss)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Brier Score:</span>
                      <span className="font-medium">{formatMetric(validationResult.baseline.brierScore)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Sample Size:</span>
                      <span className="font-medium">{validationResult.baseline.sampleSize}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500">No baseline data available</div>
                )}
              </div>

              {/* Injury-Enhanced Model */}
              <div className="border border-gray-100 rounded-[10px] p-[14px]">
                <h3 className="font-medium text-gray-700 mb-3">Injury-Enhanced Model</h3>
                {validationResult.withInjuries ? (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Accuracy:</span>
                      <span className="font-medium">{formatPercent(validationResult.withInjuries.accuracy)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Balanced Accuracy:</span>
                      <span className="font-medium">{formatPercent(validationResult.withInjuries.balancedAccuracy)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Log Loss:</span>
                      <span className="font-medium">{formatMetric(validationResult.withInjuries.logLoss)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Brier Score:</span>
                      <span className="font-medium">{formatMetric(validationResult.withInjuries.brierScore)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Sample Size:</span>
                      <span className="font-medium">{validationResult.withInjuries.sampleSize}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500">No injury-enhanced data available</div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-center py-8">
              No validation results available. Run validation to see metrics.
            </div>
          )}

          {/* Improvement Summary */}
          {validationResult?.improvement && (
            <div className="mt-[16px] p-[14px] bg-gray-50 rounded-[10px]">
              <h3 className="font-medium text-gray-700 mb-3">Improvement Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
                <div>
                  <div className="text-sm text-gray-500">Accuracy</div>
                  <div className={`font-medium ${validationResult.improvement.accuracy > 0 ? "text-green-600" : "text-red-600"}`}>
                    {validationResult.improvement.accuracy > 0 ? "+" : ""}
                    {formatPercent(validationResult.improvement.accuracy)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Balanced Accuracy</div>
                  <div className={`font-medium ${validationResult.improvement.balancedAccuracy > 0 ? "text-green-600" : "text-red-600"}`}>
                    {validationResult.improvement.balancedAccuracy > 0 ? "+" : ""}
                    {formatPercent(validationResult.improvement.balancedAccuracy)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Log Loss</div>
                  <div className={`font-medium ${validationResult.improvement.logLoss < 0 ? "text-green-600" : "text-red-600"}`}>
                    {validationResult.improvement.logLoss > 0 ? "+" : ""}
                    {formatMetric(validationResult.improvement.logLoss)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Brier Score</div>
                  <div className={`font-medium ${validationResult.improvement.brierScore < 0 ? "text-green-600" : "text-red-600"}`}>
                    {validationResult.improvement.brierScore > 0 ? "+" : ""}
                    {formatMetric(validationResult.improvement.brierScore)}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Per-Class Metrics */}
        {validationResult?.baseline?.perClass && (
          <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px] mb-8">
            <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">Per-Class Performance (Baseline)</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Precision</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recall</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">F1 Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(validationResult.baseline.perClass).map(([cls, metrics]) => (
                    <tr key={cls} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium capitalize">{cls}</td>
                      <td className="px-4 py-3">{formatPercent(metrics.precision)}</td>
                      <td className="px-4 py-3">{formatPercent(metrics.recall)}</td>
                      <td className="px-4 py-3">{formatPercent(metrics.f1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Injury Feature Impact */}
        <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px] mb-8">
          <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">Injury Feature Impact Analysis</h2>
          
          {injuryAnalysis ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border border-gray-100 rounded-[10px] p-[14px]">
                <h3 className="font-medium text-gray-700 mb-3">High Injury Difference (&gt;2)</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Accuracy:</span>
                    <span className="font-medium">{formatPercent(injuryAnalysis.highInjuryDiffAccuracy)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Sample Size:</span>
                    <span className="font-medium">{injuryAnalysis.highInjuryDiffCount}</span>
                  </div>
                </div>
              </div>
              
              <div className="border border-gray-100 rounded-[10px] p-[14px]">
                <h3 className="font-medium text-gray-700 mb-3">Low Injury Difference (&le;2)</h3>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Accuracy:</span>
                    <span className="font-medium">{formatPercent(injuryAnalysis.lowInjuryDiffAccuracy)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Sample Size:</span>
                    <span className="font-medium">{injuryAnalysis.lowInjuryDiffCount}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-center py-8">
              No injury analysis data available
            </div>
          )}
        </div>

        {/* Accuracy by Market */}
        <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px] mb-8">
          <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">Accuracy by Market</h2>
          
          {liveMetrics?.accuracyByMarket && Object.keys(liveMetrics.accuracyByMarket).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Market</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Correct</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(liveMetrics.accuracyByMarket)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([market, data]) => (
                      <tr key={market} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{market}</td>
                        <td className="px-4 py-3 text-green-600">{data.correct}</td>
                        <td className="px-4 py-3">{data.total}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-sm ${
                            data.accuracy >= 0.6 ? "bg-green-100 text-green-800" :
                            data.accuracy >= 0.5 ? "bg-yellow-100 text-yellow-800" :
                            "bg-red-100 text-red-800"
                          }`}>
                            {formatPercent(data.accuracy)}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500 text-center py-8">
              No market accuracy data available
            </div>
          )}
        </div>

        {/* Recent Performance */}
        <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px] mb-8">
          <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">Recent Performance (Last 7 Days)</h2>
          
          {liveMetrics?.recentPerformance && liveMetrics.recentPerformance.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Predictions</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Correct</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {liveMetrics.recentPerformance.map((day) => (
                    <tr key={day.date} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{day.date}</td>
                      <td className="px-4 py-3">{day.predictions}</td>
                      <td className="px-4 py-3 text-green-600">{day.correct}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-sm ${
                          day.accuracy >= 0.6 ? "bg-green-100 text-green-800" :
                          day.accuracy >= 0.5 ? "bg-yellow-100 text-yellow-800" :
                          "bg-red-100 text-red-800"
                        }`}>
                          {formatPercent(day.accuracy)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-gray-500 text-center py-8">
              No recent performance data available
            </div>
          )}
        </div>

        {/* Validation Information */}
        <div className="bg-white rounded-[14px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)] p-[20px]">
          <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[14px]">Validation Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium text-gray-700 mb-2">Methodology</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Walk-forward chronological validation</li>
                <li>• No data leakage (features computed before prediction time)</li>
                <li>• Historical snapshots preserve what was known</li>
                <li>• Injury features only used if available before prediction</li>
              </ul>
            </div>
            <div>
              <h3 className="font-medium text-gray-700 mb-2">Metrics Explained</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• <strong>Log Loss:</strong> Penalizes confident wrong predictions (lower is better)</li>
                <li>• <strong>Brier Score:</strong> Measures probability calibration (lower is better)</li>
                <li>• <strong>Balanced Accuracy:</strong> Averages recall across classes</li>
                <li>• <strong>F1 Score:</strong> Harmonic mean of precision and recall</li>
              </ul>
            </div>
          </div>
        </div>
    </div>
  );
}
