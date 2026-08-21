"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { MatchDetailDrawer } from "@/components/matches/MatchDetailDrawer";
import { ResponsiveGrid, FilterBar, SkeletonGrid } from "@/components/ui/DesignSystem";
import { PageHeader } from "@/components/ui";

type DateFilter = "today" | "week" | "month" | "all";

interface Fixture {
  id: string;
  kickoff_time: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_name?: string;
  away_team_name?: string;
  home_team_logo?: string | null;
  away_team_logo?: string | null;
  league_logo?: string | null;
  league_name?: string;
  predictions?: Array<{
    market: string;
    selection: string;
    model_probability: number;
  }>;
}

const PAGE_SIZE = 20;

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All" },
];

function getDateRange(filter: DateFilter): { from: string; to: string } | null {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  switch (filter) {
    case "today":
      return { from: `${today}T00:00:00Z`, to: `${today}T23:59:59Z` };
    case "week": {
      const end = new Date(now);
      end.setDate(end.getDate() - 7);
      return { from: `${end.toISOString().split("T")[0]}T00:00:00Z`, to: `${today}T23:59:59Z` };
    }
    case "month": {
      const end = new Date(now);
      end.setMonth(end.getMonth() - 1);
      return { from: `${end.toISOString().split("T")[0]}T00:00:00Z`, to: `${today}T23:59:59Z` };
    }
    case "all":
      return null;
  }
}

// ─── Result Card (extends MatchCard pattern with result indicator) ────────

function ResultCard({ fixture, onClick }: { fixture: Fixture; onClick: () => void }) {
  const hg = fixture.home_score ?? 0;
  const ag = fixture.away_score ?? 0;
  const total = hg + ag;

  const mainPred = fixture.predictions?.find((p) => p.market === "1X2");
  let predictedHome = false;
  if (mainPred) {
    predictedHome = mainPred.selection === fixture.home_team_name;
  }
  const actualHomeWin = hg > ag;
  const actualDraw = hg === ag;
  const wasCorrect = predictedHome ? actualHomeWin : !actualHomeWin && !actualDraw;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-[14px] border border-gray-100 hover:border-gray-200 hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all duration-300 cursor-pointer group overflow-hidden"
    >
      {/* Header */}
      <div className="px-[14px] pt-[12px] pb-[8px] flex items-center justify-between">
        <div className="flex items-center gap-[6px] min-w-0">
          {fixture.league_logo ? (
            <img src={fixture.league_logo} alt="" className="w-[14px] h-[14px] object-contain flex-none" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className="w-[14px] h-[14px] bg-gray-200 rounded-[3px] flex-none" />
          )}
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider truncate">
            {fixture.league_name || "Unknown"}
          </span>
        </div>
        <span className="text-[10px] font-semibold text-gray-400 bg-gray-50 px-[6px] py-[2px] rounded">FT</span>
      </div>

      {/* Teams + Score */}
      <div className="px-[14px] py-[8px]">
        <div className="flex items-center gap-[10px]">
          <div className="flex items-center gap-[8px] flex-1 min-w-0">
            <TeamLogo logo={fixture.home_team_logo} name={fixture.home_team_name || "H"} size={28} />
            <span className={`text-[13px] font-semibold truncate ${actualHomeWin ? "text-[#0A0F1C]" : "text-gray-500"}`}>
              {fixture.home_team_name || "Home"}
            </span>
          </div>
          <div className="flex-none px-[8px] text-center">
            <span className="font-display text-[18px] font-bold text-[#0A0F1C]">
              {hg} - {ag}
            </span>
          </div>
          <div className="flex items-center gap-[8px] flex-1 min-w-0 justify-end">
            <span className={`text-[13px] font-semibold truncate text-right ${actualHomeWin ? "text-gray-500" : "text-[#0A0F1C]"}`}>
              {fixture.away_team_name || "Away"}
            </span>
            <TeamLogo logo={fixture.away_team_logo} name={fixture.away_team_name || "A"} size={28} />
          </div>
        </div>
      </div>

      {/* Prediction Result */}
      <div className="px-[14px] pb-[12px] pt-[4px] border-t border-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[6px]">
            {mainPred && (
              <span className="text-[10px] font-medium text-gray-500 truncate max-w-[80px]">
                {mainPred.selection}
              </span>
            )}
          </div>
          <div className="flex items-center gap-[6px]">
            <span className="text-[9px] font-medium text-gray-400">
              {total} goals
            </span>
            <span className={`text-[10px] font-semibold px-[5px] py-[1px] rounded ${
              wasCorrect
                ? "bg-green-50 text-green-600"
                : "bg-red-50 text-red-500"
            }`}>
              {wasCorrect ? "✓" : "✗"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamLogo({ logo, name, size = 28 }: { logo?: string | null; name: string; size?: number }) {
  if (logo) {
    return (
      <div className="rounded-full bg-gray-50 flex items-center justify-center flex-none overflow-hidden border border-gray-100" style={{ width: size, height: size }}>
        <img src={logo} alt={name} className="object-contain" style={{ width: size * 0.7, height: size * 0.7 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      </div>
    );
  }
  return (
    <div className="bg-[#1B2A4A]/6 rounded-full flex items-center justify-center flex-none border border-gray-100" style={{ width: size, height: size }}>
      <span className="font-bold text-[#1B2A4A] font-display" style={{ fontSize: size * 0.35 }}>{name.charAt(0)}</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────

export default function ResultsPage() {
  const [dateFilter, setDateFilter] = useState<DateFilter>("week");
  const [searchQuery, setSearchQuery] = useState("");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);

  const fetchFixtures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      let query = supabase
        .from("fixtures")
        .select(
          `*, leagues (name, country, logo), home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo), away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo), predictions (market, selection, model_probability, confidence_lower, confidence_upper)`
        )
        .eq("status", "finished")
        .not("home_score", "is", null)
        .order("kickoff_time", { ascending: false });

      const range = getDateRange(dateFilter);
      if (range) {
        query = query.gte("kickoff_time", range.from).lte("kickoff_time", range.to);
      }

      const { data, error: fetchError } = await query.limit(200);
      if (fetchError) throw fetchError;

      setFixtures(
        (data || []).map((f: any) => ({
          ...f,
          home_team_name: f.home_team?.canonical_name || "TBD",
          away_team_name: f.away_team?.canonical_name || "TBD",
          home_team_logo: f.home_team?.logo || null,
          away_team_logo: f.away_team?.logo || null,
          league_logo: f.leagues?.logo || null,
          league_name: f.leagues?.name || "Unknown",
        }))
      );
    } catch (err: any) {
      setError("Unable to load results. The data service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [dateFilter]);

  useEffect(() => { fetchFixtures(); }, [fetchFixtures]);
  useEffect(() => { setCurrentPage(1); }, [dateFilter, searchQuery, leagueFilter]);

  const leagues = useMemo(() => [...new Set(fixtures.map((f) => f.league_name).filter(Boolean))].sort(), [fixtures]);

  const filtered = useMemo(() => {
    let result = [...fixtures];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((f) => f.home_team_name?.toLowerCase().includes(q) || f.away_team_name?.toLowerCase().includes(q) || f.league_name?.toLowerCase().includes(q));
    }
    if (leagueFilter !== "all") result = result.filter((f) => f.league_name === leagueFilter);
    return result;
  }, [fixtures, searchQuery, leagueFilter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div>
      <PageHeader title="Match Results" description="Completed fixtures and prediction accuracy tracking." />

      <FilterBar
        dateFilters={DATE_FILTERS}
        activeDateFilter={dateFilter}
        onDateFilterChange={(k) => setDateFilter(k as DateFilter)}
        searchPlaceholder="Search teams or leagues..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        matchCount={filtered.length}
        leagueFilter={
          <select value={leagueFilter} onChange={(e) => setLeagueFilter(e.target.value)} className="h-[34px] rounded-[10px] border border-gray-100 bg-gray-50 px-[10px] text-[12px] text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]/20 appearance-none cursor-pointer min-w-[120px]">
            <option value="all">All Leagues</option>
            {leagues.map((lg) => <option key={lg} value={lg}>{lg}</option>)}
          </select>
        }
      />

      {loading && <SkeletonGrid count={8} />}

      {!loading && error && (
        <div className="text-center py-[60px]">
          <p className="text-[13px] text-gray-400 mb-[16px]">{error}</p>
          <button onClick={fetchFixtures} className="px-[16px] py-[8px] rounded-[10px] bg-[#1B2A4A] text-white text-[12px] font-semibold hover:opacity-90 transition-all">Retry</button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-[60px]">
          <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-gray-50 mb-[16px]">
            <i className="ri-calendar-check-line text-[24px] text-gray-200" />
          </div>
          <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[4px]">No results found</h3>
          <p className="text-[13px] text-gray-400">Try a different date range.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <ResponsiveGrid>
            {paginated.map((fixture) => (
              <ResultCard key={fixture.id} fixture={fixture} onClick={() => setSelectedFixture(fixture.id)} />
            ))}
          </ResponsiveGrid>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-[4px] mt-[24px]">
              <button onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1} className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-all">←</button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((page) => (
                <button key={page} onClick={() => setCurrentPage(page)} className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[12px] font-semibold transition-all ${page === currentPage ? "bg-[#1B2A4A] text-white shadow-sm" : "text-gray-500 hover:bg-gray-100"}`}>
                  {page}
                </button>
              ))}
              <button onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === totalPages} className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-all">→</button>
            </div>
          )}

          <div className="text-center mt-[16px] text-[11px] text-gray-300">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} results
          </div>
        </>
      )}

      {selectedFixture && <MatchDetailDrawer fixtureId={selectedFixture} onClose={() => setSelectedFixture(null)} />}
    </div>
  );
}
