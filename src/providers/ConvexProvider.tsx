"use client";

import React, { useMemo } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

/**
 * ConvexClientProvider wraps the app with Convex's real-time provider.
 *
 * Architecture:
 * - Supabase (hot): Auth, user data, active predictions, accumulators
 * - Convex (cold/analytics): Historical predictions, xG data, referees, training data
 *
 * This provider enables real-time subscriptions to Convex data such as:
 * - Live prediction updates
 * - Odds snapshot changes
 * - Prediction settlement notifications
 */
export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const convex = useMemo(() => {
    if (!CONVEX_URL) {
      console.warn(
        "[Convex] NEXT_PUBLIC_CONVEX_URL not set — real-time features disabled",
      );
      return null;
    }
    return new ConvexReactClient(CONVEX_URL);
  }, []);

  if (!convex) {
    // Fallback: render children without Convex if URL is missing
    return <>{children}</>;
  }

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
