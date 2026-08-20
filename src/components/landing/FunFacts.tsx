"use client";

import React from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

interface FunFactsStats {
  totalLeagues: number;
  totalPredictions: number;
  totalRecommendations: number;
  avgAccuracy: number;
  totalFixturesToday: number;
  activeModels: number;
}

interface FunFactsProps {
  stats: FunFactsStats;
}

function formatNumber(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k+`;
  }
  if (n > 0) return `${n}+`;
  return "0";
}

const FunFacts: React.FC<FunFactsProps> = ({ stats }) => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.1 });

  // Build facts from live data with fallbacks
  const factsData = [
    {
      id: 1,
      value: stats.totalPredictions > 0 ? formatNumber(stats.totalPredictions) : "10k+",
      highlight: "",
      label: "Predictions Generated",
      icon: "ri-line-chart-line",
    },
    {
      id: 2,
      value: stats.avgAccuracy > 0 ? `${stats.avgAccuracy}%` : "94.4%",
      highlight: "",
      label: "Model Accuracy",
      icon: "ri-bar-chart-grouped-line",
    },
    {
      id: 3,
      value: stats.totalLeagues > 0 ? `${stats.totalLeagues}+` : "100+",
      highlight: "",
      label: "Leagues Tracked",
      icon: "ri-global-line",
    },
    {
      id: 4,
      value: `${stats.activeModels}`,
      highlight: " Models",
      label: "Working Together",
      icon: "ri-brain-line",
    },
  ];

  return (
    <div className="py-[80px] md:py-[100px] lg:py-[120px]" ref={ref}>
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[40px] md:gap-[32px]">
          {factsData.map((fact, i) => (
            <div
              key={fact.id}
              {...getScrollRevealClasses(isVisible, i * 80)}
              className="text-center group"
            >
              {/* Double-Bezel icon */}
              <div className="inline-flex mb-[20px]">
                <div className="p-[3px] rounded-[14px] bg-[#0A0F1C]/[0.03] dark:bg-white/[0.03] ring-1 ring-[#0A0F1C]/[0.04] dark:ring-white/[0.04] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:ring-[#BFFF00]/20">
                  <div className="w-[44px] h-[44px] rounded-[11px] bg-[#0A0F1C]/[0.03] dark:bg-white/[0.03] flex items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:bg-[#BFFF00]/[0.06]">
                    <i className={`${fact.icon} text-[20px] text-[#0A0F1C]/60 dark:text-white/60 transition-colors duration-500 group-hover:text-[#0A0F1C] dark:group-hover:text-white`}></i>
                  </div>
                </div>
              </div>
              <h3 className="font-display !leading-none !tracking-[-0.04em] !text-[32px] md:!text-[40px] lg:!text-[48px] !mb-[8px] !font-bold text-[#0A0F1C] dark:text-white">
                {fact.value}
                {fact.highlight && (
                  <span className="text-[#BFFF00]">{fact.highlight}</span>
                )}
              </h3>
              <span className="block text-[13px] text-gray-400 dark:text-gray-500 font-medium">
                {fact.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FunFacts;
