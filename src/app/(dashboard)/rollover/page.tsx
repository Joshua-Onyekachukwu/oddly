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
  fixtures?: {
    home_team?: { canonical_name?: string } | null;
    away_team?: { canonical_name?: string } | null;
    kickoff_time?: string;
  } | null;
}

interface Recommendation {
  id: string;
  fixture_id: string;
  prediction_id?: string | null;
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
  const [error, setError] = useState<string | null>(null);
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
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // rollover_chains has no created_at column — order by started_at
    const { data, error: fetchError } = await supabase
      .from("rollover_chains")
      .select(
        "*, rollover_picks(*, fixtures(home_team:teams!fixtures_home_team_id_fkey(canonical_name), away_team:teams!fixtures_away_team_id_fkey(canonical_name), kickoff_time))"
      )
      .eq("user_id", user.id)
      .order("started_at", { ascending: false });

    if (fetchError) {
      console.error("Failed to load rollover chains:", fetchError);
      setError("Unable to load your rollover chains. Please try again.");
    } else if (data) {
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
    const { data, error: recError } = await supabase
      .from("recommendations")
      .select("*")
      .eq("is_recommended", true)
      .eq("is_avoid", false)
      .in("confidence_tier", ["high", "very_high"] as any)
      .order("edge", { ascending: false })
      .limit(25);

    if (recError) {
      console.error("Failed to load recommendations:", recError);
    }

    // Respect the active chain's constraints and skip fixtures already picked
    const active = chains.find((c) => c.status === "active");
    const pickedFixtureIds = new Set(
      (active?.rollover_picks || []).map((p) => p.fixture_id).filter(Boolean)
    );

    const filtered = (data || []).filter((rec: any) => {
      if (pickedFixtureIds.has(rec.fixture_id)) return false;
      if (active?.odds_range_min != null && rec.bookmaker_odds < active.odds_range_min) return false;
      if (active?.odds_range_max != null && rec.bookmaker_odds > active.odds_range_max) return false;
      if (active?.min_probability != null && rec.model_probability < active.min_probability) return false;
      return true;
    });

    setRecommendations(filtered.slice(0, 10));
    setLoadingRecs(false);
  }, [chains]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!startingStake || startingStake <= 0 || !targetDays || targetDays <= 0) return;
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
      // rollover_percentage is decimal(3,2) — a fraction (1.00 = 100%)
      rollover_percentage: 1.0,
      status: "active",
    });

    if (!error) {
      setShowCreate(false);
      setChainName("");
      fetchChains();
    } else {
      console.error("Failed to create chain:", error);
      setError("Unable to create the chain. Please try again.");
    }
    setCreating(false);
  };

  const handleAddPick = async (rec: Recommendation) => {
    const activeChain = chains.find((c) => c.status === "active");
    if (!activeChain || !activeChain.current_balance || activeChain.current_balance <= 0) return;

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
      prediction_id: rec.prediction_id || null,
      market: rec.market,
      selection: rec.selection,
      odds: rec.bookmaker_odds,
      model_probability: rec.model_probability,
      opportunity_score: rec.edge != null ? Math.round(rec.edge * 100) : null,
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
    } else {
      console.error("Failed to add pick:", error);
      setError("Unable to add the pick. Please try again.");
    }
    setAddingPick(null);
  };

  const handleMarkResult = async (pickId: string, result: "won" | "lost") => {
    const supabase = createClient();

    // Find the pick and the chain that owns it (not necessarily the active one)
    const ownerChain = chains.find((c) => c.rollover_picks?.some((p) => p.id === pickId));
    if (!ownerChain) return;
    const pick = ownerChain.rollover_picks?.find((p) => p.id === pickId);
    if (!pick || pick.result !== "pending") return;

    const actualReturn = result === "won" ? (pick.stake || 0) * (pick.odds || 1) : 0;

    // Update pick
    const { error: pickError } = await supabase
      .from("rollover_picks")
      .update({
        result,
        actual_return: actualReturn,
        user_marked: true,
        settled_at: new Date().toISOString(),
      })
      .eq("id", pickId);

    if (pickError) {
      console.error("Failed to settle pick:", pickError);
      setError("Unable to record the result. Please try again.");
      return;
    }

    if (result === "won") {
      // Rollover: the full return becomes the next stake
      await supabase
        .from("rollover_chains")
        .update({ current_balance: actualReturn })
        .eq("id", ownerChain.id);
    } else {
      // Lost pick breaks the chain
      await supabase
        .from("rollover_chains")
        .update({ current_balance: 0, status: "broken", ended_at: new Date().toISOString() })
        .eq("id", ownerChain.id);
    }

    fetchChains();
  };

  const handleBank = async () => {
    const activeChain = chains.find((c) => c.status === "active");
    if (!activeChain || activeChain.current_balance <= 0) return;

    const supabase = createClient();
    const bankAmount = activeChain.current_balance * 0.5;

    const { error: bankError } = await supabase
      .from("rollover_chains")
      .update({
        banked_amount: activeChain.banked_amount + bankAmount,
        current_balance: activeChain.current_balance - bankAmount,
      })
      .eq("id", activeChain.id);

    if (bankError) {
      console.error("Failed to bank funds:", bankError);
      setError("Unable to bank funds. Please try again.");
      return;
    }
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

      {/* Error banner */}
      {error && (
        <div className="mb-[16px] flex items-center justify-between gap-[12px] p-[12px] bg-red-50 border border-red-100 rounded-[10px]">
          <div className="flex items-center gap-[8px]">
            <i className="ri-error-warning-line text-[16px] text-red-400" />
            <span className="text-[12px] text-red-600">{error}</span>
          </div>
          <div className="flex items-center gap-[8px] flex-none">
            {chains.length === 0 && (
              <button
                onClick={fetchChains}
                className="text-[11px] font-semibold text-red-600 bg-white border border-red-200 px-[10px] py-[4px] rounded-[6px] hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                Retry
              </button>
            )}
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="text-red-400 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
            >
              <i className="ri-close-line text-[14px]" />
            </button>
          </div>
        </div>
      )}

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
                            {pick.fixtures?.home_team?.canonical_name && pick.fixtures?.away_team?.canonical_name
                              ? `${pick.fixtures.home_team.canonical_name} vs ${pick.fixtures.away_team.canonical_name}`
                              : pick.selection}
                          </span>
                          <span className="text-[11px] text-gray-400 ml-[6px]">
                            @{pick.odds?.toFixed(2)}
                          </span>
                          {pick.selection && pick.fixtures?.home_team?.canonical_name && (
                            <span className="text-[10px] text-gray-300 ml-[6px]">
                              {pick.selection}
                            </span>
                          )}
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
                              aria-label={`Mark day ${pick.day_number} pick as won`}
                              className="text-[10px] font-medium text-green-600 bg-green-50 hover:bg-green-100 px-[8px] py-[3px] rounded-[4px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                            >
                              Won
                            </button>
                            <button
                              onClick={() => handleMarkResult(pick.id, "lost")}
                              aria-label={`Mark day ${pick.day_number} pick as lost`}
                              className="text-[10px] font-medium text-red-500 bg-red-50 hover:bg-red-100 px-[8px] py-[3px] rounded-[4px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
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
              aria-label="Close add pick panel"
              className="text-gray-400 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
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
                    aria-label={`Add ${rec.selection} to chain`}
                    className="ml-[12px] px-[10px] py-[5px] bg-[#1B2A4A] text-white text-[11px] font-medium rounded-[6px] hover:bg-[#243B53] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
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
                <label htmlFor="chain-name" className="block text-[11px] font-medium text-gray-500 mb-[4px]">Name</label>
                <input
                  id="chain-name"
                  type="text"
                  value={chainName}
                  onChange={(e) => setChainName(e.target.value)}
                  placeholder={`Chain #${chains.length + 1}`}
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
              <div>
                <label htmlFor="chain-stake" className="block text-[11px] font-medium text-gray-500 mb-[4px]">Starting Stake</label>
                <input
                  id="chain-stake"
                  type="number"
                  min="1"
                  step="1"
                  value={startingStake}
                  onChange={(e) => setStartingStake(parseFloat(e.target.value))}
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] font-mono-data focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
              <div>
                <label htmlFor="chain-days" className="block text-[11px] font-medium text-gray-500 mb-[4px]">Target Days</label>
                <input
                  id="chain-days"
                  type="number"
                  min="1"
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
                // Bar height reflects the stake multiple: actual return multiple
                // for settled picks, odds-implied for pending, minimal for losses.
                const multiple =
                  pick.result === "won" && pick.stake && pick.actual_return
                    ? pick.actual_return / pick.stake
                    : pick.result === "lost"
                    ? 0
                    : pick.result === "pending"
                    ? (pick.odds || 2) / 2
                    : 0.5;
                const barPct = Math.min(Math.max(multiple / 2.5, 0.08), 1);
                return (
                  <div key={pick.id} className="flex-1 flex flex-col items-center gap-[2px]">
                    <div
                      className={`w-full rounded-[2px] transition-all ${
                        pick.result === "won" ? "bg-green-500" : pick.result === "lost" ? "bg-red-400" : "bg-gray-200"
                      }`}
                      style={{ height: `${barPct * 60}px` }}
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
      {!loading && !error && chains.length === 0 && !showCreate && (
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
