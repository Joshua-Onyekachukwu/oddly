"use client";

import React from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

const dashboardData = [
  {
    id: 1,
    title: "Track Every Prediction With Precision",
    features: [
      { title: "Model Probability vs Market Odds", description: "See exactly where the edge is for every selection across all markets." },
      { title: "Feature Importance Breakdown", description: "Understand which data points drove each prediction — form, xG, H2H, injuries." },
      { title: "League-Specific Performance", description: "Track accuracy by league to see where the model performs best." },
      { title: "Crown Jewel Daily Pick", description: "The single best selection at 2.0+ odds with 90%+ confidence, updated daily." },
    ],
  },
  {
    id: 2,
    title: "Optimized For Maximum Value Bets",
    features: [
      { title: "Value Bet Detection", description: "Automatically identifies bets where model probability exceeds market odds." },
      { title: "Edge Calculation", description: "Precise edge measurement for every pick — know your mathematical advantage." },
      { title: "Odds Movement Tracking", description: "Monitor how odds change across bookmakers to find the best price." },
      { title: "Rollover Chain Management", description: "Track your daily rollover progress with automated chain management." },
    ],
  },
];

/** CSS-based mini dashboard preview */
function DashboardPreview({ variant }: { variant: number }) {
  if (variant === 0) {
    // Today's Matches preview
    return (
      <div className="bg-[#0A0F1C] rounded-[12px] p-[16px] mb-[20px]">
        <div className="flex items-center justify-between mb-[12px]">
          <span className="text-[10px] text-white/40 font-display uppercase tracking-wider">Today&apos;s Matches</span>
          <span className="flex items-center gap-[4px] text-[9px] text-[#BFFF00] bg-[#BFFF00]/10 px-[6px] py-[2px] rounded-full">
            <span className="w-[3px] h-[3px] bg-[#BFFF00] rounded-full animate-pulse"></span>
            LIVE
          </span>
        </div>
        {[
          { home: "Arsenal", away: "Chelsea", time: "20:00", edge: "+12%", prob: "93%" },
          { home: "Barcelona", away: "Real Madrid", time: "21:00", edge: "+8%", prob: "87%" },
          { home: "Bayern", away: "Dortmund", time: "18:30", edge: "+15%", prob: "91%" },
        ].map((m, i) => (
          <div key={i} className="flex items-center justify-between py-[8px] border-t border-white/5 first:border-t-0">
            <div className="flex items-center gap-[8px] flex-1 min-w-0">
              <span className="text-[11px] text-white truncate">{m.home}</span>
              <span className="text-[9px] text-white/30">vs</span>
              <span className="text-[11px] text-white truncate">{m.away}</span>
            </div>
            <div className="flex items-center gap-[8px] ml-[8px] flex-none">
              <span className="text-[10px] text-white/30 font-mono-data">{m.time}</span>
              <span className="text-[10px] font-bold text-[#BFFF00] font-mono-data">{m.edge}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Value Bets preview
  return (
    <div className="bg-[#0A0F1C] rounded-[12px] p-[16px] mb-[20px]">
      <div className="flex items-center justify-between mb-[12px]">
        <span className="text-[10px] text-white/40 font-display uppercase tracking-wider">Top Value Bets</span>
        <span className="text-[9px] text-white/20 font-mono-data">12 detected</span>
      </div>
      {[
        { match: "Arsenal vs Chelsea", market: "Over 2.5", edge: "22%", odds: "2.10" },
        { match: "Barcelona vs Real Madrid", market: "BTTS Yes", edge: "15%", odds: "1.85" },
        { match: "Bayern vs Dortmund", market: "Home Win", edge: "11%", odds: "1.72" },
      ].map((b, i) => (
        <div key={i} className="py-[8px] border-t border-white/5 first:border-t-0">
          <div className="flex items-center justify-between mb-[4px]">
            <span className="text-[10px] text-white/50 truncate">{b.match}</span>
            <span className="text-[11px] font-bold text-[#22c55e] font-mono-data">+{b.edge}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white">{b.market}</span>
            <span className="text-[10px] text-white/30 font-mono-data">odds {b.odds}</span>
          </div>
          <div className="w-full bg-white/5 rounded-full h-[2px] mt-[6px]">
            <div className="bg-[#22c55e] h-[2px] rounded-full" style={{ width: `${parseInt(b.edge) * 4}%` }}></div>
          </div>
        </div>
      ))}
    </div>
  );
}

const DashboardShowcase: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.05 });

  return (
    <div className="py-[80px] md:py-[100px] lg:py-[120px]">
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        {/* Header */}
        <div ref={ref} className="text-center mb-[48px] md:mb-[64px]">
          <div {...getScrollRevealClasses(isVisible, 0)} className="inline-flex items-center gap-[8px] mb-[16px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00]"></span>
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase font-display text-[#1B2A4A]">
              Dashboard
            </span>
          </div>
          <h2 {...getScrollRevealClasses(isVisible, 80)} className="font-display !text-[28px] md:!text-[36px] lg:!text-[44px] !leading-[1.1] !tracking-[-0.03em] !mb-[12px] text-[#0A0F1C]">
            Real-Time Prediction Intelligence
          </h2>
          <p {...getScrollRevealClasses(isVisible, 160)} className="text-[15px] text-gray-500 max-w-[480px] mx-auto">
            Stay updated with every prediction the model makes — all on a single,
            dynamic dashboard.
          </p>
        </div>

        {/* Dashboard cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[24px]">
          {dashboardData.map((slide, index) => (
            <div
              key={slide.id}
              {...getScrollRevealClasses(isVisible, 200 + index * 100)}
              className="bg-white rounded-[16px] p-[24px] border border-gray-100 hover:shadow-[0_8px_30px_-8px_rgba(27,42,74,0.08)] transition-all duration-500"
            >
              {/* CSS Dashboard Preview */}
              <DashboardPreview variant={index} />

              <h3 className="font-display !text-[18px] md:!text-[20px] !leading-[1.2] !mb-[20px] text-[#0A0F1C]">
                {slide.title}
              </h3>

              <div className="space-y-[12px]">
                {slide.features.map((feature, fi) => (
                  <div key={fi} className="flex items-start gap-[12px]">
                    <div className="w-[20px] h-[20px] bg-[#BFFF00]/10 rounded-full flex items-center justify-center flex-none mt-[2px]">
                      <i className="ri-check-line text-[#1B2A4A] text-[10px]"></i>
                    </div>
                    <div>
                      <h4 className="text-[13px] font-semibold text-[#0A0F1C] !mb-[2px]">
                        {feature.title}
                      </h4>
                      <p className="text-[12px] text-gray-400">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DashboardShowcase;
