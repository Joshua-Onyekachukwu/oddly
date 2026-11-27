"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, EmptyState, Button, Badge } from "@/components/ui";
import { BettingTooltip, getMarketLabel, getSelectionLabel } from "@/components/ui/BettingTooltip";

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

// ─── Rollover engine recommendation API types ──────────────────────────
// Mirrors GET /api/v1/rollover/recommendation (src/lib/rollover/engine.ts)

interface EngineLeg {
  fixtureId: string;
  fixtureLabel?: string;
  kickoffTime?: string;
  market: string;
  selection: string;
  modelProbability: number;
  odds: number;
  impliedProbability: number;
  edge: number;
  expectedValue: number;
  bookmaker?: string | null;
  sourceId?: string | null;
  leagueId?: string | null;
}

interface EngineTicket {
  id: string;
  legs: EngineLeg[];
  legCount: number;
  combinedOdds: number;
  combinedProbability: number;
  /** correlation-aware joint probability (spec §2) — preferred for display */
  adjustedProbability?: number;
  correlationFactor?: number;
  combinedEv: number;
  adjustedEv?: number;
  score: number;
  rationale: string[];
}

interface RolloverRecommendation {
  date: string;
  window: { from: string; to: string };
  tickets: EngineTicket[];
  reason: "ok" | "no_candidates" | "no_qualified_candidates" | "no_combinations_in_band" | string;
  /** spec §4 daily decision: qualified | wait | skip */
  decision?: "qualified" | "wait" | "skip" | string;
  message: string;
  stats: {
    fixturesConsidered: number;
    predictionsConsidered: number;
    candidatesWithOdds: number;
    qualifiedCount: number;
    combinationsEvaluated: number;
    rejectedCount: number;
  };
  config: {
    minCombinedOdds: number;
    maxCombinedOdds: number;
    [key: string]: unknown;
  };
  generatedAt: string;
}

// Map canonical engine market keys → BettingTooltip glossary keys
// Mirrors GET /api/v1/rollover/stats (src/lib/rollover/stats.ts)
interface RolloverStats {
  basis: "paper";
  month: string;
  chains: {
    total: number;
    active: number;
    completed: number;
    broken: number;
    startedThisMonth: number;
    completedThisMonth: number;
  };
  picks: {
    total: number;
    won: number;
    lost: number;
    skipped: number;
    settled: number;
    winRatePct: number | null;
  };
  bankroll: {
    totalCurrentBalance: number;
    totalBanked: number;
    activeChains: number;
  };
  streaks: {
    currentWinStreak: number;
    currentLossStreak: number;
    maxWinStreak: number;
    maxLossStreak: number;
  };
  drawdown: {
    maxDrawdownAmount: number;
    maxDrawdownPct: number;
  };
  averages: {
    avgOdds: number | null;
    avgModelProbability: number | null;
  };
  monthly: {
    rolloverWins: number;
    rolloverLosses: number;
    skippedDays: number;
    chainsCompleted: number;
    target: number;
    stretchTarget: number;
    progressPct: number;
  };
}

const DECISION_BADGE: Record<string, { variant: "success" | "warning" | "default"; label: string }> = {
  qualified: { variant: "success", label: "QUALIFIED" },
  wait: { variant: "warning", label: "WAIT" },
  skip: { variant: "default", label: "SKIP" },
};

const ENGINE_MARKET_TERMS: Record<string, string> = {
  "1x2": "1X2", h2h: "1X2",
  ou: "OU", over_under: "OU", totals: "OU", total_goals: "OU",
  btts: "BTTS", both_teams_to_score: "BTTS",
  dc: "DC", double_chance: "DC",
  dnb: "DNB", draw_no_bet: "DNB",
  homegoals: "HomeGoals", home_goals: "HomeGoals",
  awaygoals: "AwayGoals", away_goals: "AwayGoals",
};

const ENGINE_SELECTION_TERMS: Record<string, string> = {
  home: "Home", away: "Away", draw: "Draw",
  "1x": "1X", x2: "X2", "12": "12",
  yes: "Yes", no: "No",
  home_dnb: "Home_DNB", away_dnb: "Away_DNB",
};

/** Resolve an engine market key to a BettingTooltip term + display label. */
function engineMarketDisplay(market: string): { term: string; label: string } {
  const key = (market || "").toLowerCase();
  const term = ENGINE_MARKET_TERMS[key] ?? market;
  return { term, label: getMarketLabel(term) };
}

/** Resolve an engine selection key to a BettingTooltip term + display label. */
function engineSelectionDisplay(selection: string): { term: string; label: string } {
  const s = (selection || "").trim();
  const lower = s.toLowerCase();
  let term = ENGINE_SELECTION_TERMS[lower];
  if (!term) {
    // Title-case each underscore segment ("over_2.5" → "Over_2.5")
    term = s
      .split("_")
      .map((seg) => (/^[a-z]+$/.test(seg) ? seg[0].toUpperCase() + seg.slice(1) : seg))
      .join("_");
  }
  return { term, label: getSelectionLabel(term) };
}

function formatKickoff(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EMPTY_REASON_HINTS: Record<string, string> = {
  no_candidates: "No upcoming fixtures were found in the next 24 hours.",
  no_qualified_candidates:
    "No selections met the engine's probability and value thresholds today.",
  no_combinations_in_band:
    "Qualified picks exist, but no combination landed inside the ~2.00 odds band.",
};

export default function RolloverPage() {
  const { user, session, profile } = useAuth();
  const [chains, setChains] = useState<RolloverChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAddPick, setShowAddPick] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [addingPick, setAddingPick] = useState<string | null>(null);

  // Engine recommendation state
  const [engineRec, setEngineRec] = useState<RolloverRecommendation | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [engineError, setEngineError] = useState<string | null>(null);

  // Monthly tracker stats (spec §5) — paper/simulated figures only
  const [rolloverStats, setRolloverStats] = useState<RolloverStats | null>(null);

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

  // Fetch today's rollover recommendation from the engine API.
  // Requires the Supabase access token (route uses requireAuth).
  const fetchEngineRecommendation = useCallback(async () => {
    if (!session?.access_token) {
      setEngineLoading(false);
      return;
    }
    setEngineLoading(true);
    setEngineError(null);
    try {
      const res = await fetch("/api/v1/rollover/recommendation?hours=24&limit=3", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        const msg =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          `Request failed (${res.status})`;
        throw new Error(msg);
      }
      setEngineRec(json.data as RolloverRecommendation);
    } catch (err) {
      console.error("Failed to load rollover recommendation:", err);
      setEngineError(err instanceof Error ? err.message : "Failed to load recommendation");
      setEngineRec(null);
    } finally {
      setEngineLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchEngineRecommendation();
  }, [fetchEngineRecommendation]);

  // Fetch monthly tracker stats from /api/v1/rollover/stats
  const fetchRolloverStats = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch("/api/v1/rollover/stats", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (res.ok && json?.success) {
        setRolloverStats(json.data as RolloverStats);
      }
    } catch (err) {
      console.error("Failed to load rollover stats:", err);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchRolloverStats();
  }, [fetchRolloverStats]);

  // Map a single-leg engine ticket onto the existing rollover_picks flow.
  // Multi-leg accumulators don't fit the one-pick-per-day schema — those are
  // shown read-only with a hint to add legs manually.
  const handleUseEnginePick = (ticket: EngineTicket) => {
    if (ticket.legCount !== 1 || ticket.legs.length !== 1) return;
    const leg = ticket.legs[0];
    handleAddPick({
      id: `engine-${ticket.id}`,
      fixture_id: leg.fixtureId,
      prediction_id: leg.sourceId ?? null,
      market: leg.market,
      selection: leg.selection,
      bookmaker_odds: leg.odds,
      model_probability: leg.modelProbability,
      edge: leg.edge,
      risk_tier: "engine",
    });
  };

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

      {/* Elite upsell — non-blocking while entitlements are unenforced */}
      {profile?.subscription_tier === "free" && (
        <div className="mb-[16px] flex items-start gap-[10px] p-[12px] bg-amber-50 border border-amber-100 rounded-[10px]">
          <i className="ri-vip-crown-line text-[16px] text-amber-500 flex-none mt-[1px]" />
          <p className="text-[12px] text-amber-700 !leading-[1.6]">
            The Rollover engine is an{" "}
            <span className="font-semibold">Elite</span> feature. You&apos;re on the Free
            plan — it works for everyone during our free testing phase,{" "}
            <Link href="/pricing" className="font-semibold underline hover:text-amber-800">
              upgrade to Elite
            </Link>{" "}
            to keep it when paid plans launch.
          </p>
        </div>
      )}

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

      {/* Today's Recommendation — rollover engine */}
      <Card className="mb-[20px]">
        <div className="flex items-center justify-between mb-[4px]">
          <div>
            <div className="flex items-center gap-[8px]">
              <h2 className="text-[14px] font-display font-bold text-[#0A0F1C]">
                Today&apos;s Recommendation
              </h2>
              {engineRec?.decision && DECISION_BADGE[engineRec.decision] && (
                <Badge
                  variant={DECISION_BADGE[engineRec.decision].variant}
                  size="sm"
                >
                  {DECISION_BADGE[engineRec.decision].label}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-gray-400">
              {engineRec?.config
                ? `Auto-built ~${engineRec.config.minCombinedOdds}–${engineRec.config.maxCombinedOdds} accumulator from model picks with bookmaker odds`
                : "Auto-built ~2.00 accumulator from model picks with bookmaker odds"}
            </p>
          </div>
          <button
            onClick={fetchEngineRecommendation}
            disabled={engineLoading}
            aria-label="Refresh recommendation"
            className="flex items-center gap-[4px] px-[10px] py-[5px] text-[11px] font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-[6px] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <i className={`ri-refresh-line text-[13px] ${engineLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {engineLoading ? (
          <div className="space-y-[8px] mt-[12px]">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-[72px] bg-gray-50 rounded-[10px] animate-pulse" />
            ))}
          </div>
        ) : engineError ? (
          <div className="mt-[12px] flex items-center justify-between gap-[12px] p-[12px] bg-red-50 border border-red-100 rounded-[10px]">
            <div className="flex items-center gap-[8px]">
              <i className="ri-error-warning-line text-[16px] text-red-400" />
              <span className="text-[12px] text-red-600">{engineError}</span>
            </div>
            <button
              onClick={fetchEngineRecommendation}
              className="flex-none text-[11px] font-semibold text-red-600 bg-white border border-red-200 px-[10px] py-[4px] rounded-[6px] hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              Retry
            </button>
          </div>
        ) : !engineRec || engineRec.tickets.length === 0 ? (
          <div className="mt-[12px] p-[16px] bg-gray-50 rounded-[10px] text-center">
            <i className="ri-calendar-close-line text-[22px] text-gray-300 block mb-[4px]" />
            <p className="text-[13px] font-semibold text-[#0A0F1C] mb-[2px]">
              No qualifying rollover ticket today
            </p>
            <p className="text-[11px] text-gray-400">
              {engineRec
                ? (EMPTY_REASON_HINTS[engineRec.reason] ?? "") || engineRec.message
                : "Check back closer to kickoff when more fixtures and odds are available."}
            </p>
            {engineRec?.message && (
              <p className="text-[10px] text-gray-300 mt-[4px]">{engineRec.message}</p>
            )}
          </div>
        ) : (
          <div className="space-y-[10px] mt-[12px]">
            {engineRec.tickets.map((ticket) => {
              const singleLeg = ticket.legCount === 1 && ticket.legs.length === 1;
              const pickId = `engine-${ticket.id}`;
              return (
                <div
                  key={ticket.id}
                  className="p-[12px] bg-gray-50 rounded-[10px] border border-gray-100"
                >
                  {/* Ticket summary */}
                  <div className="flex items-center justify-between mb-[8px]">
                    <div className="flex items-center gap-[8px]">
                      <Badge variant="success" size="sm">
                        {ticket.legCount} leg{ticket.legCount === 1 ? "" : "s"}
                      </Badge>
                      <span className="text-[15px] font-mono-data font-bold text-[#0A0F1C]">
                        @{ticket.combinedOdds.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-right text-[10px] text-gray-400">
                      <span className="font-mono-data text-green-600 font-medium">
                        {(((ticket.adjustedProbability ?? ticket.combinedProbability)) * 100).toFixed(1)}% win prob
                        {(ticket.correlationFactor ?? 1) < 0.999 && (
                          <span className="text-gray-300" title="Correlation-adjusted probability">
                            {" "}(adj)
                          </span>
                        )}
                      </span>
                      <span className="mx-[4px]">·</span>
                      <span className="font-mono-data">
                        EV {(((ticket.adjustedEv ?? ticket.combinedEv)) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* Legs */}
                  <div className="divide-y divide-gray-100">
                    {ticket.legs.map((leg, idx) => {
                      const market = engineMarketDisplay(leg.market);
                      const selection = engineSelectionDisplay(leg.selection);
                      const kickoff = formatKickoff(leg.kickoffTime);
                      return (
                        <div
                          key={`${leg.fixtureId}-${leg.market}-${leg.selection}-${idx}`}
                          className="flex items-center justify-between gap-[10px] py-[7px]"
                        >
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium text-[#0A0F1C] truncate">
                              {leg.fixtureLabel ?? leg.fixtureId}
                            </div>
                            <div className="text-[10px] text-gray-400 mt-[1px]">
                              {kickoff && <span>{kickoff} · </span>}
                              <BettingTooltip term={market.term}>{market.label}</BettingTooltip>
                              {" · "}
                              <BettingTooltip term={selection.term}>
                                {selection.label}
                              </BettingTooltip>
                              {leg.bookmaker && <span> · {leg.bookmaker}</span>}
                            </div>
                          </div>
                          <div className="flex-none text-right">
                            <span className="text-[12px] font-mono-data font-semibold text-[#0A0F1C]">
                              @{leg.odds.toFixed(2)}
                            </span>
                            <span className="block text-[10px] text-gray-400 font-mono-data">
                              {(leg.modelProbability * 100).toFixed(0)}% model
                              {leg.expectedValue > 0 && (
                                <span className="text-green-600">
                                  {" "}· +{(leg.expectedValue * 100).toFixed(1)}% EV
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action */}
                  <div className="flex items-center justify-between mt-[8px] pt-[8px] border-t border-gray-100">
                    {singleLeg ? (
                      activeChain && activeChain.current_balance > 0 ? (
                        <button
                          onClick={() => handleUseEnginePick(ticket)}
                          disabled={addingPick === pickId}
                          className="px-[12px] py-[6px] bg-[#1B2A4A] text-white text-[11px] font-medium rounded-[6px] hover:bg-[#243B53] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                        >
                          {addingPick === pickId ? "Adding..." : "Use this pick"}
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-400">
                          Start a chain to add this pick to your rollover.
                        </span>
                      )
                    ) : (
                      <span className="text-[10px] text-gray-400">
                        Multi-leg accumulator — your chain tracks one pick per day, so add legs
                        manually via &quot;Add Today&apos;s Pick&quot; if you want to follow it.
                      </span>
                    )}
                    <span className="text-[10px] text-gray-300 font-mono-data">
                      #{ticket.id.slice(0, 24)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Engine stats — transparency */}
        {engineRec && !engineLoading && !engineError && (
          <p className="text-[10px] text-gray-300 mt-[10px]">
            Engine scan: {engineRec.stats.fixturesConsidered} fixtures ·{" "}
            {engineRec.stats.predictionsConsidered} predictions ·{" "}
            {engineRec.stats.candidatesWithOdds} with odds ·{" "}
            {engineRec.stats.qualifiedCount} qualified ·{" "}
            {engineRec.stats.combinationsEvaluated} combinations evaluated
            {engineRec.stats.rejectedCount > 0 &&
              ` · ${engineRec.stats.rejectedCount} rejected`}
            {engineRec.generatedAt &&
              ` · updated ${new Date(engineRec.generatedAt).toLocaleTimeString()}`}
          </p>
        )}
      </Card>

      {/* Monthly Tracker — paper/simulated stats (spec §5) */}
      {rolloverStats && rolloverStats.chains.total > 0 && (
        <Card className="mb-[20px]">
          <div className="flex items-center justify-between mb-[10px]">
            <div>
              <h2 className="text-[14px] font-display font-bold text-[#0A0F1C]">
                Monthly Tracker
              </h2>
              <p className="text-[11px] text-gray-400">
                {rolloverStats.month} · paper tracking — manually marked picks, not verified real-money results
              </p>
            </div>
            <Badge variant="default" size="sm">PAPER</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[10px]">
            {[
              {
                label: "Rollovers this month",
                value: `${rolloverStats.monthly.rolloverWins}W / ${rolloverStats.monthly.rolloverLosses}L`,
                sub: `target ${rolloverStats.monthly.target} · stretch ${rolloverStats.monthly.stretchTarget} (${rolloverStats.monthly.progressPct}%)`,
              },
              {
                label: "Win streak",
                value: `${rolloverStats.streaks.currentWinStreak}`,
                sub: `best ${rolloverStats.streaks.maxWinStreak} · settled ${rolloverStats.picks.settled} (${rolloverStats.picks.winRatePct ?? "—"}%)`,
              },
              {
                label: "Max drawdown",
                value: rolloverStats.drawdown.maxDrawdownAmount > 0
                  ? `-${rolloverStats.drawdown.maxDrawdownAmount.toFixed(2)}`
                  : "—",
                sub: rolloverStats.drawdown.maxDrawdownPct > 0
                  ? `${rolloverStats.drawdown.maxDrawdownPct.toFixed(1)}% of peak`
                  : "no losing sequence yet",
              },
              {
                label: "Avg odds / prob",
                value: rolloverStats.averages.avgOdds != null
                  ? `@${rolloverStats.averages.avgOdds.toFixed(2)}`
                  : "—",
                sub: rolloverStats.averages.avgModelProbability != null
                  ? `${(rolloverStats.averages.avgModelProbability * 100).toFixed(0)}% model prob`
                  : `${rolloverStats.chains.completed} chains completed`,
              },
            ].map((stat) => (
              <div key={stat.label} className="p-[12px] bg-gray-50 rounded-[8px]">
                <span className="block text-[10px] text-gray-400 mb-[2px]">{stat.label}</span>
                <span className="text-[15px] font-mono-data font-bold text-[#0A0F1C]">
                  {stat.value}
                </span>
                <span className="block text-[10px] text-gray-400 mt-[2px]">{stat.sub}</span>
              </div>
            ))}
          </div>
        </Card>
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
