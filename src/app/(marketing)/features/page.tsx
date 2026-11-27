import Link from "next/link";

const features = [
  {
    title: "Ensemble Prediction Engine",
    description:
      "Multiple statistical and machine-learning models evaluate every fixture across 1X2, goals, BTTS, double chance and more — combined into a single probability estimate.",
    icon: "ri-pie-chart-2-line",
    bgColor: "bg-[#BFFF00]/10",
    iconColor: "text-[#1B2A4A]",
  },
  {
    title: "Value Bet Detection",
    description:
      "Automatically compares model probabilities against bookmaker odds to surface selections with a mathematical edge.",
    icon: "ri-search-eye-line",
    bgColor: "bg-[#22c55e]/10",
    iconColor: "text-[#22c55e]",
  },
  {
    title: "Accumulator Builder",
    description:
      "Build accumulators with honest probability estimates. Combine selections and track combined odds and probability.",
    icon: "ri-stack-line",
    bgColor: "bg-[#D97706]/10",
    iconColor: "text-[#D97706]",
  },
  {
    title: "AI Analyst Chat",
    description:
      "Natural language interface to query matches, teams and markets — answers grounded in the match data.",
    icon: "ri-robot-2-line",
    bgColor: "bg-[#8B5CF6]/10",
    iconColor: "text-[#8B5CF6]",
  },
  {
    title: "Transparent Tracking",
    description:
      "Every prediction is tracked and settled. Performance metrics you can verify inside the app.",
    icon: "ri-line-chart-line",
    bgColor: "bg-[#2563EB]/10",
    iconColor: "text-[#2563EB]",
  },
  {
    title: "Rollover Challenge",
    description:
      "Daily compounding-bets strategy with bankroll management, chain tracking and honest probability math.",
    icon: "ri-fire-line",
    bgColor: "bg-[#EF4444]/10",
    iconColor: "text-[#EF4444]",
  },
];

export default function FeaturesPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      {/* Hero */}
      <section className="pt-[120px] md:pt-[140px] pb-[48px] md:pb-[64px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px] text-center">
          <div className="inline-flex items-center gap-[8px] mb-[16px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00]"></span>
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-[#1B2A4A]">
              Features
            </span>
          </div>
          <h1 className="font-display !text-[32px] md:!text-[44px] lg:!text-[52px] !leading-[1.1] !tracking-[-0.03em] !mb-[16px] text-[#0A0F1C]">
            Tools Designed for <span className="text-[#1B2A4A]">Smarter</span> Betting
          </h1>
          <p className="text-[15px] md:text-[17px] text-gray-500 max-w-[560px] mx-auto !leading-[1.75]">
            Accuracy, transparency, and edge — everything your betting strategy
            needs, in one dashboard.
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="pb-[80px] md:pb-[100px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="bg-white rounded-[14px] p-[24px] border border-gray-100 hover:border-[#1B2A4A]/10 hover:shadow-[0_4px_20px_-8px_rgba(27,42,74,0.08)] transition-all duration-500 group"
              >
                <div
                  className={`inline-flex items-center justify-center w-[44px] h-[44px] rounded-[10px] ${feature.bgColor} mb-[16px] transition-transform duration-500 group-hover:scale-110`}
                >
                  <i className={`${feature.icon} text-[20px] ${feature.iconColor}`}></i>
                </div>
                <h2 className="font-display text-[16px] font-semibold text-[#0A0F1C] !mb-[8px]">
                  {feature.title}
                </h2>
                <p className="text-[13px] text-gray-500 leading-[1.6]">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="text-center mt-[48px]">
            <Link
              href="/signup"
              className="group inline-flex items-center gap-[8px] font-display font-semibold text-[15px] rounded-full bg-[#1B2A4A] text-white py-[14px] px-[28px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_0_30px_rgba(27,42,74,0.25)] active:scale-[0.97]"
            >
              Start Free
              <span className="w-[24px] h-[24px] rounded-full bg-white/10 flex items-center justify-center transition-all duration-500 group-hover:translate-x-[2px] group-hover:-translate-y-[1px] group-hover:bg-white/15">
                <i className="ri-arrow-right-up-line text-[14px]"></i>
              </span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
