"use client";

import * as React from "react";
import { useAuth } from "@/providers/AuthProvider";

interface Recommendation {
  fixtureId: string;
  match: string;
  league: string;
  kickoff: string;
  kickoffLocal: string;
  market: string;
  selection: string;
  selectionName: string;
  modelProbability: number;
  bookmakerOdds: number;
  impliedProbability: number;
  edge: number;
  expectedValue: number;
  confidence: string;
  tier: string;
  reasoning: string;
}

interface BetslipSelection {
  fixtureId: string;
  match: string;
  market: string;
  selection: string;
  odds: number;
  modelProbability: number;
  edge: number;
  tier: string;
  reasoning: string;
}

interface Betslip {
  id: string;
  createdAt: string;
  bookmaker: string;
  selections: BetslipSelection[];
  summary: {
    totalLegs: number;
    combinedOdds: number;
    stake: number;
    potentialReturn: number;
    profit: number;
    combinedProbability: number;
    avgEdge: number;
    riskLevel: string;
    kellyStake: number;
  };
  risk: {
    approved: boolean;
    riskScore: number;
    risks: { level: string; message: string }[];
  };
  warnings: string[];
  status: string;
  instructions: string;
}

const TIER_COLORS: Record<string, string> = {
  ELITE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  HIGH: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  VALUE: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  WATCH: "bg-white/10 text-white/60 border-white/20",
};

const BOOKMAKERS = [
  { id: "sportybet", name: "SportyBet", color: "#FF6600" },
  { id: "bet9ja", name: "Bet9ja", color: "#00A651" },
  { id: "betking", name: "BetKing", color: "#1E3A8A" },
  { id: "1xbet", name: "1xBet", color: "#004C99" },
];

export default function BettingAgentPage() {
  const { user } = useAuth();

  // State
  const [loading, setLoading] = React.useState(false);
  const [recommendations, setRecommendations] = React.useState<Recommendation[]>([]);
  const [selectedPicks, setSelectedPicks] = React.useState<BetslipSelection[]>([]);
  const [betslip, setBetslip] = React.useState<Betslip | null>(null);
  const [stake, setStake] = React.useState(2000);
  const [bookmaker, setBookmaker] = React.useState("sportybet");
  const [days, setDays] = React.useState(3);
  const [minEdge, setMinEdge] = React.useState(3);
  const [betslipLoading, setBetslipLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<"find" | "betslip" | "history">("find");

  // Fetch recommendations
  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/betting-agent/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, minEdge: minEdge / 100, limit: 50, bookmaker }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to fetch recommendations");
      setRecommendations(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch recommendations");
    } finally {
      setLoading(false);
    }
  };

  // Toggle pick selection
  const togglePick = (rec: Recommendation) => {
    const existing = selectedPicks.find(
      (p) => p.fixtureId === rec.fixtureId && p.market === rec.market && p.selection === rec.selection
    );

    if (existing) {
      setSelectedPicks((prev) =>
        prev.filter(
          (p) => !(p.fixtureId === rec.fixtureId && p.market === rec.market && p.selection === rec.selection)
        )
      );
    } else {
      if (selectedPicks.length >= 10) return;
      setSelectedPicks((prev) => [
        ...prev,
        {
          fixtureId: rec.fixtureId,
          match: rec.match,
          market: `${rec.market} - ${rec.selection}`,
          selection: rec.selection,
          odds: rec.bookmakerOdds,
          modelProbability: rec.modelProbability,
          edge: rec.edge,
          tier: rec.tier,
          reasoning: rec.reasoning,
        },
      ]);
    }
  };

  // Build betslip
  const buildBetslip = async () => {
    if (selectedPicks.length === 0) return;
    setBetslipLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/betting-agent/betslip", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user?.id ? { Authorization: `Bearer ${user.id}` } : {}),
        },
        body: JSON.stringify({ selections: selectedPicks, stake, bookmaker }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to build betslip");
      setBetslip(data.data);
      setActiveTab("betslip");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build betslip");
    } finally {
      setBetslipLoading(false);
    }
  };

  // Format currency
  const formatNaira = (amount: number) =>
    new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

  return (
    <div className="min-h-screen bg-[#0A0F1C] text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0A0F1C]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <span className="text-2xl">🤖</span>
                <span className="bg-gradient-to-r from-[#BFFF00] to-emerald-400 bg-clip-text text-transparent">
                  AI Betting Agent
                </span>
              </h1>
              <p className="text-xs text-white/40 mt-0.5">
                Find value • Build betslip • Get booking code
              </p>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-1 bg-white/5 rounded-lg p-1">
              {[
                { id: "find" as const, label: "Find Value", icon: "ri-search-line" },
                { id: "betslip" as const, label: "Betslip", icon: "ri-file-list-3-line", badge: selectedPicks.length },
                { id: "history" as const, label: "History", icon: "ri-history-line" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    activeTab === tab.id
                      ? "bg-[#BFFF00]/15 text-[#BFFF00]"
                      : "text-white/40 hover:text-white/60"
                  }`}
                >
                  <i className={`${tab.icon} text-sm`} />
                  {tab.label}
                  {tab.badge ? (
                    <span className="ml-0.5 bg-[#BFFF00] text-black text-[10px] font-bold px-1.5 rounded-full">
                      {tab.badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Error Banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
            <i className="ri-error-warning-line" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400">
              <i className="ri-close-line" />
            </button>
          </div>
        )}

        {/* ═══ FIND VALUE TAB ═══ */}
        {activeTab === "find" && (
          <div>
            {/* Controls */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 mb-6">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">Days ahead</label>
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:border-[#BFFF00]/50 outline-none"
                  >
                    {[1, 2, 3, 5, 7].map((d) => (
                      <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">Min edge</label>
                  <select
                    value={minEdge}
                    onChange={(e) => setMinEdge(Number(e.target.value))}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:border-[#BFFF00]/50 outline-none"
                  >
                    {[1, 2, 3, 5, 7, 10].map((e) => (
                      <option key={e} value={e}>{e}%+</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">Bookmaker</label>
                  <select
                    value={bookmaker}
                    onChange={(e) => setBookmaker(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:border-[#BFFF00]/50 outline-none"
                  >
                    {BOOKMAKERS.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={fetchRecommendations}
                  disabled={loading}
                  className="px-5 py-2 bg-[#BFFF00] text-black font-semibold rounded-lg text-sm hover:bg-[#BFFF00]/90 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <i className="ri-loader-4-line animate-spin" />
                      Scanning...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <i className="ri-search-line" />
                      Find Value
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Results */}
            {recommendations.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-white/60">
                    Found {recommendations.length} value picks
                  </h2>
                  {selectedPicks.length > 0 && (
                    <button
                      onClick={buildBetslip}
                      disabled={betslipLoading}
                      className="px-4 py-2 bg-[#BFFF00] text-black font-semibold rounded-lg text-xs hover:bg-[#BFFF00]/90 transition-all"
                    >
                      {betslipLoading ? "Building..." : `Build Betslip (${selectedPicks.length} picks)`}
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {recommendations.map((rec, i) => {
                    const isSelected = selectedPicks.some(
                      (p) =>
                        p.fixtureId === rec.fixtureId &&
                        p.market === rec.market &&
                        p.selection === rec.selection
                    );
                    return (
                      <div
                        key={`${rec.fixtureId}-${rec.market}-${rec.selection}-${i}`}
                        onClick={() => togglePick(rec)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? "bg-[#BFFF00]/5 border-[#BFFF00]/30"
                            : "bg-white/[0.02] border-white/5 hover:border-white/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            {/* Match & League */}
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs text-white/40">{rec.league}</span>
                              <span className="text-white/20">•</span>
                              <span className="text-xs text-white/30">{rec.kickoffLocal}</span>
                            </div>
                            <div className="font-semibold text-sm text-white/90 truncate">{rec.match}</div>

                            {/* Market & Selection */}
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs bg-white/5 rounded px-2 py-0.5 text-white/60">
                                {rec.market}
                              </span>
                              <span className="text-xs bg-white/5 rounded px-2 py-0.5 text-white/80 font-medium">
                                {rec.selection}
                              </span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${TIER_COLORS[rec.tier] || TIER_COLORS.WATCH}`}>
                                {rec.tier}
                              </span>
                            </div>

                            {/* Reasoning */}
                            <p className="text-xs text-white/40 mt-2 line-clamp-2">{rec.reasoning}</p>
                          </div>

                          {/* Stats */}
                          <div className="flex flex-col items-end gap-1 min-w-[120px]">
                            <div className="text-lg font-bold text-[#BFFF00]">
                              {rec.bookmakerOdds.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-emerald-400 font-semibold">
                              +{rec.edge.toFixed(1)}% edge
                            </div>
                            <div className="text-[10px] text-white/40">
                              Model: {rec.modelProbability.toFixed(1)}%
                            </div>
                            <div className="text-[10px] text-white/30">
                              Market: {rec.impliedProbability.toFixed(1)}%
                            </div>
                          </div>

                          {/* Selection indicator */}
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-none transition-all ${
                              isSelected
                                ? "border-[#BFFF00] bg-[#BFFF00]"
                                : "border-white/20"
                            }`}
                          >
                            {isSelected && <i className="ri-check-line text-black text-xs" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Empty State */}
            {!loading && recommendations.length === 0 && (
              <div className="text-center py-20">
                <div className="text-4xl mb-3">🔍</div>
                <h3 className="text-lg font-semibold text-white/60 mb-1">Find Today&apos;s Value</h3>
                <p className="text-sm text-white/30 max-w-md mx-auto">
                  Click &quot;Find Value&quot; to scan upcoming matches and compare our model probabilities
                  against bookmaker odds to find genuine betting edges.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ═══ BETSLIP TAB ═══ */}
        {activeTab === "betslip" && (
          <div>
            {!betslip ? (
              <div>
                {/* Selected Picks */}
                <h2 className="text-sm font-semibold text-white/60 mb-3">
                  Your Picks ({selectedPicks.length}/10)
                </h2>

                {selectedPicks.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="text-4xl mb-3">📝</div>
                    <h3 className="text-lg font-semibold text-white/60 mb-1">No picks selected</h3>
                    <p className="text-sm text-white/30">
                      Go to &quot;Find Value&quot; and tap on picks to add them to your betslip.
                    </p>
                  </div>
                ) : (
                  <div>
                    {/* Stake & Bookmaker */}
                    <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 mb-4">
                      <div className="flex flex-wrap items-end gap-4">
                        <div>
                          <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">Stake (₦)</label>
                          <input
                            type="number"
                            value={stake}
                            onChange={(e) => setStake(Number(e.target.value))}
                            min={100}
                            max={100000}
                            step={100}
                            className="w-32 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:border-[#BFFF00]/50 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-white/40 uppercase tracking-wider mb-1">Bookmaker</label>
                          <select
                            value={bookmaker}
                            onChange={(e) => setBookmaker(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:border-[#BFFF00]/50 outline-none"
                          >
                            {BOOKMAKERS.map((b) => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          onClick={buildBetslip}
                          disabled={betslipLoading}
                          className="px-5 py-2 bg-[#BFFF00] text-black font-semibold rounded-lg text-sm hover:bg-[#BFFF00]/90 transition-all disabled:opacity-50"
                        >
                          {betslipLoading ? "Building..." : "Build Betslip"}
                        </button>
                      </div>
                    </div>

                    {/* Picks List */}
                    <div className="space-y-2">
                      {selectedPicks.map((pick, i) => (
                        <div
                          key={`${pick.fixtureId}-${i}`}
                          className="p-3 bg-white/[0.02] border border-white/5 rounded-lg flex items-center justify-between"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-white/80 truncate">{pick.match}</div>
                            <div className="text-xs text-white/40 mt-0.5">
                              {pick.market} • {pick.tier}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-sm font-bold text-[#BFFF00]">{pick.odds.toFixed(2)}</div>
                              <div className="text-[10px] text-emerald-400">+{pick.edge.toFixed(1)}%</div>
                            </div>
                            <button
                              onClick={() =>
                                setSelectedPicks((prev) =>
                                  prev.filter(
                                    (_, j) =>
                                      !(j === i)
                                  )
                                )
                              }
                              className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all"
                            >
                              <i className="ri-close-line text-xs" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Quick Summary */}
                    <div className="mt-4 p-4 bg-white/[0.03] border border-white/5 rounded-xl">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="text-lg font-bold text-white/80">
                            {selectedPicks.reduce((acc, p) => acc * p.odds, 1).toFixed(2)}
                          </div>
                          <div className="text-[10px] text-white/40">Combined Odds</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-[#BFFF00]">
                            {formatNaira(stake * selectedPicks.reduce((acc, p) => acc * p.odds, 1))}
                          </div>
                          <div className="text-[10px] text-white/40">Potential Return</div>
                        </div>
                        <div>
                          <div className="text-lg font-bold text-emerald-400">
                            {formatNaira(
                              stake * selectedPicks.reduce((acc, p) => acc * p.odds, 1) - stake
                            )}
                          </div>
                          <div className="text-[10px] text-white/40">Profit</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Betslip Result */
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-white/90">Your Betslip</h2>
                  <button
                    onClick={() => setBetslip(null)}
                    className="text-xs text-white/40 hover:text-white/60 transition-colors"
                  >
                    Edit selections
                  </button>
                </div>

                {/* Status Banner */}
                <div
                  className={`p-4 rounded-xl border mb-4 ${
                    betslip.risk.approved
                      ? "bg-emerald-500/10 border-emerald-500/20"
                      : "bg-red-500/10 border-red-500/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{betslip.risk.approved ? "✅" : "🚫"}</span>
                    <div>
                      <div className={`font-semibold text-sm ${betslip.risk.approved ? "text-emerald-400" : "text-red-400"}`}>
                        {betslip.risk.approved ? "Ready to Place" : "Blocked — Review Required"}
                      </div>
                      <div className="text-xs text-white/40">
                        Risk Score: {betslip.risk.riskScore}/100
                      </div>
                    </div>
                  </div>
                </div>

                {/* Selections */}
                <div className="space-y-2 mb-4">
                  {betslip.selections.map((sel, i) => (
                    <div
                      key={i}
                      className="p-3 bg-white/[0.02] border border-white/5 rounded-lg"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white/80 truncate">{sel.match}</div>
                          <div className="text-xs text-white/40 mt-0.5">{sel.market}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-[#BFFF00]">{sel.odds.toFixed(2)}</div>
                          <div className="text-[10px] text-emerald-400">+{sel.edge.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Summary */}
                <div className="p-4 bg-white/[0.03] border border-white/5 rounded-xl mb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-white/40">Legs</span>
                        <span className="text-white/80">{betslip.summary.totalLegs}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-white/40">Combined Odds</span>
                        <span className="text-white/80 font-bold">{betslip.summary.combinedOdds}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-white/40">Stake</span>
                        <span className="text-white/80">{formatNaira(betslip.summary.stake)}</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-white/40">Potential Return</span>
                        <span className="text-[#BFFF00] font-bold">{formatNaira(betslip.summary.potentialReturn)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-white/40">Profit</span>
                        <span className="text-emerald-400 font-bold">{formatNaira(betslip.summary.profit)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-white/40">Avg Edge</span>
                        <span className="text-emerald-400">+{betslip.summary.avgEdge}%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Risk Warnings */}
                {betslip.risk.risks.length > 0 && (
                  <div className="space-y-1 mb-4">
                    {betslip.risk.risks.map((risk, i) => (
                      <div
                        key={i}
                        className={`p-2 rounded text-xs ${
                          risk.level === "BLOCK"
                            ? "bg-red-500/10 text-red-400"
                            : risk.level === "WARNING"
                            ? "bg-amber-500/10 text-amber-400"
                            : "bg-blue-500/10 text-blue-400"
                        }`}
                      >
                        {risk.level}: {risk.message}
                      </div>
                    ))}
                  </div>
                )}

                {/* Warnings */}
                {betslip.warnings.length > 0 && (
                  <div className="space-y-1 mb-4">
                    {betslip.warnings.map((w, i) => (
                      <div key={i} className="p-2 rounded text-xs bg-amber-500/10 text-amber-400">
                        ⚠️ {w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Instructions */}
                <div className="p-4 bg-white/[0.03] border border-white/5 rounded-xl">
                  <h3 className="text-sm font-semibold text-white/60 mb-2">Next Steps</h3>
                  <ol className="space-y-2 text-xs text-white/50">
                    <li className="flex items-start gap-2">
                      <span className="text-[#BFFF00] font-bold">1.</span>
                      {betslip.instructions}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#BFFF00] font-bold">2.</span>
                      Add each selection with the exact odds shown above.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#BFFF00] font-bold">3.</span>
                      Enter your stake and review the betslip before placing.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#BFFF00] font-bold">4.</span>
                      Only place bets you are comfortable with. Never bet more than you can afford to lose.
                    </li>
                  </ol>
                </div>

                {/* Disclaimer */}
                <p className="text-[10px] text-white/20 text-center mt-4">
                  ⚠️ This is an AI recommendation, not financial advice. Past performance does not guarantee future results. Bet responsibly.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {activeTab === "history" && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📊</div>
            <h3 className="text-lg font-semibold text-white/60 mb-1">Coming Soon</h3>
            <p className="text-sm text-white/30 max-w-md mx-auto">
              Track your past betslips, results, and ROI over time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
