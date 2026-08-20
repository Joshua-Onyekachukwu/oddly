"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, EmptyState, Button, Badge } from "@/components/ui";

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
  const combinedProbability = selectedLegs.reduce((acc, leg) => acc * leg.recommendation.model_probability, 1);
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
              title="No value bets available"
              description="Check back when matches are closer to kickoff."
            />
          ) : (
            <div className="space-y-[4px]">
              {recommendations.map((rec) => {
                const isSelected = selectedLegs.some((l) => l.recommendation.id === rec.id);
                return (
                  <div
                    key={rec.id}
                    onClick={() => toggleLeg(rec)}
                    className={`
                      bg-white rounded-[10px] p-[14px] border transition-all duration-200 cursor-pointer
                      ${isSelected
                        ? "border-[#1B2A4A] shadow-[0_0_0_1px_#1B2A4A]"
                        : "border-gray-100 hover:border-gray-200"
                      }
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-[8px] mb-[2px]">
                          <span className="text-[13px] font-semibold text-[#0A0F1C] truncate">
                            {rec.selection}
                          </span>
                          <span className="text-[10px] text-gray-400">{rec.market}</span>
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
                        className={`
                          py-[6px] px-[8px] rounded-[6px] text-[11px] font-medium transition-all
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
                        className={`
                          flex-1 py-[6px] rounded-[6px] text-[12px] font-mono-data font-medium transition-all
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

                {savedMsg && (
                  <div className="text-center text-[13px] font-medium text-green-600 bg-green-50 rounded-[8px] py-[8px]">
                    {savedMsg}
                  </div>
                )}

                <Button
                  onClick={handleSave}
                  disabled={saving || selectedLegs.length < 2}
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
