"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface RefereeProfile {
  name: string;
  matches: number;
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  avgGoals: number;
  avgYellow: number;
  avgRed: number;
  avgFouls: number;
  bttsPct: number;
  over25Pct: number;
  homeBias: number;
  leagues: string[];
}

type SortKey = "matches" | "homeWinPct" | "avgGoals" | "avgYellow" | "homeBias";

export default function RefereesPage() {
  const [referees, setReferees] = useState<RefereeProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("matches");
  const [sortAsc, setSortAsc] = useState(false);
  const [minMatches, setMinMatches] = useState(10);
  const [selectedRef, setSelectedRef] = useState<RefereeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      // referee_profiles is not in the generated Database types — cast through unknown
      const { data, error: queryError } = await (supabase as any)
        .from("referee_profiles")
        .select(
          "referee_name,total_matches,home_win_pct,draw_pct,away_win_pct,avg_total_goals,avg_yellow_per_match,avg_red_per_match,avg_fouls_per_match,btts_pct,over_2_5_pct,home_bias,leagues_officiated"
        )
        .order("total_matches", { ascending: false })
        .limit(500);

      if (queryError) throw queryError;

      setReferees(
        (data || []).map((r: any) => ({
          name: r.referee_name,
          matches: r.total_matches ?? 0,
          homeWinPct: r.home_win_pct ?? 0,
          drawPct: r.draw_pct ?? 0,
          awayWinPct: r.away_win_pct ?? 0,
          avgGoals: r.avg_total_goals ?? 0,
          avgYellow: r.avg_yellow_per_match ?? 0,
          avgRed: r.avg_red_per_match ?? 0,
          avgFouls: r.avg_fouls_per_match ?? 0,
          bttsPct: r.btts_pct ?? 0,
          over25Pct: r.over_2_5_pct ?? 0,
          homeBias: r.home_bias ?? 0,
          leagues: r.leagues_officiated || [],
        }))
      );
    } catch (e: any) {
      setError(e?.message || "Failed to load referee profiles");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = referees
    .filter((r) => r.matches >= minMatches)
    .sort((a, b) => {
      const av = a[sortKey] || 0;
      const bv = b[sortKey] || 0;
      return sortAsc ? av - bv : bv - av;
    });

  const avgHomeWin = filtered.length > 0
    ? filtered.reduce((s, r) => s + r.homeWinPct, 0) / filtered.length
    : 0;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="mb-[24px]">
        <div className="flex items-center gap-[12px] mb-[6px]">
          <div className="w-[36px] h-[36px] rounded-[10px] bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <span className="text-[18px]">👨‍⚖️</span>
          </div>
          <div>
            <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C]">
              Referee Intelligence
            </h1>
          </div>
        </div>
        <p className="text-[13px] text-gray-500 ml-[48px]">
          Historical referee tendencies across {referees.length} officials, stored in the referee_profiles table.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-[14px] p-[16px] mb-[20px] flex items-center justify-between gap-[12px]">
          <div className="flex items-center gap-[8px]">
            <i className="ri-error-warning-line text-red-500" />
            <span className="text-[13px] font-medium text-red-700">{error}</span>
          </div>
          <button
            onClick={load}
            className="text-[12px] font-semibold text-red-600 hover:text-red-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded-[4px] px-[4px]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-[20px]">
        {[
          { label: "Referees", value: filtered.length, icon: "ri-user-line", color: "text-purple-600" },
          { label: "Avg Home Win %", value: `${(avgHomeWin * 100).toFixed(1)}%`, icon: "ri-home-line", color: "text-blue-600" },
          { label: "Min Matches", value: minMatches.toString(), icon: "ri-filter-line", color: "text-amber-600" },
          { label: "Data Source", value: "referee_profiles", icon: "ri-database-line", color: "text-green-600" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-[14px] p-[16px] border border-gray-100">
            <div className="flex items-center gap-[8px] mb-[6px]">
              <i className={`${s.icon} text-[14px] ${s.color}`} />
              <span className="text-[10px] font-semibold text-gray-400 uppercase">{s.label}</span>
            </div>
            <span className="text-[20px] font-bold text-[#0A0F1C] font-mono">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-[12px] mb-[16px]">
        <label htmlFor="min-matches" className="text-[12px] text-gray-500">Min matches:</label>
        <select
          id="min-matches"
          value={minMatches}
          onChange={(e) => setMinMatches(Number(e.target.value))}
          className="px-[10px] py-[6px] rounded-[8px] border border-gray-200 text-[12px] text-[#0A0F1C] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/30"
        >
          {[5, 10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>{n}+</option>
          ))}
        </select>
        <button
          onClick={load}
          aria-label="Refresh referee data"
          className="ml-auto flex items-center gap-[6px] px-[10px] py-[6px] rounded-[8px] border border-gray-200 text-[12px] font-semibold text-[#1B2A4A] hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30"
        >
          <i className="ri-refresh-line" /> Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-[8px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[48px] bg-white rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-[14px] border border-gray-100 p-[40px] text-center">
          <i className="ri-user-line text-[32px] text-gray-200 block mb-[8px]" />
          <p className="text-[13px] font-semibold text-gray-500">No referees match the current filters</p>
          <p className="text-[11px] text-gray-400 mt-[4px]">
            {referees.length === 0
              ? "The referee_profiles table is empty — run the referee data pipeline to populate it."
              : "Try lowering the minimum matches threshold."}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-[14px] border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-[14px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase">#</th>
                  <th className="text-left px-[14px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase">Referee</th>
                  {([
                    { key: "matches" as SortKey, label: "Matches" },
                    { key: "homeWinPct" as SortKey, label: "Home Win %" },
                    { key: "avgGoals" as SortKey, label: "Avg Goals" },
                    { key: "avgYellow" as SortKey, label: "Avg Yellow" },
                    { key: "homeBias" as SortKey, label: "Home Bias" },
                  ]).map((col) => (
                    <th
                      key={col.key}
                      onClick={() => toggleSort(col.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleSort(col.key);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Sort by ${col.label}`}
                      className="text-right px-[14px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase cursor-pointer hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B2A4A]/30"
                    >
                      {col.label} {sortKey === col.key ? (sortAsc ? "↑" : "↓") : ""}
                    </th>
                  ))}
                  <th className="text-right px-[14px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase">BTTS %</th>
                  <th className="text-right px-[14px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase">Over 2.5 %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ref, i) => (
                  <tr
                    key={ref.name}
                    onClick={() => setSelectedRef(selectedRef?.name === ref.name ? null : ref)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedRef(selectedRef?.name === ref.name ? null : ref);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={selectedRef?.name === ref.name}
                    aria-label={`View details for referee ${ref.name}`}
                    className={`border-b border-gray-50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B2A4A]/30 ${
                      selectedRef?.name === ref.name ? "bg-purple-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-[14px] py-[10px] text-[12px] text-gray-400 font-mono">{i + 1}</td>
                    <td className="px-[14px] py-[10px]">
                      <span className="text-[13px] font-semibold text-[#0A0F1C]">{ref.name}</span>
                      <span className="text-[10px] text-gray-400 ml-[6px]">{ref.leagues?.join(", ")}</span>
                    </td>
                    <td className="px-[14px] py-[10px] text-right text-[13px] font-mono text-[#0A0F1C]">{ref.matches}</td>
                    <td className="px-[14px] py-[10px] text-right">
                      <span className={`text-[13px] font-mono font-semibold ${
                        ref.homeWinPct > 0.50 ? "text-blue-600" : ref.homeWinPct < 0.42 ? "text-red-500" : "text-[#0A0F1C]"
                      }`}>
                        {(ref.homeWinPct * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-[14px] py-[10px] text-right text-[13px] font-mono text-[#0A0F1C]">{ref.avgGoals?.toFixed(2)}</td>
                    <td className="px-[14px] py-[10px] text-right text-[13px] font-mono text-[#0A0F1C]">{ref.avgYellow?.toFixed(1)}</td>
                    <td className="px-[14px] py-[10px] text-right">
                      <span className={`text-[13px] font-mono ${
                        ref.homeBias > 0.03 ? "text-blue-600" : ref.homeBias < -0.03 ? "text-red-500" : "text-gray-500"
                      }`}>
                        {ref.homeBias > 0 ? "+" : ""}{(ref.homeBias * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-[14px] py-[10px] text-right text-[13px] font-mono text-[#0A0F1C]">{(ref.bttsPct * 100).toFixed(1)}%</td>
                    <td className="px-[14px] py-[10px] text-right text-[13px] font-mono text-[#0A0F1C]">{(ref.over25Pct * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Selected Referee Detail */}
      {selectedRef && (
        <div className="mt-[16px] bg-white rounded-[14px] border border-purple-200 p-[20px]">
          <h3 className="text-[16px] font-bold text-[#0A0F1C] mb-[12px]">{selectedRef.name} — Detailed Profile</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
            {[
              { label: "Matches", value: selectedRef.matches.toString() },
              { label: "Home Win %", value: `${(selectedRef.homeWinPct * 100).toFixed(1)}%` },
              { label: "Draw %", value: `${(selectedRef.drawPct * 100).toFixed(1)}%` },
              { label: "Away Win %", value: `${(selectedRef.awayWinPct * 100).toFixed(1)}%` },
              { label: "Avg Goals", value: selectedRef.avgGoals?.toFixed(2) || "—" },
              { label: "BTTS %", value: `${(selectedRef.bttsPct * 100).toFixed(1)}%` },
              { label: "Over 2.5 %", value: `${(selectedRef.over25Pct * 100).toFixed(1)}%` },
              { label: "Avg Yellow", value: selectedRef.avgYellow?.toFixed(1) || "—" },
              { label: "Avg Red", value: selectedRef.avgRed?.toFixed(2) || "—" },
              { label: "Avg Fouls", value: selectedRef.avgFouls?.toFixed(1) || "—" },
              { label: "Home Bias", value: `${selectedRef.homeBias > 0 ? "+" : ""}${(selectedRef.homeBias * 100).toFixed(1)}%` },
              { label: "Leagues", value: selectedRef.leagues?.join(", ") || "—" },
            ].map((item) => (
              <div key={item.label} className="p-[12px] bg-gray-50 rounded-[10px]">
                <span className="text-[10px] text-gray-400 block">{item.label}</span>
                <span className="text-[14px] font-bold text-[#0A0F1C] font-mono">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Research Note */}
      <div className="mt-[24px] p-[16px] bg-amber-50 rounded-[14px] border border-amber-200">
        <h4 className="text-[13px] font-semibold text-amber-800 mb-[6px]">📊 Research Finding</h4>
        <p className="text-[12px] text-amber-700">
          XGBoost model comparison shows referee features provide <strong>no measurable improvement</strong> for 1X2 (Home/Draw/Away) prediction.
          The most predictive features remain team-level: H2H record, PPG difference, and away goals against.
          Referee tendencies (home bias, card rates, goal averages) are interesting for analysis but do not add predictive signal for match outcomes.
        </p>
      </div>
    </div>
  );
}
