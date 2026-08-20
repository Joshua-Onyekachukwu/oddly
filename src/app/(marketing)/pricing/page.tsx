"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STRIPE_PLANS, formatPrice, type PlanTier } from "@/lib/stripe/config";

const plans = [
  {
    tier: "free" as PlanTier | "free",
    name: "Free",
    price: 0,
    period: "forever",
    popular: false,
    cta: "Get Started",
    ctaStyle: "btn-secondary",
    features: [
      "Daily predictions (5 matches)",
      "10-leg accumulator limit",
      "AI analyst (3 queries/day)",
      "Basic match tracking",
      "5 leagues coverage",
    ],
    limitations: [
      "No value bet detection",
      "No Crown Jewel picks",
      "No rollover challenge",
      "No performance analytics",
    ],
  },
  {
    tier: "premium" as PlanTier,
    name: "Premium",
    price: 7500,
    period: "per month",
    popular: true,
    cta: "Upgrade to Premium",
    ctaStyle: "btn-primary",
    features: [
      "Everything in Free",
      "Unlimited predictions",
      "All 100+ leagues",
      "Value bet detection",
      "Accumulator builder (unlimited legs)",
      "AI analyst (50 queries/day)",
      "Advanced analytics dashboard",
      "Rollover challenge access",
      "Weekly performance reports",
      "Priority support",
    ],
    limitations: [],
  },
  {
    tier: "elite" as PlanTier,
    name: "Elite",
    price: 20000,
    period: "per month",
    popular: false,
    cta: "Upgrade to Elite",
    ctaStyle: "elite-btn",
    features: [
      "Everything in Premium",
      "Crown Jewel daily pick",
      "Unlimited AI queries",
      "API access",
      "Self-training model insights",
      "Custom prediction models",
      "Dedicated support",
      "Early access to new features",
    ],
    limitations: [],
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<PlanTier | "free" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async (tier: PlanTier) => {
    setError(null);
    setLoading(tier);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        // Redirect to login with return to pricing
        router.push("/login?redirect=/pricing");
        return;
      }

      const response = await fetch("/api/v1/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tier }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      console.error("Checkout error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(null);
    }
  };

  const handleGetStarted = () => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push("/matches");
      } else {
        router.push("/signup");
      }
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#fafafa] to-white">
      {/* Hero */}
      <section className="pt-28 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <span className="inline-block px-4 py-1.5 rounded-full bg-oddly-orange/10 text-oddly-orange text-xs font-semibold tracking-wide uppercase mb-6">
            Pricing
          </span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-oddly-navy mb-6 leading-tight">
            Start Free.{" "}
            <span className="text-oddly-orange">Upgrade</span> When Ready.
          </h1>
          <p className="text-lg md:text-xl text-neutral-600 max-w-2xl mx-auto leading-relaxed">
            All the power of AI-driven football predictions, starting at ₦0.
            No credit card required to sign up.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-8 items-start">
          {plans.map((plan) => (
            <div
              key={plan.tier}
              className={`relative rounded-2xl border-2 p-8 transition-all duration-300 ${
                plan.popular
                  ? "border-oddly-orange shadow-xl shadow-oddly-orange/10 scale-[1.02]"
                  : "border-neutral-200 hover:border-neutral-300 hover:shadow-lg"
              } ${plan.tier === "elite" ? "border-oddly-navy" : ""}`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-oddly-orange text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg">
                    MOST POPULAR
                  </span>
                </div>
              )}

              {plan.tier === "elite" && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-oddly-navy text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg">
                    BEST VALUE
                  </span>
                </div>
              )}

              <div className="text-center mb-8">
                <h3 className="text-xl font-bold text-oddly-navy">{plan.name}</h3>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-oddly-navy">
                    {plan.price === 0 ? "₦0" : formatPrice(plan.price)}
                  </span>
                  <span className="text-neutral-500 ml-2">{plan.period}</span>
                </div>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3 text-sm">
                    <svg
                      className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-neutral-700">{feature}</span>
                  </li>
                ))}
                {plan.limitations.map((limitation) => (
                  <li
                    key={limitation}
                    className="flex items-start gap-3 text-sm opacity-50"
                  >
                    <svg
                      className="w-5 h-5 text-neutral-400 flex-shrink-0 mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-neutral-500">{limitation}</span>
                  </li>
                ))}
              </ul>

              {plan.tier === "free" ? (
                <button
                  onClick={handleGetStarted}
                  className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 ${plan.ctaStyle}`}
                >
                  {plan.cta}
                </button>
              ) : (
                <button
                  onClick={() => handleSubscribe(plan.tier as PlanTier)}
                  disabled={loading === plan.tier}
                  className={`w-full py-3 rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                    plan.tier === "elite"
                      ? "bg-oddly-navy text-white hover:bg-oddly-navy-light"
                      : plan.ctaStyle
                  }`}
                >
                  {loading === plan.tier ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg
                        className="animate-spin h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      Processing...
                    </span>
                  ) : (
                    plan.cta
                  )}
                </button>
              )}
            </div>
          ))}
        </div>

        {error && (
          <div className="max-w-md mx-auto mt-8 p-4 bg-red-50 border border-red-200 rounded-xl text-center">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </section>

      {/* FAQ */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-oddly-navy text-center mb-12">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            {[
              {
                q: "Can I cancel anytime?",
                a: "Yes. Cancel from your dashboard settings or through Stripe's billing portal. Your access continues until the end of your billing period.",
              },
              {
                q: "What payment methods do you accept?",
                a: "We accept all major credit and debit cards (Visa, Mastercard, Verve) processed securely through Stripe.",
              },
              {
                q: "What happens after I upgrade?",
                a: "You get instant access to your new tier's features. No waiting period — the AI models start generating predictions for all your tracked leagues immediately.",
              },
              {
                q: "Is there a refund policy?",
                a: "We offer a 7-day money-back guarantee. If you're not satisfied within the first week, contact us for a full refund.",
              },
              {
                q: "Can I switch plans?",
                a: "You can upgrade from Free to Premium or Elite at any time. Contact support to switch between Premium and Elite.",
              },
            ].map((faq) => (
              <details
                key={faq.q}
                className="group border border-neutral-200 rounded-xl overflow-hidden"
              >
                <summary className="px-6 py-4 cursor-pointer font-semibold text-oddly-navy flex items-center justify-between hover:bg-neutral-50 transition-colors">
                  {faq.q}
                  <svg
                    className="w-5 h-5 text-neutral-400 group-open:rotate-180 transition-transform"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </summary>
                <div className="px-6 pb-4 text-neutral-600 text-sm leading-relaxed">
                  {faq.a}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
