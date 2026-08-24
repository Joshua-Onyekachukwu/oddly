"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Subscribe to real-time odds for a specific fixture.
 * Re-renders automatically when odds change.
 *
 * @param fixtureId - The fixture to get odds for
 * @returns { odds, isLoading, bestOdds }
 */
export function useFixtureOdds(fixtureId: string | null) {
  const odds = useQuery(
    api.realtime.getOddsForFixture,
    fixtureId ? { fixtureId } : "skip",
  );

  // Find best odds per market/selection
  const bestOdds = useMemo(() => {
    if (!odds) return {};
    const best: Record<
      string,
      { bookmaker: string; odds: number; impliedProb: number }
    > = {};

    for (const o of odds) {
      const key = `${o.market}:${o.selection}`;
      if (!best[key] || o.odds > best[key].odds) {
        best[key] = {
          bookmaker: o.bookmaker,
          odds: o.odds,
          impliedProb: o.impliedProb,
        };
      }
    }
    return best;
  }, [odds]);

  return {
    odds: odds ?? [],
    isLoading: odds === undefined,
    bestOdds,
  };
}

/**
 * Subscribe to odds comparison across multiple fixtures.
 * Useful for the odds comparison dashboard.
 */
export function useOddsComparison(options?: { limit?: number }) {
  const comparison = useQuery(api.realtime.getOddsComparison, {
    limit: options?.limit ?? 50,
  });

  return {
    comparison: comparison ?? [],
    isLoading: comparison === undefined,
  };
}

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

