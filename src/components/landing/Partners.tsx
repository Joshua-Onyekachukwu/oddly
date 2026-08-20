"use client";

import React from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";

const leagues = [
  { name: "Premier League", country: "England", color: "#3D195B" },
  { name: "La Liga", country: "Spain", color: "#FF4B44" },
  { name: "Bundesliga", country: "Germany", color: "#D20515" },
  { name: "Serie A", country: "Italy", color: "#024494" },
  { name: "Ligue 1", country: "France", color: "#091C3E" },
  { name: "Champions League", country: "UEFA", color: "#1D428A" },
  { name: "Europa League", country: "UEFA", color: "#F37920" },
  { name: "Eredivisie", country: "Netherlands", color: "#FF6600" },
  { name: "NPFL", country: "Nigeria", color: "#00843D" },
  { name: "MLS", country: "USA", color: "#80000A" },
  { name: "Primeira Liga", country: "Portugal", color: "#006847" },
  { name: "Brasileirão", country: "Brazil", color: "#009C3B" },
];

const Partners: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.05 });

  return (
    <div className="py-[60px] md:py-[80px] border-b border-gray-100" ref={ref}>
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        <div {...getScrollRevealClasses(isVisible, 0)} className="text-center mb-[32px]">
          <span className="text-[13px] text-gray-400 font-medium">
            Tracked across 12+ leagues worldwide
          </span>
        </div>

        <div {...getScrollRevealClasses(isVisible, 80)} className="flex flex-wrap justify-center gap-[12px] md:gap-[16px]">
          {leagues.map((league, i) => (
            <div
              key={league.name}
              className="flex items-center gap-[8px] px-[14px] py-[8px] bg-white rounded-full border border-gray-100 hover:border-gray-200 transition-all duration-300 group"
            >
              <div
                className="w-[8px] h-[8px] rounded-full flex-none"
                style={{ backgroundColor: league.color }}
              />
              <span className="text-[12px] font-medium text-gray-600 group-hover:text-[#0A0F1C] transition-colors whitespace-nowrap">
                {league.name}
              </span>
              <span className="text-[10px] text-gray-300 hidden md:inline">
                {league.country}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Partners;
