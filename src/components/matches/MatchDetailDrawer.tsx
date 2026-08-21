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

      // Get odds
      const { data: odds } = await supabase
        .from("odds_snapshots")
        .select("bookmaker, market, selection, odds")
        .eq("fixture_id", fixtureId);

      setData({
        ...fixture,
        home_team_name: (fixture as any).home_team?.canonical_name || "TBD",
        away_team_name: (fixture as any).away_team?.canonical_name || "TBD",
        home_team_logo: (fixture as any).home_team?.logo || null,
        away_team_logo: (fixture as any).away_team?.logo || null,
        league_name: (fixture as any).leagues?.name || "Unknown",
        league_logo: (fixture as any).leagues?.logo || null,
        odds: odds || [],
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

  const mainPred = data?.predictions?.find((p) => p.market === "1X2");
  const overUnderPreds = data?.predictions?.filter((p) => p.market === "over_under") || [];
  const bttsPred = data?.predictions?.find((p) => p.market === "btts");

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

            {/* Model Predictions */}
            {data.predictions && data.predictions.length > 0 && (
              <div className="mb-[20px]">
                <h3 className="text-[12px] font-semibold text-[#0A0F1C] mb-[10px] uppercase tracking-wider">
                  Model Predictions
                </h3>
                <div className="bg-gray-50 rounded-[12px] p-[14px] space-y-[10px]">
                  {/* 1X2 */}
                  {mainPred && (
                    <div>
                      <div className="flex items-center justify-between mb-[6px]">
                        <span className="text-[11px] font-medium text-gray-500">Match Result</span>
                        <span className="text-[13px] font-mono-data font-bold text-[#0A0F1C]">
                          {mainPred.selection} — {Math.round(mainPred.model_probability * 100)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-[3px]">
                        <div
                          className="bg-[#1B2A4A] h-[3px] rounded-full transition-all duration-500"
                          style={{ width: `${mainPred.model_probability * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Over/Under */}
                  {overUnderPreds.map((pred) => (
                    <div key={pred.selection}>
                      <div className="flex items-center justify-between mb-[6px]">
                        <span className="text-[11px] font-medium text-gray-500">{pred.selection.replace("_", " ").toUpperCase()}</span>
                        <span className="text-[13px] font-mono-data font-bold text-[#0A0F1C]">
                          {Math.round(pred.model_probability * 100)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-[3px]">
                        <div
                          className="bg-[#1B2A4A] h-[3px] rounded-full transition-all duration-500"
                          style={{ width: `${pred.model_probability * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}

                  {/* BTTS */}
                  {bttsPred && (
                    <div>
                      <div className="flex items-center justify-between mb-[6px]">
                        <span className="text-[11px] font-medium text-gray-500">Both Teams to Score</span>
                        <span className="text-[13px] font-mono-data font-bold text-[#0A0F1C]">
                          {Math.round(bttsPred.model_probability * 100)}%
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-[3px]">
                        <div
                          className="bg-[#1B2A4A] h-[3px] rounded-full transition-all duration-500"
                          style={{ width: `${bttsPred.model_probability * 100}%` }}
                        />
                      </div>
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
