"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";

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

  const fetchRecommendations = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("recommendations")
      .select("*")
      .eq("is_recommended", true)
      .order("edge", { ascending: false })
      .limit(20);

    if (!error && data) {
      setRecommendations(data);
    }
    setLoading(false);
  }, []);

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

  const combinedProbability = selectedLegs.reduce(
    (acc, leg) => acc * leg.recommendation.model_probability,
    1
  );

  const potentialReturn = totalStake * combinedOdds;

  const handleSave = async () => {
    if (!user || selectedLegs.length < 2) return;
    setSaving(true);

    const supabase = createClient();
    const selections = selectedLegs.map((leg) => ({
      recommendation_id: leg.recommendation.id,
      fixture_id: leg.recommendation.fixture_id,
      market: leg.recommendation.market,
      selection: leg.recommendation.selection,
      odds: leg.recommendation.bookmaker_odds,
      model_probability: leg.recommendation.model_probability,
      edge: leg.recommendation.edge,
    }));

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

    if (!error) {
      setSavedMsg("Accumulator saved!");
      setTimeout(() => {
        setSavedMsg("");
        setSelectedLegs([]);
        setAccName("");
      }, 2000);
    }

    setSaving(false);
  };

  return (
    <div>
      <div className="mb-[24px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          Accumulator Builder
        </h1>
        <p className="text-[14px] text-gray-500">
          Combine {selectedLegs.length} leg{selectedLegs.length !== 1 ? "s" : ""} for higher returns. Max 10 legs.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-[24px]">
        {/* Available Picks */}
        <div>
          <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">
            Available Value Bets
          </h2>
          {loading ? (
            <div className="space-y-[8px]">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-[14px] p-[16px] border border-gray-100 animate-pulse">
                  <div className="h-[14px] w-[140px] bg-gray-100 rounded-full mb-[8px]"></div>
                  <div className="h-[12px] w-[200px] bg-gray-100 rounded-full"></div>
                </div>
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
              <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-gray-50 mb-[12px]">
                <i className="ri-inbox-line text-[22px] text-gray-300"></i>
              </div>
              <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
                No value bets available
              </h3>
              <p className="text-[13px] text-gray-400">
                Check back when matches are closer to kickoff.
              </p>
            </div>
          ) : (
            <div className="space-y-[6px]">
              {recommendations.map((rec) => {
                const isSelected = selectedLegs.some((l) => l.recommendation.id === rec.id);

                return (
                  <div
                    key={rec.id}
                    onClick={() => toggleLeg(rec)}
                    className={`bg-white rounded-[14px] p-[14px] border transition-all duration-300 cursor-pointer ${
                      isSelected
                        ? "border-[#BFFF00] shadow-[0_0_0_1px_#BFFF00]"
                        : "border-gray-100 hover:border-gray-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-[8px] mb-[4px]">
                          <span className="text-[13px] font-semibold text-[#0A0F1C] truncate">
                            {rec.selection}
                          </span>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">
                            {rec.market}
                          </span>
                        </div>
                        <div className="flex items-center gap-[12px]">
                          <span className="text-[12px] text-gray-500">
                            {rec.selection} ({rec.market})
                          </span>
                          <span className="text-[12px] font-mono-data font-medium text-[#0A0F1C]">
                            @{rec.bookmaker_odds.toFixed(2)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-[12px] ml-[12px]">
                        <div className="text-right">
                          <div className="text-[12px] font-mono-data font-semibold text-[#BFFF00]">
                            +{(rec.edge * 100).toFixed(1)}%
                          </div>
                          <div className="text-[10px] text-gray-400">edge</div>
                        </div>
                        <div
                          className={`w-[24px] h-[24px] rounded-full border-2 flex items-center justify-center transition-all ${
                            isSelected
                              ? "bg-[#BFFF00] border-[#BFFF00]"
                              : "border-gray-200"
                          }`}
                        >
                          {isSelected && (
                            <i className="ri-check-line text-[12px] text-[#1B2A4A]"></i>
                          )}
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
        <div className="lg:sticky lg:top-[80px] lg:self-start">
          <div className="bg-white rounded-[16px] border border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] overflow-hidden">
            <div className="p-[20px] border-b border-gray-50">
              <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[12px]">
                Your Accumulator
              </h3>
              <input
                type="text"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                placeholder="Name (optional)"
                className="w-full h-[36px] rounded-[10px] border border-gray-200 bg-gray-50 px-[12px] text-[13px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
              />
            </div>

            {/* Selected legs */}
            <div className="p-[20px] max-h-[300px] overflow-y-auto">
              {selectedLegs.length === 0 ? (
                <p className="text-[13px] text-gray-400 text-center py-[20px]">
                  Click on value bets to add them
                </p>
              ) : (
                <div className="space-y-[6px]">
                  {selectedLegs.map((leg, idx) => (
                    <div
                      key={leg.recommendation.id}
                      className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-[6px]">
                          <span className="text-[10px] font-mono-data text-gray-400">{idx + 1}</span>
                          <span className="text-[12px] font-medium text-[#0A0F1C] truncate">
                            {leg.recommendation.selection}
                          </span>
                        </div>
                        <span className="text-[11px] text-gray-400 ml-[16px]">
                          @{leg.recommendation.bookmaker_odds.toFixed(2)}
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLeg(leg.recommendation.id);
                        }}
                        className="text-gray-300 hover:text-red-500 transition-colors p-[4px]"
                      >
                        <i className="ri-close-line text-[14px]"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Stats */}
            {selectedLegs.length >= 2 && (
              <div className="p-[20px] border-t border-gray-50 space-y-[12px]">
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
                  <span className="text-[12px] text-gray-400 block mb-[6px]">Strategy</span>
                  <div className="grid grid-cols-2 gap-[6px]">
                    {(["conservative", "balanced", "aggressive", "longshot"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStrategy(s)}
                        className={`py-[6px] px-[8px] rounded-[8px] text-[11px] font-medium transition-all ${
                          strategy === s
                            ? "bg-[#1B2A4A] text-white"
                            : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stake */}
                <div>
                  <span className="text-[12px] text-gray-400 block mb-[6px]">Stake</span>
                  <div className="flex items-center gap-[8px]">
                    {[5, 10, 25, 50].map((s) => (
                      <button
                        key={s}
                        onClick={() => setTotalStake(s)}
                        className={`flex-1 py-[6px] rounded-[8px] text-[12px] font-mono-data font-medium transition-all ${
                          totalStake === s
                            ? "bg-[#1B2A4A] text-white"
                            : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        ${s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-[8px] border-t border-gray-50">
                  <span className="text-[12px] text-gray-400">Potential Return</span>
                  <span className="text-[16px] font-mono-data font-bold text-[#BFFF00]">
                    ${potentialReturn.toFixed(2)}
                  </span>
                </div>

                {savedMsg && (
                  <div className="text-center text-[13px] font-medium text-green-600 bg-green-50 rounded-[10px] py-[8px]">
                    {savedMsg}
                  </div>
                )}

                <button
                  onClick={handleSave}
                  disabled={saving || selectedLegs.length < 2}
                  className="w-full h-[40px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-[6px]"
                >
                  {saving ? (
                    <div className="w-[16px] h-[16px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <i className="ri-save-line text-[14px]"></i>
                      Save Accumulator
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
