"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, FilterBar, EmptyState } from "@/components/ui";

interface League {
  id: string;
  name: string;
  country: string | null;
  logo: string | null;
  country_flag: string | null;
  is_active: boolean;
  priority: number;
}

interface LeagueStats {
  today: number;
  upcoming: number;
}

export default function CompetitionsPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [stats, setStats] = useState<Record<string, LeagueStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      const [{ data: leagueRows, error: leagueErr }, { data: fixtureRows, error: fixtureErr }] =
        await Promise.all([
          supabase
            .from("leagues")
            .select("id, name, country, logo, country_flag, is_active, priority")
            .order("priority", { ascending: true })
            .order("name", { ascending: true }),
          supabase
            .from("fixtures")
            .select("league_id, kickoff_time, status")
            .gte("kickoff_time", new Date().toISOString().split("T")[0] + "T00:00:00Z")
            .in("status", ["scheduled", "live", "halftime"])
            .limit(10000),
        ]);

      if (leagueErr) throw leagueErr;
      if (fixtureErr) throw fixtureErr;

      setLeagues((leagueRows || []) as League[]);

      const todayStr = new Date().toISOString().split("T")[0];
      const now = Date.now();
      const map: Record<string, LeagueStats> = {};
      for (const f of fixtureRows || []) {
        if (!f.league_id) continue;
        const s = (map[f.league_id] ||= { today: 0, upcoming: 0 });
        const kick = new Date(f.kickoff_time).getTime();
        if (kick >= now) s.upcoming += 1;
        if (f.kickoff_time.slice(0, 10) === todayStr) s.today += 1;
      }
      setStats(map);
    } catch (err: any) {
      console.error("Failed to load competitions:", err);
      setError("Unable to load competitions. The data service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leagues;
    return leagues.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.country || "").toLowerCase().includes(q)
    );
  }, [leagues, search]);

  return (
    <div>
      <PageHeader
        title="Competitions"
        description="Leagues covered by ODDLY's prediction models — fixtures, standings and model parameters."
      />

      <FilterBar
        searchPlaceholder="Search leagues or countries..."
        searchValue={search}
        onSearchChange={setSearch}
        matchCount={filtered.length}
      />

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[12px]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-[16px] animate-pulse">
              <div className="flex items-center gap-[12px]">
                <div className="w-[40px] h-[40px] rounded-full bg-gray-100" />
                <div className="flex-1 space-y-[6px]">
                  <div className="h-[13px] w-[70%] bg-gray-100 rounded" />
                  <div className="h-[10px] w-[40%] bg-gray-100 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="text-center py-[60px]">
          <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-red-50 mb-[16px]">
            <i className="ri-error-warning-line text-[24px] text-red-300" />
          </div>
          <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[4px]">
            Unable to load competitions
          </h3>
          <p className="text-[13px] text-gray-400 mb-[16px]">{error}</p>
          <button
            onClick={fetchData}
            className="px-[16px] py-[8px] rounded-[10px] bg-[#1B2A4A] text-white text-[12px] font-semibold hover:opacity-90 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon="ri-trophy-line"
          title="No competitions found"
          description={search ? `No leagues match "${search}".` : "No league data is available yet."}
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[12px]">
          {filtered.map((league) => {
            const s = stats[league.id] || { today: 0, upcoming: 0 };
            return (
              <Link
                key={league.id}
                href={`/competitions/${league.id}`}
                className="group bg-white rounded-[14px] border border-gray-100 p-[16px] hover:border-[#1B2A4A]/30 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-all duration-200"
              >
                <div className="flex items-start gap-[12px]">
                  <div className="w-[44px] h-[44px] rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden flex-none">
                    {league.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={league.logo} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <i className="ri-football-line text-[20px] text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[14px] font-semibold text-[#0A0F1C] truncate group-hover:text-[#1B2A4A] transition-colors">
                      {league.name}
                    </h3>
                    <div className="flex items-center gap-[4px] text-[11px] text-gray-400 mt-[2px]">
                      {league.country_flag && <span>{league.country_flag}</span>}
                      <span className="truncate">{league.country || "—"}</span>
                    </div>
                  </div>
                  <i className="ri-arrow-right-s-line text-[16px] text-gray-300 group-hover:text-[#1B2A4A] transition-colors" />
                </div>

                <div className="flex items-center gap-[12px] mt-[14px] pt-[12px] border-t border-gray-50">
                  <div className="flex items-center gap-[4px] text-[11px] text-gray-500">
                    <i className="ri-calendar-today-line text-[12px] text-gray-400" />
                    <span className="font-mono-data font-semibold">{s.today}</span>
                    <span className="text-gray-400">today</span>
                  </div>
                  <div className="flex items-center gap-[4px] text-[11px] text-gray-500">
                    <i className="ri-time-line text-[12px] text-gray-400" />
                    <span className="font-mono-data font-semibold">{s.upcoming}</span>
                    <span className="text-gray-400">upcoming</span>
                  </div>
                  {!league.is_active && (
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wide text-gray-300 bg-gray-50 px-[6px] py-[2px] rounded-full">
                      inactive
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
