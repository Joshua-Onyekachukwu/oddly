"use client";

import React, { useState } from "react";
import Link from "next/link";

const faqs = [
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
      "We cover leagues across Europe, South America, Africa, and Asia — including the Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, NPFL, MLS, Brasileirão, and many more. Coverage grows as new fixtures and data sources are added.",
  },
  {
    question: "What's the difference between Premium and Elite?",
    answer:
      "Premium gives you access to predictions, value bet detection, and the accumulator builder. Elite adds the daily top pick, Rollover Challenge, AI Analyst chat, and priority features as they ship.",
  },
  {
    question: "How does value bet detection work?",
    answer:
      "For each selection, the model estimates the true probability of an outcome. That probability is compared against the implied probability from bookmaker odds. When the model's estimate is meaningfully higher than the market's, the selection is flagged as a value bet with an estimated edge percentage. Edge is a mathematical estimate at the time of generation — it is not a guarantee of profit.",
  },
  {
    question: "Is ODDLY a bookmaker? Do I place bets through the app?",
    answer:
      "No. ODDLY is a sports analytics and prediction platform. We don't accept bets, hold funds, or process gambling transactions. Predictions and odds are provided for informational purposes so you can make your own decisions with a bookmaker of your choice.",
  },
  {
    question: "What happens if a prediction is wrong?",
    answer:
      "Wrong predictions are part of probabilistic forecasting — even high-confidence selections lose regularly. Every prediction is tracked and settled inside the app, so you can see the real hit rate over time rather than relying on cherry-picked wins. Past performance is not indicative of future results.",
  },
  {
    question: "How do I track my bets and performance?",
    answer:
      "Your dashboard tracks prediction outcomes, settled results, and performance metrics. The Rollover Challenge and accumulator tools let you record your own stakes and results so you can monitor bankroll, banked profit, and chain progress in one place.",
  },
  {
    question: "Do I need a paid subscription to see predictions?",
    answer:
      "The Free tier gives you a taste of the platform. Premium unlocks predictions, value bet detection, and the accumulator builder; Elite adds the daily top pick, Rollover Challenge, and AI Analyst chat. See the pricing page for current plans.",
  },
  {
    question: "Is my data safe?",
    answer:
      "We take data protection seriously. Account credentials are handled by Supabase Auth, and we only collect what's needed to run your account and predictions. See our Privacy Policy for the full details on what we store and how it's used.",
  },
];

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="bg-[#F8FAFC] min-h-screen">
      {/* Hero */}
      <section className="pt-[120px] md:pt-[140px] pb-[48px] md:pb-[64px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px] text-center">
          <div className="inline-flex items-center gap-[8px] mb-[16px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00]"></span>
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-[#1B2A4A]">
              FAQ
            </span>
          </div>
          <h1 className="font-display !text-[32px] md:!text-[44px] lg:!text-[52px] !leading-[1.1] !tracking-[-0.03em] !mb-[16px] text-[#0A0F1C]">
            Questions &amp; <span className="text-[#1B2A4A]">Answers</span>
          </h1>
          <p className="text-[15px] md:text-[17px] text-gray-500 max-w-[560px] mx-auto !leading-[1.75]">
            Everything you need to know about ODDLY and how our prediction
            platform works.
          </p>
        </div>
      </section>

      {/* Accordion */}
      <section className="pb-[80px] md:pb-[120px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          <div className="max-w-[720px] mx-auto space-y-[8px]">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className={`rounded-[1.25rem] p-[3px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  openIndex === index
                    ? "bg-[#0A0F1C]/[0.04] ring-1 ring-[#0A0F1C]/[0.06]"
                    : "bg-transparent"
                }`}
              >
                <div
                  className={`rounded-[calc(1.25rem-3px)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                    openIndex === index
                      ? "bg-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]"
                      : "bg-white/60 hover:bg-white"
                  }`}
                >
                  <button
                    onClick={() => toggle(index)}
                    className="flex items-center justify-between w-full p-[18px] md:p-[22px] text-left group"
                  >
                    <span className="font-display font-semibold text-[14px] md:text-[15px] text-[#0A0F1C] pr-4 transition-colors duration-300">
                      {faq.question}
                    </span>
                    <div
                      className={`w-[28px] h-[28px] rounded-full flex items-center justify-center flex-none transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                        openIndex === index
                          ? "bg-[#0A0F1C] rotate-180"
                          : "bg-[#0A0F1C]/[0.04]"
                      }`}
                    >
                      <i
                        className={`ri-arrow-down-s-line text-[14px] transition-colors duration-300 ${
                          openIndex === index ? "text-white" : "text-gray-400"
                        }`}
                      ></i>
                    </div>
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                      openIndex === index
                        ? "max-h-[400px] opacity-100"
                        : "max-h-0 opacity-0"
                    }`}
                  >
                    <div className="px-[18px] md:px-[22px] pb-[18px] md:pb-[22px]">
                      <p className="text-[13px] md:text-[14px] !leading-[1.75] !mb-0 text-gray-500">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-[13px] text-gray-400 mt-[40px] !mb-0">
            Still have questions?{" "}
            <Link href="/contact" className="text-[#1B2A4A] font-medium hover:underline">
              Contact us
            </Link>
            {" · "}
            <Link href="/responsible-gambling" className="text-[#1B2A4A] font-medium hover:underline">
              Responsible Gambling
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
