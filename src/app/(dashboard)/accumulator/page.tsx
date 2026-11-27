"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { PageHeader, Card, EmptyState, Button, Badge } from "@/components/ui";

interface FixtureInfo {
  id: string;
  kickoff_time: string;
  status: string;
  home: { canonical_name: string } | null;
  away: { canonical_name: string } | null;
  league: { name: string } | null;
}

interface Recommendation {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  bookmaker_odds: number;
  model_probability: number;
  edge: number;
  risk_tier: string;
  confidence_tier: string;
  fixture: FixtureInfo | null;
}

function matchLabel(rec: Recommendation): string {
  const f = rec.fixture;
  if (f?.home?.canonical_name && f?.away?.canonical_name) {
    return `${f.home.canonical_name} vs ${f.away.canonical_name}`;
  }
  return rec.selection;
}

interface AccumulatorLeg {
  recommendation: Recommendation;
  stake: number;
}

export default function AccumulatorPage() {
  const { profile, user } = useAuth();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedLegs, setSelectedLegs] = useState<AccumulatorLeg[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accName, setAccName] = useState("");
  const [strategy, setStrategy] = useState<"conservative" | "balanced" | "aggressive" | "longshot">("balanced");
  const [totalStake, setTotalStake] = useState<number>(10);
  const [savedMsg, setSavedMsg] = useState("");
  const [fetchError, setFetchError] = useState("");
  const [saveError, setSaveError] = useState("");

  const fetchRecommendations = useCallback(async () => {
    setFetchError("");
    const supabase = createClient();
    const { data, error } = await supabase
      .from("recommendations")
      .select(
        `*,
        fixture:fixtures!inner(
          id, kickoff_time, status,
          home:teams!fixtures_home_team_id_fkey(canonical_name),
          away:teams!fixtures_away_team_id_fkey(canonical_name),
          league:leagues!fixtures_league_id_fkey(name)
        )`
      )
      .eq("is_recommended", true)
      .eq("fixture.status", "scheduled")
      .gte("fixture.kickoff_time", new Date().toISOString())
      .order("edge", { ascending: false })
      .limit(20);

    if (error) {
      setFetchError(error.message);
    } else if (data) {
      setRecommendations(data as unknown as Recommendation[]);
    }
    setLoading(false);
  }, []);

  // Restore selected legs from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("oddly_accumulator_legs");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedLegs(parsed);
        }
      }
    } catch {}
  }, []);

  // Persist selected legs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("oddly_accumulator_legs", JSON.stringify(selectedLegs));
    } catch {}
  }, [selectedLegs]);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  const toggleLeg = (rec: Recommendation) => {
    setSelectedLegs((prev) => {
      const exists = prev.find((l) => l.recommendation.id === rec.id);
      if (exists) {
        return prev.filter((l) => l.recommendation.id !== rec.id);
      }
      if (prev.length >= 10) return prev;
      return [...prev, { recommendation: rec, stake: 0 }];
    });
  };

  const removeLeg = (id: string) => {
    setSelectedLegs((prev) => prev.filter((l) => l.recommendation.id !== id));
  };

  const combinedOdds = selectedLegs.reduce((acc, leg) => acc * leg.recommendation.bookmaker_odds, 1);
  const combinedProbability = selectedLegs.reduce((acc, leg) => acc * leg.recommendation.model_probability, 1);
  const potentialReturn = totalStake * combinedOdds;

  const handleSave = async () => {
    if (!user || selectedLegs.length < 2) return;
    setSaving(true);

    const supabase = createClient();
    const selections = selectedLegs.map((leg) => {
      const f = leg.recommendation.fixture;
      return {
        recommendation_id: leg.recommendation.id,
        fixture_id: leg.recommendation.fixture_id,
        market: leg.recommendation.market,
        selection: leg.recommendation.selection,
        match: matchLabel(leg.recommendation),
        league: f?.league?.name ?? null,
        kickoff_time: f?.kickoff_time ?? null,
        odds: leg.recommendation.bookmaker_odds,
        model_probability: leg.recommendation.model_probability,
        edge: leg.recommendation.edge,
      };
    });

    const { error } = await supabase.from("accumulators").insert({
      user_id: user.id,
      name: accName || `Accumulator (${selectedLegs.length} legs)`,
      selections,
      combined_odds: combinedOdds,
      estimated_probability: combinedProbability,
      strategy,
      stake: totalStake,
      status: "pending",
    });

    if (error) {
      setSaveError(error.message || "Failed to save accumulator. Please try again.");
    } else {
      setSavedMsg("Accumulator saved!");
      setSaveError("");
      setTimeout(() => {
        setSavedMsg("");
        setSelectedLegs([]);
        setAccName("");
        try { localStorage.removeItem("oddly_accumulator_legs"); } catch {}
      }, 2000);
    }

    setSaving(false);
  };

  return (
    <div>
      <PageHeader
        title="Accumulator Builder"
        description={`Combine ${selectedLegs.length} leg${selectedLegs.length !== 1 ? "s" : ""} for higher returns. Max 10 legs.`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-[20px]">
        {/* Available Picks */}
        <div>
          <h2 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wider mb-[10px]">
            Available Value Bets
          </h2>
          {fetchError && (
            <div
              className="mb-[10px] p-[10px] bg-red-50 border border-red-100 rounded-[10px] text-[12px] text-red-600 flex items-center gap-[8px]"
              role="alert"
            >
              <i className="ri-error-warning-line" />
              <span className="flex-1">{fetchError}</span>
              <button
                onClick={() => {
                  setLoading(true);
                  fetchRecommendations();
                }}
                className="font-medium text-red-700 hover:text-red-800 underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <div className="space-y-[6px]">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} padding="sm" className="animate-pulse">
                  <div className="h-[12px] w-[120px] bg-gray-100 rounded-full mb-[8px]" />
                  <div className="h-[11px] w-[180px] bg-gray-100 rounded-full" />
                </Card>
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <EmptyState
              icon="ri-inbox-line"
              title={fetchError ? "Couldn't load picks" : "No value bets available"}
              description={
                fetchError
                  ? "Something went wrong fetching recommendations. Try again in a moment."
                  : "Check back when matches are closer to kickoff."
              }
            />
          ) : (
            <div className="space-y-[4px]">
              {recommendations.map((rec) => {
                const isSelected = selectedLegs.some((l) => l.recommendation.id === rec.id);
                const f = rec.fixture;
                return (
                  <div
                    key={rec.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => toggleLeg(rec)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleLeg(rec);
                      }
                    }}
                    className={`
                      bg-white rounded-[10px] p-[14px] border transition-all duration-200 cursor-pointer
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30
                      ${isSelected
                        ? "border-[#1B2A4A] shadow-[0_0_0_1px_#1B2A4A]"
                        : "border-gray-100 hover:border-gray-200"
                      }
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-[#0A0F1C] truncate">
                          {matchLabel(rec)}
                        </div>
                        <div className="flex items-center gap-[8px] mt-[2px]">
                          <span className="text-[11px] text-gray-400 truncate">
                            {f?.league?.name ?? rec.market}
                          </span>
                          {f?.kickoff_time && (
                            <>
                              <span className="text-[10px] text-gray-300">·</span>
                              <span className="text-[11px] text-gray-400 whitespace-nowrap">
                                {new Date(f.kickoff_time).toLocaleString("en-GB", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-[8px] mt-[4px]">
                          <span className="text-[11px] text-gray-500">{rec.market}</span>
                          <span className="text-[11px] font-medium text-[#0A0F1C]">{rec.selection}</span>
                        </div>
                        <span className="text-[12px] font-mono-data font-medium text-[#0A0F1C]">
                          @{rec.bookmaker_odds.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex items-center gap-[10px] ml-[12px]">
                        <div className="text-right">
                          <div className="text-[12px] font-mono-data font-semibold text-green-600">
                            +{(rec.edge * 100).toFixed(1)}%
                          </div>
                          <div className="text-[10px] text-gray-400">edge</div>
                        </div>
                        <div
                          className={`
                            w-[20px] h-[20px] rounded-full border-2 flex items-center justify-center transition-all
                            ${isSelected ? "bg-[#1B2A4A] border-[#1B2A4A]" : "border-gray-200"}
                          `}
                        >
                          {isSelected && <i className="ri-check-line text-[10px] text-white" />}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Accumulator Slip */}
        <div className="lg:sticky lg:top-[76px] lg:self-start">
          <Card padding="none" className="overflow-hidden">
            <div className="p-[16px] border-b border-gray-100">
              <h3 className="text-[14px] font-semibold text-[#0A0F1C] mb-[10px]">
                Your Accumulator
              </h3>
              <input
                type="text"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                placeholder="Name (optional)"
                aria-label="Accumulator name"
                maxLength={80}
                className="w-full h-[34px] rounded-[8px] border border-gray-200 bg-gray-50 px-[10px] text-[12px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
              />
            </div>

            {/* Selected legs */}
            <div className="p-[16px] max-h-[280px] overflow-y-auto">
              {selectedLegs.length === 0 ? (
                <p className="text-[12px] text-gray-400 text-center py-[16px]">
                  Click on value bets to add them
                </p>
              ) : (
                <div className="space-y-[4px]">
                  {selectedLegs.map((leg, idx) => (
                    <div
                      key={leg.recommendation.id}
                      className="flex items-center justify-between p-[8px] bg-gray-50 rounded-[8px]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-[6px]">
                          <span className="text-[10px] font-mono-data text-gray-400">{idx + 1}</span>
                          <span className="text-[12px] font-medium text-[#0A0F1C] truncate">
                            {leg.recommendation.fixture
                              ? matchLabel(leg.recommendation)
                              : leg.recommendation.selection}
                          </span>
                        </div>
                        <span className="text-[11px] text-gray-400 ml-[16px] truncate block">
                          {leg.recommendation.market} • {leg.recommendation.selection} @
                          {leg.recommendation.bookmaker_odds.toFixed(2)}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLeg(leg.recommendation.id);
                        }}
                        aria-label={`Remove leg ${idx + 1}`}
                        className="text-gray-300 hover:text-red-500 transition-colors p-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 rounded"
                      >
                        <i className="ri-close-line text-[14px]" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stats */}
            {selectedLegs.length >= 2 && (
              <div className="p-[16px] border-t border-gray-100 space-y-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-gray-400">Combined Odds</span>
                  <span className="text-[14px] font-mono-data font-bold text-[#0A0F1C]">
                    {combinedOdds.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-gray-400">Model Probability</span>
                  <span className="text-[14px] font-mono-data font-semibold text-[#0A0F1C]">
                    {(combinedProbability * 100).toFixed(1)}%
                  </span>
                </div>

                {/* Strategy selector */}
                <div>
                  <span className="text-[11px] text-gray-400 block mb-[6px]">Strategy</span>
                  <div className="grid grid-cols-2 gap-[4px]">
                    {(["conservative", "balanced", "aggressive", "longshot"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStrategy(s)}
                        aria-pressed={strategy === s}
                        className={`
                          py-[6px] px-[8px] rounded-[6px] text-[11px] font-medium transition-all
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30
                          ${strategy === s
                            ? "bg-[#1B2A4A] text-white"
                            : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                          }
                        `}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stake */}
                <div>
                  <span className="text-[11px] text-gray-400 block mb-[6px]">Stake</span>
                  <div className="flex items-center gap-[4px]">
                    {[5, 10, 25, 50].map((s) => (
                      <button
                        key={s}
                        onClick={() => setTotalStake(s)}
                        aria-pressed={totalStake === s}
                        className={`
                          flex-1 py-[6px] rounded-[6px] text-[12px] font-mono-data font-medium transition-all
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30
                          ${totalStake === s
                            ? "bg-[#1B2A4A] text-white"
                            : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                          }
                        `}
                      >
                        ${s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-[8px] border-t border-gray-100">
                  <span className="text-[12px] text-gray-400">Potential Return</span>
                  <span className="text-[16px] font-mono-data font-bold text-green-600">
                    ${potentialReturn.toFixed(2)}
                  </span>
                </div>

                {saveError && (
                  <div
                    className="text-center text-[12px] font-medium text-red-600 bg-red-50 rounded-[8px] py-[8px]"
                    role="alert"
                  >
                    {saveError}
                  </div>
                )}
                {savedMsg && (
                  <div className="text-center text-[13px] font-medium text-green-600 bg-green-50 rounded-[8px] py-[8px]">
                    {savedMsg}
                  </div>
                )}

                <Button
                  onClick={handleSave}
                  disabled={saving || selectedLegs.length < 2 || !user}
                  loading={saving}
                  icon="ri-save-line"
                  className="w-full"
                >
                  Save Accumulator
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
