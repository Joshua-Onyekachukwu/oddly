"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { MatchCard } from "@/components/matches/MatchCard";
import { MatchDetailDrawer } from "@/components/matches/MatchDetailDrawer";
import { ResponsiveGrid, FilterBar, SkeletonGrid } from "@/components/ui/DesignSystem";
import { PageHeader } from "@/components/ui";

// ─── Types ───────────────────────────────────────────────────────────────

type DateFilter = "today" | "tomorrow" | "week" | "month" | "all";
type ConfidenceFilter = "all" | "high" | "medium";

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
  leagues?: { name: string; country: string; logo?: string | null };
  predictions?: Array<{
    market: string;
    selection: string;
    model_probability: number;
    confidence_lower?: number;
    confidence_upper?: number;
  }>;
  odds?: {
    home?: number;
    draw?: number;
    away?: number;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
  { key: "all", label: "All" },
];

const CONFIDENCE_FILTERS: { key: ConfidenceFilter; label: string }[] = [
  { key: "all", label: "All Confidence" },
  { key: "high", label: "65%+" },
  { key: "medium", label: "50%+" },
];

// ─── Date Helpers ────────────────────────────────────────────────────────

function getDateRange(filter: DateFilter): { from: string; to: string } | null {
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  switch (filter) {
    case "today":
      return { from: `${today}T00:00:00Z`, to: `${today}T23:59:59Z` };
    case "tomorrow": {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      const d = t.toISOString().split("T")[0];
      return { from: `${d}T00:00:00Z`, to: `${d}T23:59:59Z` };
    }
    case "week": {
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      return { from: `${today}T00:00:00Z`, to: `${end.toISOString().split("T")[0]}T23:59:59Z` };
    }
    case "month": {
      const end = new Date(now);
      end.setMonth(end.getMonth() + 1);
      return { from: `${today}T00:00:00Z`, to: `${end.toISOString().split("T")[0]}T23:59:59Z` };
    }
    case "all":
      return null;
  }
}

// ─── Pagination ──────────────────────────────────────────────────────────

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push("...");
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-[4px] mt-[24px]">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Previous page"
        className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        ←
      </button>
      {pages.map((page, i) =>
        page === "..." ? (
          <span key={`dots-${i}`} className="w-[32px] h-[32px] flex items-center justify-center text-[11px] text-gray-300">
            ···
          </span>
        ) : (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            aria-label={`Page ${page}`}
            aria-current={page === currentPage ? "page" : undefined}
            className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[12px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
              page === currentPage
                ? "bg-[#1B2A4A] text-white shadow-sm"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {page}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        aria-label="Next page"
        className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      >
        →
      </button>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────

export default function UpcomingMatchesPage() {
  const [dateFilter, setDateFilter] = useState<DateFilter>("week");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"kickoff" | "confidence">("kickoff");
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);

  // ─── Fetch Fixtures ────────────────────────────────────────────────────

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
        .eq("status", "scheduled")
        .order("kickoff_time", { ascending: true });

      const range = getDateRange(dateFilter);
      if (range) {
        query = query.gte("kickoff_time", range.from).lte("kickoff_time", range.to);
      }

      const { data, error: fetchError } = await query.limit(500);

      if (fetchError) throw fetchError;

      // Get odds for all fixtures
      const fixtureIds = (data || []).map((f: any) => f.id);
      let oddsMap: Record<string, { home?: number; draw?: number; away?: number }> = {};

      if (fixtureIds.length > 0) {
        const { data: oddsData } = await supabase
          .from("odds_snapshots")
          .select("fixture_id, selection, odds")
          .in("fixture_id", fixtureIds);

        if (oddsData) {
          // Get best odds per selection per fixture.
          // Selections are stored inconsistently ("Home"/"home"/"1", etc.)
          // and multiple markets share the table — only 1X2-style selections
          // map onto the card's home/draw/away chips.
          const normalizeSelection = (s: string): "home" | "draw" | "away" | null => {
            const v = (s || "").toLowerCase();
            if (v === "home" || v === "1") return "home";
            if (v === "draw" || v === "x") return "draw";
            if (v === "away" || v === "2") return "away";
            return null;
          };
          const grouped: Record<string, Record<string, number[]>> = {};
          for (const o of oddsData) {
            const sel = normalizeSelection(o.selection);
            if (!sel) continue;
            if (!grouped[o.fixture_id]) grouped[o.fixture_id] = {};
            if (!grouped[o.fixture_id][sel]) grouped[o.fixture_id][sel] = [];
            grouped[o.fixture_id][sel].push(o.odds);
          }
          for (const [fid, selections] of Object.entries(grouped)) {
            oddsMap[fid] = {
              home: selections["home"]?.length ? Math.max(...selections["home"]) : undefined,
              draw: selections["draw"]?.length ? Math.max(...selections["draw"]) : undefined,
              away: selections["away"]?.length ? Math.max(...selections["away"]) : undefined,
            };
          }
        }
      }

      const mapped = (data || []).map((f: any) => ({
        ...f,
        home_team_name: f.home_team?.canonical_name || "TBD",
        away_team_name: f.away_team?.canonical_name || "TBD",
        home_team_logo: f.home_team?.logo || null,
        away_team_logo: f.away_team?.logo || null,
        league_logo: f.leagues?.logo || null,
        league_name: f.leagues?.name || "Unknown",
        odds: oddsMap[f.id] || undefined,
      }));

      setFixtures(mapped);
    } catch (err: any) {
      console.error("Failed to fetch fixtures:", err);
      setError("Unable to load upcoming matches. The data service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, [dateFilter]);

  useEffect(() => {
    fetchFixtures();
  }, [fetchFixtures]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, confidenceFilter, leagueFilter, searchQuery, sortBy]);

  // ─── Derived Data ──────────────────────────────────────────────────────

  const leagues = useMemo(() => {
    const set = new Set(fixtures.map((f) => f.league_name).filter(Boolean));
    return Array.from(set).sort();
  }, [fixtures]);

  const filtered = useMemo(() => {
    let result = [...fixtures];

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.home_team_name?.toLowerCase().includes(q) ||
          f.away_team_name?.toLowerCase().includes(q) ||
          f.league_name?.toLowerCase().includes(q)
      );
    }

    // League filter
    if (leagueFilter !== "all") {
      result = result.filter((f) => f.league_name === leagueFilter);
    }

    // Confidence filter
    if (confidenceFilter !== "all") {
      result = result.filter((f) => {
        const best = f.predictions?.reduce(
          (max, p) => (p.model_probability > max ? p.model_probability : max),
          0
        ) || 0;
        if (confidenceFilter === "high") return best >= 0.65;
        if (confidenceFilter === "medium") return best >= 0.50;
        return true;
      });
    }

    // Sort
    if (sortBy === "confidence") {
      result.sort((a, b) => {
        const bestA = a.predictions?.reduce((max, p) => Math.max(max, p.model_probability), 0) || 0;
        const bestB = b.predictions?.reduce((max, p) => Math.max(max, p.model_probability), 0) || 0;
        return bestB - bestA;
      });
    }

    return result;
  }, [fixtures, searchQuery, leagueFilter, confidenceFilter, sortBy]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Upcoming Matches"
        description="AI-powered predictions for upcoming fixtures across all covered leagues."
      />

      <FilterBar
        dateFilters={DATE_FILTERS}
        activeDateFilter={dateFilter}
        onDateFilterChange={(k) => setDateFilter(k as DateFilter)}
        confidenceFilters={CONFIDENCE_FILTERS}
        activeConfidenceFilter={confidenceFilter}
        onConfidenceFilterChange={(k) => setConfidenceFilter(k as ConfidenceFilter)}
        searchPlaceholder="Search teams or leagues..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        matchCount={filtered.length}
        sortToggle={
          <button
            onClick={() => setSortBy(sortBy === "kickoff" ? "confidence" : "kickoff")}
            aria-label={sortBy === "kickoff" ? "Sort by confidence" : "Sort by kickoff time"}
            className="px-[10px] py-[6px] rounded-[8px] text-[11px] font-semibold bg-gray-50 text-gray-400 hover:text-gray-600 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <i className={sortBy === "kickoff" ? "ri-time-line" : "ri-focus-3-line"} /> {sortBy === "kickoff" ? "By Time" : "By Confidence"}
          </button>
        }
        leagueFilter={
          <select
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            aria-label="Filter by league"
            className="h-[34px] rounded-[10px] border border-gray-100 bg-gray-50 px-[10px] text-[12px] text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]/20 appearance-none cursor-pointer min-w-[120px]"
          >
            <option value="all">All Leagues ({fixtures.length})</option>
            {leagues.map((lg) => (
              <option key={lg} value={lg}>
                {lg} ({fixtures.filter((f) => f.league_name === lg).length})
              </option>
            ))}
          </select>
        }
      >
        {(dateFilter !== "week" || confidenceFilter !== "all" || leagueFilter !== "all" || searchQuery) && (
          <button
            onClick={() => {
              setDateFilter("week");
              setConfidenceFilter("all");
              setLeagueFilter("all");
              setSearchQuery("");
            }}
            className="px-[10px] py-[6px] rounded-[8px] text-[11px] font-semibold bg-red-50 text-red-500 hover:bg-red-100 transition-all flex items-center gap-[4px] w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            <i className="ri-close-line" /> Clear filters
          </button>
        )}
      </FilterBar>

      {/* Loading State */}
      {loading && <SkeletonGrid count={8} />}

      {/* Error State */}
      {!loading && error && (
        <div className="text-center py-[60px]">
          <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-red-50 mb-[16px]">
            <i className="ri-error-warning-line text-[24px] text-red-300" />
          </div>
          <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[4px]">
            Unable to load matches
          </h3>
          <p className="text-[13px] text-gray-400 mb-[16px] max-w-[360px] mx-auto">{error}</p>
          <div className="flex items-center justify-center gap-[8px]">
            <button
              onClick={fetchFixtures}
              className="px-[16px] py-[8px] rounded-[10px] bg-[#1B2A4A] text-white text-[12px] font-semibold hover:opacity-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              Retry
            </button>
            <button
              onClick={() => { setDateFilter("week"); fetchFixtures(); }}
              className="px-[16px] py-[8px] rounded-[10px] bg-gray-100 text-gray-600 text-[12px] font-semibold hover:bg-gray-200 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              Reset & Retry
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-[60px]">
          <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-gray-50 mb-[16px]">
            <i className="ri-calendar-line text-[24px] text-gray-200" />
          </div>
          <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[4px]">
            No matches found
          </h3>
          <p className="text-[13px] text-gray-400">
            {searchQuery
              ? `No matches for "${searchQuery}". Try a different search.`
              : "Try a different date range or filter."}
          </p>
        </div>
      )}

      {/* Match Grid */}
      {!loading && !error && filtered.length > 0 && (
        <>
          <ResponsiveGrid>
            {paginated.map((fixture) => (
              <MatchCard key={fixture.id} fixture={fixture} onClick={() => setSelectedFixture(fixture.id)} />
            ))}
          </ResponsiveGrid>

          {/* Pagination */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />

          {/* Footer info */}
          <div className="text-center mt-[16px] text-[11px] text-gray-300">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} matches
          </div>
        </>
      )}

      {/* Match Detail Drawer */}
      {selectedFixture && (
        <MatchDetailDrawer
          fixtureId={selectedFixture}
          onClose={() => setSelectedFixture(null)}
        />
      )}
    </div>
  );
}
