"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, EmptyState, Button, Badge } from "@/components/ui";

interface RolloverChain {
  id: string;
  user_id: string | null;
  name: string | null;
  starting_stake: number;
  current_balance: number;
  banked_amount: number;
  target_days: number | null;
  current_day: number;
  odds_range_min: number | null;
  odds_range_max: number | null;
  min_probability: number | null;
  rollover_percentage: number;
  status: string;
  started_at: string;
  ended_at: string | null;
  rollover_picks?: RolloverPick[];
}

interface RolloverPick {
  id: string;
  chain_id: string | null;
  day_number: number;
  fixture_id: string | null;
  prediction_id: string | null;
  market: string | null;
  selection: string | null;
  odds: number | null;
  model_probability: number | null;
  opportunity_score: number | null;
  stake: number | null;
  potential_return: number | null;
  result: string;
  actual_return: number | null;
  user_marked: boolean;
  settled_at: string | null;
  fixtures?: { home_team_name: string; away_team_name: string; kickoff_time: string } | null;
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
}

export default function RolloverPage() {
  const { user } = useAuth();
  const [chains, setChains] = useState<RolloverChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddPick, setShowAddPick] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [addingPick, setAddingPick] = useState<string | null>(null);

  // Create form
  const [chainName, setChainName] = useState("");
  const [startingStake, setStartingStake] = useState(10);
  const [targetDays, setTargetDays] = useState(30);
  const [creating, setCreating] = useState(false);

  const fetchChains = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("rollover_chains")
      .select("*, rollover_picks(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setChains(data);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchChains();
  }, [fetchChains]);

  const fetchRecommendations = useCallback(async () => {
    setLoadingRecs(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("recommendations")
      .select("*")
      .eq("is_recommended", true)
      .order("edge", { ascending: false })
      .limit(10);

    if (data) setRecommendations(data);
    setLoadingRecs(false);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCreating(true);

    const supabase = createClient();
    const { error } = await supabase.from("rollover_chains").insert({
      user_id: user.id,
      name: chainName || `Chain #${chains.length + 1}`,
      starting_stake: startingStake,
      current_balance: startingStake,
      target_days: targetDays,
      odds_range_min: 2.0,
      odds_range_max: 2.5,
      min_probability: 0.9,
      rollover_percentage: 100,
      status: "active",
    });

    if (!error) {
      setShowCreate(false);
      setChainName("");
      fetchChains();
    }
    setCreating(false);
  };

  const handleAddPick = async (rec: Recommendation) => {
    const activeChain = chains.find((c) => c.status === "active");
    if (!activeChain) return;

    setAddingPick(rec.id);
    const supabase = createClient();

    // Calculate next day number
    const existingPicks = activeChain.rollover_picks || [];
    const nextDay = existingPicks.length > 0
      ? Math.max(...existingPicks.map((p) => p.day_number)) + 1
      : 1;

    const stake = activeChain.current_balance;
    const potentialReturn = stake * rec.bookmaker_odds;

    const { error } = await supabase.from("rollover_picks").insert({
      chain_id: activeChain.id,
      day_number: nextDay,
      fixture_id: rec.fixture_id,
      market: rec.market,
      selection: rec.selection,
      odds: rec.bookmaker_odds,
      model_probability: rec.model_probability,
      opportunity_score: rec.edge,
      stake: stake,
      potential_return: potentialReturn,
      result: "pending",
      user_marked: false,
    });

    if (!error) {
      // Update chain current_day
      await supabase
        .from("rollover_chains")
        .update({ current_day: nextDay })
        .eq("id", activeChain.id);

      fetchChains();
      setShowAddPick(false);
    }
    setAddingPick(null);
  };

  const handleMarkResult = async (pickId: string, result: "won" | "lost") => {
    const supabase = createClient();
    const activeChain = chains.find((c) => c.status === "active");
    if (!activeChain) return;

    // Get the pick
    const pick = activeChain.rollover_picks?.find((p) => p.id === pickId);
    if (!pick) return;

    const actualReturn = result === "won" ? (pick.stake || 0) * (pick.odds || 1) : 0;

    // Update pick
    await supabase
      .from("rollover_picks")
      .update({ result, actual_return: actualReturn, settled_at: new Date().toISOString() })
      .eq("id", pickId);

    // Update chain balance
    const newBalance = result === "won" ? actualReturn : 0;
    const newBanked = activeChain.banked_amount + (result === "won" ? actualReturn * 0.5 : 0);

    await supabase
      .from("rollover_chains")
      .update({
        current_balance: newBalance,
        banked_amount: newBanked,
      })
      .eq("id", activeChain.id);

    // If lost, mark chain as broken
    if (result === "lost") {
      await supabase
        .from("rollover_chains")
        .update({ status: "broken", ended_at: new Date().toISOString() })
        .eq("id", activeChain.id);
    }

    fetchChains();
  };

  const handleBank = async () => {
    const activeChain = chains.find((c) => c.status === "active");
    if (!activeChain) return;

    const supabase = createClient();
    const bankAmount = activeChain.current_balance * 0.5;

    await supabase
      .from("rollover_chains")
      .update({
        banked_amount: activeChain.banked_amount + bankAmount,
        current_balance: activeChain.current_balance - bankAmount,
      })
      .eq("id", activeChain.id);

    fetchChains();
  };

  const activeChain = chains.find((c) => c.status === "active");
  const progressPercent = activeChain
    ? Math.round((activeChain.current_day / (activeChain.target_days || 30)) * 100)
    : 0;

  return (
    <div>
      <PageHeader
        title="Rollover Challenge"
        description={`Daily picks at ~2.0 odds. Compound your stake over ${activeChain?.target_days || 30} days.`}
        action={
          !activeChain ? (
            <Button onClick={() => setShowCreate(true)} icon="ri-add-line" size="sm">
              Start Chain
            </Button>
          ) : (
            <Button onClick={() => { setShowAddPick(true); fetchRecommendations(); }} icon="ri-add-circle-line" size="sm">
              Add Today's Pick
            </Button>
          )
        }
      />

      {/* Active Chain */}
      {activeChain && (
        <Card className="mb-[20px]">
          <div className="flex items-center justify-between mb-[16px]">
            <div>
              <div className="flex items-center gap-[8px] mb-[2px]">
                <h2 className="text-[16px] font-display font-bold text-[#0A0F1C]">
                  {activeChain.name}
                </h2>
                <Badge variant="success" dot>Active</Badge>
              </div>
              <p className="text-[11px] text-gray-400">
                Started {new Date(activeChain.started_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-[6px]">
              {activeChain.current_balance > 0 && (
                <Button onClick={handleBank} variant="ghost" size="sm" icon="ri-safe-2-line">
                  Bank 50%
                </Button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-[16px]">
            {[
              { label: "Current Balance", value: `$${activeChain.current_balance.toFixed(2)}` },
              { label: "Banked", value: `$${activeChain.banked_amount.toFixed(2)}`, color: "text-green-600" },
              { label: "Day", value: `${activeChain.current_day}/${activeChain.target_days}` },
              { label: "Return", value: `${((activeChain.current_balance / activeChain.starting_stake - 1) * 100).toFixed(1)}%`, color: activeChain.current_balance >= activeChain.starting_stake ? "text-green-600" : "text-red-500" },
            ].map((stat) => (
              <div key={stat.label} className="p-[12px] bg-gray-50 rounded-[8px]">
                <span className="block text-[10px] text-gray-400 mb-[2px]">{stat.label}</span>
                <span className={`text-[16px] font-mono-data font-bold ${stat.color || "text-[#0A0F1C]"}`}>
                  {stat.value}
                </span>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div className="mb-[4px]">
            <div className="flex items-center justify-between mb-[4px]">
              <span className="text-[10px] text-gray-400">Progress</span>
              <span className="text-[10px] font-mono-data text-gray-400">{progressPercent}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-[4px]">
              <div
                className="bg-[#1B2A4A] h-[4px] rounded-full transition-all duration-1000"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* All picks */}
          {activeChain.rollover_picks && activeChain.rollover_picks.length > 0 && (
            <div className="mt-[16px]">
              <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-[8px]">
                All Picks ({activeChain.rollover_picks.length})
              </h3>
              <div className="space-y-[4px]">
                {activeChain.rollover_picks
                  .sort((a, b) => b.day_number - a.day_number)
                  .map((pick) => (
                    <div
                      key={pick.id}
                      className="flex items-center justify-between p-[8px] bg-gray-50 rounded-[8px]"
                    >
                      <div className="flex items-center gap-[8px]">
                        <span className="text-[10px] font-mono-data text-gray-400 w-[28px]">
                          D{pick.day_number}
                        </span>
                        <div>
                          <span className="text-[12px] font-medium text-[#0A0F1C]">
                            {pick.selection}
                          </span>
                          <span className="text-[11px] text-gray-400 ml-[6px]">
                            @{pick.odds?.toFixed(2)}
                          </span>
                          {pick.stake && (
                            <span className="text-[10px] text-gray-300 ml-[6px]">
                              ${pick.stake.toFixed(2)} stake
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-[4px]">
                        {pick.result === "pending" ? (
                          <>
                            <button
                              onClick={() => handleMarkResult(pick.id, "won")}
                              className="text-[10px] font-medium text-green-600 bg-green-50 hover:bg-green-100 px-[8px] py-[3px] rounded-[4px] transition-colors"
                            >
                              Won
                            </button>
                            <button
                              onClick={() => handleMarkResult(pick.id, "lost")}
                              className="text-[10px] font-medium text-red-500 bg-red-50 hover:bg-red-100 px-[8px] py-[3px] rounded-[4px] transition-colors"
                            >
                              Lost
                            </button>
                          </>
                        ) : (
                          <Badge
                            variant={pick.result === "won" ? "success" : "danger"}
                            size="sm"
                          >
                            {pick.result.toUpperCase()}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Add Pick Modal */}
      {showAddPick && (
        <Card className="mb-[20px]">
          <div className="flex items-center justify-between mb-[12px]">
            <h3 className="text-[14px] font-semibold text-[#0A0F1C]">
              Add Today's Pick
            </h3>
            <button
              onClick={() => setShowAddPick(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <i className="ri-close-line text-[18px]" />
            </button>
          </div>
          <p className="text-[12px] text-gray-400 mb-[12px]">
            Select a value bet to add to your rollover chain. Picks should be around 2.0 odds for optimal compounding.
          </p>

          {loadingRecs ? (
            <div className="space-y-[4px]">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[48px] bg-gray-50 rounded-[8px] animate-pulse" />
              ))}
            </div>
          ) : recommendations.length === 0 ? (
            <div className="text-center py-[16px] text-gray-400 text-[12px]">
              No value bets available right now. Check back when matches are closer to kickoff.
            </div>
          ) : (
            <div className="space-y-[4px]">
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px] hover:bg-gray-100/80 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-[6px] mb-[1px]">
                      <span className="text-[12px] font-medium text-[#0A0F1C] truncate">
                        {rec.selection}
                      </span>
                      <span className="text-[10px] text-gray-400">{rec.market}</span>
                    </div>
                    <div className="flex items-center gap-[8px] text-[11px] text-gray-400">
                      <span className="font-mono-data">@{rec.bookmaker_odds.toFixed(2)}</span>
                      <span className="text-green-600 font-mono-data font-medium">
                        +{(rec.edge * 100).toFixed(1)}% edge
                      </span>
                      <span className="font-mono-data">
                        {(rec.model_probability * 100).toFixed(0)}% prob
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleAddPick(rec)}
                    disabled={addingPick === rec.id}
                    className="ml-[12px] px-[10px] py-[5px] bg-[#1B2A4A] text-white text-[11px] font-medium rounded-[6px] hover:bg-[#243B53] transition-colors disabled:opacity-50"
                  >
                    {addingPick === rec.id ? "Adding..." : "Add Pick"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Create Form */}
      {showCreate && (
        <Card className="mb-[20px]">
          <h3 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">
            Start a New Rollover Chain
          </h3>
          <form onSubmit={handleCreate} className="space-y-[10px]">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[10px]">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-[4px]">Name</label>
                <input
                  type="text"
                  value={chainName}
                  onChange={(e) => setChainName(e.target.value)}
                  placeholder={`Chain #${chains.length + 1}`}
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-[4px]">Starting Stake</label>
                <input
                  type="number"
                  step="1"
                  value={startingStake}
                  onChange={(e) => setStartingStake(parseFloat(e.target.value))}
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] font-mono-data focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-[4px]">Target Days</label>
                <input
                  type="number"
                  step="1"
                  value={targetDays}
                  onChange={(e) => setTargetDays(parseInt(e.target.value))}
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] font-mono-data focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
            </div>
            <div className="flex justify-end gap-[8px] pt-[4px]">
              <Button type="button" onClick={() => setShowCreate(false)} variant="ghost" size="sm">
                Cancel
              </Button>
              <Button type="submit" loading={creating} size="sm">
                Start Challenge
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Bankroll Chart */}
      {activeChain && activeChain.rollover_picks && activeChain.rollover_picks.length > 1 && (
        <Card className="mb-[20px]">
          <h3 className="text-[13px] font-semibold text-[#0A0F1C] mb-[12px]">Bankroll History</h3>
          <div className="flex items-end gap-[3px] h-[80px]">
            {activeChain.rollover_picks
              .sort((a, b) => a.day_number - b.day_number)
              .map((pick) => {
                const return_pct = pick.result === "won"
                  ? ((activeChain.rollover_percentage || 100) / 100)
                  : pick.result === "lost" ? 0 : 0.5;
                return (
                  <div key={pick.id} className="flex-1 flex flex-col items-center gap-[2px]">
                    <div
                      className={`w-full rounded-[2px] transition-all ${
                        pick.result === "won" ? "bg-green-500" : pick.result === "lost" ? "bg-red-400" : "bg-gray-200"
                      }`}
                      style={{ height: `${Math.max(return_pct * 60, 3)}px` }}
                    />
                    <span className="text-[7px] text-gray-300 font-mono-data">D{pick.day_number}</span>
                  </div>
                );
              })}
          </div>
          <div className="flex items-center gap-[12px] mt-[8px]">
            <span className="flex items-center gap-[4px] text-[10px] text-gray-400">
              <span className="w-[6px] h-[6px] rounded-[2px] bg-green-500" /> Won
            </span>
            <span className="flex items-center gap-[4px] text-[10px] text-gray-400">
              <span className="w-[6px] h-[6px] rounded-[2px] bg-red-400" /> Lost
            </span>
          </div>
        </Card>
      )}

      {/* Past chains */}
      {chains.filter((c) => c.status !== "active").length > 0 && (
        <div>
          <h2 className="text-[13px] font-semibold text-gray-500 uppercase tracking-wider mb-[10px]">
            Past Chains
          </h2>
          <div className="space-y-[6px]">
            {chains
              .filter((c) => c.status !== "active")
              .map((chain) => (
                <Card key={chain.id} padding="sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-[6px] mb-[2px]">
                        <span className="text-[13px] font-semibold text-[#0A0F1C]">
                          {chain.name}
                        </span>
                        <Badge variant={chain.status === "completed" ? "success" : chain.status === "broken" ? "danger" : "default"} size="sm">
                          {chain.status.toUpperCase()}
                        </Badge>
                      </div>
                      <span className="text-[11px] text-gray-400">
                        {chain.current_day}/{chain.target_days} days · ${chain.starting_stake} → ${chain.current_balance.toFixed(2)}
                      </span>
                    </div>
                    <span
                      className={`text-[14px] font-mono-data font-bold ${
                        chain.current_balance >= chain.starting_stake ? "text-green-600" : "text-red-500"
                      }`}
                    >
                      {chain.current_balance >= chain.starting_stake ? "+" : ""}
                      {((chain.current_balance / chain.starting_stake - 1) * 100).toFixed(1)}%
                    </span>
                  </div>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-[48px]">
          <div className="w-[24px] h-[24px] border-2 border-gray-200 border-t-[#1B2A4A] rounded-full animate-spin mx-auto" />
        </div>
      )}

      {/* Empty state */}
      {!loading && chains.length === 0 && !showCreate && (
        <EmptyState
          icon="ri-trophy-line"
          title="Start your first rollover chain"
          description="Pick the best value bet each day at ~2.0 odds and compound your stake."
          action={
            <Button onClick={() => setShowCreate(true)} size="sm">
              Start Challenge
            </Button>
          }
        />
      )}
    </div>
  );
}
