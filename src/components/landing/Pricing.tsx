"use client";

import React, { useState } from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";
import type { LandingStats } from "@/lib/landing-stats";

interface PricingProps {
  stats?: LandingStats;
}

const getPlans = (leagueCount: string) => [
  {
    name: "Free",
    price: "₦0",
    period: "/forever",
    description: "Get started with basic predictions and track your progress.",
    features: [
      "5 predictions per day",
      "Basic match stats",
      "Community access",
      "Mobile-friendly dashboard",
    ],
    cta: "Start Free",
    popular: false,
  },
  {
    name: "Premium",
    price: "₦7,500",
    period: "/month",
    description: "Full access to all models, value bet detection, and accumulator builder.",
    features: [
      "Unlimited predictions",
      `All ${leagueCount} leagues`,
      "Value bet detection",
      "Accumulator builder",
      "Weekly performance reports",
      "Priority support",
    ],
    cta: "Go Premium",
    popular: true,
  },
  {
    name: "Elite",
    price: "₦20,000",
    period: "/month",
    description: "Everything plus Crown Jewel, Rollover Challenge, and AI Analyst.",
    features: [
      "Everything in Premium",
      "Crown Jewel daily pick",
      "Rollover Challenge",
      "AI Analyst chat",
      "API access",
      "Dedicated support",
    ],
    cta: "Go Elite",
    popular: false,
  },
];

const Pricing: React.FC<PricingProps> = ({ stats }) => {
  const [annual, setAnnual] = useState(false);
  const { ref, isVisible } = useScrollReveal({ threshold: 0.1 });

  return (
    <div className="py-[80px] md:py-[100px] lg:py-[120px]" id="pricing" ref={ref}>
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        <div
          {...getScrollRevealClasses(isVisible, 0)}
          className="text-center mb-[48px] md:mb-[60px] max-w-[540px] mx-auto"
        >
          <span className="inline-flex items-center gap-[6px] text-[10px] font-semibold text-[#0A0F1C]/60 dark:text-white/50 bg-[#0A0F1C]/[0.03] dark:bg-white/[0.03] px-[14px] py-[6px] rounded-full mb-[20px] uppercase tracking-[0.15em] font-display">
            Pricing
          </span>
          <h2 className="font-display !text-[32px] md:!text-[40px] lg:!text-[48px] !leading-[1.1] !tracking-[-0.03em] !mb-[12px] text-[#0A0F1C] dark:text-white">
            Simple, transparent
          </h2>
          <p className="text-[15px] md:text-[17px] text-gray-400 !mb-0 !leading-[1.75]">
            Start free, upgrade when you&apos;re ready. No hidden fees, no surprises.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-[20px] max-w-[1000px] mx-auto">
          {getPlans(stats?.totalLeagues ? `${stats.totalLeagues}+` : "360+").map((plan, i) => (
            <div
              key={plan.name}
              {...getScrollRevealClasses(isVisible, 100 + i * 80)}
            >
              {/* Double-Bezel */}
              <div
                className={`relative rounded-[1.75rem] p-[6px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  plan.popular
                    ? "bg-gradient-to-b from-[#BFFF00]/20 to-[#BFFF00]/5 ring-2 ring-[#BFFF00]/30"
                    : "bg-[#0A0F1C]/[0.02] dark:bg-white/[0.02] ring-1 ring-[#0A0F1C]/[0.04] dark:ring-white/[0.04]"
                }`}
              >
                {/* Inner core */}
                <div
                  className={`relative rounded-[calc(1.75rem-6px)] p-[28px] transition-all duration-700 ${
                    plan.popular
                      ? "bg-[#0A0F1C] text-white shadow-[0_20px_60px_-15px_rgba(27,42,74,0.4)]"
                      : "bg-white dark:bg-[#0c1427] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]"
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-[10px] left-1/2 -translate-x-1/2">
                      <span className="bg-[#BFFF00] text-[#0A0F1C] text-[10px] font-bold px-[16px] py-[5px] rounded-full uppercase tracking-[0.1em] font-display">
                        Most Popular
                      </span>
                    </div>
                  )}

                  <div className="mb-[20px]">
                    <h3
                      className={`font-display text-[18px] font-semibold !mb-[4px] ${
                        plan.popular ? "text-white" : "text-[#0A0F1C] dark:text-white"
                      }`}
                    >
                      {plan.name}
                    </h3>
                    <p
                      className={`text-[13px] !mb-0 !leading-[1.6] ${
                        plan.popular ? "text-white/50" : "text-gray-400"
                      }`}
                    >
                      {plan.description}
                    </p>
                  </div>

                  <div className="mb-[28px]">
                    <span
                      className={`font-display text-[40px] font-bold tracking-[-0.04em] ${
                        plan.popular ? "text-white" : "text-[#0A0F1C] dark:text-white"
                      }`}
                    >
                      {plan.price}
                    </span>
                    <span
                      className={`text-[14px] ${
                        plan.popular ? "text-white/40" : "text-gray-400"
                      }`}
                    >
                      {plan.period}
                    </span>
                  </div>

                  <ul className="space-y-[12px] mb-[28px]">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-[10px]">
                        <i
                          className={`ri-check-line text-[14px] mt-[3px] flex-none ${
                            plan.popular ? "text-[#BFFF00]" : "text-[#22c55e]"
                          }`}
                        ></i>
                        <span
                          className={`text-[13px] !leading-[1.5] ${
                            plan.popular ? "text-white/60" : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* Button-in-Button */}
                  <a
                    href="/signup"
                    className={`group flex items-center justify-center gap-[8px] w-full font-display font-semibold text-[14px] rounded-full py-[13px] px-[24px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${
                      plan.popular
                        ? "bg-[#BFFF00] text-[#0A0F1C] hover:shadow-[0_0_30px_rgba(191,255,0,0.25)]"
                        : "bg-[#0A0F1C] dark:bg-white text-white dark:text-[#0A0F1C] hover:opacity-90"
                    }`}
                  >
                    {plan.cta}
                    <span
                      className={`w-[22px] h-[22px] rounded-full flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-[2px] group-hover:-translate-y-[1px] ${
                        plan.popular
                          ? "bg-[#0A0F1C]/8"
                          : "bg-white/10 dark:bg-[#0A0F1C]/8"
                      }`}
                    >
                      <i className="ri-arrow-right-up-line text-[12px]"></i>
                    </span>
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Pricing;
