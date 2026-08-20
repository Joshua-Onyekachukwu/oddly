"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, EmptyState, StatCard, Button, Badge } from "@/components/ui";

interface Bet {
  id: string;
  market: string;
  selection: string;
  bookmaker: string | null;
  odds_at_placement: number | null;
  stake: number | null;
  status: "pending" | "won" | "lost" | "void";
  profit: number | null;
  placed_at: string;
  settled_at: string | null;
}

export default function TrackingPage() {
  const { user } = useAuth();
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "won" | "lost">("all");

  // Form state
  const [formMarket, setFormMarket] = useState("Match Result");
  const [formSelection, setFormSelection] = useState("");
  const [formOdds, setFormOdds] = useState("");
  const [formStake, setFormStake] = useState("");
  const [formBookmaker, setFormBookmaker] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchBets = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_bets")
      .select("*")
      .eq("user_id", user.id)
      .order("placed_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      setBets(data);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchBets();
  }, [fetchBets]);

  const handlePlaceBet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setFormError("");

    if (!formSelection || !formOdds || !formStake) {
      setFormError("Please fill in selection, odds, and stake");
      return;
    }

    setFormSaving(true);

    const supabase = createClient();
    const { error } = await supabase.from("user_bets").insert({
      user_id: user.id,
      market: formMarket,
      selection: formSelection,
      bookmaker: formBookmaker || null,
      odds_at_placement: parseFloat(formOdds),
      stake: parseFloat(formStake),
      status: "pending",
    });

    if (error) {
      setFormError("Failed to place bet. Please try again.");
    } else {
      setShowForm(false);
      setFormSelection("");
      setFormOdds("");
      setFormStake("");
      setFormBookmaker("");
      fetchBets();
    }

    setFormSaving(false);
  };

  const filteredBets = filter === "all" ? bets : bets.filter((b) => b.status === filter);

  // Stats
  const totalStake = bets.reduce((acc, b) => acc + (b.stake || 0), 0);
  const totalProfit = bets
    .filter((b) => b.status !== "pending")
    .reduce((acc, b) => acc + (b.profit || 0), 0);
  const wonBets = bets.filter((b) => b.status === "won").length;
  const settledBets = bets.filter((b) => b.status !== "pending").length;
  const winRate = settledBets > 0 ? ((wonBets / settledBets) * 100).toFixed(1) : "0.0";
  const roi = totalStake > 0 ? ((totalProfit / totalStake) * 100).toFixed(1) : "0.0";

  return (
    <div>
      <PageHeader
        title="Bet Tracking"
        description="Track your bets, P&L, and performance over time."
        action={
          <Button onClick={() => setShowForm(!showForm)} icon="ri-add-line" size="sm">
            Place Bet
          </Button>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-[20px]">
        <StatCard label="Total Bets" value={bets.length.toString()} icon="ri-number-1" color="bg-gray-50 text-gray-600" />
        <StatCard label="Win Rate" value={`${winRate}%`} icon="ri-percent-line" color="bg-blue-50 text-blue-600" />
        <StatCard
          label="Total P&L"
          value={`${totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)}`}
          icon="ri-money-dollar-circle-line"
          color={totalProfit >= 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}
        />
        <StatCard
          label="ROI"
          value={`${roi}%`}
          icon="ri-line-chart-line"
          color={parseFloat(roi) >= 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}
        />
      </div>

      {/* Place Bet Form */}
      {showForm && (
        <Card className="mb-[20px]">
          <div className="flex items-center justify-between mb-[12px]">
            <h3 className="text-[14px] font-semibold text-[#0A0F1C]">Record a Bet</h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
              <i className="ri-close-line text-[18px]" />
            </button>
          </div>

          <form onSubmit={handlePlaceBet} className="space-y-[10px]">
            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-[8px] p-[10px] text-[12px] text-red-600">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-[10px]">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-[4px]">Market</label>
                <select
                  value={formMarket}
                  onChange={(e) => setFormMarket(e.target.value)}
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                >
                  <option>Match Result</option>
                  <option>Over/Under 2.5</option>
                  <option>Both Teams to Score</option>
                  <option>Asian Handicap</option>
                  <option>Double Chance</option>
                  <option>Anytime Scorer</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-[4px]">Selection</label>
                <input
                  type="text"
                  value={formSelection}
                  onChange={(e) => setFormSelection(e.target.value)}
                  placeholder="e.g. Arsenal Win"
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-[4px]">Odds</label>
                <input
                  type="number"
                  step="0.01"
                  value={formOdds}
                  onChange={(e) => setFormOdds(e.target.value)}
                  placeholder="2.10"
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 font-mono-data transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-[4px]">Stake</label>
                <input
                  type="number"
                  step="0.01"
                  value={formStake}
                  onChange={(e) => setFormStake(e.target.value)}
                  placeholder="10.00"
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 font-mono-data transition-all"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-500 mb-[4px]">Bookmaker</label>
                <input
                  type="text"
                  value={formBookmaker}
                  onChange={(e) => setFormBookmaker(e.target.value)}
                  placeholder="e.g. Bet365"
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>
            </div>

            <div className="flex justify-end gap-[8px] pt-[4px]">
              <Button type="button" onClick={() => setShowForm(false)} variant="ghost" size="sm">
                Cancel
              </Button>
              <Button type="submit" loading={formSaving} size="sm">
                Record Bet
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Filter tabs */}
      <div className="flex gap-[4px] bg-gray-100 rounded-[8px] p-[3px] mb-[14px] w-fit">
        {(["all", "pending", "won", "lost"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`
              px-[12px] py-[6px] rounded-[6px] text-[12px] font-semibold transition-all
              ${filter === f
                ? "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                : "text-gray-400 hover:text-gray-600"
              }
            `}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f !== "all" && (
              <span className="ml-[4px] text-[10px] text-gray-300">
                ({bets.filter((b) => b.status === f).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bets list */}
      {loading ? (
        <div className="space-y-[6px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padding="sm" className="animate-pulse">
              <div className="flex items-center justify-between">
                <div className="space-y-[6px]">
                  <div className="h-[12px] w-[140px] bg-gray-100 rounded-full" />
                  <div className="h-[11px] w-[100px] bg-gray-100 rounded-full" />
                </div>
                <div className="h-[22px] w-[56px] bg-gray-100 rounded-full" />
              </div>
            </Card>
          ))}
        </div>
      ) : filteredBets.length === 0 ? (
        <EmptyState
          icon="ri-bookmark-line"
          title={filter === "all" ? "No bets yet" : `No ${filter} bets`}
          description={
            filter === "all"
              ? "Record your first bet to start tracking performance."
              : "Try a different filter."
          }
        />
      ) : (
        <div className="space-y-[4px]">
          {filteredBets.map((bet) => (
            <Card key={bet.id} padding="sm">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px] mb-[2px]">
                    <span className="text-[13px] font-semibold text-[#0A0F1C] truncate">
                      {bet.selection}
                    </span>
                    <span className="text-[10px] text-gray-400">{bet.market}</span>
                  </div>
                  <div className="flex items-center gap-[10px] text-[11px] text-gray-400">
                    {bet.bookmaker && <span>{bet.bookmaker}</span>}
                    <span className="font-mono-data">@{bet.odds_at_placement?.toFixed(2)}</span>
                    <span className="font-mono-data">Stake: ${bet.stake?.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-[10px]">
                  {bet.status !== "pending" && bet.profit != null && (
                    <span
                      className={`text-[13px] font-mono-data font-semibold ${
                        bet.profit >= 0 ? "text-green-600" : "text-red-500"
                      }`}
                    >
                      {bet.profit >= 0 ? "+" : ""}${bet.profit.toFixed(2)}
                    </span>
                  )}
                  <Badge
                    variant={
                      bet.status === "won" ? "success" : bet.status === "lost" ? "danger" : bet.status === "void" ? "default" : "warning"
                    }
                    size="sm"
                  >
                    {bet.status.toUpperCase()}
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
