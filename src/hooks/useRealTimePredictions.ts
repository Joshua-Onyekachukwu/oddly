"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Subscribe to real-time prediction updates from Convex.
 * Re-renders automatically when predictions change.
 *
 * @param options.limit - Max predictions to return (default: 50)
 * @returns { predictions, isLoading, error }
 */
export function useRealTimePredictions(options?: { limit?: number }) {
  const predictions = useQuery(api.realtime.getLatestPredictions, {
    limit: options?.limit ?? 50,
  });

  return {
    predictions: predictions ?? [],
    isLoading: predictions === undefined,
    error: null, // Convex handles errors internally
  };
}

/**
 * Subscribe to real-time settlement updates.
 * Shows recently settled predictions with correct/wrong status.
 */
export function useSettlementUpdates(options?: { limit?: number }) {
  const settlements = useQuery(api.realtime.getSettlementUpdates, {
    limit: options?.limit ?? 50,
  });

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
  const stats = useQuery(api.realtime.getLiveStats);

  return {
    stats: stats ?? null,
    isLoading: stats === undefined,
  };
}
