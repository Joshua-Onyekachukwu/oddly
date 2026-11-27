"use client";

import React from "react";
import { Badge } from "@/components/ui";
import { normalizeTier, type SubscriptionTier } from "@/lib/subscription/entitlements";
import { PLAN_META } from "@/lib/subscription/plans";

const TIER_BADGE_VARIANT: Record<SubscriptionTier, "default" | "info" | "accent"> = {
  free: "default",
  premium: "info",
  elite: "accent",
};

interface SubscriptionBadgeProps {
  tier: string | null | undefined;
  /** Show "Current plan:" prefix (pricing page) vs bare tier (settings). */
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** Plan badge driven by the entitlements tier — free/premium/elite. */
export function SubscriptionBadge({
  tier,
  showLabel = false,
  size = "sm",
  className = "",
}: SubscriptionBadgeProps) {
  const normalized = normalizeTier(tier);
  const meta = PLAN_META[normalized];
  return (
    <span className={`inline-flex items-center gap-[6px] ${className}`}>
      {showLabel && (
        <span className="text-[11px] text-gray-400">Current plan:</span>
      )}
      <Badge variant={TIER_BADGE_VARIANT[normalized]} size={size}>
        {meta.name}
      </Badge>
    </span>
  );
}
