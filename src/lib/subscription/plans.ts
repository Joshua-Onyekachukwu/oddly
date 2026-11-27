/**
 * Plan presentation metadata — single source of truth for pricing/checkout UI.
 *
 * Feature membership comes from PLAN_FEATURES in ./entitlements (derived from
 * FEATURE_MIN_TIER). This module only adds display labels, prices and CTA
 * copy — it never re-declares which features a tier includes.
 *
 * Prices mirror src/lib/stripe/config.ts (STRIPE_PLANS); plans.test.ts
 * asserts they stay in sync.
 */

import {
  PLAN_FEATURES,
  normalizeTier,
  type FeatureKey,
  type SubscriptionTier,
} from "./entitlements";

export const TIER_ORDER: SubscriptionTier[] = ["free", "premium", "elite"];

export function isPaidTier(tier: SubscriptionTier): boolean {
  return tier !== "free";
}

/** Monthly price in NGN — must match STRIPE_PLANS[tier].price in lib/stripe/config. */
export const PLAN_PRICE_NGN: Record<Exclude<SubscriptionTier, "free">, number> = {
  premium: 7500,
  elite: 20000,
};

export interface PlanMeta {
  tier: SubscriptionTier;
  name: string;
  /** Display price, e.g. "₦7,500" or "₦0". */
  price: string;
  period: string;
  description: string;
  popular: boolean;
  badge?: string;
}

export const PLAN_META: Record<SubscriptionTier, PlanMeta> = {
  free: {
    tier: "free",
    name: "Free",
    price: "₦0",
    period: "forever",
    description: "Get started with core predictions and track your progress.",
    popular: false,
  },
  premium: {
    tier: "premium",
    name: "Premium",
    price: "₦7,500",
    period: "/month",
    description: "Full access to advanced analytics, value bets and the accumulator builder.",
    popular: true,
    badge: "Most Popular",
  },
  elite: {
    tier: "elite",
    name: "Elite",
    price: "₦20,000",
    period: "/month",
    description: "Everything plus the Rollover engine, AI Analyst and API access.",
    popular: false,
    badge: "Best Value",
  },
};

/** Human-readable labels for every FeatureKey. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  "predictions.basic": "Daily match predictions",
  "analytics.basic": "Performance dashboard & calibration",
  "notifications.basic": "Result & pick notifications",
  accumulator: "Accumulator builder",
  "analytics.advanced": "Advanced performance & market analytics",
  value_bets: "Value bet detection",
  betting_agent: "Betting agent recommendations",
  "ai.chat": "AI Analyst chat",
  rollover: "Rollover engine (2.00 challenge)",
  "api.access": "API access",
  "support.priority": "Priority support",
};

/** Display order for comparison tables / checklists. */
export const FEATURE_ORDER: FeatureKey[] = [
  "predictions.basic",
  "analytics.basic",
  "notifications.basic",
  "accumulator",
  "analytics.advanced",
  "value_bets",
  "betting_agent",
  "ai.chat",
  "rollover",
  "api.access",
  "support.priority",
];

export interface PlanFeature {
  key: FeatureKey;
  label: string;
}

/** Features included in a tier, straight from PLAN_FEATURES. */
export function featuresForTier(tier: string | null | undefined): PlanFeature[] {
  const normalized = normalizeTier(tier);
  return PLAN_FEATURES[normalized].map((key) => ({
    key,
    label: FEATURE_LABELS[key],
  }));
}

/** Whether a tier's plan includes a feature (per PLAN_FEATURES). */
export function planIncludes(tier: string | null | undefined, feature: FeatureKey): boolean {
  return PLAN_FEATURES[normalizeTier(tier)].includes(feature);
}

/** Ordered plan cards for pricing surfaces. */
export function getPlans(): PlanMeta[] {
  return TIER_ORDER.map((tier) => PLAN_META[tier]);
}
