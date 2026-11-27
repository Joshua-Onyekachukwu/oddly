"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { useLiveFixture } from "@/hooks/useLiveScores";
import { FavouriteButton } from "@/components/favourites/FavouriteButton";
import type { MatchContext } from "@/lib/matches/match-context";

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
  league_id?: string | null;
  home_team_logo?: string | null;
  away_team_logo?: string | null;
  league_logo?: string | null;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  is_featured: boolean;
  leagues?: { name: string; country: string; logo?: string | null };
  predictions?: Prediction[];
  recommendations?: Recommendation[];
}

export function MatchDetail({
  fixture,
  odds,
  context,
}: {
  fixture: Fixture;
  odds: Odds[];
  context?: MatchContext | null;
}) {
  const [activeTab, setActiveTab] = useState<"predictions" | "context" | "odds" | "analysis">("predictions");
  const { profile } = useAuth();
  const router = useRouter();
  const { fixture: liveData, connected } = useLiveFixture(fixture.id);

  // Use live data if available
  const displayStatus = liveData?.status || fixture.status;
  const displayHomeScore = liveData?.home_score ?? fixture.home_score;
  const displayAwayScore = liveData?.away_score ?? fixture.away_score;

  const isLive = ["live", "1H", "2H", "HT"].includes(displayStatus);
  const isFinished = ["finished", "FT"].includes(displayStatus);

  // Add a recommendation to the accumulator bet slip (persisted via localStorage,
  // consumed by the /accumulator page).
  const handleAddToSlip = (rec: Recommendation) => {
    try {
      const raw = localStorage.getItem("oddly_accumulator_legs");
      const legs: Array<{ recommendation: Recommendation; stake: number }> = raw ? JSON.parse(raw) : [];
      const exists = legs.some((l) => l.recommendation?.id === rec.id);
      if (!exists && legs.length < 10) {
        legs.push({ recommendation: rec, stake: 0 });
        localStorage.setItem("oddly_accumulator_legs", JSON.stringify(legs));
      }
    } catch {
      // localStorage unavailable — still navigate so the user lands on the slip
    }
    router.push("/accumulator");
  };

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

  function formatShortDate(iso: string | null | undefined) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function verdictColor(verdict: string | null | undefined) {
    switch (verdict) {
      case "high": return "text-green-600 bg-green-50";
      case "medium": return "text-amber-600 bg-amber-50";
      case "low": return "text-orange-600 bg-orange-50";
      case "insufficient": return "text-red-600 bg-red-50";
      default: return "text-gray-600 bg-gray-50";
    }
  }

  function statusColor(status: string | null | undefined) {
    const s = (status || "").toLowerCase();
    if (s.includes("out") || s.includes("injured") || s.includes("suspend"))
      return "text-red-600 bg-red-50";
    if (s.includes("doubt") || s.includes("question"))
      return "text-amber-600 bg-amber-50";
    return "text-gray-600 bg-gray-50";
  }

  function fmtNum(v: number | null | undefined, digits = 2) {
    return v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(digits);
  }

  function pct(v: number | null | undefined) {
    return v == null || !Number.isFinite(Number(v)) ? "—" : `${Math.round(Number(v) * 100)}%`;
  }

  const pc = context?.prediction_context ?? null;
  const dqComponents =
    pc?.data_quality_breakdown && typeof pc.data_quality_breakdown === "object"
      ? Object.entries((pc.data_quality_breakdown as any).components || {})
          .filter(([, v]) => typeof v === "number")
          .map(([k, v]) => [k, Number(v)] as [string, number])
      : [];
  const pcInput = pc?.input ?? null;
  const homeProfile = context?.team_profiles?.home ?? null;
  const awayProfile = context?.team_profiles?.away ?? null;
  const h2hMeetings = context?.h2h?.meetings ?? [];
  const homeInjuries = context?.injuries?.home ?? [];
  const awayInjuries = context?.injuries?.away ?? [];
  const oddsSummary = context?.odds_summary ?? [];

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
                {fixture.league_id && (
                  <FavouriteButton
                    entityType="league"
                    entityId={fixture.league_id}
                    entityName={fixture.leagues.name}
                    size="sm"
                  />
                )}
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
              {fixture.home_team_logo ? (
                <div className="w-[44px] h-[44px] rounded-full bg-gray-50 flex items-center justify-center flex-none overflow-hidden">
                  <img src={fixture.home_team_logo} alt="" className="w-[36px] h-[36px] object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
              ) : (
                <div className="w-[44px] h-[44px] bg-[#1B2A4A]/5 rounded-full flex items-center justify-center flex-none">
                  <span className="text-[16px] font-bold text-[#1B2A4A] font-display">
                    {(fixture.home_team_name || "H").charAt(0)}
                  </span>
                </div>
              )}
              <span className="text-[16px] md:text-[18px] font-semibold text-[#0A0F1C]">
                {fixture.home_team_name || "Home"}
              </span>
              {fixture.home_team_id && (
                <FavouriteButton
                  entityType="team"
                  entityId={fixture.home_team_id}
                  entityName={fixture.home_team_name}
                  size="sm"
                />
              )}
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
              {fixture.away_team_id && (
                <FavouriteButton
                  entityType="team"
                  entityId={fixture.away_team_id}
                  entityName={fixture.away_team_name}
                  size="sm"
                />
              )}
              <span className="text-[16px] md:text-[18px] font-semibold text-[#0A0F1C] text-right">
                {fixture.away_team_name || "Away"}
              </span>
              {fixture.away_team_logo ? (
                <div className="w-[44px] h-[44px] rounded-full bg-gray-50 flex items-center justify-center flex-none overflow-hidden">
                  <img src={fixture.away_team_logo} alt="" className="w-[36px] h-[36px] object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
              ) : (
                <div className="w-[44px] h-[44px] bg-[#1B2A4A]/5 rounded-full flex items-center justify-center flex-none">
                  <span className="text-[16px] font-bold text-[#1B2A4A] font-display">
                    {(fixture.away_team_name || "A").charAt(0)}
                  </span>
                </div>
              )}
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
        {(["predictions", "context", "odds", "analysis"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            className={`flex-1 py-[10px] px-[16px] rounded-[10px] text-[13px] font-semibold transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
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

      {activeTab === "context" && (
        <div className="space-y-[16px]">
          {/* ── Prediction breakdown ─────────────────────────────────── */}
          <div className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-[16px]">
              <h3 className="text-[13px] font-semibold text-[#0A0F1C] uppercase tracking-wider">
                Prediction Breakdown
              </h3>
              {pc ? (
                <div className="flex items-center gap-[6px]">
                  {pc.confidence_tier && (
                    <span className={`text-[10px] font-semibold px-[8px] py-[3px] rounded-full ${getConfidenceColor(pc.confidence_tier)}`}>
                      {pc.confidence_tier.replace(/_/g, " ")}
                    </span>
                  )}
                  {pc.data_quality_verdict && (
                    <span className={`text-[10px] font-semibold px-[8px] py-[3px] rounded-full ${verdictColor(pc.data_quality_verdict)}`}>
                      Data: {pc.data_quality_verdict}
                    </span>
                  )}
                  {pc.data_quality_score != null && (
                    <span className="text-[10px] font-mono-data font-semibold text-gray-500 bg-gray-50 px-[8px] py-[3px] rounded-full">
                      {pc.data_quality_score}/100
                    </span>
                  )}
                </div>
              ) : null}
            </div>

            {!pc ? (
              <p className="text-[13px] text-gray-400">
                No prediction data recorded for this fixture yet.
              </p>
            ) : (
              <div className="space-y-[16px]">
                {/* Headline metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
                  <div className="p-[10px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">{pc.market || "Market"} · {pc.selection || ""}</span>
                    <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                      {pc.model_probability != null ? `${Math.round(Number(pc.model_probability) * 100)}%` : "—"}
                    </span>
                  </div>
                  <div className="p-[10px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">{fixture.home_team_name} Elo</span>
                    <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                      {pcInput?.home_elo != null ? Math.round(Number(pcInput.home_elo)) : "—"}
                    </span>
                  </div>
                  <div className="p-[10px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">{fixture.away_team_name} Elo</span>
                    <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                      {pcInput?.away_elo != null ? Math.round(Number(pcInput.away_elo)) : "—"}
                    </span>
                  </div>
                  <div className="p-[10px] bg-gray-50 rounded-[10px]">
                    <span className="block text-[10px] text-gray-400 mb-[2px]">League Gate</span>
                    <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C] capitalize">
                      {pcInput?.league_gate || "—"}
                    </span>
                  </div>
                </div>

                {/* Recent form */}
                {(pcInput?.home_form != null || pcInput?.away_form != null) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
                    {([
                      ["Home form (last 5)", pcInput?.home_form, fixture.home_team_name],
                      ["Away form (last 5)", pcInput?.away_form, fixture.away_team_name],
                    ] as const).map(([label, form, teamName]) => (
                      <div key={label} className="p-[10px] bg-gray-50 rounded-[10px]">
                        <span className="block text-[10px] text-gray-400 mb-[4px]">{label} — {teamName}</span>
                        {Array.isArray(form) && form.length > 0 ? (
                          <div className="flex gap-[4px] flex-wrap">
                            {(form as unknown[]).map((f, i) => {
                              const s = String(f);
                              const up = s.toUpperCase().startsWith("W");
                              const down = s.toUpperCase().startsWith("L");
                              return (
                                <span
                                  key={i}
                                  className={`text-[10px] font-mono-data font-semibold px-[6px] py-[2px] rounded-[6px] ${
                                    up ? "text-green-600 bg-green-50" : down ? "text-red-600 bg-red-50" : "text-gray-500 bg-gray-100"
                                  }`}
                                >
                                  {s}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[12px] text-gray-400">No form data</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Data-quality component breakdown */}
                {dqComponents.length > 0 && (
                  <div>
                    <span className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-[8px]">
                      Data quality components
                    </span>
                    <div className="space-y-[6px]">
                      {dqComponents.map(([key, value]) => (
                        <div key={key} className="flex items-center gap-[10px]">
                          <span className="text-[11px] text-gray-500 w-[130px] truncate">
                            {key.replace(/_/g, " ")}
                          </span>
                          <div className="flex-1 bg-gray-100 rounded-full h-[4px]">
                            <div
                              className="bg-[#1B2A4A] h-[4px] rounded-full"
                              style={{ width: `${Math.min(Number(value) * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono-data text-gray-400 w-[36px] text-right">
                            {Math.round(Number(value) * 100)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pc.model_version && (
                  <p className="text-[10px] text-gray-300">
                    Model {pc.model_version}
                    {pcInput?.captured_at ? ` · snapshot ${formatShortDate(pcInput.captured_at)}` : ""}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Team profiles ─────────────────────────────────────────── */}
          <div className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="text-[13px] font-semibold text-[#0A0F1C] uppercase tracking-wider mb-[16px]">
              Team Profiles
            </h3>
            {!homeProfile && !awayProfile ? (
              <p className="text-[13px] text-gray-400">
                No team feature profile data available for these teams.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
                {([
                  ["Home", homeProfile, fixture.home_team_name],
                  ["Away", awayProfile, fixture.away_team_name],
                ] as const).map(([side, profile, teamName]) => (
                  <div key={side} className="border border-gray-100 rounded-[12px] p-[14px]">
                    {!profile ? (
                      <div>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{side} — {teamName}</span>
                        <p className="text-[12px] text-gray-400 mt-[8px]">No profile data.</p>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-[10px]">
                          <span className="text-[12px] font-semibold text-[#0A0F1C]">
                            {side} — {teamName}
                          </span>
                          <span className="text-[9px] font-medium text-gray-400 bg-gray-50 px-[6px] py-[2px] rounded-full">
                            {profile.data_season || "season n/a"}
                            {profile.xg_matches > 0 ? ` · ${profile.xg_matches} xG matches` : ""}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-[8px]">
                          {([
                            ["xG for", fmtNum(profile.avg_xg)],
                            ["xG against", fmtNum(profile.avg_xga)],
                            ["xG last 5", fmtNum(profile.xg_last5)],
                            ["Attack", fmtNum(profile.attack_rating, 1)],
                            ["Defense", fmtNum(profile.defense_rating, 1)],
                            ["Win rate", pct(profile.win_rate)],
                          ] as const).map(([label, value]) => (
                            <div key={label} className="bg-gray-50 rounded-[8px] p-[8px]">
                              <span className="block text-[9px] text-gray-400 mb-[2px]">{label}</span>
                              <span className="text-[13px] font-mono-data font-semibold text-[#0A0F1C]">{value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-[12px] mt-[8px] text-[10px] text-gray-400">
                          <span>GF/G {fmtNum(profile.goals_for_per_game)}</span>
                          <span>GA/G {fmtNum(profile.goals_against_per_game)}</span>
                          {profile.xg_source ? <span className="truncate">src: {profile.xg_source}</span> : null}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Head-to-head ──────────────────────────────────────────── */}
          <div className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <h3 className="text-[13px] font-semibold text-[#0A0F1C] uppercase tracking-wider mb-[4px]">
              Head to Head
            </h3>
            <p className="text-[11px] text-gray-400 mb-[12px]">
              Last {h2hMeetings.length} finished meeting{h2hMeetings.length === 1 ? "" : "s"}
              {context?.h2h?.with_xg ? ` · ${context.h2h.with_xg} with xG data` : ""}
            </p>
            {h2hMeetings.length === 0 ? (
              <p className="text-[13px] text-gray-400">
                No previous meetings on record between these teams.
              </p>
            ) : (
              <div className="space-y-[8px]">
                {h2hMeetings.map((m) => {
                  const homeName = m.home_team_id === fixture.home_team_id
                    ? fixture.home_team_name
                    : fixture.away_team_name;
                  const awayName = m.away_team_id === fixture.home_team_id
                    ? fixture.home_team_name
                    : fixture.away_team_name;
                  return (
                    <div
                      key={m.fixture_id}
                      className="flex items-center justify-between gap-[12px] p-[10px] bg-gray-50 rounded-[10px]"
                    >
                      <span className="text-[11px] text-gray-400 w-[86px] flex-none">
                        {formatShortDate(m.kickoff_time)}
                      </span>
                      <span className="text-[12px] text-gray-600 flex-1 truncate">
                        {homeName} <span className="font-mono-data font-semibold text-[#0A0F1C]">{m.home_score ?? "–"}–{m.away_score ?? "–"}</span> {awayName}
                      </span>
                      {m.xg ? (
                        <span className="text-[10px] font-mono-data text-gray-500 bg-white px-[8px] py-[3px] rounded-full border border-gray-100 flex-none">
                          xG {fmtNum(m.xg.home_for, 2)}–{fmtNum(m.xg.away_for, 2)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-300 flex-none">no xG</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Injuries / availability ──────────────────────────────── */}
          <div className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
            <div className="flex items-center justify-between mb-[12px]">
              <h3 className="text-[13px] font-semibold text-[#0A0F1C] uppercase tracking-wider">
                Injuries &amp; Availability
              </h3>
              {context?.injuries?.truncated && (
                <span className="text-[10px] text-amber-600 bg-amber-50 px-[8px] py-[3px] rounded-full">
                  Feed may be truncated
                </span>
              )}
            </div>
            {homeInjuries.length === 0 && awayInjuries.length === 0 ? (
              <p className="text-[13px] text-gray-400">
                No injury or suspension records for either team.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
                {([
                  ["Home", homeInjuries, fixture.home_team_name],
                  ["Away", awayInjuries, fixture.away_team_name],
                ] as const).map(([side, list, teamName]) => (
                  <div key={side}>
                    <span className="block text-[11px] font-semibold text-gray-500 mb-[8px]">
                      {side} — {teamName}
                    </span>
                    {list.length === 0 ? (
                      <p className="text-[12px] text-gray-400 pl-[4px]">No reported absences.</p>
                    ) : (
                      <div className="space-y-[6px]">
                        {list.slice(0, 15).map((inj, i) => (
                          <div key={`${inj.player_name}-${i}`} className="p-[10px] bg-gray-50 rounded-[10px]">
                            <div className="flex items-center justify-between gap-[8px]">
                              <span className="text-[12px] font-semibold text-[#0A0F1C] truncate">
                                {inj.player_name}
                              </span>
                              <span className={`text-[9px] font-semibold px-[6px] py-[2px] rounded-full flex-none ${statusColor(inj.status)}`}>
                                {(inj.status || "unknown").replace(/_/g, " ")}
                              </span>
                            </div>
                            <div className="flex items-center gap-[8px] mt-[6px]">
                              <div className="flex-1 bg-gray-200 rounded-full h-[3px]">
                                <div
                                  className="bg-[#1B2A4A] h-[3px] rounded-full"
                                  style={{
                                    width: `${Math.min(
                                      ((inj.importance_score ?? (inj.importance_1_10 != null ? inj.importance_1_10 / 10 : 0)) || 0) * 100,
                                      100
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="text-[10px] font-mono-data text-gray-400 flex-none">
                                {inj.importance_score != null
                                  ? `${Math.round(inj.importance_score * 100)}%`
                                  : inj.importance_1_10 != null
                                    ? `${inj.importance_1_10}/10`
                                    : "—"}
                              </span>
                            </div>
                            <div className="flex items-center gap-[8px] mt-[4px] text-[10px] text-gray-400">
                              {inj.injury_type ? <span className="truncate">{inj.injury_type}</span> : null}
                              {inj.expected_return ? <span>· back ~{inj.expected_return}</span> : null}
                              {inj.confidence ? (
                                <span className="ml-auto text-gray-300">{inj.confidence}</span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Odds movement ─────────────────────────────────────────── */}
          {oddsSummary.length > 0 && (
            <div className="bg-white rounded-[14px] p-[20px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]">
              <h3 className="text-[13px] font-semibold text-[#0A0F1C] uppercase tracking-wider mb-[12px]">
                Odds Movement
              </h3>
              <div className="space-y-[6px]">
                {oddsSummary.slice(0, 20).map((o, i) => (
                  <div
                    key={`${o.market}-${o.selection}-${i}`}
                    className="flex items-center justify-between gap-[10px] p-[10px] bg-gray-50 rounded-[10px]"
                  >
                    <span className="text-[12px] text-gray-600 truncate flex-1">
                      {o.market} · {o.selection}
                    </span>
                    <span className="text-[10px] text-gray-400 flex-none">
                      {o.bookmakers} book{o.bookmakers === 1 ? "" : "s"}
                    </span>
                    <span className="text-[12px] font-mono-data text-gray-400 flex-none">
                      {o.opening_odds != null ? o.opening_odds.toFixed(2) : "—"}
                    </span>
                    <i className="ri-arrow-right-line text-[12px] text-gray-300 flex-none"></i>
                    <span className="text-[13px] font-mono-data font-semibold text-[#0A0F1C] flex-none">
                      {o.latest_odds != null ? o.latest_odds.toFixed(2) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
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
                    <span className="text-[16px] font-mono-data font-bold text-[#0A0F1C]">
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

                {/* Add to bet slip button */}
                {rec.is_recommended && (
                  <button
                    onClick={() => handleAddToSlip(rec)}
                    aria-label={`Add ${rec.selection} to bet slip`}
                    className="mt-[12px] w-full h-[36px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.98] flex items-center justify-center gap-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
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
