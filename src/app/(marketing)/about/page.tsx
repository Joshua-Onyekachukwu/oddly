import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About ODDLY",
  description:
    "ODDLY is an AI-powered football prediction platform — ensemble model predictions, value bet detection, and transparent performance tracking.",
};

const principles = [
  {
    title: "Probabilities, not promises",
    description:
      "Every prediction is a probabilistic estimate from statistical and machine-learning models. We show our reasoning and settled results so you can judge the track record yourself — nothing is sold as a guarantee.",
    icon: "ri-scales-3-line",
  },
  {
    title: "Transparency by default",
    description:
      "Predictions are tracked and settled inside the app. Performance metrics, model outputs, and value-bet edges are visible rather than hidden behind marketing claims.",
    icon: "ri-eye-line",
  },
  {
    title: "Analytics, not a bookmaker",
    description:
      "ODDLY is a sports analytics product. We don't accept bets, hold funds, or process gambling transactions — we help you make more informed decisions.",
    icon: "ri-bar-chart-2-line",
  },
];

export default function AboutPage() {
  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      {/* Hero */}
      <section className="pt-[120px] md:pt-[140px] pb-[48px] md:pb-[64px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px] text-center">
          <div className="inline-flex items-center gap-[8px] mb-[16px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00]"></span>
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-[#1B2A4A]">
              About
            </span>
          </div>
          <h1 className="font-display !text-[32px] md:!text-[44px] lg:!text-[52px] !leading-[1.1] !tracking-[-0.03em] !mb-[16px] text-[#0A0F1C]">
            Oddly accurate. <span className="text-[#1B2A4A]">Honestly</span> built.
          </h1>
          <p className="text-[15px] md:text-[17px] text-gray-500 max-w-[620px] mx-auto !leading-[1.75]">
            ODDLY is an AI-powered football prediction platform. An ensemble of
            specialized models evaluates fixtures across major and minor leagues,
            surfaces value where the market may be wrong, and tracks every pick so
            you can verify the results yourself.
          </p>
        </div>
      </section>

      {/* What we do */}
      <section className="pb-[80px] md:pb-[100px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <div className="max-w-[720px] mx-auto">
            <h2 className="font-display !text-[24px] md:!text-[32px] !leading-[1.15] !tracking-[-0.02em] !mb-[16px] text-[#0A0F1C]">
              What ODDLY does
            </h2>
            <div className="space-y-[16px] text-[15px] text-gray-500 !leading-[1.75]">
              <p className="!mb-0">
                For every tracked fixture, our models produce probability
                estimates across markets like 1X2, goals, both teams to score,
                double chance, and more. Those estimates are compared against
                bookmaker odds to flag selections with a mathematical edge —
                what we call value bets.
              </p>
              <p className="!mb-0">
                Beyond individual picks, ODDLY includes an accumulator builder
                with honest combined-probability math, a rollover challenge
                tracker for compounding-bets strategies, performance analytics,
                and an AI analyst you can ask questions of in plain language.
              </p>
              <p className="!mb-0">
                Predictions are probabilistic, not certainties. We encourage you
                to read our{" "}
                <Link href="/responsible-gambling" className="text-[#1B2A4A] font-medium hover:underline">
                  Responsible Gambling
                </Link>{" "}
                page before using any prediction to place a bet.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="pb-[80px] md:pb-[120px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <div className="text-center mb-[48px]">
            <h2 className="font-display !text-[24px] md:!text-[32px] !leading-[1.15] !tracking-[-0.02em] !mb-[12px] text-[#0A0F1C]">
              How we think about predictions
            </h2>
            <p className="text-[15px] text-gray-500 max-w-[480px] mx-auto !leading-[1.75] !mb-0">
              Three principles guide everything we build.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
            {principles.map((p) => (
              <div
                key={p.title}
                className="bg-white rounded-[20px] p-[28px] border border-gray-100"
              >
                <div className="w-[44px] h-[44px] bg-[#1B2A4A]/[0.06] rounded-[12px] flex items-center justify-center mb-[16px]">
                  <i className={`${p.icon} text-[20px] text-[#1B2A4A]`}></i>
                </div>
                <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[8px]">
                  {p.title}
                </h3>
                <p className="text-[13px] text-gray-500 !leading-[1.7] !mb-0">
                  {p.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-[80px] md:pb-[120px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px] text-center">
          <h2 className="font-display !text-[24px] md:!text-[32px] !leading-[1.15] !tracking-[-0.02em] !mb-[12px] text-[#0A0F1C]">
            See the predictions for yourself
          </h2>
          <p className="text-[15px] text-gray-500 max-w-[480px] mx-auto !leading-[1.75] mb-[28px]">
            Create a free account and explore predictions, value bets, and
            settled performance inside the app.
          </p>
          <div className="flex items-center justify-center gap-[12px]">
            <Link
              href="/signup"
              className="inline-flex items-center gap-[8px] font-display font-semibold text-[14px] rounded-full bg-[#1B2A4A] text-white py-[12px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#243B53] active:scale-[0.97]"
            >
              Get started
              <i className="ri-arrow-right-up-line text-[14px]"></i>
            </Link>
            <Link
              href="/features"
              className="inline-flex items-center gap-[8px] font-display font-semibold text-[14px] rounded-full border border-gray-200 text-[#0A0F1C] py-[12px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#1B2A4A]/30 active:scale-[0.97]"
            >
              Explore features
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
