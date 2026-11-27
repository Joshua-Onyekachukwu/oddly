"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, FilterBar, EmptyState } from "@/components/ui";
import { FavouriteButton } from "@/components/favourites/FavouriteButton";
import { normalizeTeamName } from "@/lib/football/team-normalizer";
import { normalizeName, personKey } from "@/lib/players/importance";

interface PlayerImportance {
  id: string;
  team_name: string;
  player_name: string;
  player_id: number | null;
  league: string | null;
  score_0_1: number;
  score_1_10: number;
  confidence: "stats" | "history" | "neutral";
  method: string | null;
  computed_at: string | null;
}

interface InjuryInfo {
  status: string;
  injury_type: string | null;
}

const PAGE_SIZE = 50;

function confidenceBadge(conf: string) {
  switch (conf) {
    case "stats":
      return { cls: "bg-blue-50 text-blue-600", label: "Stats" };
    case "history":
      return { cls: "bg-amber-50 text-amber-600", label: "History" };
    default:
      return { cls: "bg-gray-50 text-gray-400", label: "Neutral" };
  }
}

function injuryBadge(status: string) {
  const s = (status || "").toLowerCase();
  if (s.includes("injur") || s.includes("out") || s.includes("suspend"))
    return { cls: "bg-red-50 text-red-600", label: status };
  if (s.includes("doubt") || s.includes("question"))
    return { cls: "bg-amber-50 text-amber-600", label: status };
  return { cls: "bg-emerald-50 text-emerald-600", label: status };
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerImportance[]>([]);
  const [injuryMap, setInjuryMap] = useState<Map<string, InjuryInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [confFilter, setConfFilter] = useState("all");
  const [injFilter, setInjFilter] = useState("all");
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();

      // player_importance is not in the generated Database types yet —
      // cast through `any` like other untyped-table reads in this codebase.
      const [impRes, injRes] = await Promise.all([
        (supabase as any)
          .from("player_importance")
          .select("id, team_name, player_name, player_id, league, score_0_1, score_1_10, confidence, method, computed_at")
          .order("score_1_10", { ascending: false })
          .limit(10000),
        supabase
          .from("player_injury_data")
          .select("team_name, player_name, status, injury_type, fetched_at")
          .limit(10000),
      ]);

      if (impRes.error) throw impRes.error;
      if (injRes.error) throw injRes.error;

      setPlayers((impRes.data || []) as PlayerImportance[]);

      // Index latest injury status per (team, player) using the same
      // normalization the importance engine uses.
      const map = new Map<string, InjuryInfo & { fetched: string }>();
      for (const row of (injRes.data || []) as any[]) {
        const tKey = normalizeTeamName(normalizeName(row.team_name));
        const pKey = personKey(row.player_name);
        if (!pKey) continue;
        const key = `${tKey}|${pKey}`;
        const fetched = row.fetched_at || "";
        const cur = map.get(key);
        if (!cur || fetched > cur.fetched) {
          map.set(key, { status: row.status, injury_type: row.injury_type, fetched });
        }
      }
      const finalMap = new Map<string, InjuryInfo>();
      for (const [k, v] of map) finalMap.set(k, { status: v.status, injury_type: v.injury_type });
      setInjuryMap(finalMap);
    } catch (err: any) {
      console.error("Failed to load players:", err);
      setError("Unable to load player data. The data service may be temporarily unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);
  useEffect(() => {
    setPage(1);
  }, [search, teamFilter, confFilter, injFilter]);

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) if (p.team_name) set.add(p.team_name);
    return Array.from(set).sort();
  }, [players]);

  const injuryFor = useCallback(
    (p: PlayerImportance): InjuryInfo | null => {
      const tKey = normalizeTeamName(normalizeName(p.team_name));
      const pKey = personKey(p.player_name);
      return injuryMap.get(`${tKey}|${pKey}`) || null;
    },
    [injuryMap]
  );

  const filtered = useMemo(() => {
    let result = players;
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) =>
          normalizeName(p.player_name).includes(normalizeName(q)) ||
          (p.team_name || "").toLowerCase().includes(q) ||
          (p.league || "").toLowerCase().includes(q)
      );
    }
    if (teamFilter !== "all") result = result.filter((p) => p.team_name === teamFilter);
    if (confFilter !== "all") result = result.filter((p) => p.confidence === confFilter);
    if (injFilter === "injured") {
      result = result.filter((p) => {
        const inj = injuryFor(p);
        if (!inj) return false;
        const s = (inj.status || "").toLowerCase();
        return s.includes("injur") || s.includes("out") || s.includes("suspend") || s.includes("doubt");
      });
    } else if (injFilter === "available") {
      result = result.filter((p) => {
        const inj = injuryFor(p);
        if (!inj) return false;
        const s = (inj.status || "").toLowerCase();
        return !(s.includes("injur") || s.includes("out") || s.includes("suspend") || s.includes("doubt"));
      });
    }
    return result;
  }, [players, search, teamFilter, confFilter, injFilter, injuryFor]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <PageHeader
        title="Players"
        description="Player importance scores computed from performance stats and absence history — joined with the latest injury feed."
      />

      <FilterBar
        searchPlaceholder="Search players, teams or leagues..."
        searchValue={search}
        onSearchChange={setSearch}
        matchCount={filtered.length}
        sortToggle={
          <div className="flex items-center gap-[4px]">
            <span className="px-[10px] py-[6px] text-[11px] font-semibold bg-[#1B2A4A] text-white rounded-[8px]">
              Top importance
            </span>
          </div>
        }
        leagueFilter={
          <div className="flex items-center gap-[6px] flex-wrap">
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="h-[34px] rounded-[10px] border border-gray-100 bg-gray-50 px-[10px] text-[12px] text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]/20 appearance-none cursor-pointer min-w-[140px]"
            >
              <option value="all">All Teams ({teams.length})</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={confFilter}
              onChange={(e) => setConfFilter(e.target.value)}
              className="h-[34px] rounded-[10px] border border-gray-100 bg-gray-50 px-[10px] text-[12px] text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]/20 appearance-none cursor-pointer"
            >
              <option value="all">All Confidence</option>
              <option value="stats">Stats-backed</option>
              <option value="history">History-only</option>
              <option value="neutral">Neutral</option>
            </select>
            <select
              value={injFilter}
              onChange={(e) => setInjFilter(e.target.value)}
              className="h-[34px] rounded-[10px] border border-gray-100 bg-gray-50 px-[10px] text-[12px] text-gray-500 focus:outline-none focus:ring-1 focus:ring-[#1B2A4A]/20 appearance-none cursor-pointer"
            >
              <option value="all">All Availability</option>
              <option value="injured">Injured / doubtful</option>
              <option value="available">Available</option>
            </select>
          </div>
        }
      />

      {loading && (
        <div className="bg-white rounded-[14px] border border-gray-100 overflow-hidden">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-[12px] px-[16px] py-[12px] border-b border-gray-50 animate-pulse last:border-0">
              <div className="w-[32px] h-[32px] rounded-full bg-gray-100" />
              <div className="flex-1 space-y-[6px]">
                <div className="h-[12px] w-[40%] bg-gray-100 rounded" />
                <div className="h-[10px] w-[25%] bg-gray-100 rounded" />
              </div>
              <div className="h-[12px] w-[50px] bg-gray-100 rounded" />
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
            Unable to load players
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
          icon="ri-user-star-line"
          title="No players found"
          description={search ? `No players match "${search}".` : "No player importance data is available yet."}
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="bg-white rounded-[14px] border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-50 bg-gray-50/50">
                    <th className="px-[16px] py-[10px] font-semibold">Player</th>
                    <th className="py-[10px] font-semibold">Team</th>
                    <th className="py-[10px] font-semibold">League</th>
                    <th className="py-[10px] font-semibold text-center">Score</th>
                    <th className="py-[10px] font-semibold text-center">Confidence</th>
                    <th className="py-[10px] font-semibold">Availability</th>
                    <th className="px-[16px] py-[10px] font-semibold text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((p) => {
                    const conf = confidenceBadge(p.confidence);
                    const inj = injuryFor(p);
                    return (
                      <tr key={p.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                        <td className="px-[16px] py-[10px] font-medium text-[#0A0F1C] whitespace-nowrap">
                          {p.player_name}
                        </td>
                        <td className="py-[10px] text-gray-600 whitespace-nowrap">{p.team_name || "—"}</td>
                        <td className="py-[10px] text-gray-500 whitespace-nowrap">{p.league || "—"}</td>
                        <td className="py-[10px] text-center">
                          <span
                            className={`inline-flex items-center justify-center min-w-[36px] px-[6px] py-[2px] rounded-[6px] font-mono-data text-[11px] font-bold ${
                              Number(p.score_1_10) >= 7
                                ? "bg-emerald-50 text-emerald-600"
                                : Number(p.score_1_10) >= 5
                                  ? "bg-amber-50 text-amber-600"
                                  : "bg-gray-50 text-gray-500"
                            }`}
                            title={p.method || ""}
                          >
                            {Number(p.score_1_10).toFixed(1)}
                          </span>
                        </td>
                        <td className="py-[10px] text-center">
                          <span className={`text-[9px] font-bold uppercase tracking-wide px-[6px] py-[2px] rounded-full ${conf.cls}`}>
                            {conf.label}
                          </span>
                        </td>
                        <td className="py-[10px]">
                          {inj ? (
                            <span className={`text-[9px] font-bold uppercase tracking-wide px-[6px] py-[2px] rounded-full ${injuryBadge(inj.status).cls}`}>
                              {injuryBadge(inj.status).label}
                            </span>
                          ) : (
                            <span className="text-[10px] text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-[16px] py-[10px] text-right">
                          <FavouriteButton
                            entityType="player"
                            entityId={p.player_name}
                            entityName={p.player_name}
                            size="sm"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
            {filtered.length} players
          </div>
        </>
      )}
    </div>
  );
}
