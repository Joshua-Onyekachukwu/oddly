"use client";

import { useValuePicksLive } from "./useSupabaseRealtime";

/**
 * Subscribe to live value picks with real-time edge detection.
 * Polls Supabase every 15s (replaces Convex real-time subscription).
 */
export function useLiveValuePicks(options?: {
  tier?: string;
  market?: string;
  limit?: number;
}) {
  const picks = useValuePicksLive(options?.limit ?? 50);

  // Client-side filter if tier/market specified
  const filtered = picks?.filter((p) => {
    if (options?.tier && p.tier !== options.tier) return false;
    if (options?.market && p.market !== options.market) return false;
    return true;
  });

  return {
    picks: filtered ?? [],
    isLoading: picks === undefined,
    eliteCount: filtered?.filter((p) => p.tier === "ELITE").length ?? 0,
    highCount: filtered?.filter((p) => p.tier === "HIGH").length ?? 0,
  };
}
