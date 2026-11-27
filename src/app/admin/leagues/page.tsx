"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { PageHeader, Button, Card, CardHeader, Badge, EmptyState } from "@/components/ui";

interface LeagueModelParams {
  id?: string;
  league_name?: string;
  home_advantage?: number | null;
  goal_expectancy?: number | null;
  avg_goals?: number | null;
  home_win_pct?: number | null;
  draw_pct?: number | null;
  avg_yellow?: number | null;
  avg_corners?: number | null;
  poisson_weight?: number | null;
  elo_weight?: number | null;
  regression_weight?: number | null;
  overall_accuracy?: number | null;
  data_points?: number | null;
  last_trained?: string | null;
}

interface League {
  id: string;
  name: string;
  country: string | null;
  sport: string | null;
  is_active: boolean;
  priority: number;
  logo: string | null;
  fixture_count: number;
  upcoming_count: number;
  finished_count: number;
  model_params: LeagueModelParams | null;
}

const PARAM_FIELDS: { key: keyof LeagueModelParams; label: string; step: string }[] = [
  { key: "home_advantage", label: "Home Advantage", step: "1" },
  { key: "goal_expectancy", label: "Goal Expectancy", step: "0.1" },
  { key: "avg_goals", label: "Avg Goals", step: "0.1" },
  { key: "home_win_pct", label: "Home Win %", step: "0.1" },
  { key: "draw_pct", label: "Draw %", step: "0.1" },
  { key: "avg_yellow", label: "Avg Yellow Cards", step: "0.1" },
  { key: "avg_corners", label: "Avg Corners", step: "0.1" },
  { key: "poisson_weight", label: "Poisson Weight", step: "0.05" },
  { key: "elo_weight", label: "Elo Weight", step: "0.05" },
  { key: "regression_weight", label: "Regression Weight", step: "0.05" },
];

export default function AdminLeaguesPage() {
  const { session } = useAuth();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<League | null>(null);

  // Edit form state
  const [formName, setFormName] = useState("");
  const [formCountry, setFormCountry] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formPriority, setFormPriority] = useState("");
  const [formParams, setFormParams] = useState<Record<string, string>>({});
  const [paramsDirty, setParamsDirty] = useState(false);

  const getAuthHeaders = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error("Not authenticated");
    return { Authorization: `Bearer ${data.session.access_token}` };
  }, []);

  const fetchLeagues = useCallback(async () => {
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/v1/admin/leagues?pageSize=100", { headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error || json.success === false) {
        throw new Error(json?.error?.message || `Failed to load leagues (${res.status})`);
      }
      setLeagues(json.data || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load leagues");
    }
    setLoading(false);
  }, [getAuthHeaders]);

  useEffect(() => {
    fetchLeagues();
  }, [fetchLeagues]);

  const openEditor = (league: League) => {
    setEditing(league);
    setFormName(league.name);
    setFormCountry(league.country || "");
    setFormActive(league.is_active);
    setFormPriority(String(league.priority ?? 0));
    const params: Record<string, string> = {};
    for (const f of PARAM_FIELDS) {
      const v = league.model_params?.[f.key];
      params[f.key] = v === null || v === undefined ? "" : String(v);
    }
    setFormParams(params);
    setParamsDirty(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!editing || !session?.access_token) return;
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {};
    if (formName.trim() !== editing.name) payload.name = formName.trim();
    if (formCountry.trim() !== (editing.country || "")) payload.country = formCountry.trim() || null;
    if (formActive !== editing.is_active) payload.is_active = formActive;
    const prio = parseInt(formPriority, 10);
    if (!Number.isNaN(prio) && prio !== editing.priority) payload.priority = prio;

    if (paramsDirty) {
      const mp: Record<string, number> = {};
      for (const f of PARAM_FIELDS) {
        const raw = formParams[f.key]?.trim();
        if (raw === "" || raw === undefined) continue;
        const num = Number(raw);
        if (!Number.isNaN(num)) mp[f.key] = num;
      }
      if (Object.keys(mp).length > 0) payload.model_params = mp;
    }

    if (Object.keys(payload).length === 0) {
      setSaving(false);
      setEditing(null);
      return;
    }

    try {
      const res = await fetch(`/api/v1/admin/leagues/${editing.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error || json.success === false) {
        throw new Error(json?.error?.message || json?.error || `Update failed (${res.status})`);
      }
      setEditing(null);
      await fetchLeagues();
    } catch (e: any) {
      setError(e?.message || "Failed to save league");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="League Management"
        description="Edit league metadata, display order, active flags, and model parameters."
        action={
          <Button onClick={fetchLeagues} variant="secondary" icon="ri-refresh-line">
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-[16px] flex items-center justify-between gap-[8px] bg-amber-50 border border-amber-200 rounded-[10px] p-[12px] text-[12px] text-amber-700">
          <span className="flex items-center gap-[6px]"><i className="ri-alert-line" /> {error}</span>
          <button onClick={fetchLeagues} className="text-[11px] font-semibold underline hover:no-underline">Retry</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[64px] bg-white rounded-[14px] animate-pulse" />
          ))}
        </div>
      ) : leagues.length === 0 ? (
        <EmptyState icon="ri-football-line" title="No leagues" description="Leagues will appear here once synced." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="px-[16px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider">League</th>
                  <th className="px-[8px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Country</th>
                  <th className="px-[8px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Priority</th>
                  <th className="px-[8px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Fixtures</th>
                  <th className="px-[8px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Model Params</th>
                  <th className="px-[8px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="px-[16px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leagues.map((l) => (
                  <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="px-[16px] py-[10px] font-semibold text-[#0A0F1C]">{l.name}</td>
                    <td className="px-[8px] py-[10px] text-gray-500">{l.country || "—"}</td>
                    <td className="px-[8px] py-[10px] text-right font-mono">{l.priority}</td>
                    <td className="px-[8px] py-[10px] text-right font-mono">
                      {l.fixture_count}
                      <span className="text-gray-400"> ({l.upcoming_count} up / {l.finished_count} done)</span>
                    </td>
                    <td className="px-[8px] py-[10px]">
                      {l.model_params ? (
                        <Badge variant="info" size="sm">
                          trained{l.model_params.last_trained ? ` · ${new Date(l.model_params.last_trained).toLocaleDateString()}` : ""}
                        </Badge>
                      ) : (
                        <Badge variant="default" size="sm">none</Badge>
                      )}
                    </td>
                    <td className="px-[8px] py-[10px]">
                      <Badge variant={l.is_active ? "success" : "default"} size="sm">
                        {l.is_active ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td className="px-[16px] py-[10px] text-right">
                      <button
                        onClick={() => openEditor(l)}
                        className="text-[11px] font-semibold text-[#1B2A4A] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded-[4px] px-[4px]"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Edit panel */}
      {editing && (
        <div className="fixed inset-0 z-[20] flex items-center justify-center p-[16px] bg-black/40" onClick={() => !saving && setEditing(null)}>
          <div
            className="bg-white rounded-[16px] w-full max-w-[720px] max-h-[90vh] overflow-y-auto p-[20px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-[16px]">
              <h2 className="text-[16px] font-bold text-[#0A0F1C]">Edit {editing.name}</h2>
              <button
                onClick={() => setEditing(null)}
                className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-gray-400 hover:bg-gray-100"
                aria-label="Close"
              >
                <i className="ri-close-line text-[18px]" />
              </button>
            </div>

            {/* League fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px] mb-[20px]">
              <label className="block">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Name</span>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-[4px] w-full px-[10px] py-[8px] rounded-[8px] border border-gray-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Country</span>
                <input
                  value={formCountry}
                  onChange={(e) => setFormCountry(e.target.value)}
                  className="mt-[4px] w-full px-[10px] py-[8px] rounded-[8px] border border-gray-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Display Priority</span>
                <input
                  type="number"
                  value={formPriority}
                  onChange={(e) => setFormPriority(e.target.value)}
                  className="mt-[4px] w-full px-[10px] py-[8px] rounded-[8px] border border-gray-200 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
                />
              </label>
              <label className="flex items-end gap-[8px] pb-[8px]">
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="w-[16px] h-[16px] accent-[#1B2A4A]"
                />
                <span className="text-[13px] font-medium text-[#0A0F1C]">League is active</span>
              </label>
            </div>

            {/* Model params */}
            <div className="mb-[20px]">
              <div className="flex items-center justify-between mb-[8px]">
                <h3 className="text-[13px] font-semibold text-[#0A0F1C]">Model Parameters</h3>
                {editing.model_params?.overall_accuracy != null && (
                  <span className="text-[11px] text-gray-400">
                    Trained accuracy {Number(editing.model_params.overall_accuracy).toFixed(1)}%
                    {editing.model_params.data_points ? ` · ${editing.model_params.data_points} pts` : ""}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-[10px] p-[12px] bg-gray-50 rounded-[10px]">
                {PARAM_FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{f.label}</span>
                    <input
                      type="number"
                      step={f.step}
                      value={formParams[f.key] || ""}
                      onChange={(e) => {
                        setFormParams((prev) => ({ ...prev, [f.key]: e.target.value }));
                        setParamsDirty(true);
                      }}
                      placeholder="—"
                      className="mt-[2px] w-full px-[8px] py-[6px] rounded-[6px] border border-gray-200 bg-white text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20"
                    />
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-[6px]">
                Blank fields are left unchanged. Parameters apply to the ensemble model for this league.
              </p>
            </div>

            <div className="flex items-center justify-end gap-[8px]">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} loading={saving} icon="ri-save-line">
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
