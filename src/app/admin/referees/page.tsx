"use client";

import React, { useState, useEffect } from "react";

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

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/data/referee-profiles.json");
        if (res.ok) {
          const data = await res.json();
          setReferees(Array.isArray(data) ? data : []);
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, []);

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
          Historical referee tendencies across {referees.length} officials. Data from football-data.co.uk.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-[20px]">
        {[
          { label: "Referees", value: filtered.length, icon: "ri-user-line", color: "text-purple-600" },
          { label: "Avg Home Win %", value: `${(avgHomeWin * 100).toFixed(1)}%`, icon: "ri-home-line", color: "text-blue-600" },
          { label: "Min Matches", value: minMatches.toString(), icon: "ri-filter-line", color: "text-amber-600" },
          { label: "Data Source", value: "football-data.co.uk", icon: "ri-database-line", color: "text-green-600" },
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
        <label className="text-[12px] text-gray-500">Min matches:</label>
        <select
          value={minMatches}
          onChange={(e) => setMinMatches(Number(e.target.value))}
          className="px-[10px] py-[6px] rounded-[8px] border border-gray-200 text-[12px] text-[#0A0F1C] focus:outline-none focus:ring-2 focus:ring-purple-500/30"
        >
          {[5, 10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>{n}+</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-[8px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[48px] bg-white rounded-[10px] animate-pulse" />
          ))}
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
                      className="text-right px-[14px] py-[10px] text-[10px] font-semibold text-gray-400 uppercase cursor-pointer hover:text-gray-600"
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
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${
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
