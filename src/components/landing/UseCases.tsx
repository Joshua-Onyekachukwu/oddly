"use client";

import React from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

const useCasesData = [
  { id: 1, title: "Daily Bettors", desc: "Get AI-powered picks every morning with the Crown Jewel and value bets.", icon: "ri-calendar-check-line", color: "text-[#1B2A4A]", bg: "bg-[#BFFF00]/10" },
  { id: 2, title: "Accumulator Builders", desc: "Smart combination optimization that maximizes returns while managing risk.", icon: "ri-stack-line", color: "text-[#D97706]", bg: "bg-[#D97706]/10" },
  { id: 3, title: "Rollover Chasers", desc: "Track daily rollover chains with automated pick selection and bank management.", icon: "ri-fire-line", color: "text-[#EF4444]", bg: "bg-[#EF4444]/10" },
  { id: 4, title: "Data Analysts", desc: "Deep dive into model performance, accuracy reports, and feature importance.", icon: "ri-bar-chart-line", color: "text-[#2563EB]", bg: "bg-[#2563EB]/10" },
  { id: 5, title: "Value Seekers", desc: "Automated edge detection across 100+ leagues with real-time odds comparison.", icon: "ri-percent-line", color: "text-[#22c55e]", bg: "bg-[#22c55e]/10" },
  { id: 6, title: "Premium Members", desc: "Unlimited AI chat, priority alerts, and exclusive model insights.", icon: "ri-vip-crown-line", color: "text-[#8B5CF6]", bg: "bg-[#8B5CF6]/10" },
];

const UseCases: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.05 });

  return (
    <div className="py-[80px] md:py-[100px] lg:py-[120px] relative z-[1] overflow-hidden" id="use-cases">
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        {/* Header */}
        <div ref={ref} className="text-center mb-[48px] md:mb-[64px]">
          <div {...getScrollRevealClasses(isVisible, 0)} className="inline-flex items-center gap-[8px] mb-[16px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00]"></span>
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-[#1B2A4A]">
              Who ODDLY Helps
            </span>
          </div>
          <h2 {...getScrollRevealClasses(isVisible, 80)} className="font-display !text-[28px] md:!text-[36px] lg:!text-[44px] !leading-[1.1] !tracking-[-0.03em] !mb-[12px] text-[#0A0F1C]">
            Built for Every Type of Bettor
          </h2>
          <p {...getScrollRevealClasses(isVisible, 160)} className="text-[15px] text-gray-500 max-w-[480px] mx-auto">
            From casual fans to serious bettors — discover how ODDLY adapts
            to your betting style.
          </p>
        </div>

        {/* Use case cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
          {useCasesData.map((useCase, i) => (
            <div
              key={useCase.id}
              {...getScrollRevealClasses(isVisible, 200 + i * 60)}
              className="bg-white rounded-[14px] p-[24px] border border-gray-100 hover:border-[#1B2A4A]/10 hover:shadow-[0_4px_20px_-8px_rgba(27,42,74,0.08)] transition-all duration-500 group"
            >
              <div className={`inline-flex items-center justify-center w-[44px] h-[44px] rounded-[10px] ${useCase.bg} mb-[16px] transition-transform duration-500 group-hover:scale-110`}>
                <i className={`${useCase.icon} text-[20px] ${useCase.color}`}></i>
              </div>
              <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] !mb-[8px]">
                {useCase.title}
              </h3>
              <p className="text-[13px] text-gray-500 leading-[1.6]">
                {useCase.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UseCases;
