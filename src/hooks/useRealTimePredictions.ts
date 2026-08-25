"use client";

import {
  useSettlementFeed,
  useLiveStats,
  useMarketAccuracy,
  usePredictionStats,
} from "./useSupabaseRealtime";

/**
 * Subscribe to real-time prediction updates from Supabase.
 * Polls every 15s (replaces Convex real-time subscription).
 *
 * @param options.limit - Max predictions to return (default: 50)
 * @returns { predictions, isLoading, error }
 */
export function useRealTimePredictions(options?: { limit?: number }) {
  const settlements = useSettlementFeed(options?.limit ?? 50);

  return {
    predictions: settlements ?? [],
    isLoading: settlements === undefined,
    error: null,
  };
}

/**
 * Subscribe to real-time settlement updates.
 * Shows recently settled predictions with correct/wrong status.
 */
export function useSettlementUpdates(options?: { limit?: number }) {
  const settlements = useSettlementFeed(options?.limit ?? 50);

  return {
    settlements: settlements ?? [],
    isLoading: settlements === undefined,
    correctCount: settlements?.filter((s) => s.result === "correct").length ?? 0,
    wrongCount: settlements?.filter((s) => s.result === "wrong").length ?? 0,
  };
}

/**
 * Subscribe to live accuracy stats that update in real-time.
 */
export function useLiveAccuracyStats() {
  const liveStats = useLiveStats();

  return {
    stats: liveStats
      ? {
          totalPredictions: liveStats.total_predictions,
          correct: liveStats.correct_predictions,
          wrong: 0,
          accuracy: liveStats.accuracy,
          lastUpdated: new Date().toISOString(),
        }
      : null,
    isLoading: liveStats === undefined,
  };
}
