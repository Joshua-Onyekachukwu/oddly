import { PricingPlans } from "@/components/subscription/PricingPlans";
import {
  FEATURE_LABELS,
  FEATURE_ORDER,
  PLAN_META,
  planIncludes,
} from "@/lib/subscription/plans";
import type { SubscriptionTier } from "@/lib/subscription/entitlements";

const TIERS: SubscriptionTier[] = ["free", "premium", "elite"];

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

function Cell({ included }: { included: boolean }) {
  return included ? (
    <i className="ri-check-line text-[16px] text-[#22c55e]"></i>
  ) : (
    <span className="text-gray-300">—</span>
  );
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

      {/* Pricing Cards — live checkout via /api/v1/stripe/checkout */}
      <section className="pb-[64px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <PricingPlans />
        </div>
      </section>

      {/* Comparison table — generated from PLAN_FEATURES (entitlements.ts) */}
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
                    {TIERS.map((tier) => (
                      <th
                        key={tier}
                        className={`text-center py-[14px] px-[16px] font-display text-[12px] font-semibold uppercase tracking-wider ${
                          tier === "premium" ? "text-[#1B2A4A]" : "text-gray-500"
                        }`}
                      >
                        {PLAN_META[tier].name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_ORDER.map((feature, i) => (
                    <tr
                      key={feature}
                      className={`border-b border-gray-50 ${i % 2 === 0 ? "bg-white" : "bg-[#FAFBFC]"}`}
                    >
                      <td className="py-[12px] px-[16px] font-medium text-[13px] text-[#0A0F1C]">
                        {FEATURE_LABELS[feature]}
                      </td>
                      {TIERS.map((tier) => (
                        <td key={tier} className="text-center py-[12px] px-[16px]">
                          <Cell included={planIncludes(tier, feature)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-gray-100 bg-[#F8FAFC]">
                    <td className="py-[14px] px-[16px] font-display text-[13px] font-semibold text-[#0A0F1C]">
                      Price
                    </td>
                    {TIERS.map((tier) => (
                      <td key={tier} className="text-center py-[14px] px-[16px]">
                        <span className="font-display text-[18px] font-bold text-[#0A0F1C]">
                          {PLAN_META[tier].price}
                        </span>
                        {tier !== "free" && (
                          <span className="text-gray-400 text-[11px]">/mo</span>
                        )}
                      </td>
                    ))}
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
