"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, FilterBar, EmptyState } from "@/components/ui";
import { FavouriteButton } from "@/components/favourites/FavouriteButton";

interface Team {
  id: string;
  canonical_name: string;
  country: string | null;
  logo: string | null;
  league_id: string | null;
  leagues?: { name: string; country: string | null; logo: string | null } | null;
}

type SortKey = "name" | "league" | "country";

const PAGE_SIZE = 48;

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [page, setPage] = useState(1);

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("teams")
        .select("id, canonical_name, country, logo, league_id, leagues(name, country, logo)")
        .order("canonical_name", { ascending: true })
        .limit(2000);

      if (fetchError) throw fetchError;
      setTeams((data || []) as unknown as Team[]);
    } catch (err: any) {
      console.error("Failed to fetch teams:", err);
      setError("Unable to load teams. The data service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);
  useEffect(() => {
    setPage(1);
  }, [search, leagueFilter, sortBy]);

  const leagues = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) {
      const n = t.leagues?.name;
      if (n) set.add(n);
    }
    return Array.from(set).sort();
  }, [teams]);

  const filtered = useMemo(() => {
    let result = [...teams];
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (t) =>
          t.canonical_name.toLowerCase().includes(q) ||
          (t.leagues?.name || "").toLowerCase().includes(q) ||
          (t.country || "").toLowerCase().includes(q)
      );
    }
    if (leagueFilter !== "all") {
      result = result.filter((t) => t.leagues?.name === leagueFilter);
    }
    result.sort((a, b) => {
      if (sortBy === "league") {
        return (a.leagues?.name || "").localeCompare(b.leagues?.name || "") ||
          a.canonical_name.localeCompare(b.canonical_name);
      }
      if (sortBy === "country") {
        return (a.country || "").localeCompare(b.country || "") ||
          a.canonical_name.localeCompare(b.canonical_name);
      }
      return a.canonical_name.localeCompare(b.canonical_name);
    });
    return result;
  }, [teams, search, leagueFilter, sortBy]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const sortBtn = (key: SortKey, label: string) => (
    <button
      key={key}
      onClick={() => setSortBy(key)}
      className={`px-[10px] py-[6px] rounded-[8px] text-[11px] font-semibold transition-all ${
        sortBy === key ? "bg-[#1B2A4A] text-white" : "bg-gray-50 text-gray-400 hover:text-gray-600"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <PageHeader
        title="Teams"
        description="Every club tracked across ODDLY's covered leagues — form, xG profiles and injury availability on each team page."
      />

      <FilterBar
        searchPlaceholder="Search teams, leagues or countries..."
        searchValue={search}
        onSearchChange={setSearch}
        matchCount={filtered.length}
        sortToggle={
          <div className="flex items-center gap-[4px]">
            {sortBtn("name", "Name")}
            {sortBtn("league", "League")}
            {sortBtn("country", "Country")}
          </div>
        }
        leagueFilter={
          <select
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            className="h-[34px] rounded-[10px] border border-gray-100 bg-gray-50 px-[10px] text-[12px] text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]/20 appearance-none cursor-pointer min-w-[140px]"
          >
            <option value="all">All Leagues ({teams.length})</option>
            {leagues.map((lg) => (
              <option key={lg} value={lg}>
                {lg} ({teams.filter((t) => t.leagues?.name === lg).length})
              </option>
            ))}
          </select>
        }
      />

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[12px]">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-[14px] animate-pulse">
              <div className="flex items-center gap-[10px]">
                <div className="w-[36px] h-[36px] rounded-full bg-gray-100" />
                <div className="flex-1 space-y-[6px]">
                  <div className="h-[12px] w-[75%] bg-gray-100 rounded" />
                  <div className="h-[10px] w-[45%] bg-gray-100 rounded" />
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
            Unable to load teams
          </h3>
          <p className="text-[13px] text-gray-400 mb-[16px]">{error}</p>
          <button
            onClick={fetchTeams}
            className="px-[16px] py-[8px] rounded-[10px] bg-[#1B2A4A] text-white text-[12px] font-semibold hover:opacity-90 transition-all"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          icon="ri-team-line"
          title="No teams found"
          description={search ? `No teams match "${search}".` : "No team data is available yet."}
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[12px]">
            {paginated.map((team) => (
              <div
                key={team.id}
                className="group relative bg-white rounded-[14px] border border-gray-100 p-[14px] hover:border-[#1B2A4A]/30 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] transition-all duration-200"
              >
                <Link href={`/teams/${team.id}`} className="block">
                  <div className="flex items-center gap-[10px]">
                    <div className="w-[38px] h-[38px] rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden flex-none">
                      {team.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={team.logo} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <i className="ri-football-line text-[16px] text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-[13px] font-semibold text-[#0A0F1C] truncate group-hover:text-[#1B2A4A] transition-colors">
                        {team.canonical_name}
                      </h3>
                      <div className="text-[11px] text-gray-400 truncate">
                        {team.leagues?.name || team.country || "—"}
                      </div>
                    </div>
                    <i className="ri-arrow-right-s-line text-[16px] text-gray-300 group-hover:text-[#1B2A4A] transition-colors" />
                  </div>
                </Link>
                <div className="absolute top-[10px] right-[10px]">
                  <FavouriteButton
                    entityType="team"
                    entityId={team.id}
                    entityName={team.canonical_name}
                    size="sm"
                  />
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-[4px] mt-[24px]">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
                className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                ←
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[12px] font-semibold transition-all ${
                      p === page ? "bg-[#1B2A4A] text-white shadow-sm" : "text-gray-500 hover:bg-gray-100"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(page + 1)}
                disabled={page === totalPages}
                className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center text-[13px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                →
              </button>
            </div>
          )}

          <div className="text-center mt-[16px] text-[11px] text-gray-300">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length} teams
          </div>
        </>
      )}
    </div>
  );
}
