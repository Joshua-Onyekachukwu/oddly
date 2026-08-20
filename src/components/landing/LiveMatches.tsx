"use client";

import React from "react";
import Link from "next/link";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

interface Fixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  predictionCount: number;
  topMarket: string | null;
}

interface ValueBet {
  id: string;
  match: string;
  market: string;
  selection: string;
  edge: number;
  odds: number;
  confidence: number;
}

interface LiveMatchesProps {
  fixtures: Fixture[];
  valueBets: ValueBet[];
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

function getInitial(name: string): string {
  return name?.charAt(0)?.toUpperCase() || "?";
}

const LiveMatches: React.FC<LiveMatchesProps> = ({ fixtures, valueBets }) => {
  const { ref: sectionRef, isVisible } = useScrollReveal({ threshold: 0.05 });
  const { ref: betsRef, isVisible: betsVisible } = useScrollReveal({ threshold: 0.1 });

  // Show max 8 fixtures
  const displayFixtures = fixtures.slice(0, 8);
  const hasData = displayFixtures.length > 0 || valueBets.length > 0;

  if (!hasData) return null;

  return (
    <section className="py-[80px] md:py-[100px] lg:py-[120px] bg-[#F8FAFC]" id="matches">
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        {/* Section header */}
        <div ref={sectionRef} className="text-center mb-[48px] md:mb-[64px]">
          <div {...getScrollRevealClasses(isVisible, 0)} className="inline-flex items-center gap-[8px] mb-[16px]">
            <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00] animate-pulse"></span>
            <span className="text-[#1B2A4A] text-[11px] font-semibold tracking-[0.15em] uppercase font-display">
              Live Feed
            </span>
          </div>
          <h2
            {...getScrollRevealClasses(isVisible, 80)}
            className="font-display !text-[28px] md:!text-[36px] lg:!text-[44px] !leading-[1.1] !tracking-[-0.03em] !mb-[12px] text-[#0A0F1C]"
          >
            Today&apos;s Matches &amp; Value Bets
          </h2>
          <p
            {...getScrollRevealClasses(isVisible, 160)}
            className="text-[15px] text-gray-500 max-w-[480px] mx-auto"
          >
            Real-time fixtures with AI predictions and detected value bets across all tracked leagues.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-[32px]">
          {/* Fixtures — 3 columns */}
          {displayFixtures.length > 0 && (
            <div className="lg:col-span-3" ref={sectionRef}>
              <div className="flex items-center justify-between mb-[16px]">
                <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C]">
                  Fixtures
                </h3>
                <span className="text-[12px] text-gray-400 font-mono-data">
                  {displayFixtures.length} today
                </span>
              </div>

              <div className="space-y-[8px]">
                {displayFixtures.map((f, i) => (
                  <Link
                    key={f.id}
                    href={`/matches/${f.id}`}
                    {...getScrollRevealClasses(isVisible, i * 40)}
                    className="group block bg-white rounded-[14px] p-[16px] border border-gray-100 hover:border-[#1B2A4A]/10 hover:shadow-[0_4px_20px_-8px_rgba(27,42,74,0.1)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                  >
                    <div className="flex items-center justify-between">
                      {/* Teams */}
                      <div className="flex items-center gap-[12px] flex-1 min-w-0">
                        <div className="flex items-center gap-[8px] min-w-0">
                          <div className="w-[28px] h-[28px] bg-[#0A0F1C]/4 rounded-full flex items-center justify-center flex-none">
                            <span className="text-[11px] font-bold text-[#0A0F1C] font-display">{getInitial(f.homeTeam)}</span>
                          </div>
                          <span className="text-[13px] font-semibold text-[#0A0F1C] truncate">{f.homeTeam}</span>
                        </div>

                        <span className="text-[11px] font-bold text-gray-300 font-display flex-none">VS</span>

                        <div className="flex items-center gap-[8px] min-w-0">
                          <span className="text-[13px] font-semibold text-[#0A0F1C] truncate">{f.awayTeam}</span>
                          <div className="w-[28px] h-[28px] bg-[#D97706]/8 rounded-full flex items-center justify-center flex-none">
                            <span className="text-[11px] font-bold text-[#D97706] font-display">{getInitial(f.awayTeam)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Meta */}
                      <div className="flex items-center gap-[12px] ml-[12px] flex-none">
                        {f.topMarket && (
                          <span className="hidden md:inline-flex text-[10px] text-[#22c55e] bg-[#22c55e]/8 px-[8px] py-[3px] rounded-full font-medium">
                            {f.topMarket.split(" — ")[0]}
                          </span>
                        )}
                        <span className="text-[11px] text-gray-400 font-mono-data">{formatKickoff(f.kickoff)}</span>
                        <i className="ri-arrow-right-s-line text-gray-300 group-hover:text-[#1B2A4A] transition-colors duration-300"></i>
                      </div>
                    </div>

                    {/* League + prediction count */}
                    <div className="flex items-center gap-[8px] mt-[8px]">
                      <span className="text-[10px] text-gray-400">{f.league}</span>
                      {f.predictionCount > 0 && (
                        <>
                          <span className="text-gray-200">·</span>
                          <span className="text-[10px] text-gray-400">{f.predictionCount} predictions</span>
                        </>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Value Bets — 2 columns */}
          {valueBets.length > 0 && (
            <div className="lg:col-span-2" ref={betsRef}>
              <div className="flex items-center justify-between mb-[16px]">
                <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C]">
                  Top Value Bets
                </h3>
                <span className="flex items-center gap-[4px] text-[10px] font-semibold text-[#22c55e] bg-[#22c55e]/8 px-[8px] py-[3px] rounded-full">
                  <span className="w-[4px] h-[4px] rounded-full bg-[#22c55e] animate-pulse"></span>
                  LIVE
                </span>
              </div>

              <div className="space-y-[8px]">
                {valueBets.map((vb, i) => (
                  <div
                    key={vb.id}
                    {...getScrollRevealClasses(betsVisible, i * 60)}
                    className="bg-white rounded-[14px] p-[16px] border border-gray-100 hover:border-[#22c55e]/20 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                  >
                    {/* Match */}
                    <div className="text-[11px] text-gray-400 mb-[8px] truncate">
                      {vb.match}
                    </div>

                    {/* Market + Selection */}
                    <div className="flex items-center justify-between mb-[10px]">
                      <div>
                        <span className="text-[13px] font-semibold text-[#0A0F1C] capitalize">
                          {vb.market.replace(/_/g, " ")}
                        </span>
                        <span className="text-[11px] text-gray-400 ml-[6px] capitalize">
                          — {vb.selection}
                        </span>
                      </div>
                      <span className="font-display text-[14px] font-bold text-[#22c55e] font-mono-data">
                        +{vb.edge.toFixed(1)}%
                      </span>
                    </div>

                    {/* Edge bar */}
                    <div className="w-full bg-gray-100 rounded-full h-[3px] mb-[10px]">
                      <div
                        className="bg-[#22c55e] h-[3px] rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min(vb.edge * 5, 100)}%` }}
                      ></div>
                    </div>

                    {/* Stats */}
                    <div className="flex items-center gap-[12px]">
                      <div className="flex items-center gap-[4px]">
                        <span className="text-[10px] text-gray-400">Odds</span>
                        <span className="text-[11px] font-bold text-[#0A0F1C] font-mono-data">{vb.odds.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-[4px]">
                        <span className="text-[10px] text-gray-400">Confidence</span>
                        <span className="text-[11px] font-bold text-[#0A0F1C] font-mono-data">{vb.confidence.toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CTA */}
        <div {...getScrollRevealClasses(isVisible, 400)} className="text-center mt-[40px]">
          <Link
            href="/signup"
            className="group inline-flex items-center gap-[8px] font-display font-semibold text-[14px] rounded-full bg-[#1B2A4A] text-white py-[12px] px-[24px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:shadow-[0_0_30px_rgba(27,42,74,0.2)] active:scale-[0.97]"
          >
            View All Matches
            <span className="w-[22px] h-[22px] rounded-full bg-white/10 flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-[2px] group-hover:-translate-y-[1px] group-hover:bg-white/15">
              <i className="ri-arrow-right-up-line text-[12px]"></i>
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default LiveMatches;
