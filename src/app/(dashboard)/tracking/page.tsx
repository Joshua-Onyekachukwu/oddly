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

type StatusFilter = "all" | "pending" | "won" | "lost" | "void";

const naira = (n: number) =>
  `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function placedLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
}

const MARKETS = [
  "Match Result",
  "Over/Under 2.5",
  "Both Teams to Score",
  "Asian Handicap",
  "Double Chance",
  "Anytime Scorer",
];

export default function TrackingPage() {
  const { user, session } = useAuth();
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [settlingId, setSettlingId] = useState<string | null>(null);

  // Form state
  const [formMarket, setFormMarket] = useState(MARKETS[0]);
  const [formSelection, setFormSelection] = useState("");
  const [formOdds, setFormOdds] = useState("");
  const [formStake, setFormStake] = useState("");
  const [formBookmaker, setFormBookmaker] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const fetchBets = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: queryError } = await supabase
      .from("user_bets")
      .select("*")
      .eq("user_id", user.id)
      .order("placed_at", { ascending: false })
      .limit(100);

    if (queryError) {
      console.error("Failed to fetch bets:", queryError);
      setError("Could not load your bets. Please try again.");
      setBets([]);
    } else {
      setBets((data as Bet[]) || []);
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

    const odds = parseFloat(formOdds);
    const stake = parseFloat(formStake);

    if (!formSelection.trim()) {
      setFormError("Please enter a selection");
      return;
    }
    if (!formOdds || isNaN(odds) || odds < 1.01) {
      setFormError("Odds must be at least 1.01");
      return;
    }
    if (!formStake || isNaN(stake) || stake <= 0) {
      setFormError("Stake must be greater than 0");
      return;
    }

    setFormSaving(true);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("user_bets").insert({
      user_id: user.id,
      market: formMarket,
      selection: formSelection.trim(),
      bookmaker: formBookmaker.trim() || null,
      odds_at_placement: odds,
      stake,
      status: "pending",
    });

    if (insertError) {
      console.error("Failed to record bet:", insertError);
      setFormError("Failed to record bet. Please try again.");
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

  const settleBet = async (bet: Bet, status: "won" | "lost" | "void") => {
    if (!session?.access_token || settlingId) return;
    setSettlingId(bet.id);

    try {
      const res = await fetch(`/api/v1/user/bets/${bet.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();

      if (data.success !== false && res.ok) {
        setBets((prev) =>
          prev.map((b) =>
            b.id === bet.id
              ? { ...b, status, profit: data.data?.profit ?? b.profit, settled_at: new Date().toISOString() }
              : b
          )
        );
      } else {
        console.error("Failed to settle bet:", data);
      }
    } catch (err) {
      console.error("Failed to settle bet:", err);
    } finally {
      setSettlingId(null);
    }
  };

  const filteredBets = filter === "all" ? bets : bets.filter((b) => b.status === filter);

  // Stats
  const totalStake = bets.reduce((acc, b) => acc + (b.stake || 0), 0);
  const settled = bets.filter((b) => b.status !== "pending");
  const totalProfit = settled.reduce((acc, b) => acc + (b.profit || 0), 0);
  const wonBets = bets.filter((b) => b.status === "won").length;
  const winRate = settled.length > 0 ? ((wonBets / settled.length) * 100).toFixed(1) : "0.0";
  const roi = totalStake > 0 ? ((totalProfit / totalStake) * 100).toFixed(1) : "0.0";

  const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "won", label: "Won" },
    { value: "lost", label: "Lost" },
    { value: "void", label: "Void" },
  ];

  return (
    <div>
      <PageHeader
        title="Bet Tracking"
        description="Track your bets, P&L, and performance over time."
        action={
          <Button onClick={() => setShowForm(!showForm)} icon={showForm ? "ri-close-line" : "ri-add-line"} size="sm">
            {showForm ? "Close" : "Place Bet"}
          </Button>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px] mb-[20px]">
        <StatCard label="Total Bets" value={bets.length.toLocaleString()} icon="ri-bookmark-line" color="bg-gray-50 text-gray-600" />
        <StatCard label="Win Rate" value={`${winRate}%`} icon="ri-percent-line" color="bg-blue-50 text-blue-600" />
        <StatCard
          label="Total P&L"
          value={`${totalProfit >= 0 ? "+" : "−"}${naira(Math.abs(totalProfit))}`}
          icon="ri-money-dollar-circle-line"
          color={totalProfit >= 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}
        />
        <StatCard
          label="ROI"
          value={`${parseFloat(roi) >= 0 ? "+" : ""}${roi}%`}
          icon="ri-line-chart-line"
          color={parseFloat(roi) >= 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}
        />
      </div>

      {/* Place Bet Form */}
      {showForm && (
        <Card className="mb-[20px]">
          <div className="flex items-center justify-between mb-[12px]">
            <h3 className="text-[14px] font-semibold text-[#0A0F1C]">Record a Bet</h3>
            <button
              onClick={() => setShowForm(false)}
              aria-label="Close bet form"
              className="text-gray-400 hover:text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30 rounded-[4px] p-[2px]"
            >
              <i className="ri-close-line text-[18px]" />
            </button>
          </div>

          <form onSubmit={handlePlaceBet} className="space-y-[10px]">
            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-[8px] p-[10px] text-[12px] text-red-600" role="alert">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-[10px]">
              <div>
                <label htmlFor="bet-market" className="block text-[11px] font-medium text-gray-500 mb-[4px]">Market</label>
                <select
                  id="bet-market"
                  value={formMarket}
                  onChange={(e) => setFormMarket(e.target.value)}
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                >
                  {MARKETS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="bet-selection" className="block text-[11px] font-medium text-gray-500 mb-[4px]">Selection</label>
                <input
                  id="bet-selection"
                  type="text"
                  value={formSelection}
                  onChange={(e) => setFormSelection(e.target.value)}
                  placeholder="e.g. Arsenal Win"
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 transition-all"
                />
              </div>

              <div>
                <label htmlFor="bet-odds" className="block text-[11px] font-medium text-gray-500 mb-[4px]">Odds</label>
                <input
                  id="bet-odds"
                  type="number"
                  step="0.01"
                  min="1.01"
                  value={formOdds}
                  onChange={(e) => setFormOdds(e.target.value)}
                  placeholder="2.10"
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 font-mono-data transition-all"
                />
              </div>

              <div>
                <label htmlFor="bet-stake" className="block text-[11px] font-medium text-gray-500 mb-[4px]">Stake (₦)</label>
                <input
                  id="bet-stake"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formStake}
                  onChange={(e) => setFormStake(e.target.value)}
                  placeholder="10,000"
                  className="w-full h-[36px] rounded-[8px] border border-gray-200 bg-white px-[10px] text-[12px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B2A4A]/20 font-mono-data transition-all"
                />
              </div>

              <div>
                <label htmlFor="bet-bookmaker" className="block text-[11px] font-medium text-gray-500 mb-[4px]">Bookmaker</label>
                <input
                  id="bet-bookmaker"
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
      <div className="flex gap-[4px] bg-gray-100 rounded-[8px] p-[3px] mb-[14px] w-fit" role="tablist" aria-label="Filter bets by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`
              px-[12px] py-[6px] rounded-[6px] text-[12px] font-semibold transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30
              ${filter === f.value
                ? "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                : "text-gray-400 hover:text-gray-600"
              }
            `}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-[4px] text-[10px] text-gray-300">
                ({bets.filter((b) => b.status === f.value).length})
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
      ) : error ? (
        <EmptyState
          icon="ri-error-warning-line"
          title="Could not load bets"
          description={error}
          action={
            <Button onClick={fetchBets} icon="ri-refresh-line" size="sm" variant="secondary">
              Try again
            </Button>
          }
        />
      ) : filteredBets.length === 0 ? (
        <EmptyState
          icon="ri-bookmark-line"
          title={filter === "all" ? "No bets yet" : `No ${filter} bets`}
          description={
            filter === "all"
              ? "Record your first bet to start tracking performance."
              : "Try a different filter."
          }
          action={
            filter === "all" ? (
              <Button onClick={() => setShowForm(true)} size="sm" icon="ri-add-line">
                Place Bet
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-[4px]">
          {filteredBets.map((bet) => (
            <Card key={bet.id} padding="sm">
              <div className="flex items-center justify-between gap-[10px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px] mb-[2px]">
                    <span className="text-[13px] font-semibold text-[#0A0F1C] truncate">
                      {bet.selection}
                    </span>
                    <span className="text-[10px] text-gray-400 flex-none">{bet.market}</span>
                  </div>
                  <div className="flex items-center gap-[10px] text-[11px] text-gray-400">
                    {bet.bookmaker && <span>{bet.bookmaker}</span>}
                    <span className="font-mono-data">@{bet.odds_at_placement?.toFixed(2) ?? "—"}</span>
                    <span className="font-mono-data">Stake: {bet.stake != null ? naira(bet.stake) : "—"}</span>
                    <span>{placedLabel(bet.placed_at)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-[10px] flex-none">
                  {bet.status !== "pending" && bet.profit != null && (
                    <span
                      className={`text-[13px] font-mono-data font-semibold ${
                        bet.profit > 0 ? "text-green-600" : bet.profit < 0 ? "text-red-500" : "text-gray-400"
                      }`}
                    >
                      {bet.profit > 0 ? "+" : bet.profit < 0 ? "−" : ""}{naira(Math.abs(bet.profit))}
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

              {/* Settle actions for pending bets */}
              {bet.status === "pending" && (
                <div className="flex items-center gap-[6px] mt-[8px] pt-[8px] border-t border-gray-50">
                  <span className="text-[10px] text-gray-400 mr-[2px]">Settle:</span>
                  {(["won", "lost", "void"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => settleBet(bet, s)}
                      disabled={settlingId === bet.id}
                      className={`px-[8px] py-[3px] rounded-[6px] text-[10px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-50
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30
                        ${s === "won" ? "text-green-600 hover:bg-green-50" : s === "lost" ? "text-red-500 hover:bg-red-50" : "text-gray-400 hover:bg-gray-100"}
                      `}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
