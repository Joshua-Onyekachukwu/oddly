"use client";

import React from "react";
import Link from "next/link";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

const GetStarted: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.1 });

  return (
    <div className="py-[80px] md:py-[100px] lg:py-[120px]" ref={ref}>
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        <div
          {...getScrollRevealClasses(isVisible, 0)}
          className="bg-[#0A0F1C] rounded-[1.5rem] p-[48px] md:p-[64px] lg:p-[80px] relative overflow-hidden text-center"
        >
          {/* Ambient orbs */}
          <div className="absolute top-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-[#BFFF00]/[0.04] blur-[100px] pointer-events-none" />
          <div className="absolute bottom-[-10%] left-[-5%] w-[300px] h-[300px] rounded-full bg-[#2563EB]/[0.06] blur-[80px] pointer-events-none" />

          {/* Grid */}
          <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

          <div className="relative z-[1]">
            <div className="inline-flex items-center gap-[8px] mb-[24px]">
              <span className="w-[6px] h-[6px] rounded-full bg-[#BFFF00] animate-pulse"></span>
              <span className="text-[#BFFF00]/80 text-[11px] font-semibold tracking-[0.15em] uppercase font-display">
                Start Today
              </span>
            </div>

            <h2 className="font-display !text-[28px] md:!text-[36px] lg:!text-[44px] !leading-[1.1] !tracking-[-0.03em] !mb-[16px] text-white">
              Ready to Bet <span className="text-[#BFFF00]">Smarter</span>?
            </h2>

            <p className="text-[15px] text-gray-400 max-w-[480px] mx-auto mb-[32px]">
              Join thousands of bettors using AI-powered predictions to find
              value where the market gets it wrong.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-[12px]">
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
                View Dashboard
                <span className="w-[24px] h-[24px] rounded-full bg-white/5 flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-[2px] group-hover:-translate-y-[1px] group-hover:bg-white/10">
                  <i className="ri-arrow-right-up-line text-[14px]"></i>
                </span>
              </Link>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-[12px] md:gap-[20px] mt-[32px]">
              {["No credit card required", "Cancel anytime", "90%+ ELITE accuracy"].map((t, i) => (
                <span key={i} className="flex items-center gap-[6px] text-[12px] text-white/30">
                  <i className="ri-check-line text-[#BFFF00] text-[12px]"></i>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GetStarted;
