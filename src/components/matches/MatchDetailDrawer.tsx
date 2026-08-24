"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface MatchDetailProps {
  fixtureId: string;
  onClose: () => void;
}

interface FixtureDetail {
  id: string;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_name?: string;
  away_team_name?: string;
  home_team_logo?: string | null;
  away_team_logo?: string | null;
  league_name?: string;
  league_logo?: string | null;
  predictions?: Array<{
    market: string;
    selection: string;
    model_probability: number;
    confidence_lower?: number | null;
    confidence_upper?: number | null;
  }>;
  odds?: Array<{
    bookmaker: string;
    market: string;
    selection: string;
    odds: number;
  }>;
  home_form?: string;
  away_form?: string;
  home_recent?: Array<{ gf: number; ga: number; opp: string; isHome: boolean; date: string }>;
  away_recent?: Array<{ gf: number; ga: number; opp: string; isHome: boolean; date: string }>;
  h2h?: Array<{ home: string; away: string; hg: number; ag: number; date: string }>;
  home_form_stats?: { w: number; d: number; l: number; gf: number; ga: number; pts: number; ppg: number };
  away_form_stats?: { w: number; d: number; l: number; gf: number; ga: number; pts: number; ppg: number };
  home_injuries?: Array<{ player_name: string; team_name: string; injury_type: string; status: string; expected_return: string }>;
  away_injuries?: Array<{ player_name: string; team_name: string; injury_type: string; status: string; expected_return: string }>;
  home_xg?: { avg_xg: number; avg_goals: number; avg_shots: number; avg_on_target: number } | null;
  away_xg?: { avg_xg: number; avg_goals: number; avg_shots: number; avg_on_target: number } | null;
}

function TeamLogo({ logo, name, size = 48 }: { logo?: string | null; name: string; size?: number }) {
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
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="bg-[#1B2A4A]/6 rounded-full flex items-center justify-center flex-none border border-gray-100"
      style={{ width: size, height: size }}
    >
      <span className="font-bold text-[#1B2A4A] font-display" style={{ fontSize: size * 0.35 }}>
        {name.charAt(0)}
      </span>
    </div>
  );
}

export function MatchDetailDrawer({ fixtureId, onClose }: MatchDetailProps) {
  const [data, setData] = useState<FixtureDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();

      const { data: fixture } = await supabase
        .from("fixtures")
        .select(
          `*, leagues (name, logo), home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo), away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo), predictions (market, selection, model_probability, confidence_lower, confidence_upper)`
        )
        .eq("id", fixtureId)
        .single();

      if (!fixture) {
        setLoading(false);
        return;
      }

      const homeTeamName = (fixture as any).home_team?.canonical_name;
      const awayTeamName = (fixture as any).away_team?.canonical_name;
      const homeTeamId = (fixture as any).home_team_id;
      const awayTeamId = (fixture as any).away_team_id;

      // Get odds
      const { data: odds } = await supabase
        .from("odds_snapshots")
        .select("bookmaker, market, selection, odds")
        .eq("fixture_id", fixtureId);

      // Get recent form (last 5 finished matches for each team) using two separate queries
      let homeRecent: any[] = [];
      let awayRecent: any[] = [];
      if (homeTeamId) {
        const [asHome, asAway] = await Promise.all([
          supabase.from("fixtures").select("home_score, away_score, kickoff_time, away_team:teams!fixtures_away_team_id_fkey(canonical_name)").eq("status", "finished").eq("home_team_id", homeTeamId).order("kickoff_time", { ascending: false }).limit(5),
          supabase.from("fixtures").select("home_score, away_score, kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name)").eq("status", "finished").eq("away_team_id", homeTeamId).order("kickoff_time", { ascending: false }).limit(5),
        ]);
        const all = [
          ...(asHome.data || []).map((f: any) => ({ gf: f.home_score, ga: f.away_score, opp: f.away_team?.canonical_name, isHome: true, date: f.kickoff_time })),
          ...(asAway.data || []).map((f: any) => ({ gf: f.away_score, ga: f.home_score, opp: f.home_team?.canonical_name, isHome: false, date: f.kickoff_time })),
        ].filter(m => m.gf !== null && m.ga !== null).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
        homeRecent = all;
      }
      if (awayTeamId) {
        const [asHome, asAway] = await Promise.all([
          supabase.from("fixtures").select("home_score, away_score, kickoff_time, away_team:teams!fixtures_away_team_id_fkey(canonical_name)").eq("status", "finished").eq("home_team_id", awayTeamId).order("kickoff_time", { ascending: false }).limit(5),
          supabase.from("fixtures").select("home_score, away_score, kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name)").eq("status", "finished").eq("away_team_id", awayTeamId).order("kickoff_time", { ascending: false }).limit(5),
        ]);
        const all = [
          ...(asHome.data || []).map((f: any) => ({ gf: f.home_score, ga: f.away_score, opp: f.away_team?.canonical_name, isHome: true, date: f.kickoff_time })),
          ...(asAway.data || []).map((f: any) => ({ gf: f.away_score, ga: f.home_score, opp: f.home_team?.canonical_name, isHome: false, date: f.kickoff_time })),
        ].filter(m => m.gf !== null && m.ga !== null).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
        awayRecent = all;
      }

      // Get H2H (both directions)
      let h2h: any[] = [];
      if (homeTeamId && awayTeamId) {
        const [h2h1, h2h2] = await Promise.all([
          supabase.from("fixtures").select("home_score, away_score, kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name)").eq("status", "finished").eq("home_team_id", homeTeamId).eq("away_team_id", awayTeamId).order("kickoff_time", { ascending: false }).limit(5),
          supabase.from("fixtures").select("home_score, away_score, kickoff_time, home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name)").eq("status", "finished").eq("home_team_id", awayTeamId).eq("away_team_id", homeTeamId).order("kickoff_time", { ascending: false }).limit(5),
        ]);
        h2h = [...(h2h1.data || []), ...(h2h2.data || [])].filter((f: any) => f.home_score !== null && f.away_score !== null).sort((a, b) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime()).slice(0, 8).map((f: any) => ({
          home: f.home_team?.canonical_name,
          away: f.away_team?.canonical_name,
          hg: f.home_score,
          ag: f.away_score,
          date: f.kickoff_time,
        }));
      }

      // Get xG data from StatsBomb + Understat
      let homeXg = null;
      let awayXg = null;
      try {
        const xgRes = await fetch("/data/statsbomb-xg.json");
        if (xgRes.ok) {
          const xgData = await xgRes.json();
          homeXg = xgData.features?.[homeTeamName] || null;
          awayXg = xgData.features?.[awayTeamName] || null;
        }
      } catch {}
      // Fall back to Understat xG if StatsBomb doesn't have the team
      if (!homeXg || !awayXg) {
        try {
          const uRes = await fetch("/data/understat-xg.json");
          if (uRes.ok) {
            const uData = await uRes.json();
            const teams = uData.teams || {};
            const findU = (name: string) => {
              const lower = name.toLowerCase();
              for (const [key, feat] of Object.entries(teams) as [string, any][]) {
                const keyName = key.split(/_EPL_|_La_liga_|_Bundesliga_|_Serie_A_|_Ligue_1_/)[0].toLowerCase();
                if (keyName === lower) return feat;
              }
              return null;
            };
            if (!homeXg && homeTeamName) homeXg = findU(homeTeamName);
            if (!awayXg && awayTeamName) awayXg = findU(awayTeamName);
          }
        } catch {}
      }

      // Compute form string (W/D/L)
      const formStr = (recent: any[]) => recent.map(m => m.gf > m.ga ? "W" : m.gf < m.ga ? "L" : "D").join("");

      // Compute form stats
      const formStats = (recent: any[]) => {
        if (!recent || recent.length === 0) return { w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, ppg: 0 };
        const w = recent.filter(m => m.gf > m.ga).length;
        const d = recent.filter(m => m.gf === m.ga).length;
        const l = recent.filter(m => m.gf < m.ga).length;
        const gf = recent.reduce((s, m) => s + (m.gf || 0), 0);
        const ga = recent.reduce((s, m) => s + (m.ga || 0), 0);
        const pts = w * 3 + d;
        return { w, d, l, gf, ga, pts, ppg: +(pts / recent.length).toFixed(1) };
      };

      // Load injury data
      let homeInjuries: any[] = [];
      let awayInjuries: any[] = [];
      try {
        const injRes = await fetch("/data/premier-injuries.json");
        if (injRes.ok) {
          const injData = await injRes.json();
          const injuries = injData.injuries || [];
          homeInjuries = injuries.filter((i: any) => i.team_name === homeTeamName || (homeTeamName && i.team_name.toLowerCase().includes(homeTeamName.toLowerCase().split(" ")[0])));
          awayInjuries = injuries.filter((i: any) => i.team_name === awayTeamName || (awayTeamName && i.team_name.toLowerCase().includes(awayTeamName.toLowerCase().split(" ")[0])));
        }
      } catch {}

      setData({
        ...fixture,
        home_team_name: homeTeamName || "TBD",
        away_team_name: awayTeamName || "TBD",
        home_team_logo: (fixture as any).home_team?.logo || null,
        away_team_logo: (fixture as any).away_team?.logo || null,
        league_name: (fixture as any).leagues?.name || "Unknown",
        league_logo: (fixture as any).leagues?.logo || null,
        odds: odds || [],
        home_form: formStr(homeRecent),
        away_form: formStr(awayRecent),
        home_recent: homeRecent,
        away_recent: awayRecent,
        home_form_stats: formStats(homeRecent),
        away_form_stats: formStats(awayRecent),
        home_injuries: homeInjuries,
        away_injuries: awayInjuries,
        h2h,
        home_xg: homeXg,
        away_xg: awayXg,
      });
      setLoading(false);
    }
    load();
  }, [fixtureId]);

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Group all predictions by market type
  const predsByMarket: Record<string, Array<{market: string, selection: string, model_probability: number, confidence_lower?: number | null, confidence_upper?: number | null}>> = {};
  for (const p of data?.predictions || []) {
    const key = p.market;
    if (!predsByMarket[key]) predsByMarket[key] = [];
    predsByMarket[key].push(p);
  }
  // Sort markets: 1X2 first, then BTTS, OU, DC, DNB, HomeGoals, AwayGoals
  const marketOrder = ["1X2", "BTTS", "OU", "DC", "DNB", "HomeGoals", "AwayGoals"];
  const sortedMarkets = Object.keys(predsByMarket).sort((a, b) => {
    const ai = marketOrder.indexOf(a);
    const bi = marketOrder.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });
  const MARKET_LABELS: Record<string, string> = {
    "1X2": "Match Result", "BTTS": "Both Teams To Score",
    "OU": "Over/Under Goals", "DC": "Double Chance",
    "DNB": "Draw No Bet", "HomeGoals": "Home Team Goals",
    "AwayGoals": "Away Team Goals",
  };

  // Group odds by bookmaker
  const oddsByBookmaker: Record<string, Record<string, number>> = {};
  if (data?.odds) {
    for (const o of data.odds) {
      if (!oddsByBookmaker[o.bookmaker]) oddsByBookmaker[o.bookmaker] = {};
      oddsByBookmaker[o.bookmaker][o.selection] = o.odds;
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      {/* Drawer */}
      <div
        className="relative bg-white w-full sm:w-[520px] max-h-[85vh] rounded-t-[20px] sm:rounded-[20px] overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.15)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-[10px] pb-[4px]">
          <div className="w-[36px] h-[4px] bg-gray-200 rounded-full" />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-[12px] right-[12px] w-[32px] h-[32px] rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-all z-10"
        >
          <span className="text-[14px]">✕</span>
        </button>

        {loading ? (
          <div className="p-[24px] space-y-[12px] animate-pulse">
            <div className="h-[20px] w-[120px] bg-gray-100 rounded" />
            <div className="h-[60px] bg-gray-50 rounded-[12px]" />
            <div className="h-[80px] bg-gray-50 rounded-[12px]" />
          </div>
        ) : !data ? (
          <div className="p-[40px] text-center">
            <p className="text-[14px] text-gray-400">Match not found</p>
          </div>
        ) : (
          <div className="overflow-y-auto max-h-[85vh] p-[20px] sm:p-[24px]">
            {/* League */}
            <div className="flex items-center gap-[6px] mb-[16px]">
              {data.league_logo && (
                <img src={data.league_logo} alt="" className="w-[16px] h-[16px] object-contain" />
              )}
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                {data.league_name}
              </span>
            </div>

            {/* Teams + Score */}
            <div className="flex items-center justify-between mb-[20px]">
              <div className="flex items-center gap-[12px] flex-1">
                <TeamLogo logo={data.home_team_logo} name={data.home_team_name || "Home"} size={48} />
                <div>
                  <span className="text-[16px] font-semibold text-[#0A0F1C] block">
                    {data.home_team_name}
                  </span>
                  <span className="text-[11px] text-gray-400">Home</span>
                </div>
              </div>

              <div className="px-[16px] text-center">
                {data.home_score !== null && data.away_score !== null ? (
                  <span className="font-display text-[28px] font-bold text-[#0A0F1C]">
                    {data.home_score} - {data.away_score}
                  </span>
                ) : (
                  <span className="text-[12px] font-bold text-gray-300 uppercase">vs</span>
                )}
                <span className="block text-[11px] text-gray-400 mt-[2px]">
                  {new Date(data.kickoff_time).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  {new Date(data.kickoff_time).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              <div className="flex items-center gap-[12px] flex-1 justify-end">
                <div className="text-right">
                  <span className="text-[16px] font-semibold text-[#0A0F1C] block">
                    {data.away_team_name}
                  </span>
                  <span className="text-[11px] text-gray-400">Away</span>
                </div>
                <TeamLogo logo={data.away_team_logo} name={data.away_team_name || "Away"} size={48} />
              </div>
            </div>

            {/* Model Predictions — All 24 Markets */}
            {data.predictions && data.predictions.length > 0 && (
              <div className="mb-[20px]">
                <div className="flex items-center justify-between mb-[10px]">
                  <h3 className="text-[12px] font-semibold text-[#0A0F1C] uppercase tracking-wider">
                    Model Predictions
                  </h3>
                  <span className="text-[10px] text-gray-400">
                    {data.predictions.length} markets
                  </span>
                </div>
                <div className="space-y-[12px]">
                  {sortedMarkets.map((market) => {
                    const preds = predsByMarket[market];
                    const label = MARKET_LABELS[market] || market;
                    return (
                      <div key={market} className="bg-gray-50 rounded-[12px] p-[14px]">
                        <h4 className="text-[11px] font-semibold text-gray-500 mb-[8px] uppercase tracking-wider">
                          {label}
                        </h4>
                        <div className="space-y-[6px]">
                          {preds.sort((a, b) => b.model_probability - a.model_probability).map((pred) => {
                            const prob = Math.round(pred.model_probability * 100);
                            const tier = prob >= 70 ? "ELITE" : prob >= 60 ? "HIGH" : "MEDIUM";
                            return (
                              <div key={pred.selection} className="flex items-center gap-[8px]">
                                <span className="text-[11px] font-medium text-[#0A0F1C] w-[100px] truncate">
                                  {pred.selection.replace(/_/g, " ")}
                                </span>
                                <div className="flex-1 bg-gray-200 rounded-full h-[3px]">
                                  <div
                                    className={`h-[3px] rounded-full transition-all duration-500 ${
                                      prob >= 70 ? "bg-[#1B2A4A]" : prob >= 55 ? "bg-[#1B2A4A]/60" : "bg-[#1B2A4A]/30"
                                    }`}
                                    style={{ width: `${prob}%` }}
                                  />
                                </div>
                                <span className={`text-[12px] font-mono font-bold w-[40px] text-right ${
                                  prob >= 70 ? "text-[#0A0F1C]" : "text-gray-500"
                                }`}>
                                  {prob}%
                                </span>
                                <span className={`text-[8px] font-bold px-[4px] py-[1px] rounded ${
                                  tier === "ELITE" ? "bg-[#F59E0B]/10 text-[#D97706]" :
                                  tier === "HIGH" ? "bg-[#10B981]/10 text-[#059669]" : "bg-gray-100 text-gray-400"
                                }`}>
                                  {tier}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Form Guide */}
            {(data.home_form || data.away_form) && (
              <div className="mb-[20px]">
                <h3 className="text-[12px] font-semibold text-[#0A0F1C] mb-[10px] uppercase tracking-wider">
                  Form Guide
                </h3>
                <div className="grid grid-cols-2 gap-[10px]">
                  {/* Home form */}
                  <div className="bg-gray-50 rounded-[12px] p-[12px]">
                    <div className="flex items-center gap-[8px] mb-[8px]">
                      <TeamLogo logo={data.home_team_logo} name={data.home_team_name || ""} size={24} />
                      <span className="text-[11px] font-semibold text-[#0A0F1C] truncate">{data.home_team_name}</span>
                    </div>
                    <div className="flex gap-[4px] mb-[6px]">
                      {(data.home_form || "").split("").map((r, i) => (
                        <span key={i} className={`w-[22px] h-[22px] rounded-[4px] flex items-center justify-center text-[10px] font-bold text-white ${
                          r === "W" ? "bg-[#22C55E]" : r === "L" ? "bg-[#EF4444]" : "bg-[#94A3B8]"
                        }`}>{r}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-[8px] mt-[4px]">
                      <span className="text-[10px] text-gray-400">
                        {data.home_form_stats?.w || 0}W {data.home_form_stats?.d || 0}D {data.home_form_stats?.l || 0}L
                      </span>
                      <span className="text-[10px] text-gray-300">•</span>
                      <span className="text-[10px] text-gray-400">
                        GF:{data.home_form_stats?.gf || 0} GA:{data.home_form_stats?.ga || 0}
                      </span>
                      <span className="text-[10px] text-gray-300">•</span>
                      <span className="text-[10px] font-semibold text-[#0A0F1C]">
                        {data.home_form_stats?.ppg || 0} PPG
                      </span>
                    </div>
                  </div>
                  {/* Away form */}
                  <div className="bg-gray-50 rounded-[12px] p-[12px]">
                    <div className="flex items-center gap-[8px] mb-[8px]">
                      <TeamLogo logo={data.away_team_logo} name={data.away_team_name || ""} size={24} />
                      <span className="text-[11px] font-semibold text-[#0A0F1C] truncate">{data.away_team_name}</span>
                    </div>
                    <div className="flex gap-[4px] mb-[6px]">
                      {(data.away_form || "").split("").map((r, i) => (
                        <span key={i} className={`w-[22px] h-[22px] rounded-[4px] flex items-center justify-center text-[10px] font-bold text-white ${
                          r === "W" ? "bg-[#22C55E]" : r === "L" ? "bg-[#EF4444]" : "bg-[#94A3B8]"
                        }`}>{r}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-[8px] mt-[4px]">
                      <span className="text-[10px] text-gray-400">
                        {data.away_form_stats?.w || 0}W {data.away_form_stats?.d || 0}D {data.away_form_stats?.l || 0}L
                      </span>
                      <span className="text-[10px] text-gray-300">•</span>
                      <span className="text-[10px] text-gray-400">
                        GF:{data.away_form_stats?.gf || 0} GA:{data.away_form_stats?.ga || 0}
                      </span>
                      <span className="text-[10px] text-gray-300">•</span>
                      <span className="text-[10px] font-semibold text-[#0A0F1C]">
                        {data.away_form_stats?.ppg || 0} PPG
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* H2H History */}
            {data.h2h && data.h2h.length > 0 && (
              <div className="mb-[20px]">
                <h3 className="text-[12px] font-semibold text-[#0A0F1C] mb-[10px] uppercase tracking-wider">
                  Head-to-Head ({data.h2h.length} matches)
                </h3>
                <div className="bg-gray-50 rounded-[12px] overflow-hidden">
                  {data.h2h.slice(0, 6).map((m, i) => (
                    <div key={i} className={`flex items-center justify-between px-[12px] py-[8px] ${i < data.h2h!.length - 1 ? "border-b border-gray-100" : ""}`}>
                      <span className="text-[11px] text-gray-500 truncate flex-1 min-w-0">
                        {m.home}
                      </span>
                      <div className="flex items-center gap-[6px] px-[10px] flex-none">
                        <span className={`text-[12px] font-bold font-mono ${m.hg > m.ag ? "text-[#22C55E]" : "text-gray-600"}`}>{m.hg}</span>
                        <span className="text-[10px] text-gray-300">-</span>
                        <span className={`text-[12px] font-bold font-mono ${m.ag > m.hg ? "text-[#22C55E]" : "text-gray-600"}`}>{m.ag}</span>
                      </div>
                      <span className="text-[11px] text-gray-500 truncate flex-1 min-w-0 text-right">
                        {m.away}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Injuries & Suspensions */}
            {((data.home_injuries && data.home_injuries.length > 0) || (data.away_injuries && data.away_injuries.length > 0)) && (
              <div className="mb-[20px]">
                <h3 className="text-[12px] font-semibold text-[#0A0F1C] mb-[10px] uppercase tracking-wider">
                  Injuries & Suspensions
                </h3>
                <div className="grid grid-cols-2 gap-[10px]">
                  {/* Home injuries */}
                  <div className="bg-gray-50 rounded-[12px] p-[12px]">
                    <div className="flex items-center gap-[8px] mb-[8px]">
                      <TeamLogo logo={data.home_team_logo} name={data.home_team_name || ""} size={20} />
                      <span className="text-[11px] font-semibold text-[#0A0F1C] truncate">{data.home_team_name}</span>
                    </div>
                    {data.home_injuries && data.home_injuries.length > 0 ? (
                      <div className="space-y-[4px]">
                        {data.home_injuries.slice(0, 5).map((inj: any, i: number) => (
                          <div key={i} className="flex items-center gap-[6px]">
                            <span className={`w-[6px] h-[6px] rounded-full flex-none ${
                              inj.status === "injured" ? "bg-[#EF4444]" :
                              inj.status === "suspended" ? "bg-[#F59E0B]" : "bg-[#94A3B8]"
                            }`} />
                            <span className="text-[10px] text-gray-600 truncate flex-1">{inj.player_name}</span>
                            <span className="text-[9px] text-gray-400 flex-none">{inj.injury_type}</span>
                          </div>
                        ))}
                        {data.home_injuries.length > 5 && (
                          <span className="text-[9px] text-gray-400">+{data.home_injuries.length - 5} more</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-400">No known absences</span>
                    )}
                  </div>
                  {/* Away injuries */}
                  <div className="bg-gray-50 rounded-[12px] p-[12px]">
                    <div className="flex items-center gap-[8px] mb-[8px]">
                      <TeamLogo logo={data.away_team_logo} name={data.away_team_name || ""} size={20} />
                      <span className="text-[11px] font-semibold text-[#0A0F1C] truncate">{data.away_team_name}</span>
                    </div>
                    {data.away_injuries && data.away_injuries.length > 0 ? (
                      <div className="space-y-[4px]">
                        {data.away_injuries.slice(0, 5).map((inj: any, i: number) => (
                          <div key={i} className="flex items-center gap-[6px]">
                            <span className={`w-[6px] h-[6px] rounded-full flex-none ${
                              inj.status === "injured" ? "bg-[#EF4444]" :
                              inj.status === "suspended" ? "bg-[#F59E0B]" : "bg-[#94A3B8]"
                            }`} />
                            <span className="text-[10px] text-gray-600 truncate flex-1">{inj.player_name}</span>
                            <span className="text-[9px] text-gray-400 flex-none">{inj.injury_type}</span>
                          </div>
                        ))}
                        {data.away_injuries.length > 5 && (
                          <span className="text-[9px] text-gray-400">+{data.away_injuries.length - 5} more</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-400">No known absences</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* xG Data */}
            {(data.home_xg || data.away_xg) && (
              <div className="mb-[20px]">
                <h3 className="text-[12px] font-semibold text-[#0A0F1C] mb-[10px] uppercase tracking-wider">
                  Expected Goals (xG)
                </h3>
                <div className="bg-gray-50 rounded-[12px] p-[14px]">
                  <div className="grid grid-cols-3 gap-[12px] text-center">
                    <div>
                      <span className="text-[10px] text-gray-400 block mb-[2px]">{data.home_team_name}</span>
                      <span className="text-[20px] font-bold font-mono text-[#0A0F1C] block">
                        {data.home_xg ? data.home_xg.avg_xg.toFixed(2) : "—"}
                      </span>
                      <span className="text-[9px] text-gray-400">avg xG</span>
                    </div>
                    <div className="flex items-center justify-center">
                      <div className="w-[1px] h-[40px] bg-gray-200" />
                    </div>
                    <div>
                      <span className="text-[10px] text-gray-400 block mb-[2px]">{data.away_team_name}</span>
                      <span className="text-[20px] font-bold font-mono text-[#0A0F1C] block">
                        {data.away_xg ? data.away_xg.avg_xg.toFixed(2) : "—"}
                      </span>
                      <span className="text-[9px] text-gray-400">avg xG</span>
                    </div>
                  </div>
                  {(data.home_xg || data.away_xg) && (
                    <div className="flex items-center justify-between mt-[10px] pt-[10px] border-t border-gray-200">
                      <span className="text-[10px] text-gray-400">
                        Shots: {data.home_xg?.avg_shots?.toFixed(0) || "—"} vs {data.away_xg?.avg_shots?.toFixed(0) || "—"}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        On Target: {data.home_xg?.avg_on_target?.toFixed(1) || "—"} vs {data.away_xg?.avg_on_target?.toFixed(1) || "—"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Bookmaker Odds */}
            {Object.keys(oddsByBookmaker).length > 0 && (
              <div className="mb-[20px]">
                <h3 className="text-[12px] font-semibold text-[#0A0F1C] mb-[10px] uppercase tracking-wider">
                  Bookmaker Odds
                </h3>
                <div className="bg-gray-50 rounded-[12px] overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_60px_60px_60px] px-[14px] py-[8px] border-b border-gray-100">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase">Bookmaker</span>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase text-center">Home</span>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase text-center">Draw</span>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase text-center">Away</span>
                  </div>
                  {Object.entries(oddsByBookmaker).map(([bookmaker, selections]) => (
                    <div key={bookmaker} className="grid grid-cols-[1fr_60px_60px_60px] px-[14px] py-[8px] border-b border-gray-50 last:border-0">
                      <span className="text-[12px] font-medium text-[#0A0F1C] capitalize">{bookmaker}</span>
                      <span className="text-[12px] font-mono-data text-center text-gray-600">
                        {selections["Home"]?.toFixed(2) || "—"}
                      </span>
                      <span className="text-[12px] font-mono-data text-center text-gray-600">
                        {selections["Draw"]?.toFixed(2) || "—"}
                      </span>
                      <span className="text-[12px] font-mono-data text-center text-gray-600">
                        {selections["Away"]?.toFixed(2) || "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Data unavailable notice */}
            {data.predictions?.length === 0 && (
              <div className="text-center py-[20px] bg-gray-50 rounded-[12px]">
                <p className="text-[13px] text-gray-400">Prediction data unavailable for this match</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
