"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

interface CrownJewel {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  market: string;
  selection: string;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  modelAgreement: number;
}

interface HeroStats {
  totalLeagues: number;
  totalPredictions: number;
  totalRecommendations: number;
  avgAccuracy: number;
  totalFixturesToday: number;
  activeModels: number;
}

interface HeroBannerProps {
  crownJewel: CrownJewel | null;
  stats: HeroStats;
}

function getTeamInitial(name: string): string {
  return name?.charAt(0)?.toUpperCase() || "?";
}

function formatKickoff(iso: string): string {
  if (!iso) return "TBD";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "TBD";
  }
}

const HeroBanner: React.FC<HeroBannerProps> = ({ crownJewel, stats }) => {
  const { ref: heroRef, isVisible } = useScrollReveal({ threshold: 0.05 });
  const { ref: cardRef, isVisible: cardVisible } = useScrollReveal({ threshold: 0.1 });

  // Use live data or fallbacks
  const cj = crownJewel;
  const homeTeam = cj?.homeTeam || "Arsenal";
  const awayTeam = cj?.awayTeam || "Chelsea";
  const market = cj?.market?.replace(/_/g, " ") || "Over 2.5 Goals";
  const selection = cj?.selection || "over";
  const modelProb = cj ? Math.round(cj.modelProbability * 100) : 93;
  const impliedProb = cj ? Math.round(cj.impliedProbability * 100) : 71;
  const edge = cj ? Math.round(cj.edge * 100) : 22;
  const models = cj?.modelAgreement || stats.activeModels;
  const kickoff = cj?.kickoff ? formatKickoff(cj.kickoff) : "Today 20:00";
  const hasCrownJewel = !!cj;

  return (
    <div className="xl:max-w-[1680px] mx-auto px-4 md:px-6">
      <div
        ref={heroRef}
        className="bg-[#0A0F1C] py-[60px] md:py-[100px] lg:py-[120px] xl:px-[80px] relative z-[1] xl:rounded-[2.5rem] overflow-hidden"
      >
        {/* Ambient gradient orbs */}
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-[#BFFF00]/[0.04] blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-[#2563EB]/[0.06] blur-[100px] pointer-events-none" />

        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.015] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto relative">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-[48px] lg:gap-[80px] items-center">
            {/* Left: Copy */}
            <div className="xl:max-w-[580px] text-center md:text-left">
              {/* Eyebrow */}
              <div
                {...getScrollRevealClasses(isVisible, 0)}
                className="inline-flex items-center gap-[8px] mb-[24px] md:mb-[32px] justify-center md:justify-start"
              >
                <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00] animate-pulse"></span>
                <span className="text-[#BFFF00]/80 text-[11px] font-semibold tracking-[0.15em] uppercase font-display">
                  {models} Models Agree {hasCrownJewel ? "— Live Now" : "— Analyzing"}
                </span>
              </div>

              {/* Headline */}
              <h1
                {...getScrollRevealClasses(isVisible, 80)}
                className="font-display !text-[36px] md:!text-[48px] lg:!text-[56px] xl:!text-[64px] !leading-[1.05] !tracking-[-0.04em] !mb-[20px] md:!mb-[24px] text-white"
              >
                Every edge.
                <br />
                <span className="text-[#BFFF00]">Every model.</span>
                <br />
                One pick.
              </h1>

              {/* Subhead */}
              <p
                {...getScrollRevealClasses(isVisible, 160)}
                className="text-[15px] md:text-[17px] !leading-[1.75] !mb-0 text-gray-400/80 max-w-[460px] mx-auto md:mx-0"
              >
                The Crown Jewel is our single highest-conviction selection each
                day — where all {models} AI models agree, confidence exceeds 90%, and
                the edge over the market is real.
              </p>

              {/* CTAs */}
              <div
                {...getScrollRevealClasses(isVisible, 240)}
                className="mt-[32px] md:mt-[40px] flex flex-wrap items-center gap-[12px] justify-center md:justify-start"
              >
                <Link
                  href="/signup"
                  className="group inline-flex items-center gap-[8px] font-display font-semibold text-[15px] rounded-full bg-[#BFFF00] text-[#0A0F1C] py-[14px] px-[28px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_0_40px_rgba(191,255,0,0.2)] active:scale-[0.97]"
                >
                  Start Free
                  <span className="w-[24px] h-[24px] rounded-full bg-[#0A0F1C]/8 flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-[2px] group-hover:-translate-y-[1px] group-hover:bg-[#0A0F1C]/12">
                    <i className="ri-arrow-right-up-line text-[14px]"></i>
                  </span>
                </Link>
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-[8px] font-display font-medium text-[15px] rounded-full text-white/60 hover:text-white py-[14px] px-[28px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] border border-white/8 hover:border-white/20 active:scale-[0.97]"
                >
                  See Today&apos;s Pick
                  <span className="w-[24px] h-[24px] rounded-full bg-white/5 flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-[2px] group-hover:-translate-y-[1px] group-hover:bg-white/10">
                    <i className="ri-arrow-right-up-line text-[14px]"></i>
                  </span>
                </Link>
              </div>

              {/* Trust strip — live stats */}
              <div
                {...getScrollRevealClasses(isVisible, 320)}
                className="mt-[48px] md:mt-[64px] flex items-center gap-[20px] flex-wrap justify-center md:justify-start"
              >
                {[
                  { value: stats.avgAccuracy > 0 ? `${stats.avgAccuracy}%` : "—", label: "accuracy" },
                  { value: stats.totalLeagues > 0 ? `${stats.totalLeagues}+` : "—", label: "leagues" },
                  { value: stats.totalFixturesToday > 0 ? `${stats.totalFixturesToday}` : "—", label: "fixtures today" },
                ].map((stat, i) => (
                  <React.Fragment key={stat.label}>
                    {i > 0 && <div className="w-[1px] h-[20px] bg-white/8"></div>}
                    <div className="flex items-center gap-[6px]">
                      <span className="text-[13px] text-white/40 font-mono-data font-medium">
                        {stat.value}
                      </span>
                      <span className="text-[12px] text-white/25">
                        {stat.label}
                      </span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Right: Dashboard + Crown Jewel Card */}
            <div ref={cardRef} className="relative hidden lg:block">
              {/* Dashboard preview — Double-Bezel */}
              <div
                {...getScrollRevealClasses(cardVisible, 100)}
                className="relative"
              >
                {/* Outer shell */}
                <div className="p-[6px] rounded-[2rem] bg-white/[0.03] ring-1 ring-white/[0.06]">
                  {/* Inner core */}
                  <div className="rounded-[calc(2rem-6px)] overflow-hidden bg-[#0D1321] shadow-[inset_0_1px_1px_rgba(255,255,255,0.03)]">
                    <Image
                      src="/images/hero-dashboard.svg"
                      className="w-full max-w-[600px]"
                      alt="ODDLY Prediction Dashboard"
                      width={865}
                      height={744}
                      priority
                    />
                  </div>
                </div>
              </div>

              {/* Floating Crown Jewel Card — Double-Bezel */}
              <div
                {...getScrollRevealClasses(cardVisible, 300)}
                className="absolute bottom-[16px] left-[8px] right-[8px] md:left-[-24px] md:right-auto md:bottom-[32px] md:max-w-[320px] z-[3]"
              >
                {/* Outer shell */}
                <div className="p-[5px] rounded-[1.25rem] bg-white/[0.06] ring-1 ring-white/[0.08] backdrop-blur-xl">
                  {/* Inner core */}
                  <div className="rounded-[calc(1.25rem-5px)] bg-white p-[18px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5),0_20px_60px_-15px_rgba(0,0,0,0.4)]">
                    {/* Crown Jewel badge */}
                    <div className="flex items-center gap-[8px] mb-[14px]">
                      <div className="w-[22px] h-[22px] rounded-[6px] bg-[#0A0F1C] flex items-center justify-center">
                        <i className="ri-vip-crown-fill text-[10px] text-[#BFFF00]"></i>
                      </div>
                      <span className="font-display text-[10px] font-semibold text-[#0A0F1C] uppercase tracking-[0.12em]">
                        Crown Jewel
                      </span>
                      {hasCrownJewel && (
                        <span className="ml-auto flex items-center gap-[4px] text-[9px] font-semibold text-[#22c55e] bg-[#22c55e]/8 px-[8px] py-[3px] rounded-full">
                          <span className="w-[4px] h-[4px] rounded-full bg-[#22c55e] animate-pulse"></span>
                          LIVE
                        </span>
                      )}
                    </div>

                    {/* Match */}
                    <div className="flex items-center justify-between mb-[14px]">
                      <div className="text-center">
                        <div className="w-[36px] h-[36px] bg-[#0A0F1C]/4 rounded-full flex items-center justify-center mb-[4px]">
                          <span className="text-[14px] font-bold text-[#0A0F1C] font-display">{getTeamInitial(homeTeam)}</span>
                        </div>
                        <span className="text-[10px] font-semibold text-gray-600">{homeTeam}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-[12px] font-bold text-gray-300 font-display">VS</span>
                        <div className="text-[9px] text-gray-400 mt-[2px]">{kickoff}</div>
                      </div>
                      <div className="text-center">
                        <div className="w-[36px] h-[36px] bg-[#D97706]/8 rounded-full flex items-center justify-center mb-[4px]">
                          <span className="text-[14px] font-bold text-[#D97706] font-display">{getTeamInitial(awayTeam)}</span>
                        </div>
                        <span className="text-[10px] font-semibold text-gray-600">{awayTeam}</span>
                      </div>
                    </div>

                    {/* Edge Indicator */}
                    <div className="bg-[#F8FAFC] rounded-[10px] p-[12px] edge-indicator">
                      <div className="flex items-center justify-between mb-[8px]">
                        <span className="text-[12px] font-medium text-gray-500 capitalize">{market}</span>
                        <span className="font-display text-[14px] font-bold text-[#0A0F1C] font-mono-data">{modelProb}%</span>
                      </div>
                      <div className="w-full bg-gray-200/60 rounded-full h-[3px] mb-[8px]">
                        <div className="bg-[#0A0F1C] h-[3px] rounded-full" style={{ width: `${modelProb}%` }}></div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400 font-mono-data">
                          Model {modelProb}% · Market {impliedProb}%
                        </span>
                        <span className="font-display text-[12px] font-bold text-[#22c55e] font-mono-data">
                          +{edge}% edge
                        </span>
                      </div>
                    </div>

                    {/* Model agreement */}
                    <div className="mt-[10px] flex items-center gap-[6px]">
                      <span className="flex items-center gap-[3px] text-[9px] text-gray-400">
                        <i className="ri-check-line text-[#22c55e] text-[10px]"></i>
                        {models}/7 models
                      </span>
                      <span className="text-gray-200">·</span>
                      <span className="flex items-center gap-[3px] text-[9px] text-gray-400">
                        <i className="ri-check-line text-[#22c55e] text-[10px]"></i>
                        {hasCrownJewel ? "Value detected" : "Awaiting data"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HeroBanner;
