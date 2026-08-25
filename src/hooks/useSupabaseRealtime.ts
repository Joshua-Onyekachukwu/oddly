"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/**
 * Shared Supabase client for realtime subscriptions.
 * Uses anon key (read-only) + service role for admin queries.
 */
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  );
}

// ─── useLiveStats ──────────────────────────────────────────────

export interface LiveStats {
  total_predictions: number;
  correct_predictions: number;
  accuracy: number;
  total_fixtures: number;
  active_models: number;
}

/**
 * Replacement for: useQuery(api.realtime.getLiveStats)
 * Polls Supabase every 10s for live stats.
 */
export function useLiveStats(): LiveStats | undefined {
  const [stats, setStats] = useState<LiveStats | undefined>();

  const fetchStats = useCallback(async () => {
    try {
      const sb = getSupabase();
      const [predCount, correctCount, fixtureCount] = await Promise.all([
        sb.from("predictions").select("id", { count: "exact", head: true }),
        sb.from("predictions").select("id", { count: "exact", head: true }).eq("result", "correct"),
        sb.from("fixtures").select("id", { count: "exact", head: true }).eq("status", "finished"),
      ]);
      const total = predCount.count || 0;
      const correct = correctCount.count || 0;
      setStats({
        total_predictions: total,
        correct_predictions: correct,
        accuracy: total > 0 ? Math.round((correct / total) * 1000) / 10 : 0,
        total_fixtures: fixtureCount.count || 0,
        active_models: 3,
      });
    } catch {}
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return stats;
}

// ─── useSettlementFeed ─────────────────────────────────────────

export interface SettlementItem {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  model_probability: number;
  model_version: string;
  result: string;
  settled_at: string;
  match_name?: string;
}

/**
 * Replacement for: useQuery(api.realtime.getSettlementUpdates)
 * Polls Supabase every 15s for recent settlements.
 */
export function useSettlementFeed(limit = 20): SettlementItem[] | undefined {
  const [items, setItems] = useState<SettlementItem[] | undefined>();

  const fetchFeed = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from("predictions")
        .select("id, fixture_id, market, selection, model_probability, model_version, result, settled_at")
        .not("result", "is", null)
        .neq("result", "pending")
        .order("settled_at", { ascending: false })
        .limit(limit);
      setItems(data || []);
    } catch {}
  }, [limit]);

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 15000);
    return () => clearInterval(interval);
  }, [fetchFeed]);

  return items;
}

// ─── useValuePicksLive ─────────────────────────────────────────

export interface ValuePick {
  id: string;
  fixture_id: string;
  match_name: string;
  market: string;
  selection: string;
  model_probability: number;
  bookmaker_odds: number;
  edge: number;
  tier: string;
}

/**
 * Replacement for: useQuery(api.realtime.getValuePicksLive)
 * Polls Supabase every 15s for value picks (recommendations).
 */
export function useValuePicksLive(limit = 30): ValuePick[] | undefined {
  const [picks, setPicks] = useState<ValuePick[] | undefined>();

  const fetchPicks = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from("recommendations")
        .select("id, fixture_id, market, selection, model_probability, bookmaker_odds, edge, opportunity_score, is_recommended")
        .eq("is_recommended", true)
        .order("edge", { ascending: false })
        .limit(limit);
      setPicks(
        (data || []).map((r: any) => ({
          ...r,
          match_name: "",
          tier: r.edge > 0.1 ? "ELITE" : r.edge > 0.05 ? "HIGH" : "MEDIUM",
        }))
      );
    } catch {}
  }, [limit]);

  useEffect(() => {
    fetchPicks();
    const interval = setInterval(fetchPicks, 15000);
    return () => clearInterval(interval);
  }, [fetchPicks]);

  return picks;
}

// ─── useMarketAccuracy ─────────────────────────────────────────

export interface MarketAccuracy {
  market: string;
  total: number;
  correct: number;
  accuracy: number;
}

/**
 * Replacement for: useQuery(api.realtime.getSettlementByMarket)
 * Uses materialized view for zero-disk-I/O.
 */
export function useMarketAccuracy(): MarketAccuracy[] | undefined {
  const [data, setData] = useState<MarketAccuracy[] | undefined>();

  const fetchAccuracy = useCallback(async () => {
    try {
      const sb = getSupabase();
      // Try materialized view first
      const { data: mv } = await sb.from("mv_market_accuracy").select("*");
      if (mv && mv.length > 0) {
        setData(mv.map((r: any) => ({
          market: r.market,
          total: r.total,
          correct: r.correct,
          accuracy: r.accuracy,
        })));
        return;
      }
      // Fallback: query predictions
      const { data: preds } = await sb
        .from("predictions")
        .select("market, result")
        .not("result", "is", null)
        .neq("result", "pending")
        .limit(10000);
      if (!preds) return;
      const byMarket: Record<string, { total: number; correct: number }> = {};
      for (const p of preds) {
        if (!byMarket[p.market]) byMarket[p.market] = { total: 0, correct: 0 };
        byMarket[p.market].total++;
        if (p.result === "correct") byMarket[p.market].correct++;
      }
      setData(
        Object.entries(byMarket).map(([market, v]) => ({
          market,
          total: v.total,
          correct: v.correct,
          accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 1000) / 10 : 0,
        }))
      );
    } catch {}
  }, []);

  useEffect(() => {
    fetchAccuracy();
    const interval = setInterval(fetchAccuracy, 30000);
    return () => clearInterval(interval);
  }, [fetchAccuracy]);

  return data;
}

// ─── usePredictionStats ────────────────────────────────────────

export interface PredictionStats {
  total: number;
  correct: number;
  wrong: number;
  pending: number;
  accuracy: number;
}

/**
 * Replacement for: useQuery(api.predictions.getStats)
 */
export function usePredictionStats(): PredictionStats | undefined {
  const [stats, setStats] = useState<PredictionStats | undefined>();

  const fetchStats = useCallback(async () => {
    try {
      const sb = getSupabase();
      const { data: mv } = await sb.from("mv_settlement_summary").select("*").single();
      if (mv) {
        setStats({
          total: mv.total_predictions || 0,
          correct: mv.correct || 0,
          wrong: mv.wrong || 0,
          pending: mv.pending || 0,
          accuracy: mv.accuracy || 0,
        });
        return;
      }
      // Fallback
      const [total, correct, wrong] = await Promise.all([
        sb.from("predictions").select("id", { count: "exact", head: true }),
        sb.from("predictions").select("id", { count: "exact", head: true }).eq("result", "correct"),
        sb.from("predictions").select("id", { count: "exact", head: true }).eq("result", "wrong"),
      ]);
      const t = total.count || 0;
      const c = correct.count || 0;
      setStats({
        total: t,
        correct: c,
        wrong: wrong.count || 0,
        pending: 0,
        accuracy: t > 0 ? Math.round((c / t) * 1000) / 10 : 0,
      });
    } catch {}
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return stats;
}
