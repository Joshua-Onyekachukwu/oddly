"use client";

import React from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

const aboutCards = [
  { icon: "ri-line-chart-line", title: "Live Match Tracking", desc: "Follow predictions in real-time as matches unfold across 100+ leagues.", color: "bg-[#BFFF00]/10", iconColor: "text-[#1B2A4A]" },
  { icon: "ri-notification-3-line", title: "Instant Alerts", desc: "Get notified the moment a value bet is detected or Crown Jewel is ready.", color: "bg-[#D97706]/10", iconColor: "text-[#D97706]" },
  { icon: "ri-bar-chart-grouped-line", title: "Deep Analytics", desc: "Model accuracy, edge, and confidence at a glance for every prediction.", color: "bg-[#22c55e]/10", iconColor: "text-[#22c55e]" },
  { icon: "ri-stack-line", title: "Smart Optimization", desc: "Accumulator builder maximizes your returns while managing risk.", color: "bg-[#2563EB]/10", iconColor: "text-[#2563EB]" },
];

const About: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.05 });

  return (
    <div className="py-[80px] md:py-[100px] lg:py-[120px]" ref={ref}>
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[48px] items-center">
          {/* Left — CSS-based prediction chart visual */}
          <div {...getScrollRevealClasses(isVisible, 0)} className="relative">
            {/* Prediction accuracy card */}
            <div className="bg-[#0A0F1C] rounded-[1.5rem] p-[32px] relative overflow-hidden">
              {/* Grid pattern */}
              <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "30px 30px" }} />

              <div className="relative z-[1]">
                <div className="flex items-center justify-between mb-[24px]">
                  <div>
                    <span className="text-[11px] text-white/40 uppercase tracking-wider font-display">Model Accuracy</span>
                    <h3 className="font-display text-[32px] font-bold text-white font-mono-data">94.4%</h3>
                  </div>
                  <div className="w-[40px] h-[40px] bg-[#BFFF00]/10 rounded-[10px] flex items-center justify-center">
                    <i className="ri-arrow-up-double-line text-[#BFFF00] text-[18px]"></i>
                  </div>
                </div>

                {/* Bar chart */}
                <div className="flex items-end gap-[6px] h-[120px] mb-[16px]">
                  {[65, 72, 68, 81, 76, 89, 84, 91, 88, 94, 90, 94].map((h, i) => (
                    <div key={i} className="flex-1 bg-white/5 rounded-t-[4px] relative group">
                      <div
                        className="absolute bottom-0 left-0 right-0 rounded-t-[4px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
                        style={{
                          height: `${h}%`,
                          background: i >= 10 ? "#BFFF00" : i >= 8 ? "rgba(191,255,0,0.4)" : "rgba(255,255,255,0.15)",
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between text-[10px] text-white/30">
                  <span>Jan</span>
                  <span>Mar</span>
                  <span>Jun</span>
                  <span>Sep</span>
                  <span>Dec</span>
                </div>
              </div>
            </div>

            {/* Floating edge card */}
            <div className="absolute -bottom-[16px] -right-[16px] bg-white rounded-[12px] p-[14px] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.12)] border border-gray-100 z-[2]">
              <div className="flex items-center gap-[8px]">
                <div className="w-[28px] h-[28px] bg-[#22c55e]/10 rounded-full flex items-center justify-center">
                  <i className="ri-percent-line text-[#22c55e] text-[12px]"></i>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block">Avg Edge</span>
                  <span className="text-[14px] font-bold text-[#0A0F1C] font-mono-data">+12.3%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right — Copy + cards */}
          <div {...getScrollRevealClasses(isVisible, 100)}>
            <span className="inline-block rounded-full text-[#1B2A4A] bg-[#1B2A4A]/8 py-[4px] px-[14px] text-[11px] font-semibold tracking-wider uppercase font-display mb-[16px]">
              About ODDLY
            </span>

            <h2 className="font-display !text-[28px] md:!text-[36px] lg:!text-[44px] !leading-[1.1] !tracking-[-0.03em] !mb-[16px] text-[#0A0F1C]">
              Football Predictions Powered by 7 AI Models
            </h2>

            <p className="text-[15px] text-gray-500 max-w-[480px] mb-[32px]">
              From data collection to value bet detection, ODDLY keeps your
              betting strategy moving forward with AI-powered precision.
            </p>

            <div className="space-y-[12px]">
              {aboutCards.map((card, index) => (
                <div
                  key={index}
                  {...getScrollRevealClasses(isVisible, 200 + index * 80)}
                  className="flex items-center gap-[16px] p-[16px] bg-white rounded-[12px] border border-gray-100 hover:border-[#1B2A4A]/10 transition-all duration-500"
                >
                  <div className={`flex-none ${card.color} flex items-center justify-center w-[44px] h-[44px] rounded-[10px]`}>
                    <i className={`${card.icon} text-[18px] ${card.iconColor}`}></i>
                  </div>
                  <div>
                    <h3 className="font-display text-[14px] font-semibold text-[#0A0F1C] !mb-[2px]">
                      {card.title}
                    </h3>
                    <p className="text-[13px] text-gray-400">{card.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;
