"use client";

import React, { useState, useEffect } from "react";
import { useScrollReveal, getScrollRevealClasses } from "@/hooks/useScrollReveal";
import { createClient } from "@/lib/supabase/client";

interface League {
  id: string;
  name: string;
  country: string | null;
  logo: string | null;
}

const FALLBACK_LEAGUES = [
  { name: "Premier League", country: "England", color: "#3D195B", letter: "PL" },
  { name: "La Liga", country: "Spain", color: "#FF4B44", letter: "LL" },
  { name: "Bundesliga", country: "Germany", color: "#D20515", letter: "BL" },
  { name: "Serie A", country: "Italy", color: "#024494", letter: "SA" },
  { name: "Ligue 1", country: "France", color: "#091C3E", letter: "L1" },
  { name: "Champions League", country: "UEFA", color: "#1D428A", letter: "CL" },
  { name: "Europa League", country: "UEFA", color: "#F37920", letter: "EL" },
  { name: "Eredivisie", country: "Netherlands", color: "#FF6600", letter: "ED" },
  { name: "NPFL", country: "Nigeria", color: "#00843D", letter: "NP" },
  { name: "MLS", country: "USA", color: "#80000A", letter: "ML" },
  { name: "Primeira Liga", country: "Portugal", color: "#006847", letter: "PL" },
  { name: "Brasileirão", country: "Brazil", color: "#009C3B", letter: "BR" },
];

const Partners: React.FC = () => {
  const { ref, isVisible } = useScrollReveal({ threshold: 0.05 });
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeagues() {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("leagues")
          .select("id, name, country, logo")
          .eq("is_active", true)
          .order("priority", { ascending: true })
          .limit(12);

        if (data && data.length > 0) {
          setLeagues(data);
        }
      } catch {
        // Use fallback
      }
      setLoading(false);
    }
    fetchLeagues();
  }, []);

  const displayLeagues = leagues.length > 0 ? leagues : FALLBACK_LEAGUES;

  return (
    <div className="py-[60px] md:py-[80px] border-b border-gray-100" ref={ref}>
      <div className="container sm:max-w-[540px] md:max-w-[720px] lg:max-w-[960px] xl:max-w-[1200px] mx-auto px-[16px]">
        <div {...getScrollRevealClasses(isVisible, 0)} className="text-center mb-[32px]">
          <span className="text-[13px] text-gray-400 font-medium">
            Tracked across 12+ leagues worldwide
          </span>
        </div>

        <div {...getScrollRevealClasses(isVisible, 80)} className="flex flex-wrap justify-center gap-[12px] md:gap-[16px]">
          {displayLeagues.map((league) => {
            const isReal = "id" in league && "logo" in league;
            const logo = isReal ? (league as League).logo : null;
            const name = isReal ? (league as League).name : (league as any).name;
            const country = isReal ? (league as League).country : (league as any).country;
            const color = isReal ? null : (league as any).color;
            const letter = isReal ? null : (league as any).letter;

            return (
              <div
                key={name}
                className="flex items-center gap-[10px] px-[16px] py-[10px] bg-white rounded-[12px] border border-gray-100 hover:border-gray-200 hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.08)] transition-all duration-300 group"
              >
                {/* League logo */}
                {logo ? (
                  <div className="w-[28px] h-[28px] rounded-[6px] flex items-center justify-center flex-none bg-gray-50 overflow-hidden">
                    <img
                      src={logo}
                      alt={name}
                      className="w-[22px] h-[22px] object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                      }}
                    />
                    <span className="hidden w-full h-full flex items-center justify-center text-[9px] font-bold font-display text-gray-400 bg-gray-100 rounded-[6px]">
                      {letter || name.charAt(0)}
                    </span>
                  </div>
                ) : (
                  <div
                    className="w-[28px] h-[28px] rounded-[6px] flex items-center justify-center flex-none text-white text-[9px] font-bold font-display tracking-wide"
                    style={{ backgroundColor: color || "#1B2A4A" }}
                  >
                    {letter || name.charAt(0)}
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="text-[12px] font-semibold text-gray-700 group-hover:text-[#0A0F1C] transition-colors whitespace-nowrap leading-tight">
                    {name}
                  </span>
                  <span className="text-[10px] text-gray-300 leading-tight">
                    {country}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Partners;
