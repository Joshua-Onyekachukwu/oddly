/**
 * Subscription entitlements — freemium + paid tiers.
 *
 * Tiers (profiles.subscription_tier): "free" | "premium" | "elite"
 * Prices defined in src/lib/stripe/config.ts (Premium ₦7,500/mo,
 * Elite ₦20,000/mo — NGN).
 *
 * ENFORCEMENT IS CURRENTLY DISABLED (`ENTITLEMENTS_ENFORCED = false`):
 * every feature is open to all tiers while the product is in free/
 * testing phase. Flip the flag (or per-feature) when paid launch
 * begins — no route changes needed, gates already consult this module.
 */

export type SubscriptionTier = "free" | "premium" | "elite";

export const ENTITLEMENTS_ENFORCED = false;

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  premium: 1,
  elite: 2,
};

export type FeatureKey =
  | "predictions.basic" // core predictions, matches, results — all tiers
  | "analytics.basic" // performance page, Brier/calibration
  | "accumulator" // accumulator builder
  | "notifications.basic"
  | "ai.chat" // AI analyst chat
  | "analytics.advanced" // deep performance/market analytics
  | "value_bets" // value-bet detection feed
  | "rollover" // 2.00 rollover engine (Elite)
  | "betting_agent" // betting-agent recommendations
  | "api.access" // programmatic API access
  | "support.priority";

/** Minimum tier required per feature. */
const FEATURE_MIN_TIER: Record<FeatureKey, SubscriptionTier> = {
  "predictions.basic": "free",
  "analytics.basic": "free",
  "notifications.basic": "free",
  "accumulator": "premium",
  "ai.chat": "elite",
  "analytics.advanced": "premium",
  "value_bets": "premium",
  "rollover": "elite",
  "betting_agent": "premium",
  "api.access": "elite",
  "support.priority": "elite",
};

export function normalizeTier(tier: string | null | undefined): SubscriptionTier {
  const t = (tier || "").toLowerCase();
  return t === "premium" || t === "elite" ? t : "free";
}

export function tierAtLeast(tier: SubscriptionTier, min: SubscriptionTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

/** Whether the tier may use the feature (always true while enforcement is off). */
export function hasFeature(tier: string | null | undefined, feature: FeatureKey): boolean {
  if (!ENTITLEMENTS_ENFORCED) return true;
  return tierAtLeast(normalizeTier(tier), FEATURE_MIN_TIER[feature]);
}

/** For API routes: returns an upgrade payload when the feature is gated and unmet. */
export function featureGateResponse(
  tier: string | null | undefined,
  feature: FeatureKey
): { allowed: true } | { allowed: false; status: number; body: Record<string, unknown> } {
  if (hasFeature(tier, feature)) return { allowed: true };
  const minTier = FEATURE_MIN_TIER[feature];
  return {
    allowed: false,
    status: 402,
    body: {
      error: "upgrade_required",
      feature,
      required_tier: minTier,
      message: `This feature requires the ${minTier} plan.`,
    },
  };
}

/** Human-readable plan comparison for pricing/marketing surfaces. */
export const PLAN_FEATURES: Record<SubscriptionTier, FeatureKey[]> = {
  free: [
    "predictions.basic",
    "analytics.basic",
    "notifications.basic",
  ],
  premium: [
    "predictions.basic",
    "analytics.basic",
    "notifications.basic",
    "accumulator",
    "analytics.advanced",
    "value_bets",
    "betting_agent",
  ],
  elite: [
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
  ],
};
