"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { normalizeTier, type SubscriptionTier } from "@/lib/subscription/entitlements";

export interface SubscriptionState {
  /** Effective tier — subscriptions row wins when it has a live status. */
  tier: SubscriptionTier;
  /** Raw Stripe-mirrored status, null when no row / not signed in. */
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete" | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** True while the subscriptions lookup is in flight. */
  loading: boolean;
  /** True when the user has a live (non-canceled) paid subscription. */
  hasActivePaidSub: boolean;
}

const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Reads the user's subscription state.
 *
 * Primary source: the `subscriptions` table row owned by the user (same
 * direct-table pattern used for user_favourites on the settings page).
 * Falls back to the denormalized profiles.subscription_tier cache via
 * useAuth().profile when no live row exists.
 */
export function useSubscription(): SubscriptionState {
  const { user, profile } = useAuth();
  const [row, setRow] = useState<{
    tier: SubscriptionTier;
    status: NonNullable<SubscriptionState["status"]>;
    current_period_end: string | null;
    cancel_at_period_end: boolean | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRow(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("subscriptions")
      .select("tier, status, current_period_end, cancel_at_period_end")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load subscription:", error);
          setRow(null);
        } else if (data && LIVE_STATUSES.has(data.status)) {
          setRow({
            tier: normalizeTier(data.tier),
            status: data.status,
            current_period_end: data.current_period_end,
            cancel_at_period_end: data.cancel_at_period_end ?? false,
          });
        } else {
          setRow(null);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const profileTier = normalizeTier(profile?.subscription_tier);
  const livePaid = row !== null && row.tier !== "free";

  const tier: SubscriptionTier = livePaid
    ? row!.tier
    : profileTier;

  return {
    tier,
    status: row?.status ?? null,
    currentPeriodEnd: row?.current_period_end ?? profile?.subscription_expires_at ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    loading,
    hasActivePaidSub: livePaid,
  };
}

export type { SubscriptionTier };
