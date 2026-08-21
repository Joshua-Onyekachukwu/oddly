"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { MatchesList } from "@/components/matches/MatchesList";

type DateFilter = "today" | "tomorrow" | "week" | "month";

const FILTER_OPTIONS: { key: DateFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
];

function getDateRange(filter: DateFilter): { from: string; to: string } {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  switch (filter) {
    case "today":
      return { from: `${today}T00:00:00Z`, to: `${today}T23:59:59Z` };

    case "tomorrow": {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const t = tomorrow.toISOString().split("T")[0];
      return { from: `${t}T00:00:00Z`, to: `${t}T23:59:59Z` };
    }

    case "week": {
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const wEnd = weekEnd.toISOString().split("T")[0];
      return { from: `${today}T00:00:00Z`, to: `${wEnd}T23:59:59Z` };
    }

    case "month": {
      const monthEnd = new Date(now);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      const mEnd = monthEnd.toISOString().split("T")[0];
      return { from: `${today}T00:00:00Z`, to: `${mEnd}T23:59:59Z` };
    }
  }
}

export default function UpcomingPage() {
  const [filter, setFilter] = useState<DateFilter>("week");
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFixtures = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { from, to } = getDateRange(filter);

    const { data, error } = await supabase
      .from("fixtures")
      .select(
        `*, leagues (name, country, logo), home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo), away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo), predictions (id, market, selection, model_probability, confidence_lower, confidence_upper)`
      )
      .gte("kickoff_time", from)
      .lte("kickoff_time", to)
      .order("kickoff_time", { ascending: true })
      .limit(100);

    if (!error && data) {
      setFixtures(
        data.map((f: any) => ({
          ...f,
          home_team_name: f.home_team?.canonical_name || "TBD",
          away_team_name: f.away_team?.canonical_name || "TBD",
          home_team_logo: f.home_team?.logo || null,
          away_team_logo: f.away_team?.logo || null,
          league_logo: f.leagues?.logo || null,
        }))
      );
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchFixtures();
  }, [fetchFixtures]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-[20px]">
        <h1 className="font-display text-[24px] md:text-[28px] font-bold text-[#0A0F1C] mb-[4px]">
          Upcoming Matches
        </h1>
        <p className="text-[14px] text-gray-500">
          AI-powered predictions for upcoming fixtures across 100+ leagues.
        </p>
      </div>

      {/* Date filter tabs */}
      <div className="flex items-center gap-[6px] mb-[20px] overflow-x-auto pb-[4px]">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`
              px-[14px] py-[7px] rounded-[8px] text-[12px] font-semibold whitespace-nowrap transition-all
              ${
                filter === opt.key
                  ? "bg-[#1B2A4A] text-white shadow-sm"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
              }
            `}
          >
            {opt.label}
          </button>
        ))}
        <span className="text-[11px] text-gray-400 ml-[8px]">
          {fixtures.length} fixture{fixtures.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-[6px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[80px] bg-gray-50 rounded-[10px] animate-pulse" />
          ))}
        </div>
      )}

      {/* Fixtures */}
      {!loading && fixtures.length === 0 && (
        <div className="text-center py-[48px]">
          <i className="ri-calendar-line text-[40px] text-gray-200 block mb-[12px]" />
          <p className="text-[14px] text-gray-400 mb-[4px]">No matches found</p>
          <p className="text-[12px] text-gray-300">
            Try a different date range or check back later.
          </p>
        </div>
      )}

      {!loading && fixtures.length > 0 && <MatchesList fixtures={fixtures} />}
    </div>
  );
}
