"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";

interface RolloverChain {
  id: string;
  name: string;
  starting_stake: number;
  current_balance: number;
  banked_amount: number;
  target_days: number;
  current_day: number;
  odds_range_min: number;
  odds_range_max: number;
  min_probability: number;
  status: "active" | "completed" | "broken" | "paused";
  started_at: string;
  ended_at: string | null;
  rollover_picks?: RolloverPick[];
}

interface RolloverPick {
  id: string;
  day_number: number;
  market: string;
  selection: string;
  odds: number;
  model_probability: number;
  stake: number;
  potential_return: number;
  result: "pending" | "won" | "lost" | "skipped";
  actual_return: number | null;
}

export default function RolloverPage() {
  const { user, profile } = useAuth();
  const [chains, setChains] = useState<RolloverChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedChain, setSelectedChain] = useState<RolloverChain | null>(null);

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
      // Auto-select active chain
      const active = data.find((c) => c.status === "active");
      if (active && !selectedChain) setSelectedChain(active);
    }
    setLoading(false);
  }, [user, selectedChain]);

  useEffect(() => {
    fetchChains();
  }, [fetchChains]);

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
      status: "active",
    });

    if (!error) {
      setShowCreate(false);
      setChainName("");
      fetchChains();
    }
    setCreating(false);
  };

  const activeChain = chains.find((c) => c.status === "active");
  const completedChains = chains.filter((c) => c.status === "completed");
  const brokenChains = chains.filter((c) => c.status === "broken");

  const progressPercent = activeChain
    ? Math.round((activeChain.current_day / activeChain.target_days) * 100)
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
            Rollover Challenge
          </h1>
          <p className="text-[14px] text-gray-500">
            Daily Crown Jewel picks at ~2.0 odds. Compound your stake over {activeChain?.target_days || 30} days.
          </p>
        </div>
        {!activeChain && (
          <button
            onClick={() => setShowCreate(true)}
            className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all duration-300 hover:bg-[#243B53] active:scale-[0.98] flex items-center gap-[6px]"
          >
            <i className="ri-add-line text-[14px]"></i>
            Start Chain
          </button>
        )}
      </div>

      {/* Active Chain */}
      {activeChain && (
        <div className="bg-white rounded-[16px] p-[24px] border border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] mb-[24px]">
          <div className="flex items-center justify-between mb-[20px]">
            <div>
              <div className="flex items-center gap-[8px] mb-[4px]">
                <h2 className="font-display text-[18px] font-bold text-[#0A0F1C]">
                  {activeChain.name}
                </h2>
                <span className="flex items-center gap-[4px] text-[10px] font-semibold text-[#22c55e] bg-[#22c55e]/8 px-[8px] py-[3px] rounded-full">
                  <span className="w-[4px] h-[4px] rounded-full bg-[#22c55e] animate-pulse"></span>
                  Active
                </span>
              </div>
              <p className="text-[12px] text-gray-400">
                Started {new Date(activeChain.started_at).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[20px]">
            <div className="p-[14px] bg-gray-50 rounded-[12px]">
              <span className="block text-[10px] text-gray-400 mb-[4px]">Current Balance</span>
              <span className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">
                ${activeChain.current_balance.toFixed(2)}
              </span>
            </div>
            <div className="p-[14px] bg-gray-50 rounded-[12px]">
              <span className="block text-[10px] text-gray-400 mb-[4px]">Banked</span>
              <span className="text-[18px] font-mono-data font-bold text-green-600">
                ${activeChain.banked_amount.toFixed(2)}
              </span>
            </div>
            <div className="p-[14px] bg-gray-50 rounded-[12px]">
              <span className="block text-[10px] text-gray-400 mb-[4px]">Day</span>
              <span className="text-[18px] font-mono-data font-bold text-[#0A0F1C]">
                {activeChain.current_day}/{activeChain.target_days}
              </span>
            </div>
            <div className="p-[14px] bg-gray-50 rounded-[12px]">
              <span className="block text-[10px] text-gray-400 mb-[4px]">Return</span>
              <span className="text-[18px] font-mono-data font-bold text-[#BFFF00]">
                {((activeChain.current_balance / activeChain.starting_stake - 1) * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-[8px]">
            <div className="flex items-center justify-between mb-[6px]">
              <span className="text-[11px] text-gray-400">Progress</span>
              <span className="text-[11px] font-mono-data text-gray-400">{progressPercent}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-[6px]">
              <div
                className="bg-[#1B2A4A] h-[6px] rounded-full transition-all duration-1000"
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </div>

          {/* Recent picks */}
          {activeChain.rollover_picks && activeChain.rollover_picks.length > 0 && (
            <div className="mt-[16px]">
              <h3 className="text-[13px] font-semibold text-[#0A0F1C] mb-[10px]">Recent Picks</h3>
              <div className="space-y-[6px]">
                {activeChain.rollover_picks
                  .sort((a, b) => b.day_number - a.day_number)
                  .slice(0, 5)
                  .map((pick) => (
                    <div
                      key={pick.id}
                      className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[10px]"
                    >
                      <div className="flex items-center gap-[10px]">
                        <span className="text-[10px] font-mono-data text-gray-400 w-[30px]">
                          D{pick.day_number}
                        </span>
                        <div>
                          <span className="text-[12px] font-medium text-[#0A0F1C]">
                            {pick.selection}
                          </span>
                          <span className="text-[11px] text-gray-400 ml-[6px]">
                            @{pick.odds?.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full ${
                          pick.result === "won"
                            ? "text-green-600 bg-green-50"
                            : pick.result === "lost"
                            ? "text-red-600 bg-red-50"
                            : "text-gray-400 bg-gray-100"
                        }`}
                      >
                        {pick.result.toUpperCase()}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white rounded-[16px] p-[20px] border border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.03)] mb-[24px]">
          <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[16px]">
            Start a New Rollover Chain
          </h3>
          <form onSubmit={handleCreate} className="space-y-[12px]">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
              <div>
                <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">Name</label>
                <input
                  type="text"
                  value={chainName}
                  onChange={(e) => setChainName(e.target.value)}
                  placeholder={`Chain #${chains.length + 1}`}
                  className="w-full h-[38px] rounded-[10px] border border-gray-200 bg-white px-[12px] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">Starting Stake</label>
                <input
                  type="number"
                  step="1"
                  value={startingStake}
                  onChange={(e) => setStartingStake(parseFloat(e.target.value))}
                  className="w-full h-[38px] rounded-[10px] border border-gray-200 bg-white px-[12px] text-[13px] font-mono-data focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-gray-500 mb-[4px]">Target Days</label>
                <input
                  type="number"
                  step="1"
                  value={targetDays}
                  onChange={(e) => setTargetDays(parseInt(e.target.value))}
                  className="w-full h-[38px] rounded-[10px] border border-gray-200 bg-white px-[12px] text-[13px] font-mono-data focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
            </div>
            <div className="flex justify-end gap-[8px]">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="h-[36px] px-[16px] rounded-[10px] text-[13px] font-medium text-gray-500 hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="h-[36px] px-[16px] rounded-[10px] bg-[#1B2A4A] text-white text-[13px] font-semibold transition-all hover:bg-[#243B53] active:scale-[0.98] disabled:opacity-50 flex items-center gap-[6px]"
              >
                {creating ? (
                  <div className="w-[14px] h-[14px] border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  "Start Challenge"
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Past chains */}
      {chains.length > 0 && (
        <div>
          <h2 className="text-[14px] font-semibold text-[#0A0F1C] mb-[12px]">Past Chains</h2>
          {chains.filter((c) => c.status !== "active").length === 0 ? (
            <p className="text-[13px] text-gray-400 py-[20px]">
              No completed chains yet. Keep going!
            </p>
          ) : (
            <div className="space-y-[8px]">
              {chains
                .filter((c) => c.status !== "active")
                .map((chain) => (
                  <div
                    key={chain.id}
                    className="bg-white rounded-[14px] p-[16px] border border-gray-100 shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-[8px] mb-[4px]">
                          <span className="text-[13px] font-semibold text-[#0A0F1C]">
                            {chain.name}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-[6px] py-[2px] rounded-full ${
                              chain.status === "completed"
                                ? "text-green-600 bg-green-50"
                                : "text-red-600 bg-red-50"
                            }`}
                          >
                            {chain.status.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-[11px] text-gray-400">
                          {chain.current_day}/{chain.target_days} days · ${chain.starting_stake} → ${chain.current_balance.toFixed(2)}
                        </span>
                      </div>
                      <span
                        className={`text-[14px] font-mono-data font-bold ${
                          chain.current_balance >= chain.starting_stake
                            ? "text-green-600"
                            : "text-red-500"
                        }`}
                      >
                        {chain.current_balance >= chain.starting_stake ? "+" : ""}
                        {((chain.current_balance / chain.starting_stake - 1) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-[48px]">
          <div className="w-[32px] h-[32px] border-2 border-gray-200 border-t-[#1B2A4A] rounded-full animate-spin mx-auto"></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && chains.length === 0 && !showCreate && (
        <div className="text-center py-[48px] bg-white rounded-[16px] border border-gray-100">
          <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-[#D97706]/8 mb-[12px]">
            <i className="ri-trophy-line text-[22px] text-[#D97706]"></i>
          </div>
          <h3 className="font-display text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
            Start your first rollover chain
          </h3>
          <p className="text-[13px] text-gray-400 mb-[16px] max-w-[300px] mx-auto">
            Pick the Crown Jewel each day at ~2.0 odds and compound your stake. The AI finds the safest single pick daily.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="h-[36px] px-[20px] rounded-[10px] bg-[#D97706] text-white text-[13px] font-semibold transition-all hover:bg-[#B45309] active:scale-[0.98]"
          >
            Start Challenge
          </button>
        </div>
      )}
    </div>
  );
}
