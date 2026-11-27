import Link from "next/link";

const plans = [
  {
    tier: "free" as const,
    name: "Free",
    price: "₦0",
    period: "forever",
    popular: false,
    cta: "Get Started Free",
    ctaHref: "/signup",
    features: [
      "Daily predictions (5 matches)",
      "10-leg accumulator limit",
      "AI analyst (3 queries/day)",
      "Basic match tracking",
      "5 leagues coverage",
    ],
    limitations: [
      "No value bet detection",
      "No daily top picks",
      "No rollover challenge",
      "No performance analytics",
    ],
  },
  {
    tier: "premium" as const,
    name: "Premium",
    price: "₦7,500",
    period: "per month",
    popular: true,
    cta: "Coming Soon",
    ctaHref: null,
    features: [
      "Everything in Free",
      "Unlimited predictions",
      "All covered leagues",
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
    tier: "elite" as const,
    name: "Elite",
    price: "₦20,000",
    period: "per month",
    popular: false,
    cta: "Coming Soon",
    ctaHref: null,
    features: [
      "Everything in Premium",
      "Daily top pick",
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

const comparison = [
  { feature: "Daily Predictions", free: "5 matches", premium: "Unlimited", elite: "Unlimited" },
  { feature: "Leagues Covered", free: "5 leagues", premium: "All covered leagues", elite: "All covered leagues" },
  { feature: "Accumulator Builder", free: "10-leg max", premium: "Unlimited legs", elite: "Unlimited legs" },
  { feature: "AI Analyst", free: "3 queries/day", premium: "50 queries/day", elite: "Unlimited" },
  { feature: "Value Bet Detection", free: false, premium: true, elite: true },
  { feature: "Daily Top Pick", free: false, premium: false, elite: true },
  { feature: "Rollover Challenge", free: false, premium: true, elite: true },
  { feature: "Performance Analytics", free: false, premium: true, elite: true },
  { feature: "Weekly Reports", free: false, premium: true, elite: true },
  { feature: "API Access", free: false, premium: false, elite: true },
  { feature: "Custom Models", free: false, premium: false, elite: true },
  { feature: "Priority Support", free: false, premium: true, elite: true },
  { feature: "Early Access Features", free: false, premium: false, elite: true },
];

const faqs = [
  {
    q: "Is ODDLY really free right now?",
    a: "Yes! We're in our testing phase and offering full access to all features at no cost. This gives us the data we need to fine-tune our prediction models.",
  },
  {
    q: "Will I lose access when paid plans launch?",
    a: "No. Early users who signed up during the free period will receive a special discount when paid plans launch.",
  },
  {
    q: "How accurate are the predictions?",
    a: "Our ensemble combines multiple statistical and machine-learning models with real-time odds analysis. We're continuously training on live data, and settled results are tracked inside the app.",
  },
  {
    q: "What data sources do you use?",
    a: "We pull live odds from multiple bookmakers, fixture data from football data providers, and run predictions through our ensemble pipeline.",
  },
  {
    q: "Can I track my bets?",
    a: "Yes. The tracking dashboard shows your ROI, win rate, streak, and performance breakdown by league and market type.",
  },
];

function Cell({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <i className="ri-check-line text-[16px] text-[#22c55e]"></i>
    ) : (
      <span className="text-gray-300">—</span>
    );
  }
  return <span className="text-[12px] text-gray-500 font-mono-data">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      {/* Hero */}
      <section className="pt-[120px] md:pt-[140px] pb-[48px] md:pb-[64px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px] text-center">
          <div className="inline-flex items-center gap-[6px] text-[10px] font-semibold text-[#0A0F1C]/60 bg-[#0A0F1C]/[0.03] px-[14px] py-[6px] rounded-full mb-[20px] uppercase tracking-[0.15em] font-display">
            Pricing
          </div>
          <h1 className="font-display !text-[32px] md:!text-[44px] lg:!text-[52px] !leading-[1.1] !tracking-[-0.03em] !mb-[16px] text-[#0A0F1C]">
            Start Free. <span className="text-[#1B2A4A]">Upgrade</span> When Ready.
          </h1>
          <p className="text-[15px] md:text-[17px] text-gray-500 max-w-[560px] mx-auto !leading-[1.75]">
            All the power of AI-driven football predictions, starting at ₦0.
            No credit card required to sign up.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-[64px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[20px] max-w-[1000px] mx-auto items-start">
            {plans.map((plan) => (
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
                  {plan.popular && (
                    <div className="absolute -top-[10px] left-1/2 -translate-x-1/2">
                      <span className="bg-[#BFFF00] text-[#0A0F1C] text-[10px] font-bold px-[16px] py-[5px] rounded-full uppercase tracking-[0.1em] font-display">
                        Most Popular
                      </span>
                    </div>
                  )}
                  {plan.tier === "elite" && (
                    <div className="absolute -top-[10px] left-1/2 -translate-x-1/2">
                      <span className="bg-[#1B2A4A] text-white text-[10px] font-bold px-[16px] py-[5px] rounded-full uppercase tracking-[0.1em] font-display">
                        Best Value
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
                      {plan.tier === "premium"
                        ? "Full access to all models, value bet detection, and accumulator builder."
                        : plan.tier === "elite"
                        ? "Everything plus Top Pick, Rollover Challenge, and AI Analyst."
                        : "Get started with basic predictions and track your progress."}
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
                      /{plan.period}
                    </span>
                  </div>

                  <ul className="space-y-[10px] mb-[24px]">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-[8px]">
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
                          {feature}
                        </span>
                      </li>
                    ))}
                    {plan.limitations.map((limitation) => (
                      <li key={limitation} className="flex items-start gap-[8px] opacity-50">
                        <i className="ri-close-line text-[14px] mt-[3px] flex-none text-gray-400"></i>
                        <span className="text-[13px] !leading-[1.5] text-gray-400">
                          {limitation}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {plan.ctaHref ? (
                    <Link
                      href={plan.ctaHref}
                      className={`group flex items-center justify-center gap-[8px] w-full font-display font-semibold text-[14px] rounded-full py-[13px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] ${
                        plan.popular
                          ? "bg-[#BFFF00] text-[#0A0F1C] hover:shadow-[0_0_30px_rgba(191,255,0,0.25)]"
                          : "bg-[#0A0F1C] text-white hover:opacity-90"
                      }`}
                    >
                      {plan.cta}
                      <span
                        className={`w-[22px] h-[22px] rounded-full flex items-center justify-center transition-all duration-500 group-hover:translate-x-[2px] group-hover:-translate-y-[1px] ${
                          plan.popular ? "bg-[#0A0F1C]/8" : "bg-white/10"
                        }`}
                      >
                        <i className="ri-arrow-right-up-line text-[12px]"></i>
                      </span>
                    </Link>
                  ) : (
                    <button
                      disabled
                      className={`w-full font-display font-semibold text-[14px] rounded-full py-[13px] px-[24px] opacity-60 cursor-not-allowed ${
                        plan.popular
                          ? "bg-[#BFFF00] text-[#0A0F1C]"
                          : plan.tier === "elite"
                          ? "bg-[#1B2A4A] text-white"
                          : "bg-[#0A0F1C]/10 text-[#0A0F1C]"
                      }`}
                    >
                      {plan.cta}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Coming Soon note */}
          <div className="max-w-[640px] mx-auto mt-[48px]">
            <div className="bg-white rounded-[1.25rem] border border-gray-100 p-[28px] md:p-[36px] text-center">
              <h2 className="font-display text-[18px] md:text-[20px] font-semibold text-[#0A0F1C] !mb-[8px]">
                Premium Plans Coming Soon
              </h2>
              <p className="text-[13px] md:text-[14px] text-gray-500 !leading-[1.7] !mb-[8px]">
                We&apos;re currently in our testing phase, perfecting the prediction
                engine and building enough data to prove our edge. Premium and Elite
                tiers will launch once we&apos;re ready to scale.
              </p>
              <p className="text-[12px] text-gray-400">
                In the meantime, enjoy full access to all features for free.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="pb-[80px] md:pb-[100px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <h2 className="font-display text-[24px] md:text-[32px] font-bold text-[#0A0F1C] text-center !mb-[8px]">
            Compare Plans
          </h2>
          <p className="text-[14px] text-gray-400 text-center !mb-[32px]">
            See exactly what you get with each tier.
          </p>
          <div className="bg-white rounded-[1.25rem] border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-[#F8FAFC]">
                    <th className="text-left py-[14px] px-[16px] font-display text-[12px] font-semibold text-gray-500 uppercase tracking-wider w-[40%]">
                      Feature
                    </th>
                    <th className="text-center py-[14px] px-[16px] font-display text-[12px] font-semibold text-gray-500 uppercase tracking-wider">
                      Free
                    </th>
                    <th className="text-center py-[14px] px-[16px] font-display text-[12px] font-semibold text-[#1B2A4A] uppercase tracking-wider">
                      Premium
                    </th>
                    <th className="text-center py-[14px] px-[16px] font-display text-[12px] font-semibold text-[#1B2A4A] uppercase tracking-wider">
                      Elite
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row, i) => (
                    <tr key={row.feature} className={`border-b border-gray-50 ${i % 2 === 0 ? "bg-white" : "bg-[#FAFBFC]"}`}>
                      <td className="py-[12px] px-[16px] font-medium text-[13px] text-[#0A0F1C]">
                        {row.feature}
                      </td>
                      <td className="text-center py-[12px] px-[16px]"><Cell value={row.free} /></td>
                      <td className="text-center py-[12px] px-[16px]"><Cell value={row.premium} /></td>
                      <td className="text-center py-[12px] px-[16px]"><Cell value={row.elite} /></td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-100 bg-[#F8FAFC]">
                    <td className="py-[14px] px-[16px] font-display text-[13px] font-semibold text-[#0A0F1C]">
                      Price
                    </td>
                    <td className="text-center py-[14px] px-[16px]">
                      <span className="font-display text-[18px] font-bold text-[#0A0F1C]">₦0</span>
                    </td>
                    <td className="text-center py-[14px] px-[16px]">
                      <span className="font-display text-[18px] font-bold text-[#1B2A4A]">₦7,500</span>
                      <span className="text-gray-400 text-[11px]">/mo</span>
                    </td>
                    <td className="text-center py-[14px] px-[16px]">
                      <span className="font-display text-[18px] font-bold text-[#1B2A4A]">₦20,000</span>
                      <span className="text-gray-400 text-[11px]">/mo</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="pb-[80px] md:pb-[100px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <h2 className="font-display text-[24px] md:text-[32px] font-bold text-[#0A0F1C] text-center !mb-[32px]">
            Frequently Asked Questions
          </h2>
          <div className="max-w-[680px] mx-auto space-y-[8px]">
            {faqs.map((faq) => (
              <details
                key={faq.q}
                className="group bg-white rounded-[12px] border border-gray-100 overflow-hidden"
              >
                <summary className="px-[20px] py-[16px] cursor-pointer font-display text-[14px] font-semibold text-[#0A0F1C] flex items-center justify-between gap-[12px] hover:bg-[#F8FAFC] transition-colors list-none [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <i className="ri-arrow-down-s-line text-[18px] text-gray-400 transition-transform duration-300 group-open:rotate-180 flex-none"></i>
                </summary>
                <div className="px-[20px] pb-[18px] text-[13px] text-gray-500 !leading-[1.7]">
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
