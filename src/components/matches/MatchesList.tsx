"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useLiveScores } from "@/hooks/useLiveScores";

interface Fixture {
  id: string;
  home_team_name?: string;
  away_team_name?: string;
  home_team_logo?: string | null;
  away_team_logo?: string | null;
  league_logo?: string | null;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  leagues?: { name: string; country: string; logo?: string | null };
  predictions?: Array<{
    id: string;
    market: string;
    selection: string;
    model_probability: number;
    confidence_lower: number;
    confidence_upper: number;
  }>;
}

function formatKickoff(time: string) {
  const date = new Date(time);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getStatusBadge(status: string, kickoffTime: string, isLive: boolean) {
  if (isLive || status === "live" || status === "1H" || status === "2H" || status === "HT") {
    return (
      <span className="flex items-center gap-[4px] text-[10px] font-semibold text-[#22c55e] bg-[#22c55e]/8 px-[8px] py-[3px] rounded-full">
        <span className="w-[4px] h-[4px] rounded-full bg-[#22c55e] animate-pulse"></span>
        LIVE
      </span>
    );
  }
  if (status === "finished" || status === "FT") {
    return (
      <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-[8px] py-[3px] rounded-full">
        FT
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold text-gray-400">
      {formatKickoff(kickoffTime)}
    </span>
  );
}

/**
 * Animated score display — flashes green on change
 */
function LiveScore({
  homeScore,
  awayScore,
  isLive,
}: {
  homeScore: number | null;
  awayScore: number | null;
  isLive: boolean;
}) {
  const [flash, setFlash] = React.useState(false);
  const prevScoreRef = React.useRef(`${homeScore}-${awayScore}`);

  React.useEffect(() => {
    const current = `${homeScore}-${awayScore}`;
    if (prevScoreRef.current !== current && prevScoreRef.current !== "null-null") {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 2000);
      prevScoreRef.current = current;
      return () => clearTimeout(timer);
    }
    prevScoreRef.current = current;
  }, [homeScore, awayScore]);

  if (homeScore === null && awayScore === null) {
    return (
      <span className="text-[13px] font-medium text-gray-300">VS</span>
    );
  }

  return (
    <span
      className={`font-display text-[18px] font-bold font-mono-data transition-all duration-300 ${
        flash
          ? "text-[#22c55e] scale-110"
          : isLive
          ? "text-[#0A0F1C]"
          : "text-[#0A0F1C]"
      }`}
    >
      {homeScore} - {awayScore}
    </span>
  );
}

export function MatchesList({ fixtures }: { fixtures: Fixture[] }) {
  const router = useRouter();
  const { getScore, isLive, connected } = useLiveScores();

  if (fixtures.length === 0) {
    return (
      <div className="text-center py-[60px]">
        <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-gray-50 mb-[16px]">
          <i className="ri-calendar-line text-[24px] text-gray-300"></i>
        </div>
        <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[4px]">
          No matches today
        </h3>
        <p className="text-[13px] text-gray-400">
          Check back tomorrow for upcoming fixtures.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Realtime connection indicator */}
      {connected && fixtures.some((f) => ["live", "halftime", "1H", "2H"].includes(f.status)) && (
        <div className="flex items-center gap-[6px] mb-[12px] text-[11px] text-[#22c55e]">
          <span className="w-[6px] h-[6px] rounded-full bg-[#22c55e] animate-pulse"></span>
          Live scores connected — updates appear instantly
        </div>
      )}

      <div className="space-y-[8px]">
        {fixtures.map((fixture) => {
          const liveData = getScore(fixture.id);
          const fixtureIsLive = isLive(fixture.id) || ["live", "halftime", "1H", "2H"].includes(fixture.status);

          // Use live data if available, otherwise fall back to props
          const displayStatus = liveData?.status || fixture.status;
          const displayHomeScore = liveData?.home_score ?? fixture.home_score;
          const displayAwayScore = liveData?.away_score ?? fixture.away_score;

          const bestPrediction = fixture.predictions?.[0];

          return (
            <div
              key={fixture.id}
              onClick={() => router.push(`/matches/${fixture.id}`)}
              className={`bg-white rounded-[14px] p-[16px] md:p-[20px] border transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:border-gray-200 group cursor-pointer ${
                fixtureIsLive ? "border-[#22c55e]/20 shadow-[0_0_0_1px_rgba(34,197,94,0.05)]" : "border-gray-100"
              }`}
            >
              <div className="flex items-center justify-between mb-[12px]">
                <div className="flex items-center gap-[8px]">
                  {fixture.leagues?.name && (
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                      {fixture.leagues.name}
                    </span>
                  )}
                  {fixtureIsLive && (
                    <span className="text-[10px] font-mono-data text-[#22c55e]">
                      {liveData?.updated_at
                        ? `${Math.floor((Date.now() - new Date(liveData.updated_at).getTime()) / 60000)}m ago`
                        : ""}
                    </span>
                  )}
                </div>
                {getStatusBadge(displayStatus, fixture.kickoff_time, fixtureIsLive)}
              </div>

              <div className="flex items-center justify-between">
                {/* Teams */}
                <div className="flex items-center gap-[16px] flex-1">
                  <div className="flex items-center gap-[10px] flex-1">
                    {fixture.home_team_logo ? (
                      <div className="w-[32px] h-[32px] rounded-full bg-gray-50 flex items-center justify-center flex-none overflow-hidden">
                        <img src={fixture.home_team_logo} alt="" className="w-[24px] h-[24px] object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>
                    ) : (
                      <div className="w-[32px] h-[32px] bg-[#0A0F1C]/4 rounded-full flex items-center justify-center flex-none">
                        <span className="text-[12px] font-bold text-[#0A0F1C] font-display">
                          {(fixture.home_team_name || "H").charAt(0)}
                        </span>
                      </div>
                    )}
                    <span className="text-[14px] font-medium text-[#0A0F1C] truncate">
                      {fixture.home_team_name || "Home"}
                    </span>
                  </div>

                  <div className="text-center px-[12px]">
                    <LiveScore
                      homeScore={displayHomeScore}
                      awayScore={displayAwayScore}
                      isLive={fixtureIsLive}
                    />
                  </div>

                  <div className="flex items-center gap-[10px] flex-1 justify-end">
                    <span className="text-[14px] font-medium text-[#0A0F1C] truncate text-right">
                      {fixture.away_team_name || "Away"}
                    </span>
                    {fixture.away_team_logo ? (
                      <div className="w-[32px] h-[32px] rounded-full bg-gray-50 flex items-center justify-center flex-none overflow-hidden">
                        <img src={fixture.away_team_logo} alt="" className="w-[24px] h-[24px] object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </div>
                    ) : (
                      <div className="w-[32px] h-[32px] bg-[#0A0F1C]/4 rounded-full flex items-center justify-center flex-none">
                        <span className="text-[12px] font-bold text-[#0A0F1C] font-display">
                          {(fixture.away_team_name || "A").charAt(0)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Prediction preview */}
              {bestPrediction && (
                <div className="mt-[12px] pt-[12px] border-t border-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-gray-400">
                      {bestPrediction.selection}
                    </span>
                    <div className="flex items-center gap-[8px]">
                      <span className="text-[12px] font-mono-data font-medium text-[#0A0F1C]">
                        {Math.round(bestPrediction.model_probability * 100)}%
                      </span>
                      <span className="text-[10px] text-gray-400">confidence</span>
                    </div>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-[2px] mt-[6px]">
                    <div
                      className="bg-[#0A0F1C] h-[2px] rounded-full transition-all duration-1000"
                      style={{
                        width: `${bestPrediction.model_probability * 100}%`,
                      }}
                    ></div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
