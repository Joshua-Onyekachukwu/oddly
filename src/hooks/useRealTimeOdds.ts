"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Subscribe to live value picks with real-time edge detection.
 */
export function useLiveValuePicks(options?: {
  tier?: string;
  market?: string;
  limit?: number;
}) {
  const picks = useQuery(api.realtime.getValuePicksLive, {
    tier: options?.tier,
    market: options?.market,
    limit: options?.limit ?? 50,
  });

  return {
    picks: picks ?? [],
    isLoading: picks === undefined,
    eliteCount: picks?.filter((p) => p.tier === "ELITE").length ?? 0,
    highCount: picks?.filter((p) => p.tier === "HIGH").length ?? 0,
  };
}

