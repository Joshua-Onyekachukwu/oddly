"use client";

import React from "react";
import { useRouter } from "next/navigation";

interface MatchCardProps {
  fixture: {
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
    leagues?: { name: string; country: string; logo?: string | null };
    predictions?: Array<{
      market: string;
      selection: string;
      model_probability: number;
      confidence_lower?: number | null;
      confidence_upper?: number | null;
    }>;
    odds?: {
      home?: number;
      draw?: number;
      away?: number;
    };
  };
  onClick?: () => void;
}

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

function formatDate(time: string) {
  const date = new Date(time);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = date.toDateString() === tomorrow.toDateString();

  if (isToday) return "Today";
  if (isTomorrow) return "Tomorrow";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(time: string) {
  return new Date(time).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function TeamLogo({ logo, name, size = 32 }: { logo?: string | null; name: string; size?: number }) {
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
              parent.innerHTML = `<span style="font-size:${size * 0.35}px;font-weight:700;color:#1B2A4A;font-family:var(--font-display)">${name.charAt(0)}</span>`;
            }
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
      <span
        className="font-bold text-[#1B2A4A] font-display"
        style={{ fontSize: size * 0.35 }}
      >
        {name.charAt(0)}
      </span>
    </div>
  );
}

function PredictionBadge({ prediction }: { prediction: { market: string; selection: string; model_probability: number } }) {
  const prob = Math.round(prediction.model_probability * 100);
  const isHigh = prob >= 65;
  const isElite = prob >= 75;

  return (
    <div className="flex items-center gap-[6px]">
      <span className="text-[10px] font-medium text-gray-500 truncate max-w-[80px]">
        {prediction.selection}
      </span>
      <span
        className={`text-[11px] font-mono-data font-bold px-[5px] py-[1px] rounded ${
          isElite
            ? "bg-[#1B2A4A] text-white"
            : isHigh
            ? "bg-[#1B2A4A]/10 text-[#1B2A4A]"
            : "bg-gray-100 text-gray-500"
        }`}
      >
        {prob}%
      </span>
    </div>
  );
}

export function MatchCard({ fixture, onClick }: MatchCardProps) {
  const router = useRouter();

  const mainPrediction = fixture.predictions?.find((p) => p.market === "1X2");
  const overUnder = fixture.predictions?.find((p) => p.market === "over_under" && p.selection === "over_2.5");
  const btts = fixture.predictions?.find((p) => p.market === "btts" && p.selection === "yes");
  const under35 = fixture.predictions?.find((p) => p.market === "over_under" && p.selection === "under_3.5");

  // Pick the strongest prediction to display
  const allPreds = fixture.predictions || [];
  const strongest = allPreds.reduce((best, p) =>
    p.model_probability > (best?.model_probability || 0) ? p : best
  , null as typeof allPreds[0] | null);

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      router.push(`/matches/${fixture.id}`);
    }
  };

  return (
    <div
      onClick={handleClick}
      role="article"
      aria-label={`${fixture.home_team_name || 'Home'} vs ${fixture.away_team_name || 'Away'} — ${strongest ? `${strongest.selection} ${Math.round(strongest.model_probability * 100)}%` : 'Prediction pending'}`}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
      className="bg-white rounded-[14px] border border-gray-100 hover:border-gray-200 hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-inset transition-all duration-300 cursor-pointer group overflow-hidden"
    >
      {/* Header: League + Kickoff */}
      <div className="px-[14px] pt-[12px] pb-[8px] flex items-center justify-between">
        <div className="flex items-center gap-[6px] min-w-0">
          {fixture.league_logo ? (
            <img
              src={fixture.league_logo}
              alt={fixture.leagues?.name || 'League'}
              className="w-[14px] h-[14px] object-contain flex-none"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-[14px] h-[14px] bg-gray-200 rounded-[3px] flex-none" />
          )}
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider truncate">
            {fixture.leagues?.name || "Unknown"}
          </span>
        </div>
        <div className="flex items-center gap-[6px] flex-none">
          <span className="text-[10px] font-medium text-gray-400">
            {formatDate(fixture.kickoff_time)}
          </span>
          <span className="text-[11px] font-mono-data font-bold text-[#1B2A4A] bg-gray-50 px-[6px] py-[2px] rounded">
            {formatTime(fixture.kickoff_time)}
          </span>
        </div>
      </div>

      {/* Teams */}
      <div className="px-[14px] py-[8px]">
        <div className="flex items-center gap-[10px]">
          {/* Home */}
          <div className="flex items-center gap-[8px] flex-1 min-w-0">
            <TeamLogo logo={fixture.home_team_logo} name={fixture.home_team_name || "Home"} size={28} />
            <span className="text-[13px] font-semibold text-[#0A0F1C] truncate">
              {fixture.home_team_name || "Home"}
            </span>
          </div>

          {/* Score / VS */}
          <div className="flex-none px-[8px]">
            {fixture.home_score !== null && fixture.away_score !== null ? (
              <span className="font-display text-[16px] font-bold text-[#0A0F1C]">
                {fixture.home_score} - {fixture.away_score}
              </span>
            ) : (
              <span className="text-[11px] font-bold text-gray-300 uppercase">vs</span>
            )}
          </div>

          {/* Away */}
          <div className="flex items-center gap-[8px] flex-1 min-w-0 justify-end">
            <span className="text-[13px] font-semibold text-[#0A0F1C] truncate text-right">
              {fixture.away_team_name || "Away"}
            </span>
            <TeamLogo logo={fixture.away_team_logo} name={fixture.away_team_name || "Away"} size={28} />
          </div>
        </div>
      </div>

      {/* Prediction + Odds */}
      <div className="px-[14px] pb-[12px] pt-[4px] border-t border-gray-50">
        {strongest ? (
          <div className="flex items-center justify-between">
            <PredictionBadge prediction={strongest} />
            {fixture.odds && (
              <div className="flex items-center gap-[4px]">
                {fixture.odds.home && (
                  <span className="text-[9px] font-mono-data text-gray-400 bg-gray-50 px-[4px] py-[1px] rounded">
                    H {fixture.odds.home.toFixed(2)}
                  </span>
                )}
                {fixture.odds.draw && (
                  <span className="text-[9px] font-mono-data text-gray-400 bg-gray-50 px-[4px] py-[1px] rounded">
                    D {fixture.odds.draw.toFixed(2)}
                  </span>
                )}
                {fixture.odds.away && (
                  <span className="text-[9px] font-mono-data text-gray-400 bg-gray-50 px-[4px] py-[1px] rounded">
                    A {fixture.odds.away.toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-300 italic">Prediction pending</span>
          </div>
        )}

        {/* Additional predictions row */}
        {allPreds.length > 1 && (
          <div className="flex items-center gap-[6px] mt-[6px] flex-wrap">
            {under35 && (
              <span className="text-[9px] font-medium text-gray-400 bg-gray-50 px-[5px] py-[2px] rounded" title="Under 3.5 goals — fewer than 4 goals in the match">
                U3.5 {Math.round(under35.model_probability * 100)}%
              </span>
            )}
            {btts && (
              <span className="text-[9px] font-medium text-gray-400 bg-gray-50 px-[5px] py-[2px] rounded" title="Both Teams To Score — both teams score at least 1 goal">
                BTTS {Math.round(btts.model_probability * 100)}%
              </span>
            )}
            {overUnder && (
              <span className="text-[9px] font-medium text-gray-400 bg-gray-50 px-[5px] py-[2px] rounded" title="Over 2.5 goals — more than 2 goals in the match">
                O2.5 {Math.round(overUnder.model_probability * 100)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
