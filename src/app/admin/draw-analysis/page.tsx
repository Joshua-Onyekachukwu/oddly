"use client";

import React, { useState, useEffect, useCallback } from "react";

function StatCard({
  label, value, icon, color = "bg-blue-50 text-blue-600", subtitle,
}: {
  label: string; value: string | number; icon: string; color?: string; subtitle?: string;
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

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "success" | "danger" | "warning" | "default" }) {
  const colors = {
    success: "bg-green-50 text-green-600",
    danger: "bg-red-50 text-red-600",
    warning: "bg-amber-50 text-amber-600",
    default: "bg-gray-100 text-gray-600",
  };
  return <span className={`text-[10px] font-bold px-[8px] py-[3px] rounded-full ${colors[variant]}`}>{children}</span>;
}

export default function DrawAnalysisPage() {
  const [summary, setSummary] = useState<any>(null);
  const [confusion, setConfusion] = useState<any>(null);
  const [buckets, setBuckets] = useState<any[]>([]);
  const [leagues, setLeagues] = useState<any[]>([]);
  const [trend, setTrend] = useState<any[]>([]);
  const [calibration, setCalibration] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, confRes, bucRes, leaRes, treRes, calRes] = await Promise.all([
        fetch("/api/v1/analytics/draw?type=summary"),
        fetch("/api/v1/analytics/draw?type=confusion"),
        fetch("/api/v1/analytics/draw?type=buckets"),
        fetch("/api/v1/analytics/draw?type=leagues"),
        fetch("/api/v1/analytics/draw?type=trend&days=90"),
        fetch("/api/v1/analytics/draw?type=calibration"),
      ]);
      const [sum, conf, buc, lea, tre, cal] = await Promise.all([
        sumRes.json(), confRes.json(), bucRes.json(), leaRes.json(), treRes.json(), calRes.json(),
      ]);
      setSummary(sum.data?.data || null);
      setConfusion(conf.data?.data || null);
      setBuckets(buc.data?.data || []);
      setLeagues(lea.data?.data || []);
      setTrend(tre.data?.data || []);
      setCalibration(cal.data?.data || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div>
      <div className="mb-[24px] flex items-start justify-between">
        <div>
          <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C] mb-[4px]">
            Draw Analysis
          </h1>
          <p className="text-[13px] text-gray-500">
            Deep dive into draw prediction accuracy, calibration, and league-specific performance.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="text-[11px] text-gray-400 hover:text-[#1B2A4A] transition-colors flex items-center gap-[4px]"
        >
          <i className="ri-refresh-line" /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-[12px] mb-[24px]">
          <StatCard
            label="Actual Draws"
            value={summary.actualDraws}
            icon="ri-equalizer-line"
            color="bg-amber-50 text-amber-600"
            subtitle={`${summary.totalPredictions > 0 ? Math.round((summary.actualDraws / summary.totalPredictions) * 100) : 0}% of matches`}
          />
          <StatCard
            label="Correct Draws"
            value={summary.correctDraws}
            icon="ri-check-line"
            color="bg-green-50 text-green-600"
            subtitle={`Precision: ${summary.drawPrecision}%`}
          />
          <StatCard
            label="Missed Draws"
            value={summary.missedDraws}
            icon="ri-close-circle-line"
            color="bg-red-50 text-red-600"
            subtitle={`${summary.homeToDrawErrors} H->D, ${summary.awayToDrawErrors} A->D`}
          />
          <StatCard
            label="False Draws"
            value={summary.falseDraws}
            icon="ri-error-warning-line"
            color="bg-orange-50 text-orange-600"
            subtitle={`${summary.drawToHomeErrors} D->H, ${summary.drawToAwayErrors} D->A`}
          />
          <StatCard
            label="Draw F1 Score"
            value={`${summary.drawF1}%`}
            icon="ri-function-add-line"
            color="bg-purple-50 text-purple-600"
            subtitle={`Recall: ${summary.drawRecall}%`}
          />
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-[12px] mb-[24px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-[16px]">
              <div className="h-[80px] bg-gray-100 rounded-[8px] animate-pulse" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[16px]">
        {/* Confusion Matrix */}
        <Card>
          <CardHeader title="Outcome Confusion Matrix" description="Predicted (rows) vs Actual (columns)" />
          <div className="p-[16px]">
            {!confusion ? (
              <div className="text-center py-[32px] text-gray-400 text-[13px]">No data available</div>
            ) : (
              <>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr>
                      <th className="text-left py-[6px] px-[8px] text-[10px] text-gray-400 uppercase">Predicted \ Actual</th>
                      {confusion.labels.map((l: string) => (
                        <th key={l} className="text-center py-[6px] px-[8px] text-[10px] text-gray-400 uppercase">{l}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {confusion.labels.map((row: string, i: number) => (
                      <tr key={row} className="border-t border-gray-50">
                        <td className="py-[6px] px-[8px] font-semibold text-[#0A0F1C]">{row}</td>
                        {confusion.matrix[i].map((val: number, j: number) => (
                          <td key={j} className={`text-center py-[6px] px-[8px] font-mono font-semibold ${
                            i === j ? "text-green-600 bg-green-50/50" :
                            (j === 1 && i !== 1) ? "text-red-600 bg-red-50/30" : "text-gray-500"
                          }`}>{val.toLocaleString()}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-[12px] flex gap-[16px] text-[10px] text-gray-400">
                  <span><span className="text-green-600">&#9632;</span> Correct</span>
                  <span><span className="text-red-600">&#9632;</span> Missed/False Draw</span>
                  <span>Gray = Other errors</span>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Draw Probability Calibration */}
        <Card>
          <CardHeader title="Draw Probability Calibration" description="Does predicted draw probability match actual draw rate?" />
          <div className="p-[16px]">
            {buckets.length === 0 ? (
              <div className="text-center py-[32px] text-gray-400 text-[13px]">No data available</div>
            ) : (
              <div className="space-y-[6px]">
                {buckets.map((b: any) => (
                  <div key={b.prob_bucket} className="flex items-center gap-[10px]">
                    <span className="text-[11px] font-mono text-gray-500 w-[50px] flex-none">{b.prob_bucket}</span>
                    <div className="flex-1 h-[18px] bg-gray-100 rounded-[4px] overflow-hidden relative">
                      <div
                        className="h-full rounded-[4px] transition-all duration-500 bg-blue-400"
                        style={{ width: `${Math.min((b.observed_draw_rate || 0) * 100, 100)}%` }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-[2px] bg-red-500"
                        style={{ left: `${Math.min((b.avg_predicted_draw_prob || 0) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono w-[40px] text-right flex-none">
                      {b.observed_draw_rate ? Math.round(b.observed_draw_rate * 100) : 0}%
                    </span>
                    <span className="text-[10px] text-gray-400 w-[55px] text-right flex-none">
                      {b.total_matches} matches
                    </span>
                  </div>
                ))}
                <div className="mt-[12px] flex gap-[16px] text-[10px] text-gray-400">
                  <span><span className="text-blue-400">&#9632;</span> Observed draw rate</span>
                  <span><span className="text-red-500">|</span> Predicted draw probability</span>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* League Draw Performance */}
      <Card className="mb-[16px]">
        <CardHeader title="Draw Performance by League" description="League-specific draw accuracy, calibration, and sample sizes" />
        <div className="p-[16px] overflow-x-auto">
          {leagues.length === 0 ? (
            <div className="text-center py-[32px] text-gray-400 text-[13px]">No league data available</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">League</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Matches</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Draw Rate</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Predicted</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Precision</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Recall</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">F1</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Cal. Error</th>
                  <th className="text-right py-[8px] px-[10px] font-medium text-gray-500">Sample Size</th>
                </tr>
              </thead>
              <tbody>
                {leagues.map((lg: any) => (
                  <tr key={lg.leagueId} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="py-[8px] px-[10px] font-semibold text-[#0A0F1C]">{lg.leagueName || "Unknown"}</td>
                    <td className="text-right py-[8px] px-[10px] font-mono text-gray-600">{lg.totalPredictions}</td>
                    <td className="text-right py-[8px] px-[10px] font-mono text-gray-600">
                      {lg.actualDrawRate ? Math.round(lg.actualDrawRate * 100) : 0}%
                    </td>
                    <td className="text-right py-[8px] px-[10px] font-mono text-gray-600">
                      {lg.predictedDrawRate ? Math.round(lg.predictedDrawRate * 100) : 0}%
                    </td>
                    <td className="text-right py-[8px] px-[10px] font-mono text-gray-600">
                      {lg.drawPrecision ? Math.round(lg.drawPrecision * 100) : 0}%
                    </td>
                    <td className="text-right py-[8px] px-[10px] font-mono text-gray-600">
                      {lg.drawRecall ? Math.round(lg.drawRecall * 100) : 0}%
                    </td>
                    <td className="text-right py-[8px] px-[10px] font-mono font-semibold text-gray-700">
                      {lg.drawF1 || 0}%
                    </td>
                    <td className="text-right py-[8px] px-[10px]">
                      <Badge variant={
                        (lg.calibrationError || 0) < 0.03 ? "success" :
                        (lg.calibrationError || 0) < 0.08 ? "warning" : "danger"
                      }>
                        {lg.calibrationError ? Math.round(lg.calibrationError * 100) : 0}%
                      </Badge>
                    </td>
                    <td className="text-right py-[8px] px-[10px]">
                      <span className={`text-[10px] font-mono px-[6px] py-[2px] rounded-full ${
                        lg.totalPredictions >= 100 ? "bg-green-50 text-green-600" :
                        lg.totalPredictions >= 30 ? "bg-amber-50 text-amber-600" : "bg-red-50 text-red-600"
                      }`}>
                        {lg.totalPredictions >= 100 ? "Reliable" : lg.totalPredictions >= 30 ? "Moderate" : "Low"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Draw Trend */}
      {trend.length > 0 && (
        <Card className="mb-[16px]">
          <CardHeader title="Draw Performance Trend" description="Weekly actual vs predicted draw rates" />
          <div className="p-[16px]">
            <div className="flex items-end gap-[4px] h-[120px]">
              {trend.slice(-14).map((t: any) => (
                <div key={t.week} className="flex-1 flex flex-col items-center gap-[4px]">
                  <span className="text-[9px] font-mono text-gray-400">
                    {t.actual_draw_rate ? Math.round(t.actual_draw_rate * 100) : 0}%
                  </span>
                  <div className="w-full flex gap-[1px] items-end">
                    <div
                      className="flex-1 bg-amber-400 rounded-t-[2px]"
                      style={{ height: `${Math.max((t.actual_draw_rate || 0) * 400, 4)}px` }}
                    />
                    <div
                      className="flex-1 bg-blue-400 rounded-t-[2px]"
                      style={{ height: `${Math.max((t.predicted_draw_rate || 0) * 400, 4)}px` }}
                    />
                  </div>
                  <span className="text-[8px] text-gray-300">{String(t.week).slice(5, 10)}</span>
                </div>
              ))}
            </div>
            <div className="mt-[8px] flex gap-[16px] text-[10px] text-gray-400 justify-center">
              <span><span className="text-amber-400">&#9632;</span> Actual draw rate</span>
              <span><span className="text-blue-400">&#9632;</span> Predicted draw rate</span>
            </div>
          </div>
        </Card>
      )}

      {/* Model Health */}
      <Card>
        <CardHeader title="Draw Model Health" description="Current calibration status and alerts" />
        <div className="p-[16px]">
          {!summary ? (
            <div className="text-center py-[32px] text-gray-400 text-[13px]">No data available yet</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
              <div className="bg-gray-50 rounded-[10px] p-[12px]">
                <div className="text-[10px] font-semibold text-gray-400 uppercase mb-[4px]">Model</div>
                <div className="text-[14px] font-bold text-[#0A0F1C]">market-draw v1.0</div>
                <div className="text-[11px] text-gray-400 mt-[2px]">Dedicated draw model</div>
              </div>
              <div className="bg-gray-50 rounded-[10px] p-[12px]">
                <div className="text-[10px] font-semibold text-gray-400 uppercase mb-[4px]">Calibration Error</div>
                <div className={`text-[14px] font-bold ${
                  (summary.calibrationError || 0) < 0.05 ? "text-green-600" : "text-amber-600"
                }`}>
                  {summary.calibrationError ? `${Math.round(summary.calibrationError * 100)}%` : "N/A"}
                </div>
              </div>
              <div className="bg-gray-50 rounded-[10px] p-[12px]">
                <div className="text-[10px] font-semibold text-gray-400 uppercase mb-[4px]">Status</div>
                <Badge variant={summary.totalPredictions > 100 ? "success" : "warning"}>
                  {summary.totalPredictions > 100 ? "Active" : "Warming Up"}
                </Badge>
              </div>
              <div className="bg-gray-50 rounded-[10px] p-[12px]">
                <div className="text-[10px] font-semibold text-gray-400 uppercase mb-[4px]">Leagues Calibrated</div>
                <div className="text-[14px] font-bold text-[#0A0F1C]">{leagues.length}</div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
