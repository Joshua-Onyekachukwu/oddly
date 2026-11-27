"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, CardHeader, Badge, StatCard, EmptyState } from "@/components/ui";

interface WeightConfig {
  id: string;
  config_name: string;
  trained_at: string | null;
  accuracy: number | null;
  brier_score: number | null;
  matches_analyzed: number | null;
  recalibration?: Record<string, unknown> | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

interface MarketPerf {
  model_version: string;
  market: string | null;
  total_predictions: number;
  correct_predictions: number;
  accuracy: number | null;
  avg_brier_score: number | null;
  avg_roi: number | null;
  evaluations: number;
  last_evaluated: string;
}

interface DriftRow {
  id: string;
  model_version: string;
  market: string;
  drift_status: string;
  recent_accuracy: number | null;
  prior_accuracy: number | null;
  accuracy_delta: number | null;
  brier_delta: number | null;
  recent_n: number;
  prior_n: number;
  computed_at: string;
  reasons?: unknown;
}

interface GateRow {
  id: string;
  league_key: string;
  league_name: string | null;
  verdict: string;
  model_version: string;
  sample_size: number;
  computed_at: string;
  metrics?: Record<string, unknown>;
}

interface ModelsResponse {
  weightConfigs: WeightConfig[];
  performance: MarketPerf[];
  drift: DriftRow[];
  driftSummary: Record<string, number>;
  gates: GateRow[];
  gateSummary: Record<string, number>;
}

const VERDICT_VARIANT: Record<string, "success" | "warning" | "danger" | "info" | "default"> = {
  trusted: "success",
  watch: "warning",
  exclude: "danger",
  insufficient: "default",
};

const DRIFT_VARIANT: Record<string, "success" | "warning" | "danger" | "default"> = {
  stable: "success",
  watch: "warning",
  drift_suspected: "danger",
  insufficient_data: "default",
};

// Weight columns worth surfacing in the pretty-printed config view
const WEIGHT_KEY_PATTERN = /weight$|^intercept$/;

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export default function AdminModelsPage() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedConfig, setExpandedConfig] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    setError(null);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/v1/admin/models", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error || json.success === false) {
        throw new Error(json?.error?.message || `Failed to load models (${res.status})`);
      }
      setData(json.data || null);
    } catch (e: any) {
      setError(e?.message || "Failed to load model data");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const weightKeys = data?.weightConfigs?.[0]
    ? Object.keys(data.weightConfigs[0]).filter(
        (k) => WEIGHT_KEY_PATTERN.test(k) && typeof data.weightConfigs[0][k] === "number"
      )
    : [];

  return (
    <div>
      <PageHeader
        title="Model Configuration"
        description="Weight configs, market performance, drift detection, and league gate verdicts."
        action={
          <button
            onClick={fetchModels}
            className="px-[12px] py-[7px] rounded-[8px] text-[12px] font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all flex items-center gap-[6px]"
          >
            <i className="ri-refresh-line" /> Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-[16px] flex items-center justify-between gap-[8px] bg-amber-50 border border-amber-200 rounded-[10px] p-[12px] text-[12px] text-amber-700">
          <span className="flex items-center gap-[6px]"><i className="ri-alert-line" /> {error}</span>
          <button onClick={fetchModels} className="text-[11px] font-semibold underline hover:no-underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[140px] bg-white rounded-[14px] animate-pulse" />
          ))}
        </div>
      ) : !data ? (
        <EmptyState icon="ri-brain-line" title="No model data" description="Model configuration will appear once the training pipeline runs." />
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
            <StatCard
              label="Weight Configs"
              value={String(data.weightConfigs.length)}
              icon="ri-scales-3-line"
              color="bg-purple-50 text-purple-600"
            />
            <StatCard
              label="Gate Verdicts"
              value={String(data.gates.length)}
              icon="ri-shield-check-line"
              color="bg-blue-50 text-blue-600"
            />
            <StatCard
              label="Trusted Leagues"
              value={String(data.gateSummary.trusted ?? 0)}
              icon="ri-checkbox-circle-line"
              color="bg-green-50 text-green-600"
            />
            <StatCard
              label="Drift Suspected"
              value={String(data.driftSummary.drift_suspected ?? 0)}
              icon="ri-alert-line"
              color={(data.driftSummary.drift_suspected ?? 0) > 0 ? "bg-red-50 text-red-500" : "bg-gray-50 text-gray-600"}
            />
          </div>

          {/* Weight configs */}
          <Card className="mb-[24px]">
            <CardHeader title="Weight Configurations" description="model_weight_config — learned ensemble weights" />
            <div className="divide-y divide-gray-50">
              {data.weightConfigs.length === 0 && (
                <p className="p-[16px] text-[13px] text-gray-400">No weight configs found.</p>
              )}
              {data.weightConfigs.map((wc) => {
                const expanded = expandedConfig === wc.id;
                const weightEntries = weightKeys
                  .map((k) => [k, wc[k]] as const)
                  .filter(([, v]) => typeof v === "number" && v !== 0);
                return (
                  <div key={wc.id} className="p-[16px]">
                    <div className="flex items-center justify-between mb-[8px]">
                      <div className="flex items-center gap-[10px]">
                        <span className="text-[14px] font-bold text-[#0A0F1C] font-mono">{wc.config_name}</span>
                        {wc.config_name === "production_v5" && <Badge variant="accent" size="sm">production</Badge>}
                        <Badge variant={typeof wc.accuracy === "number" && wc.accuracy >= 0.6 ? "success" : "default"} size="sm">
                          acc {typeof wc.accuracy === "number" ? `${(wc.accuracy * 100).toFixed(1)}%` : "—"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-[12px] text-[11px] text-gray-400">
                        <span>{wc.matches_analyzed ? `${Number(wc.matches_analyzed).toLocaleString()} matches` : ""}</span>
                        <span>{wc.trained_at ? `trained ${new Date(wc.trained_at).toLocaleDateString()}` : ""}</span>
                        <button
                          onClick={() => setExpandedConfig(expanded ? null : wc.id)}
                          className="text-[11px] font-semibold text-[#1B2A4A] hover:underline"
                        >
                          {expanded ? "Hide weights" : "Show weights"}
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[12px] mt-[8px]">
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-[6px]">Weights</p>
                          <pre className="text-[11px] font-mono bg-gray-50 rounded-[8px] p-[10px] overflow-x-auto max-h-[280px] overflow-y-auto">
                            {weightEntries.length > 0
                              ? weightEntries.map(([k, v]) => `${k}: ${Number(v).toFixed(4)}`).join("\n")
                              : prettyJson(wc)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-[6px]">Recalibration</p>
                          <pre className="text-[11px] font-mono bg-gray-50 rounded-[8px] p-[10px] overflow-x-auto max-h-[280px] overflow-y-auto whitespace-pre-wrap">
                            {prettyJson(wc.recalibration)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[24px]">
            {/* Performance by market */}
            <Card>
              <CardHeader title="Performance by Market" description="Aggregated from model_performance" />
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Market</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">Preds</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">Accuracy</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">Brier</th>
                      <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.performance.map((p) => (
                      <tr key={`${p.model_version}-${p.market}`} className="border-b border-gray-50 last:border-0">
                        <td className="px-[16px] py-[8px]">
                          <span className="font-semibold text-[#0A0F1C] capitalize">{(p.market || "all").replace(/_/g, " ")}</span>
                          <span className="block text-[10px] text-gray-400 font-mono">{p.model_version}</span>
                        </td>
                        <td className="px-[8px] py-[8px] text-right font-mono">{p.total_predictions.toLocaleString()}</td>
                        <td className="px-[8px] py-[8px] text-right font-mono font-semibold">
                          {p.accuracy !== null ? `${p.accuracy.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-[8px] py-[8px] text-right font-mono">{p.avg_brier_score !== null ? p.avg_brier_score.toFixed(4) : "—"}</td>
                        <td className={`px-[16px] py-[8px] text-right font-mono font-semibold ${p.avg_roi !== null && p.avg_roi >= 0 ? "text-green-600" : "text-red-500"}`}>
                          {p.avg_roi !== null ? `${p.avg_roi.toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                    {data.performance.length === 0 && (
                      <tr><td colSpan={5} className="px-[16px] py-[20px] text-center text-gray-400">No performance data.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Drift status */}
            <Card>
              <CardHeader
                title="Drift Status"
                description="Latest model_drift_status per model + market"
              />
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Model / Market</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Status</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">Δ Acc</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">Δ Brier</th>
                      <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.drift.map((d) => (
                      <tr key={d.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-[16px] py-[8px]">
                          <span className="font-semibold text-[#0A0F1C] font-mono text-[11px]">{d.model_version}</span>
                          <span className="block text-[10px] text-gray-400 capitalize">{(d.market || "").replace(/_/g, " ")}</span>
                        </td>
                        <td className="px-[8px] py-[8px]">
                          <Badge variant={DRIFT_VARIANT[d.drift_status] || "default"} size="sm">{d.drift_status.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className={`px-[8px] py-[8px] text-right font-mono ${d.accuracy_delta !== null && Number(d.accuracy_delta) < 0 ? "text-red-500" : "text-gray-600"}`}>
                          {d.accuracy_delta !== null ? Number(d.accuracy_delta).toFixed(3) : "—"}
                        </td>
                        <td className="px-[8px] py-[8px] text-right font-mono">{d.brier_delta !== null ? Number(d.brier_delta).toFixed(4) : "—"}</td>
                        <td className="px-[16px] py-[8px] text-right font-mono text-gray-500">{d.recent_n}/{d.prior_n}</td>
                      </tr>
                    ))}
                    {data.drift.length === 0 && (
                      <tr><td colSpan={5} className="px-[16px] py-[20px] text-center text-gray-400">No drift data — computed weekly by the learn cron.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* League gate verdicts */}
          <Card>
            <CardHeader
              title="League Gate Verdicts"
              description="Per-league model gating from league_model_gates (market = ALL)"
            />
            <div className="px-[16px] pb-[8px] flex flex-wrap gap-[8px]">
              {Object.entries(data.gateSummary).map(([verdict, count]) => (
                <Badge key={verdict} variant={VERDICT_VARIANT[verdict] || "default"}>
                  {verdict}: {count}
                </Badge>
              ))}
              {data.gates.length === 0 && <span className="text-[12px] text-gray-400">No gate verdicts computed yet.</span>}
            </div>
            {data.gates.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-left">
                      <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">League</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Verdict</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase">Model</th>
                      <th className="px-[8px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">Sample</th>
                      <th className="px-[16px] py-[8px] text-[10px] font-semibold text-gray-400 uppercase text-right">Computed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.gates.map((g) => (
                      <tr key={g.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-[16px] py-[8px] font-semibold text-[#0A0F1C]">{g.league_name || g.league_key}</td>
                        <td className="px-[8px] py-[8px]">
                          <Badge variant={VERDICT_VARIANT[g.verdict] || "default"} size="sm">{g.verdict}</Badge>
                        </td>
                        <td className="px-[8px] py-[8px] font-mono text-[11px] text-gray-500">{g.model_version}</td>
                        <td className="px-[8px] py-[8px] text-right font-mono">{g.sample_size}</td>
                        <td className="px-[16px] py-[8px] text-right text-[11px] text-gray-400">{new Date(g.computed_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
