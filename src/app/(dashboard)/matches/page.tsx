"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { MatchCard } from "@/components/matches/MatchCard";
import { MatchDetailDrawer } from "@/components/matches/MatchDetailDrawer";
import { ResponsiveGrid, FilterBar, SkeletonGrid } from "@/components/ui/DesignSystem";
import { PageHeader } from "@/components/ui";

// ─── Types ───────────────────────────────────────────────────────────────

type ConfidenceFilter = "all" | "high" | "medium";
type SortBy = "kickoff" | "confidence";

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
    confidence_lower?: number | null;
    confidence_upper?: number | null;
  }>;
  odds?: {
    home?: number;
    draw?: number;
    away?: number;
  };
}

const PAGE_SIZE = 20;

const CONFIDENCE_FILTERS: { key: ConfidenceFilter; label: string }[] = [
  { key: "all", label: "All Confidence" },
  { key: "high", label: "65%+" },
  { key: "medium", label: "50%+" },
];

// ─── Main Page ───────────────────────────────────────────────────────────

export default function TodayMatchesPage() {
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("kickoff");
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFixture, setSelectedFixture] = useState<string | null>(null);

  // ─── Fetch Today's Fixtures ───────────────────────────────────────────

  const fetchFixtures = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const today = new Date().toISOString().split("T")[0];

      const { data, error: fetchError } = await supabase
        .from("fixtures")
        .select(
          `*, leagues (name, country, logo), home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo), away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo), predictions (market, selection, model_probability, confidence_lower, confidence_upper)`
        )
        .gte("kickoff_time", `${today}T00:00:00Z`)
        .lte("kickoff_time", `${today}T23:59:59Z`)
        .order("kickoff_time", { ascending: true });

      if (fetchError) throw fetchError;

      // Get odds
      const fixtureIds = (data || []).map((f: any) => f.id);
      let oddsMap: Record<string, { home?: number; draw?: number; away?: number }> = {};

      if (fixtureIds.length > 0) {
        const { data: oddsData } = await supabase
          .from("odds_snapshots")
          .select("fixture_id, selection, odds")
          .in("fixture_id", fixtureIds);

        if (oddsData) {
          const grouped: Record<string, Record<string, number[]>> = {};
          for (const o of oddsData) {
            if (!grouped[o.fixture_id]) grouped[o.fixture_id] = {};
            if (!grouped[o.fixture_id][o.selection]) grouped[o.fixture_id][o.selection] = [];
            grouped[o.fixture_id][o.selection].push(o.odds);
          }
          for (const [fid, selections] of Object.entries(grouped)) {
            oddsMap[fid] = {
              home: selections["Home"]?.length ? Math.max(...selections["Home"]) : undefined,
              draw: selections["Draw"]?.length ? Math.max(...selections["Draw"]) : undefined,
              away: selections["Away"]?.length ? Math.max(...selections["Away"]) : undefined,
            };
          }
        }
      }

      setFixtures(
        (data || []).map((f: any) => ({
          ...f,
          home_team_name: f.home_team?.canonical_name || "TBD",
          away_team_name: f.away_team?.canonical_name || "TBD",
          home_team_logo: f.home_team?.logo || null,
          away_team_logo: f.away_team?.logo || null,
          league_logo: f.leagues?.logo || null,
          league_name: f.leagues?.name || "Unknown",
          odds: oddsMap[f.id] || undefined,
        }))
      );
    } catch (err: any) {
      console.error("Failed to fetch fixtures:", err);
      setError("Unable to load today's matches. The data service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFixtures(); }, [fetchFixtures]);
  useEffect(() => { setCurrentPage(1); }, [confidenceFilter, leagueFilter, searchQuery, sortBy]);

  // ─── Derived Data ──────────────────────────────────────────────────────

  const leagues = useMemo(() => {
    const set = new Set(fixtures.map((f) => f.league_name).filter(Boolean));
    return Array.from(set).sort();
  }, [fixtures]);

  const filtered = useMemo(() => {
    let result = [...fixtures];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.home_team_name?.toLowerCase().includes(q) ||
          f.away_team_name?.toLowerCase().includes(q) ||
          f.league_name?.toLowerCase().includes(q)
      );
    }

    if (leagueFilter !== "all") {
      result = result.filter((f) => f.league_name === leagueFilter);
    }

    if (confidenceFilter !== "all") {
      result = result.filter((f) => {
        const best = f.predictions?.reduce((max, p) => (p.model_probability > max ? p.model_probability : max), 0) || 0;
        if (confidenceFilter === "high") return best >= 0.65;
        if (confidenceFilter === "medium") return best >= 0.50;
        return true;
      });
    }

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
        title="Today's Matches"
        description="AI-powered predictions for today's fixtures across 100+ leagues."
      />

      <FilterBar
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
            className="px-[10px] py-[6px] rounded-[8px] text-[11px] font-semibold bg-gray-50 text-gray-400 hover:text-gray-600 transition-all"
          >
            {sortBy === "kickoff" ? "📅 By Time" : "🎯 By Confidence"}
          </button>
        }
        leagueFilter={
          <select
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
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
      />

      {/* Loading */}
      {loading && <SkeletonGrid count={8} />}

      {/* Error */}
      {!loading && error && (
        <div className="text-center py-[60px]">
          <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-red-50 mb-[16px]">
            <i className="ri-error-warning-line text-[24px] text-red-300" />
          </div>
          <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[4px]">
            Unable to load matches
          </h3>
          <p className="text-[13px] text-gray-400 mb-[16px]">{error}</p>
          <button
            onClick={fetchFixtures}
            className="px-[16px] py-[8px] rounded-[10px] bg-[#1B2A4A] text-white text-[12px] font-semibold hover:opacity-90 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div className="text-center py-[60px]">
          <div className="inline-flex items-center justify-center w-[56px] h-[56px] rounded-[14px] bg-gray-50 mb-[16px]">
            <i className="ri-calendar-line text-[24px] text-gray-200" />
          </div>
          <h3 className="font-display text-[16px] font-semibold text-[#0A0F1C] mb-[4px]">
            No matches today
          </h3>
          <p className="text-[13px] text-gray-400">
            {searchQuery
              ? `No matches for "${searchQuery}". Try a different search.`
              : "Check back tomorrow for upcoming fixtures."}
          </p>
        </div>
      )}

      {/* Grid */}
      {!loading && !error && filtered.length > 0 && (
        <>
          <ResponsiveGrid>
            {paginated.map((fixture) => (
              <MatchCard key={fixture.id} fixture={fixture} onClick={() => setSelectedFixture(fixture.id)} />
            ))}
          </ResponsiveGrid>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-[4px] mt-[24px]">
              <button
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                ←
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const page = i + 1;
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[12px] font-semibold transition-all ${
                      page === currentPage
                        ? "bg-[#1B2A4A] text-white shadow-sm"
                        : "text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                →
              </button>
            </div>
          )}

          <div className="text-center mt-[16px] text-[11px] text-gray-300">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} matches
          </div>
        </>
      )}

      {/* Detail Drawer */}
      {selectedFixture && (
        <MatchDetailDrawer fixtureId={selectedFixture} onClose={() => setSelectedFixture(null)} />
      )}
    </div>
  );
}
