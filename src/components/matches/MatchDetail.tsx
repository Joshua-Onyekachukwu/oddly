"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { useLiveFixture } from "@/hooks/useLiveScores";

interface Prediction {
  id: string;
  market: string;
  selection: string;
  model_probability: number;
  confidence_lower: number;
  confidence_upper: number;
  model_version: string;
  features_used: any;
  sub_model_probabilities: any;
  model_disagreement: number | null;
  result: string;
  created_at: string;
}

interface Recommendation {
  id: string;
  market: string;
  selection: string;
  bookmaker_odds: number;
  model_probability: number;
  edge: number;
  opportunity_score: number;
  risk_tier: string;
  confidence_tier: string;
  kelly_fraction: number | null;
  is_recommended: boolean;
  is_avoid: boolean;
  explanation: any;
}

interface Odds {
  id: string;
  bookmaker: string;
  market: string;
  selection: string;
  odds: number;
  snapshot_time: string;
}

interface Fixture {
  id: string;
  home_team_name: string;
  away_team_name: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  is_featured: boolean;
  leagues?: { name: string; country: string };
  predictions?: Prediction[];
  recommendations?: Recommendation[];
}

export function MatchDetail({
  fixture,
  odds,
}: {
  fixture: Fixture;
  odds: Odds[];
}) {
  const [activeTab, setActiveTab] = useState<"predictions" | "odds" | "analysis">("predictions");
  const { profile } = useAuth();
  const router = useRouter();
  const { fixture: liveData, connected } = useLiveFixture(fixture.id);

  // Use live data if available
  const displayStatus = liveData?.status || fixture.status;
  const displayHomeScore = liveData?.home_score ?? fixture.home_score;
  const displayAwayScore = liveData?.away_score ?? fixture.away_score;

  const isLive = ["live", "1H", "2H", "HT"].includes(displayStatus);
  const isFinished = ["finished", "FT"].includes(displayStatus);

  function formatKickoff(time: string) {
    const date = new Date(time);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getRiskColor(tier: string) {
    switch (tier) {
      case "low": return "text-green-600 bg-green-50";
      case "medium": return "text-amber-600 bg-amber-50";
      case "high": return "text-red-600 bg-red-50";
      default: return "text-gray-600 bg-gray-50";
    }
  }

  function getConfidenceColor(tier: string) {
    switch (tier) {
      case "very_high": return "text-[#1B2A4A] bg-[#BFFF00]/10";
      case "high": return "text-green-600 bg-green-50";
      case "medium": return "text-amber-600 bg-amber-50";
      default: return "text-gray-600 bg-gray-50";
    }
  }

  // Group odds by market
  const oddsByMarket = odds.reduce(
    (acc, odd) => {
      if (!acc[odd.market]) acc[odd.market] = [];
      acc[odd.market].push(odd);
      return acc;
    },
    {} as Record<string, Odds[]>
  );

  return (
    <div className="space-y-[24px]">
      {/* Match Header */}
      <div className="bg-white rounded-[16px] p-[24px] md:p-[32px] border border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
        {/* League & Status */}
        <div className="flex items-center justify-between mb-[20px]">
          <div className="flex items-center gap-[10px]">
            {fixture.leagues?.name && (
              <>
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {fixture.leagues.country}
                </span>
                <span className="text-gray-200">·</span>
                <span className="text-[11px] font-semibold text-[#1B2A4A] uppercase tracking-wider">
                  {fixture.leagues.name}
                </span>
              </>
            )}
            {connected && isLive && (
              <span className="text-[10px] text-[#22c55e] flex items-center gap-[4px] ml-[8px]">
                <span className="w-[4px] h-[4px] rounded-full bg-[#22c55e] animate-pulse"></span>
                Realtime
              </span>
            )}
          </div>
          {isLive ? (
            <span className="flex items-center gap-[4px] text-[10px] font-semibold text-[#22c55e] bg-[#22c55e]/8 px-[10px] py-[4px] rounded-full">
              <span className="w-[5px] h-[5px] rounded-full bg-[#22c55e] animate-pulse"></span>
              LIVE
            </span>
          ) : isFinished ? (
            <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-[10px] py-[4px] rounded-full">
              FT
            </span>
          ) : (
            <span className="text-[11px] font-medium text-gray-400">
              {formatKickoff(fixture.kickoff_time)}
            </span>
          )}
        </div>

        {/* Teams & Score */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[16px] flex-1">
            <div className="flex items-center gap-[12px] flex-1">
              <div className="w-[44px] h-[44px] bg-[#1B2A4A]/5 rounded-full flex items-center justify-center flex-none">
                <span className="text-[16px] font-bold text-[#1B2A4A] font-display">
                  {(fixture.home_team_name || "H").charAt(0)}
                </span>
              </div>
              <span className="text-[16px] md:text-[18px] font-semibold text-[#0A0F1C]">
                {fixture.home_team_name || "Home"}
              </span>
            </div>

            <div className="text-center px-[20px]">
              {isFinished || isLive ? (
                <span className={`font-display text-[24px] md:text-[28px] font-bold font-mono-data transition-colors duration-300 ${
                  isLive && liveData ? "text-[#22c55e]" : "text-[#0A0F1C]"
                }`}>
                  {displayHomeScore ?? 0} - {displayAwayScore ?? 0}
                </span>
              ) : (
                <span className="text-[14px] font-medium text-gray-300">VS</span>
              )}
            </div>

            <div className="flex items-center gap-[12px] flex-1 justify-end">
              <span className="text-[16px] md:text-[18px] font-semibold text-[#0A0F1C] text-right">
                {fixture.away_team_name || "Away"}
              </span>
              <div className="w-[44px] h-[44px] bg-[#1B2A4A]/5 rounded-full flex items-center justify-center flex-none">
                <span className="text-[16px] font-bold text-[#1B2A4A] font-display">
                  {(fixture.away_team_name || "A").charAt(0)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Featured badge */}
        {fixture.is_featured && (
          <div className="mt-[16px] flex justify-center">
            <span className="inline-flex items-center gap-[6px] text-[11px] font-semibold text-[#D97706] bg-[#D97706]/8 px-[12px] py-[5px] rounded-full">
              <i className="ri-star-fill text-[10px]"></i>
              Featured Match
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-[4px] bg-gray-50 rounded-[12px] p-[4px]">
        {(["predictions", "odds", "analysis"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-[10px] px-[16px] rounded-[10px] text-[13px] font-semibold transition-all duration-300 ${
              activeTab === tab
                ? "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "predictions" && (
        <div className="space-y-[12px]">
          {(!fixture.predictions || fixture.predictions.length === 0) ? (
            <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
              <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-gray-50 mb-[12px]">
                <i className="ri-brain-line text-[22px] text-gray-300"></i>
              </div>
              <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
                No predictions yet
              </h3>
              <p className="text-[13px] text-gray-400">
                Predictions will appear when the AI models have analyzed this fixture.
              </p>
            </div>
          ) : (
            fixture.predictions.map((pred) => (
              <div
                key={pred.id}
                className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
              >
                <div className="flex items-center justify-between mb-[12px]">
                  <div>
                    <span className="text-[14px] font-semibold text-[#0A0F1C]">
                      {pred.selection}
                    </span>
                    <span className="text-[12px] text-gray-400 ml-[8px]">
                      {pred.market}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-[8px] py-[3px] rounded-full ${
                      pred.result === "correct"
                        ? "text-green-600 bg-green-50"
                        : pred.result === "wrong"
                        ? "text-red-600 bg-red-50"
                        : "text-gray-400 bg-gray-50"
                    }`}
                  >
                    {pred.result === "pending" ? "Pending" : pred.result === "correct" ? "✓ Correct" : "✗ Wrong"}
                  </span>
                </div>

                {/* Probability bar */}
                <div className="mb-[12px]">
                  <div className="flex items-center justify-between mb-[6px]">
                    <span className="text-[12px] text-gray-400">Model Probability</span>
                    <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                      {Math.round(pred.model_probability * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-[3px]">
                    <div
                      className="bg-[#1B2A4A] h-[3px] rounded-full transition-all duration-1000"
                      style={{ width: `${pred.model_probability * 100}%` }}
                    ></div>
                  </div>
                  {/* Confidence range */}
                  {pred.confidence_lower != null && pred.confidence_upper != null && (
                    <div className="flex items-center justify-between mt-[4px]">
                      <span className="text-[10px] font-mono-data text-gray-300">
                        {Math.round(pred.confidence_lower * 100)}%
                      </span>
                      <span className="text-[10px] text-gray-300">confidence range</span>
                      <span className="text-[10px] font-mono-data text-gray-300">
                        {Math.round(pred.confidence_upper * 100)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Model info row */}
                <div className="flex flex-wrap items-center gap-[8px]">
                  <span className="text-[10px] font-medium text-gray-400 bg-gray-50 px-[8px] py-[3px] rounded-full">
                    {pred.model_version}
                  </span>
                  {pred.model_disagreement != null && (
                    <span className="text-[10px] font-medium text-amber-500 bg-amber-50 px-[8px] py-[3px] rounded-full">
                      Disagreement: {Math.round(pred.model_disagreement * 100)}%
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "odds" && (
        <div className="space-y-[16px]">
          {Object.keys(oddsByMarket).length === 0 ? (
            <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
              <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-gray-50 mb-[12px]">
                <i className="ri-bar-chart-box-line text-[22px] text-gray-300"></i>
              </div>
              <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
                No odds available
              </h3>
              <p className="text-[13px] text-gray-400">
                Odds will appear once bookmakers have set their lines.
              </p>
            </div>
          ) : (
            Object.entries(oddsByMarket).map(([market, marketOdds]) => (
              <div key={market} className="bg-white rounded-[14px] p-[20px] border border-gray-100">
                <h3 className="text-[13px] font-semibold text-[#0A0F1C] mb-[12px] uppercase tracking-wider">
                  {market}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-[8px]">
                  {marketOdds.map((odd) => (
                    <div
                      key={odd.id}
                      className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]"
                    >
                      <span className="text-[12px] text-gray-500 truncate mr-[8px]">
                        {odd.bookmaker}
                      </span>
                      <span className="text-[13px] font-mono-data font-semibold text-[#0A0F1C]">
                        {odd.odds.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "analysis" && (
        <div className="space-y-[12px]">
          {(!fixture.recommendations || fixture.recommendations.length === 0) ? (
            <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
              <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-gray-50 mb-[12px]">
                <i className="ri-lightbulb-line text-[22px] text-gray-300"></i>
              </div>
              <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
                No value bets found
              </h3>
              <p className="text-[13px] text-gray-400">
                No edges detected for this fixture. Check back closer to kickoff.
              </p>
            </div>
          ) : (
            fixture.recommendations.map((rec) => (
              <div
                key={rec.id}
                className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
              >
                <div className="flex items-center justify-between mb-[12px]">
                  <div>
                    <span className="text-[14px] font-semibold text-[#0A0F1C]">
                      {rec.selection}
                    </span>
                    <span className="text-[12px] text-gray-400 ml-[8px]">
                      {rec.market}
                    </span>
                  </div>
                  {rec.is_recommended && (
                    <span className="inline-flex items-center gap-[4px] text-[10px] font-semibold text-[#1B2A4A] bg-[#BFFF00]/10 px-[8px] py-[3px] rounded-full">
                      <i className="ri-check-line text-[9px]"></i>
                      Recommended
                    </span>
                  )}
                  {rec.is_avoid && (
                    <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-[8px] py-[3px] rounded-full">
                      Avoid
                    </span>
                  )}
                </div>

                {/* Edge indicator */}
                <div className="mb-[16px]">
                  <div className="flex items-center justify-between mb-[6px]">
                    <span className="text-[12px] text-gray-400">Edge</span>
                    <span className="text-[16px] font-mono-data font-bold text-[#BFFF00]">
                      {(rec.edge * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-[4px]">
                    <div
                      className="bg-[#BFFF00] h-[4px] rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(rec.edge * 100 * 2, 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[12px]">
                  <div className="p-[10px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Bookmaker Odds</span>
                    <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                      {rec.bookmaker_odds.toFixed(2)}
                    </span>
                  </div>
                  <div className="p-[10px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Model Prob</span>
                    <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                      {Math.round(rec.model_probability * 100)}%
                    </span>
                  </div>
                  <div className="p-[10px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">Opportunity</span>
                    <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                      {rec.opportunity_score}/100
                    </span>
                  </div>
                  {rec.kelly_fraction != null && (
                    <div className="p-[10px] bg-gray-50 rounded-[10px]">
                      <span className="block text-[10px] text-gray-400 mb-[2px]">Kelly Fraction</span>
                      <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                        {(rec.kelly_fraction * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Risk & Confidence badges */}
                <div className="flex gap-[8px]">
                  <span className={`text-[10px] font-semibold px-[8px] py-[3px] rounded-full ${getRiskColor(rec.risk_tier)}`}>
                    {rec.risk_tier.charAt(0).toUpperCase() + rec.risk_tier.slice(1)} Risk
                  </span>
                  <span className={`text-[10px] font-semibold px-[8px] py-[3px] rounded-full ${getConfidenceColor(rec.confidence_tier)}`}>
                    {rec.confidence_tier.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())} Confidence
                  </span>
                </div>

                {/* Add to bet button */}
                {rec.is_recommended && (
                  <button
                    onClick={() => {
                      // TODO: Add to accumulator or place bet
                    }}
                    className="mt-[12px] w-full h-[36px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.98] flex items-center justify-center gap-[6px]"
                  >
                    <i className="ri-add-line text-[14px]"></i>
                    Add to Bet Slip
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
