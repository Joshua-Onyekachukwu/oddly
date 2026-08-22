"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────

interface Prediction {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  model_probability: number;
  model_version: string;
}

interface Fixture {
  id: string;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_name?: string;
  away_team_name?: string;
  home_team_logo?: string | null;
  away_team_logo?: string | null;
  league_logo?: string | null;
  leagues?: { name: string; country: string };
}

interface ElitePick {
  fixture: Fixture;
  predictions: Prediction[];
  bestPick: Prediction;
  edge: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatKickoff(time: string) {
  const date = new Date(time);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 0) return "Started";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${diffDays}d`;
}

function formatTime(time: string) {
  return new Date(time).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(time: string) {
  return new Date(time).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatMarket(market: string): string {
  const map: Record<string, string> = {
    "1X2": "Match Result",
    over_under: "Total Goals",
    btts: "BTTS",
    double_chance: "Double Chance",
    dnb: "Draw No Bet",
    smart_selection: "Best Pick",
  };
  return map[market] || market;
}

function formatSelection(sel: string): string {
  return sel
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Components ──────────────────────────────────────────────────────────

function TeamLogo({ logo, name, size = 36 }: { logo?: string | null; name: string; size?: number }) {
  if (logo) {
    return (
      <div
        className="rounded-full bg-gray-50 flex items-center justify-center flex-none overflow-hidden border border-gray-100"
        style={{ width: size, height: size }}
      >
        <img
          src={logo}
          alt={name}
          className="object-contain"
          style={{ width: size * 0.7, height: size * 0.7 }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.classList.add("bg-[#1B2A4A]/8");
              parent.innerHTML = `<span style="font-size:${size * 0.35}px;font-weight:700;color:#1B2A4A;font-family:var(--font-display)">${name.charAt(0).toUpperCase()}</span>`;
            }
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="bg-[#1B2A4A]/8 rounded-full flex items-center justify-center flex-none border border-gray-100"
      style={{ width: size, height: size }}
    >
      <span className="font-bold text-[#1B2A4A] font-display" style={{ fontSize: size * 0.35 }}>
        {name.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function ConfidenceBar({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100);
  const color = pct >= 90 ? "#059669" : pct >= 80 ? "#1B2A4A" : pct >= 70 ? "#6366f1" : "#9ca3af";

  return (
    <div className="w-full">
      <div className="h-[6px] bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function ElitePickCard({ pick }: { pick: ElitePick }) {
  const [expanded, setExpanded] = useState(false);
  const { fixture, bestPick, predictions } = pick;
  const prob = Math.round(bestPick.model_probability * 100);

  return (
    <div className="bg-white rounded-[14px] border border-gray-100 hover:border-gray-200 hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow,transform] duration-200 ease-out cursor-pointer group overflow-hidden active:scale-[0.98]"
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div className="px-[16px] pt-[14px] pb-[10px] flex items-center justify-between">
        <div className="flex items-center gap-[6px] min-w-0">
          {fixture.league_logo ? (
            <img src={fixture.league_logo} alt="" className="w-[16px] h-[16px] object-contain flex-none" />
          ) : (
            <div className="w-[16px] h-[16px] bg-gray-200 rounded-[3px] flex-none" />
          )}
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            {fixture.leagues?.name || "Unknown"}
          </span>
        </div>
        <div className="flex items-center gap-[8px]">
          <span className="text-[10px] font-medium text-gray-400">{formatDate(fixture.kickoff_time)}</span>
          <span className="text-[11px] font-mono-data font-bold text-[#1B2A4A] bg-gray-50 px-[6px] py-[2px] rounded">
            {formatTime(fixture.kickoff_time)}
          </span>
        </div>
      </div>

      {/* Teams */}
      <div className="px-[16px] py-[8px]">
        <div className="flex items-center gap-[12px]">
          <div className="flex items-center gap-[10px] flex-1 min-w-0">
            <TeamLogo logo={fixture.home_team_logo} name={fixture.home_team_name || "Home"} size={36} />
            <span className="text-[14px] font-semibold text-[#0A0F1C] truncate">
              {fixture.home_team_name || "Home"}
            </span>
          </div>
          <div className="flex-none px-[12px]">
            {fixture.home_score !== null ? (
              <span className="font-display text-[18px] font-bold text-[#0A0F1C]">
                {fixture.home_score} - {fixture.away_score}
              </span>
            ) : (
              <span className="text-[12px] font-bold text-gray-300 uppercase">vs</span>
            )}
          </div>
          <div className="flex items-center gap-[10px] flex-1 min-w-0 justify-end">
            <span className="text-[14px] font-semibold text-[#0A0F1C] truncate text-right">
              {fixture.away_team_name || "Away"}
            </span>
            <TeamLogo logo={fixture.away_team_logo} name={fixture.away_team_name || "Away"} size={36} />
          </div>
        </div>
      </div>

      {/* Best Pick */}
      <div className="px-[16px] pb-[12px] pt-[8px] border-t border-gray-50">
        <div className="flex items-center justify-between mb-[6px]">
          <div className="flex items-center gap-[8px]">
            <span className="text-[10px] font-semibold text-[#059669] bg-[#059669]/10 px-[8px] py-[2px] rounded-full">
              ELITE
            </span>
            <span className="text-[12px] font-medium text-gray-600">
              {formatMarket(bestPick.market)}
            </span>
          </div>
          <div className="flex items-center gap-[4px]">
            <span className="text-[16px] font-bold text-[#1B2A4A]">{prob}%</span>
            <span className="text-[10px] text-gray-400">confidence</span>
          </div>
        </div>

        <div className="flex items-center gap-[8px] mb-[6px]">
          <span className="text-[13px] font-bold text-[#0A0F1C]">
            {formatSelection(bestPick.selection)}
          </span>
        </div>

        <ConfidenceBar probability={bestPick.model_probability} />

        {/* Expand indicator */}
        <div className="flex items-center justify-center mt-[8px]">
          <span className="text-[10px] text-gray-300 font-medium">
            {expanded ? "▲ Less" : `▲ ${predictions.length} markets`}
          </span>
        </div>
      </div>

      {/* Expanded: All Markets */}
      {expanded && (
        <div className="px-[16px] pb-[14px] border-t border-gray-50 pt-[10px]">
          <div className="grid grid-cols-2 gap-[8px]">
            {predictions
              .sort((a, b) => b.model_probability - a.model_probability)
              .map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-[10px] py-[6px] rounded-[8px] text-[11px] ${
                    p.id === bestPick.id
                      ? "bg-[#059669]/10 border border-[#059669]/20"
                      : "bg-gray-50"
                  }`}
                >
                  <span className="font-medium text-gray-600 truncate">
                    {formatSelection(p.selection)}
                  </span>
                  <span className="font-mono-data font-bold text-[#1B2A4A] ml-[4px]">
                    {Math.round(p.model_probability * 100)}%
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────

export default function EliteDashboardPage() {
  const [picks, setPicks] = useState<ElitePick[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ elite: 0, total: 0, leagues: 0 });

  const loadData = useCallback(async () => {
    try {
      const sb = createClient();

      // Get today's date range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Load today's fixtures with predictions
      const { data: fixtures } = await sb
        .from("fixtures")
        .select(`
          id, kickoff_time, status, home_score, away_score,
          home_team:teams!fixtures_home_team_id_fkey(id, canonical_name, logo),
          away_team:teams!fixtures_away_team_id_fkey(id, canonical_name, logo),
          league:leagues(name, country, logo)
        `)
        .gte("kickoff_time", today.toISOString())
        .lt("kickoff_time", tomorrow.toISOString())
        .order("kickoff_time", { ascending: true })
        .limit(100);

      if (!fixtures || fixtures.length === 0) {
        setPicks([]);
        setLoading(false);
        return;
      }

      // Load ELITE predictions for these fixtures
      const fixtureIds = fixtures.map((f) => f.id);
      const { data: predictions } = await sb
        .from("predictions")
        .select("id, fixture_id, market, selection, model_probability, model_version")
        .in("fixture_id", fixtureIds)
        .gte("model_probability", 0.70)
        .order("model_probability", { ascending: false });

      if (!predictions || predictions.length === 0) {
        setPicks([]);
        setLoading(false);
        return;
      }

      // Group predictions by fixture
      const predByFixture: Record<string, Prediction[]> = {};
      for (const p of predictions) {
        if (!predByFixture[p.fixture_id]) predByFixture[p.fixture_id] = [];
        predByFixture[p.fixture_id].push(p);
      }

      // Build ElitePick objects
      const elitePicks: ElitePick[] = [];
      for (const fixture of fixtures) {
        const preds = predByFixture[fixture.id];
        if (!preds || preds.length === 0) continue;

        // Sort by probability and pick the best
        preds.sort((a, b) => b.model_probability - a.model_probability);
        const best = preds[0];

        // Calculate edge (difference from random chance)
        const edge = best.model_probability - 0.5;

        elitePicks.push({
          fixture: {
            id: fixture.id,
            kickoff_time: fixture.kickoff_time,
            status: fixture.status,
            home_score: fixture.home_score,
            away_score: fixture.away_score,
            home_team_name: (fixture.home_team as any)?.canonical_name || "Home",
            away_team_name: (fixture.away_team as any)?.canonical_name || "Away",
            home_team_logo: (fixture.home_team as any)?.logo,
            away_team_logo: (fixture.away_team as any)?.logo,
            league_logo: (fixture.league as any)?.logo,
            leagues: fixture.league as any,
          },
          predictions: preds,
          bestPick: best,
          edge,
        });
      }

      // Sort by best pick probability (highest first)
      elitePicks.sort((a, b) => b.bestPick.model_probability - a.bestPick.model_probability);

      // Count stats
      const uniqueLeagues = new Set(elitePicks.map((p) => p.fixture.leagues?.name));

      setPicks(elitePicks);
      setStats({
        elite: elitePicks.length,
        total: predictions.length,
        leagues: uniqueLeagues.size,
      });
    } catch (err) {
      console.error("Failed to load elite picks:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Refresh every 5 minutes
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <div className="min-h-screen bg-[#F8F9FC]">
      <div className="max-w-[1200px] mx-auto px-[20px] py-[24px]">
        {/* Header */}
        <div className="mb-[24px]">
          <div className="flex items-center gap-[10px] mb-[4px]">
            <span className="text-[24px]">👑</span>
            <h1 className="text-[22px] font-bold text-[#0A0F1C] font-display">
              ELITE Dashboard
            </h1>
          </div>
          <p className="text-[13px] text-gray-500 ml-[34px]">
            Today&apos;s highest-confidence picks across 26+ markets. Only ELITE tier selections.
          </p>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-[12px] mb-[24px] flex-wrap">
          <div className="bg-[#059669]/10 px-[14px] py-[8px] rounded-[10px] flex items-center gap-[8px]">
            <span className="text-[10px] font-semibold text-[#059669] uppercase tracking-wider">ELITE</span>
            <span className="text-[18px] font-bold text-[#059669]">{stats.elite}</span>
            <span className="text-[10px] text-[#059669]/60">picks</span>
          </div>
          <div className="bg-gray-100 px-[14px] py-[8px] rounded-[10px] flex items-center gap-[8px]">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Markets</span>
            <span className="text-[18px] font-bold text-gray-700">{stats.total}</span>
          </div>
          <div className="bg-gray-100 px-[14px] py-[8px] rounded-[10px] flex items-center gap-[8px]">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Leagues</span>
            <span className="text-[18px] font-bold text-gray-700">{stats.leagues}</span>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-[20px] animate-pulse">
                <div className="h-[12px] bg-gray-100 rounded w-[60%] mb-[12px]" />
                <div className="flex items-center gap-[12px] mb-[12px]">
                  <div className="w-[36px] h-[36px] bg-gray-100 rounded-full" />
                  <div className="h-[14px] bg-gray-100 rounded flex-1" />
                  <div className="h-[14px] bg-gray-100 rounded flex-1" />
                </div>
                <div className="h-[16px] bg-gray-100 rounded w-[40%] mb-[8px]" />
                <div className="h-[6px] bg-gray-100 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && picks.length === 0 && (
          <div className="bg-white rounded-[14px] border border-gray-100 p-[40px] text-center">
            <span className="text-[40px]">🔍</span>
            <h3 className="text-[16px] font-semibold text-[#0A0F1C] mt-[12px] mb-[4px]">
              No ELITE picks for today
            </h3>
            <p className="text-[13px] text-gray-500">
              The system hasn&apos;t found any high-confidence picks for today&apos;s matches yet.
              Check back closer to kickoff times.
            </p>
          </div>
        )}

        {/* Picks Grid */}
        {!loading && picks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
            {picks.map((pick) => (
              <ElitePickCard key={pick.fixture.id} pick={pick} />
            ))}
          </div>
        )}

        {/* Footer */}
        {!loading && picks.length > 0 && (
          <div className="text-center mt-[24px] text-[11px] text-gray-300">
            {picks.length} ELITE picks • Updated live • 26+ markets analyzed per match
          </div>
        )}
      </div>
    </div>
  );
}
