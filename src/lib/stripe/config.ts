/**
 * Stripe Configuration
 *
 * Plan IDs are set via environment variables.
 * Create these in Stripe Dashboard → Products:
 *
 * Premium: recurring, ₦7,500/month
 * Elite: recurring, ₦20,000/month
 */

export const STRIPE_PLANS = {
  premium: {
    name: "Premium",
    description: "Unlimited predictions, accumulator builder, advanced analytics",
    price: 7500,
    currency: "ngn",
    interval: "month" as const,
    priceId: process.env.STRIPE_PREMIUM_PRICE_ID || "",
    features: [
      "Unlimited predictions",
      "All 360+ leagues",
      "Value bet detection",
      "Accumulator builder",
      "Weekly performance reports",
      "Priority support",
    ],
  },
  elite: {
    name: "Elite",
    description: "Everything + Crown Jewel, Rollover Challenge, AI Analyst",
    price: 20000,
    currency: "ngn",
    interval: "month" as const,
    priceId: process.env.STRIPE_ELITE_PRICE_ID || "",
    features: [
      "Everything in Premium",
      "Crown Jewel daily pick",
      "Rollover Challenge",
      "AI Analyst chat",
      "API access",
      "Dedicated support",
    ],
  },
} as const;

export type PlanTier = keyof typeof STRIPE_PLANS;

/**
 * Get the price ID for a plan tier
 */
export function getPriceId(tier: PlanTier): string {
  const plan = STRIPE_PLANS[tier];
  if (!plan.priceId) {
    throw new Error(`Stripe price ID not configured for ${tier} plan`);
  }
  return plan.priceId;
}

/**
 * Format price for display
 */
export function formatPrice(amount: number, currency: string = "ngn"): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount);
}
