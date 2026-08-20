"use client";

import React from "react";
import Image from "next/image";
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
          {/* Left — Real football analytics image */}
          <div {...getScrollRevealClasses(isVisible, 0)} className="relative">
            <div className="relative rounded-[1.5rem] overflow-hidden aspect-[4/3]">
              <Image
                src="https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&q=80"
                alt="Football analytics dashboard"
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
              {/* Dark overlay with gradient */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0A0F1C]/90 via-[#0A0F1C]/40 to-transparent" />

              {/* Overlay content */}
              <div className="absolute bottom-0 left-0 right-0 p-[24px] md:p-[32px]">
                <div className="flex items-center gap-[12px] mb-[12px]">
                  <div className="w-[36px] h-[36px] bg-[#BFFF00]/20 rounded-[8px] flex items-center justify-center backdrop-blur-sm">
                    <i className="ri-brain-line text-[#BFFF00] text-[16px]"></i>
                  </div>
                  <span className="text-[11px] text-white/60 uppercase tracking-wider font-display">AI-Powered</span>
                </div>
                <h3 className="font-display text-[24px] md:text-[28px] font-bold text-white !leading-[1.1] !tracking-[-0.02em] !mb-[8px]">
                  7 Models Working Together
                </h3>
                <p className="text-[13px] text-white/60 leading-[1.5]">
                  Dixon-Coles, XGBoost, Elo, and 4 more — all analyzed by NVIDIA AI to find the sharpest edge.
                </p>
              </div>
            </div>

            {/* Floating accuracy card */}
            <div className="absolute -bottom-[16px] -right-[16px] md:-right-[16px] right-[8px] bg-white rounded-[12px] p-[14px] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.12)] border border-gray-100 z-[2]">
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

            {/* Floating model count card */}
            <div className="absolute -top-[12px] -left-[12px] md:-left-[12px] left-[8px] bg-white rounded-[12px] p-[12px] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.12)] border border-gray-100 z-[2]">
              <div className="flex items-center gap-[8px]">
                <div className="w-[28px] h-[28px] bg-[#8B5CF6]/10 rounded-full flex items-center justify-center">
                  <i className="ri-robot-2-line text-[#8B5CF6] text-[12px]"></i>
                </div>
                <div>
                  <span className="text-[10px] text-gray-400 block">Active Models</span>
                  <span className="text-[14px] font-bold text-[#0A0F1C] font-mono-data">7</span>
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
