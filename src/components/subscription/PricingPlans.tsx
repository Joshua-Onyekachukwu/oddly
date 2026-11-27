"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { useSubscription } from "@/components/subscription/useSubscription";
import { SubscriptionBadge } from "@/components/subscription/SubscriptionBadge";
import {
  featuresForTier,
  getPlans,
  isPaidTier,
  type PlanMeta,
} from "@/lib/subscription/plans";
import type { SubscriptionTier } from "@/lib/subscription/entitlements";

/**
 * Interactive pricing cards — the single checkout surface.
 *
 * Feature lists come from PLAN_FEATURES via lib/subscription/plans (which
 * reads entitlements.ts). Paid CTAs POST /api/v1/stripe/checkout; users with
 * an active paid subscription are routed to the Stripe billing portal for
 * plan changes (the checkout route rejects duplicate subscriptions).
 */
export function PricingPlans() {
  const router = useRouter();
  const { user, session } = useAuth();
  const sub = useSubscription();

  const [checkoutTier, setCheckoutTier] = useState<SubscriptionTier | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openPortal = async () => {
    if (!session?.access_token) return;
    setPortalLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/stripe/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.portalUrl) {
        window.location.href = data.portalUrl;
        return;
      }
      setError(data.error || "Could not open the billing portal. Please try again.");
    } catch {
      setError("Could not open the billing portal. Please try again.");
    } finally {
      setPortalLoading(false);
    }
  };

  const startCheckout = async (tier: SubscriptionTier) => {
    if (!user) {
      router.push("/signup");
      return;
    }
    if (!session?.access_token) {
      setError("Your session has expired. Please sign in again.");
      return;
    }
    setCheckoutTier(tier);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }

      // Already subscribed — plan changes go through the billing portal.
      if (res.status === 409 || data.error === "already_subscribed") {
        setNotice("You already have an active subscription — opening the billing portal to manage your plan.");
        await openPortal();
        return;
      }

      // Stripe keys / price IDs not configured on this deployment.
      if (res.status === 503 || data.error === "Stripe is not configured yet") {
        setError(
          data.message ||
            "Payments aren't enabled yet — checkout requires Stripe to be configured. Please check back soon."
        );
        return;
      }

      setError(data.message || data.error || "Checkout failed. Please try again.");
    } catch {
      setError("Checkout failed. Please check your connection and try again.");
    } finally {
      setCheckoutTier(null);
    }
  };

  const renderCta = (plan: PlanMeta) => {
    const isCurrent = sub.tier === plan.tier;
    const loading = checkoutTier === plan.tier || portalLoading;

    // Signed-out visitors: free → signup, paid → signup (they subscribe after).
    if (!user) {
      return (
        <Link
          href="/signup"
          className={`group flex items-center justify-center gap-[8px] w-full font-display font-semibold text-[14px] rounded-full py-[13px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${
            plan.popular
              ? "bg-[#BFFF00] text-[#0A0F1C] hover:shadow-[0_0_30px_rgba(191,255,0,0.25)]"
              : "bg-[#0A0F1C] text-white hover:opacity-90"
          }`}
        >
          {isPaidTier(plan.tier) ? `Choose ${plan.name}` : "Get Started Free"}
          <span
            className={`w-[22px] h-[22px] rounded-full flex items-center justify-center transition-all duration-500 group-hover:translate-x-[2px] group-hover:-translate-y-[1px] ${
              plan.popular ? "bg-[#0A0F1C]/8" : "bg-white/10"
            }`}
          >
            <i className="ri-arrow-right-up-line text-[12px]"></i>
          </span>
        </Link>
      );
    }

    if (isCurrent) {
      return (
        <div className="space-y-[8px]">
          <button
            disabled
            className={`w-full font-display font-semibold text-[14px] rounded-full py-[13px] px-[24px] opacity-70 cursor-default ${
              plan.popular
                ? "bg-[#BFFF00] text-[#0A0F1C]"
                : plan.tier === "elite"
                ? "bg-[#1B2A4A] text-white"
                : "bg-[#0A0F1C]/10 text-[#0A0F1C]"
            }`}
          >
            Current plan
          </button>
          {isPaidTier(plan.tier) && sub.hasActivePaidSub && (
            <button
              onClick={openPortal}
              disabled={portalLoading}
              className="w-full text-[12px] font-semibold text-gray-500 hover:text-[#1B2A4A] transition-colors disabled:opacity-50"
            >
              {portalLoading ? "Opening portal…" : "Manage billing →"}
            </button>
          )}
        </div>
      );
    }

    // Paid card while on a paid plan → checkout route will 409 → portal.
    const ctaLabel = isPaidTier(plan.tier)
      ? sub.hasActivePaidSub
        ? `Switch to ${plan.name}`
        : `Choose ${plan.name}`
      : "Switch to Free";

    return (
      <button
        onClick={() =>
          isPaidTier(plan.tier) ? startCheckout(plan.tier) : openPortal()
        }
        disabled={loading}
        className={`group flex items-center justify-center gap-[8px] w-full font-display font-semibold text-[14px] rounded-full py-[13px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed ${
          plan.popular
            ? "bg-[#BFFF00] text-[#0A0F1C] hover:shadow-[0_0_30px_rgba(191,255,0,0.25)]"
            : plan.tier === "elite"
            ? "bg-[#1B2A4A] text-white hover:opacity-90"
            : "bg-[#0A0F1C]/10 text-[#0A0F1C] hover:bg-[#0A0F1C]/15"
        }`}
      >
        {loading ? (
          <span className="w-[14px] h-[14px] border-2 border-current/30 border-t-current rounded-full animate-spin" />
        ) : (
          <>
            {ctaLabel}
            <span
              className={`w-[22px] h-[22px] rounded-full flex items-center justify-center transition-all duration-500 group-hover:translate-x-[2px] group-hover:-translate-y-[1px] ${
                plan.popular ? "bg-[#0A0F1C]/8" : "bg-white/10"
              }`}
            >
              <i className="ri-arrow-right-up-line text-[12px]"></i>
            </span>
          </>
        )}
      </button>
    );
  };

  return (
    <div>
      {/* Current subscription status */}
      {user && (
        <div className="flex flex-wrap items-center justify-center gap-[10px] mb-[28px]">
          <SubscriptionBadge tier={sub.tier} showLabel />
          {sub.status && (
            <span className="text-[12px] text-gray-400">
              {sub.status === "past_due"
                ? "Payment past due — update your card in the billing portal."
                : sub.cancelAtPeriodEnd && sub.currentPeriodEnd
                ? `Cancels on ${new Date(sub.currentPeriodEnd).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}`
                : sub.currentPeriodEnd && isPaidTier(sub.tier)
                ? `Renews ${new Date(sub.currentPeriodEnd).toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}`
                : "Active"}
            </span>
          )}
        </div>
      )}

      {notice && (
        <div className="max-w-[640px] mx-auto mb-[20px] bg-blue-50 border border-blue-100 rounded-[10px] p-[12px] text-[13px] text-blue-700 flex items-center gap-[8px]" role="status">
          <i className="ri-information-line text-[14px] flex-none" />
          {notice}
        </div>
      )}
      {error && (
        <div className="max-w-[640px] mx-auto mb-[20px] bg-amber-50 border border-amber-100 rounded-[10px] p-[12px] text-[13px] text-amber-700 flex items-center gap-[8px]" role="alert">
          <i className="ri-error-warning-line text-[14px] flex-none" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-[20px] max-w-[1000px] mx-auto items-start">
        {getPlans().map((plan) => {
          const features = featuresForTier(plan.tier);
          return (
            <div
              key={plan.tier}
              className={`relative rounded-[1.75rem] p-[6px] transition-all duration-500 ${
                plan.popular
                  ? "bg-gradient-to-b from-[#BFFF00]/20 to-[#BFFF00]/5 ring-2 ring-[#BFFF00]/30"
                  : "bg-[#0A0F1C]/[0.02] ring-1 ring-[#0A0F1C]/[0.04]"
              }`}
            >
              <div
                className={`relative rounded-[calc(1.75rem-6px)] p-[28px] ${
                  plan.popular
                    ? "bg-[#0A0F1C] text-white shadow-[0_20px_60px_-15px_rgba(27,42,74,0.4)]"
                    : "bg-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]"
                }`}
              >
                {(plan.badge || plan.popular) && (
                  <div className="absolute -top-[10px] left-1/2 -translate-x-1/2">
                    <span
                      className={`text-[10px] font-bold px-[16px] py-[5px] rounded-full uppercase tracking-[0.1em] font-display ${
                        plan.popular
                          ? "bg-[#BFFF00] text-[#0A0F1C]"
                          : "bg-[#1B2A4A] text-white"
                      }`}
                    >
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="mb-[20px]">
                  <h2
                    className={`font-display text-[18px] font-semibold !mb-[4px] ${
                      plan.popular ? "text-white" : "text-[#0A0F1C]"
                    }`}
                  >
                    {plan.name}
                  </h2>
                  <p
                    className={`text-[13px] !mb-0 !leading-[1.6] ${
                      plan.popular ? "text-white/50" : "text-gray-400"
                    }`}
                  >
                    {plan.description}
                  </p>
                </div>

                <div className="mb-[24px]">
                  <span
                    className={`font-display text-[40px] font-bold tracking-[-0.04em] ${
                      plan.popular ? "text-white" : "text-[#0A0F1C]"
                    }`}
                  >
                    {plan.price}
                  </span>
                  <span className={`text-[14px] ${plan.popular ? "text-white/40" : "text-gray-400"}`}>
                    {plan.period === "/month" ? "/month" : plan.period}
                  </span>
                </div>

                <ul className="space-y-[10px] mb-[24px]">
                  {features.map((feature) => (
                    <li key={feature.key} className="flex items-start gap-[8px]">
                      <i
                        className={`ri-check-line text-[14px] mt-[3px] flex-none ${
                          plan.popular ? "text-[#BFFF00]" : "text-[#22c55e]"
                        }`}
                      ></i>
                      <span
                        className={`text-[13px] !leading-[1.5] ${
                          plan.popular ? "text-white/60" : "text-gray-500"
                        }`}
                      >
                        {feature.label}
                      </span>
                    </li>
                  ))}
                </ul>

                {renderCta(plan)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

