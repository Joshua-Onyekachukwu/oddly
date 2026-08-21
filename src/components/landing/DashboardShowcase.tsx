"use client";

import React from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

/**
 * A full-width, immersive dashboard preview that looks like a real app.
 * Uses CSS-only animations for the "live" feel.
 */
function DashboardPreview() {
  return (
    <div className="relative mx-auto max-w-[960px]">
      {/* Glow effect behind the dashboard */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#BFFF00]/5 via-transparent to-transparent rounded-[24px] blur-3xl -z-10" />

      {/* Main dashboard frame */}
      <div className="bg-[#0A0F1C] rounded-[16px] md:rounded-[20px] border border-white/5 overflow-hidden shadow-[0_20px_80px_-20px_rgba(0,0,0,0.5)]">
        {/* Top bar */}
        <div className="flex items-center justify-between px-[20px] py-[12px] border-b border-white/5">
          <div className="flex items-center gap-[12px]">
            <div className="flex items-center gap-[6px]">
              <div className="w-[10px] h-[10px] rounded-full bg-red-500/80" />
              <div className="w-[10px] h-[10px] rounded-full bg-yellow-500/80" />
              <div className="w-[10px] h-[10px] rounded-full bg-green-500/80" />
            </div>
            <span className="text-[11px] text-white/20 font-mono-data">oddly.ai/dashboard</span>
          </div>
          <div className="flex items-center gap-[8px]">
            <span className="flex items-center gap-[4px] text-[9px] text-[#BFFF00] bg-[#BFFF00]/10 px-[8px] py-[3px] rounded-full font-semibold">
              <span className="w-[4px] h-[4px] bg-[#BFFF00] rounded-full animate-pulse" />
              LIVE
            </span>
          </div>
        </div>

        {/* Dashboard content */}
        <div className="p-[16px] md:p-[24px]">
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[20px]">
            {[
              { label: "Today's Picks", value: "24", change: "+6", color: "text-[#BFFF00]" },
              { label: "Win Rate", value: "91.2%", change: "+2.1%", color: "text-[#22c55e]" },
              { label: "Avg Edge", value: "+14.8%", change: "+1.3%", color: "text-[#BFFF00]" },
              { label: "Active Chains", value: "3", change: "Day 12", color: "text-white" },
            ].map((stat) => (
              <div key={stat.label} className="bg-white/[0.03] rounded-[10px] p-[12px] border border-white/5">
                <span className="text-[9px] text-white/30 uppercase tracking-wider block mb-[4px]">{stat.label}</span>
                <div className="flex items-end justify-between">
                  <span className={`text-[18px] md:text-[22px] font-bold font-mono-data ${stat.color}`}>{stat.value}</span>
                  <span className="text-[9px] text-[#22c55e] font-mono-data">{stat.change}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Main content grid */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-[16px]">
            {/* Left — Match list */}
            <div className="bg-white/[0.02] rounded-[12px] border border-white/5 overflow-hidden">
              <div className="flex items-center justify-between px-[14px] py-[10px] border-b border-white/5">
                <span className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Crown Jewel Pick</span>
                <span className="text-[9px] text-[#D97706] bg-[#D97706]/10 px-[6px] py-[2px] rounded-full font-semibold">ELITE</span>
              </div>

              {/* Crown Jewel card */}
              <div className="p-[14px] border-b border-white/5 bg-[#D97706]/5">
                <div className="flex items-center justify-between mb-[8px]">
                  <div className="flex items-center gap-[8px]">
                    <div className="w-[6px] h-[6px] rounded-full bg-[#D97706] animate-pulse" />
                    <span className="text-[10px] text-[#D97706] font-semibold uppercase tracking-wider">Crown Jewel</span>
                  </div>
                  <span className="text-[10px] text-white/30 font-mono-data">93% confidence</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[13px] font-semibold text-white">Arsenal</span>
                    <span className="text-[11px] text-white/30 mx-[6px]">vs</span>
                    <span className="text-[13px] font-semibold text-white">Chelsea</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[14px] font-bold text-[#BFFF00] font-mono-data block">+18.2%</span>
                    <span className="text-[9px] text-white/30">edge</span>
                  </div>
                </div>
                <div className="flex items-center gap-[12px] mt-[8px]">
                  <span className="text-[10px] text-white/40">Home Win</span>
                  <span className="text-[10px] text-white/20">|</span>
                  <span className="text-[10px] text-white/40 font-mono-data">odds 1.85</span>
                  <span className="text-[10px] text-white/20">|</span>
                  <span className="text-[10px] text-white/40">EPL</span>
                </div>
              </div>

              {/* Match rows */}
              {[
                { home: "Barcelona", away: "Real Madrid", time: "21:00", edge: "+12%", prob: "87%", market: "BTTS Yes" },
                { home: "Bayern Munich", away: "Dortmund", time: "18:30", edge: "+15%", prob: "91%", market: "Over 2.5" },
                { home: "Inter Milan", away: "Napoli", time: "20:45", edge: "+9%", prob: "84%", market: "Home Win" },
                { home: "PSG", away: "Marseille", time: "21:00", edge: "+11%", prob: "88%", market: "Home Win" },
              ].map((m, i) => (
                <div key={i} className="flex items-center justify-between px-[14px] py-[10px] border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-[10px] flex-1 min-w-0">
                    <span className="text-[11px] text-white/70 truncate">{m.home}</span>
                    <span className="text-[9px] text-white/20">vs</span>
                    <span className="text-[11px] text-white/70 truncate">{m.away}</span>
                  </div>
                  <div className="flex items-center gap-[10px] ml-[8px] flex-none">
                    <span className="text-[10px] text-white/30 hidden md:inline">{m.market}</span>
                    <span className="text-[10px] text-white/20 font-mono-data">{m.time}</span>
                    <span className="text-[11px] font-bold text-[#22c55e] font-mono-data">+{m.edge}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Right — AI Analyst sidebar */}
            <div className="space-[12px]">
              {/* AI Analyst */}
              <div className="bg-white/[0.02] rounded-[12px] border border-white/5 p-[14px]">
                <div className="flex items-center gap-[8px] mb-[12px]">
                  <div className="w-[24px] h-[24px] bg-[#8B5CF6]/20 rounded-[6px] flex items-center justify-center">
                    <i className="ri-robot-2-line text-[12px] text-[#8B5CF6]" />
                  </div>
                  <span className="text-[11px] font-semibold text-white/60">AI Analyst</span>
                </div>
                <div className="space-[8px]">
                  <div className="bg-white/[0.03] rounded-[8px] p-[10px]">
                    <p className="text-[11px] text-white/50 leading-[1.5]">
                      &quot;Arsenal&apos;s home form (W8 D1 L1) combined with Chelsea&apos;s defensive vulnerability on the road makes Home Win the optimal selection.&quot;
                    </p>
                  </div>
                  <div className="flex items-center gap-[6px]">
                    <span className="text-[9px] text-[#8B5CF6] bg-[#8B5CF6]/10 px-[6px] py-[2px] rounded-full">Llama 3.1 70B</span>
                    <span className="text-[9px] text-white/20">2.1s</span>
                  </div>
                </div>
              </div>

              {/* Model performance */}
              <div className="bg-white/[0.02] rounded-[12px] border border-white/5 p-[14px]">
                <span className="text-[10px] text-white/30 uppercase tracking-wider block mb-[10px]">Model Accuracy</span>
                <div className="flex items-end gap-[3px] h-[48px]">
                  {[65, 72, 68, 81, 77, 85, 91, 88, 93, 90, 87, 91].map((v, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end">
                      <div
                        className="w-full rounded-[2px] transition-all duration-500"
                        style={{
                          height: `${v}%`,
                          backgroundColor: v >= 85 ? "#22c55e" : v >= 70 ? "#D97706" : "#EF4444",
                          opacity: 0.6 + (i / 12) * 0.4,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-[8px]">
                  <span className="text-[9px] text-white/20">12 week trend</span>
                  <span className="text-[10px] text-[#22c55e] font-mono-data font-semibold">91.2%</span>
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-2 gap-[8px]">
                <div className="bg-white/[0.02] rounded-[10px] border border-white/5 p-[10px] text-center">
                  <span className="text-[16px] font-bold text-[#BFFF00] font-mono-data block">7</span>
                  <span className="text-[9px] text-white/30">Active Models</span>
                </div>
                <div className="bg-white/[0.02] rounded-[10px] border border-white/5 p-[10px] text-center">
                  <span className="text-[16px] font-bold text-white font-mono-data block">12+</span>
                  <span className="text-[9px] text-white/30">Leagues</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: "ri-brain-line",
    title: "7 AI Models Working Together",
    description: "Dixon-Coles, XGBoost, Elo, and 4 more — analyzed by NVIDIA AI to find the sharpest edges.",
  },
  {
    icon: "ri-search-eye-line",
    title: "Automatic Value Detection",
    description: "Scans 100+ markets per match to find bets where your model has a mathematical advantage.",
  },
  {
    icon: "ri-fire-line",
    title: "Crown Jewel Daily Pick",
    description: "The single highest-conviction selection each day — where all 7 models agree at 90%+ confidence.",
  },
  {
    icon: "ri-line-chart-line",
    title: "Live Odds Comparison",
    description: "Real-time odds from Pinnacle, Betway, and 100+ bookmakers — always find the best price.",
  },
];

const DashboardShowcase: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.05 });
  const { ref: featuresRef, isVisible: featuresVisible } = useScrollReveal({ threshold: 0.1 });

  return (
    <div className="py-[80px] md:py-[100px] lg:py-[120px] bg-[#0A0F1C] relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[#BFFF00]/3 rounded-full blur-[120px] pointer-events-none" />

      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px] relative z-10">
        {/* Header */}
        <div ref={ref} className="text-center mb-[48px] md:mb-[64px]">
          <div {...getScrollRevealClasses(isVisible, 0)} className="inline-flex items-center gap-[8px] mb-[16px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00] animate-pulse" />
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-white/50">
              Dashboard
            </span>
          </div>
          <h2
            {...getScrollRevealClasses(isVisible, 80)}
            className="font-display !text-[28px] md:!text-[36px] lg:!text-[44px] !leading-[1.1] !tracking-[-0.03em] !mb-[12px] text-white"
          >
            Real-Time Prediction Intelligence
          </h2>
          <p
            {...getScrollRevealClasses(isVisible, 160)}
            className="text-[15px] text-white/40 max-w-[480px] mx-auto"
          >
            Every prediction, every edge, every model — all on a single,
            dynamic dashboard that updates in real time.
          </p>
        </div>

        {/* Dashboard Preview */}
        <div {...getScrollRevealClasses(isVisible, 200)}>
          <DashboardPreview />
        </div>

        {/* Feature highlights */}
        <div ref={featuresRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[16px] mt-[48px] md:mt-[64px]">
          {FEATURES.map((feature, i) => (
            <div
              key={feature.title}
              {...getScrollRevealClasses(featuresVisible, i * 80)}
              className="bg-white/[0.03] rounded-[12px] p-[20px] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all duration-500 group"
            >
              <div className="w-[36px] h-[36px] bg-[#BFFF00]/10 rounded-[8px] flex items-center justify-center mb-[12px] group-hover:bg-[#BFFF00]/15 transition-colors">
                <i className={`${feature.icon} text-[16px] text-[#BFFF00]`} />
              </div>
              <h3 className="text-[14px] font-semibold text-white mb-[6px]">
                {feature.title}
              </h3>
              <p className="text-[12px] text-white/40 leading-[1.6]">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DashboardShowcase;
