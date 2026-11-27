"use client";

import React from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

const featuresData = [
  {
    title: "Ensemble Prediction Engine",
    description: "Market-specific models — 1X2, goals, BTTS, double chance — combined with cross-model signals and draw analysis.",
    icon: "ri-pie-chart-2-line",
    bgColor: "bg-[#BFFF00]/10",
    iconColor: "text-[#1B2A4A]",
  },
  {
    title: "20+ Markets Per Match",
    description: "Match result, over/under lines, BTTS, double chance, draw no bet, and team goals — all priced with model probabilities.",
    icon: "ri-bar-chart-grouped-line",
    bgColor: "bg-[#D97706]/10",
    iconColor: "text-[#D97706]",
  },
  {
    title: "Team Intelligence",
    description: "Elo strength ratings, recent form, home/away splits, expected goals, injuries, and referee tendencies feed every prediction.",
    icon: "ri-brain-line",
    bgColor: "bg-[#2563EB]/10",
    iconColor: "text-[#2563EB]",
  },
  {
    title: "Accumulator Builder",
    description: "Build multi-selection slips and track combined odds and probability across your picks.",
    icon: "ri-stack-line",
    bgColor: "bg-[#22c55e]/10",
    iconColor: "text-[#22c55e]",
  },
  {
    title: "AI Analyst Chat",
    description: "Ask questions about matches, teams, and markets — answers grounded in the match data.",
    icon: "ri-robot-2-line",
    bgColor: "bg-[#8B5CF6]/10",
    iconColor: "text-[#8B5CF6]",
  },
  {
    title: "Rollover Challenge",
    description: "Track a daily ~2.0 odds compounding strategy with bankroll management and chain history.",
    icon: "ri-fire-line",
    bgColor: "bg-[#EF4444]/10",
    iconColor: "text-[#EF4444]",
  },
];

const Features: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.05 });

  return (
    <div className="xl:max-w-[1680px] mx-auto" id="features">
      <div className="bg-[#f7f7f7] dark:bg-[#0a0e19] py-[80px] md:py-[100px] lg:py-[120px] relative z-[1] xl:rounded-[35px]">
        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
          {/* Header */}
          <div ref={ref} className="text-center mb-[48px] md:mb-[64px]">
            <div {...getScrollRevealClasses(isVisible, 0, "inline-flex items-center gap-[8px] mb-[16px]")}>
              <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00]"></span>
              <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-[#1B2A4A]">
                ODDLY Features
              </span>
            </div>
            <h2 {...getScrollRevealClasses(isVisible, 80, "font-display !text-[28px] md:!text-[36px] lg:!text-[44px] !leading-[1.1] !tracking-[-0.03em] !mb-[12px] text-[#0A0F1C]")}>
              Tools Designed for Smarter Betting
            </h2>
            <p {...getScrollRevealClasses(isVisible, 160, "text-[15px] text-gray-500 max-w-[480px] mx-auto")}>
              Accuracy, transparency, and edge — everything your betting
              strategy needs.
            </p>
          </div>

          {/* Feature grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
            {featuresData.map((feature, index) => (
              <div
                key={index}
                {...getScrollRevealClasses(isVisible, 200 + index * 60, "bg-white rounded-[14px] p-[24px] border border-gray-100 hover:border-[#1B2A4A]/10 hover:shadow-[0_4px_20px_-8px_rgba(27,42,74,0.08)] transition-all duration-500 group")}
              >
                <div className={`inline-flex items-center justify-center w-[44px] h-[44px] rounded-[10px] ${feature.bgColor} mb-[16px] transition-transform duration-500 group-hover:scale-110`}>
                  <i className={`${feature.icon} text-[20px] ${feature.iconColor}`}></i>
                </div>
                <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] !mb-[8px]">
                  {feature.title}
                </h3>
                <p className="text-[13px] text-gray-500 leading-[1.6]">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Features;
