"use client";

import React, { useState } from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";
import type { LandingStats } from "@/lib/landing-stats";

interface FAQProps {
  stats?: LandingStats;
}

const getFaqData = (leagueCount: string) => [
  {
    question: "How accurate are ODDLY's predictions?",
    answer:
      "ODDLY's ensemble model is evaluated with walk-forward validation on historical matches that were never used for training. Accuracy varies by market and league, and high-confidence selections historically perform better than low-confidence ones — but no prediction is guaranteed. We show settled results and performance metrics inside the app so you can judge the track record yourself.",
  },
  {
    question: "What is the daily top pick?",
    answer:
      "Each day the system evaluates upcoming fixtures across all supported markets and surfaces its highest-confidence selection, alongside the model probability, market-implied probability, and expected edge. Picks are probabilistic estimates, not certainties.",
  },
  {
    question: "How does the Rollover Challenge work?",
    answer:
      "The Rollover Challenge lets you track a compounding-bets strategy: you start with a stake, add daily selections around even odds, and reinvest winnings. You mark results yourself and the dashboard tracks your bankroll, banked profits, and chain progress.",
  },
  {
    question: "Can I cancel my subscription anytime?",
    answer:
      "Yes, you can cancel anytime from your dashboard. Your access continues until the end of your billing period. No hidden fees, no cancellation penalties.",
  },
  {
    question: "Which leagues does ODDLY cover?",
    answer:
      `We cover ${leagueCount} leagues across Europe, South America, Africa, and Asia — including the Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, NPFL, MLS, Brasileirão, and many more.`,
  },
  {
    question: "What's the difference between Premium and Elite?",
    answer:
      "Premium gives you access to predictions, value bet detection, and the accumulator builder. Elite adds the daily top pick, Rollover Challenge, AI Analyst chat, and priority features as they ship.",
  },
];

const FAQ: React.FC<FAQProps> = ({ stats }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { ref, isVisible } = useScrollReveal({ threshold: 0.1 });

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="py-[80px] md:py-[100px] lg:py-[120px]" id="faq" ref={ref}>
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        <div
          {...getScrollRevealClasses(isVisible, 0, "text-center mb-[48px] md:mb-[60px] max-w-[540px] mx-auto")}
        >
          <span className="inline-flex items-center gap-[6px] text-[10px] font-semibold text-[#0A0F1C]/60 dark:text-white/50 bg-[#0A0F1C]/[0.03] dark:bg-white/[0.03] px-[14px] py-[6px] rounded-full mb-[20px] uppercase tracking-[0.15em] font-display">
            FAQ
          </span>
          <h2 className="font-display !text-[32px] md:!text-[40px] lg:!text-[48px] !leading-[1.1] !tracking-[-0.03em] !mb-[12px] text-[#0A0F1C] dark:text-white">
            Questions & Answers
          </h2>
          <p className="text-[15px] md:text-[17px] text-gray-400 !mb-0 !leading-[1.75]">
            Everything you need to know about ODDLY and how our prediction
            platform works.
          </p>
        </div>

        <div className="max-w-[680px] mx-auto space-y-[8px]">
          {getFaqData(stats?.totalLeagues ? `${stats.totalLeagues}+` : "many").map((faq, index) => (
            <div
              key={index}
              {...getScrollRevealClasses(isVisible, 80 + index * 60)}
            >
              {/* Double-Bezel */}
              <div
                className={`rounded-[1.25rem] p-[3px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  openIndex === index
                    ? "bg-[#0A0F1C]/[0.04] dark:bg-white/[0.04] ring-1 ring-[#0A0F1C]/[0.06] dark:ring-white/[0.06]"
                    : "bg-transparent"
                }`}
              >
                <div
                  className={`rounded-[calc(1.25rem-3px)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                    openIndex === index
                      ? "bg-white dark:bg-[#0c1427] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]"
                      : "bg-[#F8FAFC] dark:bg-transparent hover:bg-white dark:hover:bg-[#0c1427]/30"
                  }`}
                >
                  <button
                    onClick={() => toggle(index)}
                    className="flex items-center justify-between w-full p-[18px] md:p-[22px] text-left group"
                  >
                    <span className="font-display font-semibold text-[14px] md:text-[15px] text-[#0A0F1C] dark:text-white pr-4 transition-colors duration-300">
                      {faq.question}
                    </span>
                    <div
                      className={`w-[28px] h-[28px] rounded-full flex items-center justify-center flex-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                        openIndex === index
                          ? "bg-[#0A0F1C] dark:bg-white rotate-180"
                          : "bg-[#0A0F1C]/[0.04] dark:bg-white/[0.04]"
                      }`}
                    >
                      <i
                        className={`ri-arrow-down-s-line text-[14px] transition-colors duration-300 ${
                          openIndex === index
                            ? "text-white dark:text-[#0A0F1C]"
                            : "text-gray-400"
                        }`}
                      ></i>
                    </div>
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                      openIndex === index
                        ? "max-h-[300px] opacity-100"
                        : "max-h-0 opacity-0"
                    }`}
                  >
                    <div className="px-[18px] md:px-[22px] pb-[18px] md:pb-[22px]">
                      <p className="text-[13px] md:text-[14px] !leading-[1.75] !mb-0 text-gray-400">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FAQ;
