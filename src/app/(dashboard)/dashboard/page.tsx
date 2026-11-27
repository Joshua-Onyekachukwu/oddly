"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import { PageHeader, Card, CardHeader, StatCard, Badge, EmptyState } from "@/components/ui";

// ─── Types ───────────────────────────────────────────────────────────────

interface Prediction {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  model_probability: number;
  model_version: string;
  result?: string | null;
  settled_at?: string | null;
}

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
  leagues?: { name: string; country: string };
}

interface ElitePick {
  fixture: Fixture;
  predictions: Prediction[];
  bestPick: Prediction;
}

interface SettlementItem {
  id: string;
  market: string;
  selection: string;
  model_probability: number;
  result: string;
  settled_at: string;
  matchLabel: string;
}

interface FavouriteMatch {
  id: string;
  kickoff_time: string;
  status: string;
  home_team_name: string;
  away_team_name: string;
  home_team_logo: string | null;
  away_team_logo: string | null;
  league_name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatKickoff(time: string) {
  const date = new Date(time);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 0) return "Started";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${diffDays}d`;
}

function formatTime(time: string) {
  return new Date(time).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(time: string) {
  return new Date(time).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatMarket(market: string): string {
  const map: Record<string, string> = {
    "1X2": "Match Result",
    "1x2": "Match Result",
    over_under: "Total Goals",
    ou: "Total Goals",
    btts: "BTTS",
    double_chance: "Double Chance",
    dc: "Double Chance",
    dnb: "Draw No Bet",
    smart_selection: "Best Pick",
  };
  return map[market] || market.replace(/_/g, " ");
}

function formatSelection(sel: string): string {
  return sel
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// ─── Components ──────────────────────────────────────────────────────────

function TeamLogo({ logo, name, size = 36 }: { logo?: string | null; name: string; size?: number }) {
  if (logo) {
    return (
      <div
        className="rounded-full bg-gray-50 flex items-center justify-center flex-none overflow-hidden border border-gray-100"
        style={{ width: size, height: size }}
      >
        <img
          src={logo}
          alt={name}
          className="object-contain"
          style={{ width: size * 0.7, height: size * 0.7 }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.classList.add("bg-[#1B2A4A]/8");
              parent.innerHTML = `<span style="font-size:${size * 0.35}px;font-weight:700;color:#1B2A4A;font-family:var(--font-display)">${name.charAt(0).toUpperCase()}</span>`;
            }
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="bg-[#1B2A4A]/8 rounded-full flex items-center justify-center flex-none border border-gray-100"
      style={{ width: size, height: size }}
    >
      <span className="font-bold text-[#1B2A4A] font-display" style={{ fontSize: size * 0.35 }}>
        {name.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

function ConfidenceBar({ probability }: { probability: number }) {
  const pct = Math.round(probability * 100);
  const color = pct >= 90 ? "#059669" : pct >= 80 ? "#1B2A4A" : pct >= 70 ? "#6366f1" : "#9ca3af";

  return (
    <div className="w-full">
      <div className="h-[6px] bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function ElitePickCard({ pick }: { pick: ElitePick }) {
  const [expanded, setExpanded] = useState(false);
  const { fixture, bestPick, predictions } = pick;
  const prob = Math.round(bestPick.model_probability * 100);

  return (
    <div
      className="bg-white rounded-[14px] border border-gray-100 hover:border-gray-200 hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] duration-200 ease-out cursor-pointer group overflow-hidden"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="px-[16px] pt-[14px] pb-[10px] flex items-center justify-between">
        <div className="flex items-center gap-[6px] min-w-0">
          {fixture.league_logo ? (
            <img src={fixture.league_logo} alt="" className="w-[16px] h-[16px] object-contain flex-none" />
          ) : (
            <div className="w-[16px] h-[16px] bg-gray-200 rounded-[3px] flex-none" />
          )}
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider truncate">
            {fixture.leagues?.name || "Unknown"}
          </span>
        </div>
        <div className="flex items-center gap-[8px] flex-none">
          <span className="text-[10px] font-medium text-gray-400">{formatDate(fixture.kickoff_time)}</span>
          <span className="text-[11px] font-mono-data font-bold text-[#1B2A4A] bg-gray-50 px-[6px] py-[2px] rounded">
            {formatTime(fixture.kickoff_time)}
          </span>
        </div>
      </div>

      <div className="px-[16px] py-[8px]">
        <div className="flex items-center gap-[12px]">
          <div className="flex items-center gap-[10px] flex-1 min-w-0">
            <TeamLogo logo={fixture.home_team_logo} name={fixture.home_team_name || "Home"} size={36} />
            <span className="text-[14px] font-semibold text-[#0A0F1C] truncate">
              {fixture.home_team_name || "Home"}
            </span>
          </div>
          <div className="flex-none px-[12px]">
            {fixture.home_score !== null ? (
              <span className="font-display text-[18px] font-bold text-[#0A0F1C]">
                {fixture.home_score} - {fixture.away_score}
              </span>
            ) : (
              <span className="text-[12px] font-bold text-gray-300 uppercase">vs</span>
            )}
          </div>
          <div className="flex items-center gap-[10px] flex-1 min-w-0 justify-end">
            <span className="text-[14px] font-semibold text-[#0A0F1C] truncate text-right">
              {fixture.away_team_name || "Away"}
            </span>
            <TeamLogo logo={fixture.away_team_logo} name={fixture.away_team_name || "Away"} size={36} />
          </div>
        </div>
      </div>

      <div className="px-[16px] pb-[12px] pt-[8px] border-t border-gray-50">
        <div className="flex items-center justify-between mb-[6px]">
          <div className="flex items-center gap-[8px]">
            <span className="text-[10px] font-semibold text-[#059669] bg-[#059669]/10 px-[8px] py-[2px] rounded-full">
              ELITE
            </span>
            <span className="text-[12px] font-medium text-gray-600">{formatMarket(bestPick.market)}</span>
          </div>
          <div className="flex items-center gap-[4px]">
            <span className="text-[16px] font-bold text-[#1B2A4A]">{prob}%</span>
            <span className="text-[10px] text-gray-400">confidence</span>
          </div>
        </div>

        <div className="flex items-center gap-[8px] mb-[6px]">
          <span className="text-[13px] font-bold text-[#0A0F1C]">{formatSelection(bestPick.selection)}</span>
        </div>

        <ConfidenceBar probability={bestPick.model_probability} />

        <div className="flex items-center justify-center mt-[8px]">
          <span className="text-[10px] text-gray-300 font-medium">
            {expanded ? "▲ Less" : `▲ ${predictions.length} markets`}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="px-[16px] pb-[14px] border-t border-gray-50 pt-[10px]">
          <div className="grid grid-cols-2 gap-[8px]">
            {predictions
              .sort((a, b) => b.model_probability - a.model_probability)
              .map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-[10px] py-[6px] rounded-[8px] text-[11px] ${
                    p.id === bestPick.id ? "bg-[#059669]/10 border border-[#059669]/20" : "bg-gray-50"
                  }`}
                >
                  <span className="font-medium text-gray-600 truncate">{formatSelection(p.selection)}</span>
                  <span className="font-mono-data font-bold text-[#1B2A4A] ml-[4px]">
                    {Math.round(p.model_probability * 100)}%
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

const QUICK_LINKS = [
  {
    href: "/matches/upcoming",
    icon: "ri-calendar-event-line",
    title: "Upcoming Matches",
    description: "All fixtures and predictions",
  },
  {
    href: "/predictions",
    icon: "ri-line-chart-line",
    title: "Predictions",
    description: "Every market, every match",
  },
  {
    href: "/rollover",
    icon: "ri-repeat-line",
    title: "Rollover",
    description: "Daily ~2.0 odds challenge",
  },
  {
    href: "/performance",
    icon: "ri-bar-chart-box-line",
    title: "Performance",
    description: "Accuracy and results",
  },
];

// ─── Main Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const router = useRouter();
  const [picks, setPicks] = useState<ElitePick[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ elite: 0, total: 0, leagues: 0, fixturesToday: 0 });
  const [recentSettlements, setRecentSettlements] = useState<SettlementItem[]>([]);
  const [weekAccuracy, setWeekAccuracy] = useState<{ pct: number; n: number } | null>(null);
  const [favouriteMatches, setFavouriteMatches] = useState<FavouriteMatch[]>([]);
  const [favouritesCount, setFavouritesCount] = useState(0);

  // First-run onboarding: send incomplete users through /onboarding once per
  // browser session. The onboarding page's "Skip" marks the profile flag, so
  // users are never trapped — at most one redirect per session.
  useEffect(() => {
    if (authLoading || !user || !profile) return;
    if (profile.onboarding_completed !== false) return;
    try {
      if (sessionStorage.getItem("oddly_onboarding_prompt")) return;
      sessionStorage.setItem("oddly_onboarding_prompt", "1");
    } catch {
      // sessionStorage unavailable — still redirect once
    }
    router.push("/onboarding");
  }, [authLoading, user, profile, router]);

  // Load upcoming fixtures involving the user's favourited teams/leagues.
  useEffect(() => {
    if (!user) {
      setFavouriteMatches([]);
      setFavouritesCount(0);
      return;
    }

    let cancelled = false;
    const loadFavourites = async () => {
      const sb = createClient();
      const { data: favs } = await sb
        .from("user_favourites")
        .select("entity_type, entity_id")
        .eq("user_id", user.id);

      if (cancelled) return;
      const rows = favs || [];
      setFavouritesCount(rows.length);

      // Only UUID entity_ids can be matched against fixtures.team/league FK
      // columns — non-UUID favourites (e.g. player names) are ignored here.
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const teamIds = rows
        .filter((f) => f.entity_type === "team" && uuidRe.test(f.entity_id))
        .map((f) => f.entity_id);
      const leagueIds = rows
        .filter((f) => f.entity_type === "league" && uuidRe.test(f.entity_id))
        .map((f) => f.entity_id);
      if (teamIds.length === 0 && leagueIds.length === 0) {
        setFavouriteMatches([]);
        return;
      }

      const now = new Date().toISOString();
      const orParts: string[] = [];
      if (teamIds.length > 0) {
        orParts.push(`home_team_id.in.(${teamIds.join(",")})`);
        orParts.push(`away_team_id.in.(${teamIds.join(",")})`);
      }
      if (leagueIds.length > 0) {
        orParts.push(`league_id.in.(${leagueIds.join(",")})`);
      }

      const { data: fixtures } = await sb
        .from("fixtures")
        .select(
          `id, kickoff_time, status,
           home_team:teams!fixtures_home_team_id_fkey(canonical_name, logo),
           away_team:teams!fixtures_away_team_id_fkey(canonical_name, logo),
           league:leagues(name)`
        )
        .gte("kickoff_time", now)
        .order("kickoff_time", { ascending: true })
        .limit(200)
        .or(orParts.join(","));

      if (cancelled) return;

      const upcoming = (fixtures || [])
        .filter((f) => !["finished", "FT", "cancelled", "postponed"].includes(f.status))
        .slice(0, 8)
        .map((f: any) => ({
          id: f.id,
          kickoff_time: f.kickoff_time,
          status: f.status,
          home_team_name: f.home_team?.canonical_name || "TBD",
          away_team_name: f.away_team?.canonical_name || "TBD",
          home_team_logo: f.home_team?.logo || null,
          away_team_logo: f.away_team?.logo || null,
          league_name: f.league?.name || "",
        }));

      setFavouriteMatches(upcoming);
    };

    loadFavourites();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const loadData = useCallback(async () => {
    try {
      const sb = createClient();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { data: fixtures } = await sb
        .from("fixtures")
        .select(`
          id, kickoff_time, status, home_score, away_score,
          home_team:teams!fixtures_home_team_id_fkey(id, canonical_name, logo),
          away_team:teams!fixtures_away_team_id_fkey(id, canonical_name, logo),
          league:leagues(name, country, logo)
        `)
        .gte("kickoff_time", today.toISOString())
        .lt("kickoff_time", tomorrow.toISOString())
        .order("kickoff_time", { ascending: true })
        .limit(100);

      const fixtureList = fixtures || [];

      let elitePicks: ElitePick[] = [];
      let totalPreds = 0;
      if (fixtureList.length > 0) {
        const fixtureIds = fixtureList.map((f) => f.id);
        const { data: predictions } = await sb
          .from("predictions")
          .select("id, fixture_id, market, selection, model_probability, model_version")
          .in("fixture_id", fixtureIds)
          .gte("model_probability", 0.70)
          .order("model_probability", { ascending: false });

        const preds = predictions || [];
        totalPreds = preds.length;

        const predByFixture: Record<string, Prediction[]> = {};
        for (const p of preds) {
          if (!predByFixture[p.fixture_id]) predByFixture[p.fixture_id] = [];
          predByFixture[p.fixture_id].push(p);
        }

        for (const fixture of fixtureList) {
          const fPreds = predByFixture[fixture.id];
          if (!fPreds || fPreds.length === 0) continue;
          fPreds.sort((a, b) => b.model_probability - a.model_probability);
          elitePicks.push({
            fixture: {
              id: fixture.id,
              kickoff_time: fixture.kickoff_time,
              status: fixture.status,
              home_score: fixture.home_score,
              away_score: fixture.away_score,
              home_team_name: (fixture.home_team as any)?.canonical_name || "Home",
              away_team_name: (fixture.away_team as any)?.canonical_name || "Away",
              home_team_logo: (fixture.home_team as any)?.logo,
              away_team_logo: (fixture.away_team as any)?.logo,
              league_logo: (fixture.league as any)?.logo,
              leagues: fixture.league as any,
            },
            predictions: fPreds,
            bestPick: fPreds[0],
          });
        }
        elitePicks.sort((a, b) => b.bestPick.model_probability - a.bestPick.model_probability);
      }

      const uniqueLeagues = new Set(elitePicks.map((p) => p.fixture.leagues?.name));
      setPicks(elitePicks);
      setStats({
        elite: elitePicks.length,
        total: totalPreds,
        leagues: uniqueLeagues.size,
        fixturesToday: fixtureList.length,
      });

      // Recent settlements (last 7 days) — accuracy + feed
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: settled } = await sb
        .from("predictions")
        .select("id, fixture_id, market, selection, model_probability, result, settled_at")
        .in("result", ["correct", "wrong"])
        .gte("settled_at", weekAgo)
        .order("settled_at", { ascending: false })
        .limit(3000);

      if (settled && settled.length > 0) {
        const correct = settled.filter((p) => p.result === "correct").length;
        setWeekAccuracy({
          pct: Math.round((correct / settled.length) * 1000) / 10,
          n: settled.length,
        });

        // Resolve fixture labels for the most recent items
        const recent = settled.slice(0, 12);
        const fixIds = Array.from(new Set(recent.map((p) => p.fixture_id).filter(Boolean)));
        const labelByFixture: Record<string, string> = {};
        if (fixIds.length > 0) {
          const { data: fixRows } = await sb
            .from("fixtures")
            .select(
              "id, home:teams!fixtures_home_team_id_fkey(canonical_name), away:teams!fixtures_away_team_id_fkey(canonical_name)"
            )
            .in("id", fixIds);
          for (const f of fixRows || []) {
            const h = (f as any).home?.canonical_name || "?";
            const a = (f as any).away?.canonical_name || "?";
            labelByFixture[f.id] = `${h} vs ${a}`;
          }
        }
        setRecentSettlements(
          recent.map((p) => ({
            id: p.id,
            market: p.market,
            selection: p.selection,
            model_probability: p.model_probability,
            result: p.result || "pending",
            settled_at: p.settled_at || "",
            matchLabel: labelByFixture[p.fixture_id] || "Match",
          }))
        );
      } else {
        setWeekAccuracy(null);
        setRecentSettlements([]);
      }
    } catch (err) {
      console.error("Failed to load dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <div className="min-h-screen bg-[#F8F9FC]">
      <div className="max-w-[1200px] mx-auto px-[20px] py-[24px]">
        <PageHeader
          title={`${greeting()}`}
          description={new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        />

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px] mb-[24px]">
          <StatCard
            label="Fixtures Today"
            value={loading ? "—" : String(stats.fixturesToday)}
            icon="ri-calendar-event-line"
            color="bg-gray-50 text-gray-600"
          />
          <StatCard
            label="ELITE Picks"
            value={loading ? "—" : String(stats.elite)}
            icon="ri-trophy-line"
            color="bg-amber-50 text-amber-600"
          />
          <StatCard
            label="Predictions Today"
            value={loading ? "—" : String(stats.total)}
            icon="ri-line-chart-line"
            color="bg-blue-50 text-blue-600"
          />
          <StatCard
            label="7-Day Accuracy"
            value={weekAccuracy ? `${weekAccuracy.pct}%` : "—"}
            icon="ri-bar-chart-box-line"
            color="bg-green-50 text-green-600"
          />
        </div>
        {weekAccuracy && (
          <p className="text-[11px] text-gray-400 -mt-[16px] mb-[24px]">
            Based on {weekAccuracy.n.toLocaleString()} settled predictions (last 7 days)
          </p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[20px]">
          {/* Main column — picks */}
          <div className="lg:col-span-2">
            {/* Your teams' matches — only when the user has favourites */}
            {favouriteMatches.length > 0 && (
              <div className="mb-[24px]">
                <div className="flex items-center justify-between mb-[14px]">
                  <h2 className="text-[15px] font-semibold text-[#0A0F1C] font-display flex items-center gap-[8px]">
                    <i className="ri-heart-fill text-[14px] text-red-400" />
                    Your Teams&apos; Matches
                  </h2>
                  <Link
                    href="/settings"
                    className="text-[12px] font-medium text-[#1B2A4A] hover:text-[#243B53] transition-colors"
                  >
                    Manage favourites →
                  </Link>
                </div>
                <Card padding="none">
                  <div className="divide-y divide-gray-50">
                    {favouriteMatches.map((m) => (
                      <Link
                        key={m.id}
                        href={`/matches/${m.id}`}
                        className="flex items-center gap-[12px] px-[16px] py-[12px] hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-center gap-[8px] flex-1 min-w-0">
                          <TeamLogo logo={m.home_team_logo} name={m.home_team_name} size={28} />
                          <div className="min-w-0">
                            <span className="block text-[13px] font-semibold text-[#0A0F1C] truncate">
                              {m.home_team_name} <span className="text-gray-300 font-normal">vs</span> {m.away_team_name}
                            </span>
                            <span className="block text-[10px] text-gray-400 truncate mt-[1px]">
                              {m.league_name}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-[8px] flex-none">
                          <TeamLogo logo={m.away_team_logo} name={m.away_team_name} size={28} />
                          <div className="text-right">
                            <span className="block text-[10px] font-medium text-gray-400">{formatDate(m.kickoff_time)}</span>
                            <span className="block text-[11px] font-mono-data font-bold text-[#1B2A4A]">
                              {formatTime(m.kickoff_time)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            <div className="flex items-center justify-between mb-[14px]">
              <h2 className="text-[15px] font-semibold text-[#0A0F1C] font-display">
                Top Picks Today
              </h2>
              <Link
                href="/matches/upcoming"
                className="text-[12px] font-medium text-[#1B2A4A] hover:text-[#243B53] transition-colors"
              >
                View all matches →
              </Link>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-[14px] border border-gray-100 p-[20px] animate-pulse">
                    <div className="h-[12px] bg-gray-100 rounded w-[60%] mb-[12px]" />
                    <div className="flex items-center gap-[12px] mb-[12px]">
                      <div className="w-[36px] h-[36px] bg-gray-100 rounded-full" />
                      <div className="h-[14px] bg-gray-100 rounded flex-1" />
                      <div className="h-[14px] bg-gray-100 rounded flex-1" />
                    </div>
                    <div className="h-[16px] bg-gray-100 rounded w-[40%] mb-[8px]" />
                    <div className="h-[6px] bg-gray-100 rounded-full" />
                  </div>
                ))}
              </div>
            ) : picks.length === 0 ? (
              <EmptyState
                icon="ri-search-line"
                title="No high-confidence picks today"
                description="The model hasn't found any ≥70% probability selections for today's matches yet. Check back closer to kickoff."
                action={
                  <Link
                    href="/matches/upcoming"
                    className="inline-flex items-center px-[14px] py-[7px] bg-[#1B2A4A] text-white text-[12px] font-medium rounded-[8px] hover:bg-[#243B53] transition-colors"
                  >
                    Browse matches
                  </Link>
                }
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px] stagger-children">
                {picks.slice(0, 8).map((pick) => (
                  <ElitePickCard key={pick.fixture.id} pick={pick} />
                ))}
              </div>
            )}

            {/* Recent settlements */}
            <div className="mt-[28px]">
              <h2 className="text-[15px] font-semibold text-[#0A0F1C] font-display mb-[14px]">
                Recent Results
              </h2>
              {recentSettlements.length === 0 ? (
                <Card padding="md">
                  <p className="text-[13px] text-gray-400">
                    No settled predictions in the last 7 days.
                  </p>
                </Card>
              ) : (
                <Card padding="none">
                  <div className="divide-y divide-gray-50">
                    {recentSettlements.map((s) => (
                      <div key={s.id} className="flex items-center justify-between px-[16px] py-[10px]">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-[8px]">
                            <span className="text-[12px] font-medium text-[#0A0F1C] truncate">
                              {formatSelection(s.selection)}
                            </span>
                            <span className="text-[10px] text-gray-400">{formatMarket(s.market)}</span>
                          </div>
                          <span className="block text-[11px] text-gray-400 truncate mt-[1px]">
                            {s.matchLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-[10px] flex-none ml-[12px]">
                          <span className="text-[11px] font-mono-data text-gray-400">
                            {Math.round(s.model_probability * 100)}%
                          </span>
                          <Badge variant={s.result === "correct" ? "success" : "danger"} size="sm">
                            {s.result === "correct" ? "WON" : "LOST"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>

          {/* Side column */}
          <div className="space-y-[20px]">
            {/* Quick links */}
            <Card padding="md">
              <CardHeader title="Explore" icon="ri-compass-3-line" />
              <div className="space-y-[6px]">
                {QUICK_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-[12px] p-[10px] rounded-[10px] hover:bg-gray-50 transition-colors group"
                  >
                    <div className="w-[34px] h-[34px] rounded-[9px] bg-gray-50 flex items-center justify-center flex-none group-hover:bg-[#1B2A4A]/8 transition-colors">
                      <i className={`${link.icon} text-[16px] text-gray-500 group-hover:text-[#1B2A4A] transition-colors`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block text-[13px] font-medium text-[#0A0F1C]">{link.title}</span>
                      <span className="block text-[11px] text-gray-400 truncate">{link.description}</span>
                    </div>
                    <i className="ri-arrow-right-s-line text-[16px] text-gray-300 group-hover:text-gray-500 transition-colors" />
                  </Link>
                ))}
              </div>
            </Card>

            {/* Personalization prompt when no favourites yet */}
            {user && favouritesCount === 0 && (
              <Card padding="md">
                <CardHeader title="Personalize" icon="ri-heart-3-line" />
                <p className="text-[12px] text-gray-500 leading-relaxed mb-[12px]">
                  Follow your teams and leagues to see their upcoming matches
                  and predictions right here.
                </p>
                <Link
                  href="/onboarding"
                  className="inline-flex items-center gap-[6px] text-[12px] font-semibold text-[#1B2A4A] hover:text-[#243B53] transition-colors"
                >
                  Pick your teams <i className="ri-arrow-right-line" />
                </Link>
              </Card>
            )}

            {/* Rollover status */}
            <Card padding="md">
              <CardHeader title="Daily Rollover" icon="ri-repeat-line" />
              <p className="text-[12px] text-gray-500 leading-relaxed mb-[12px]">
                The system hunts for selections near 2.00 combined odds where model
                probabilities support positive expected value.
              </p>
              <Link
                href="/rollover"
                className="inline-flex items-center gap-[6px] text-[12px] font-semibold text-[#1B2A4A] hover:text-[#243B53] transition-colors"
              >
                Open rollover <i className="ri-arrow-right-line" />
              </Link>
            </Card>

            {/* Model info */}
            <Card padding="md">
              <CardHeader title="Prediction Engine" icon="ri-cpu-line" />
              <div className="space-y-[8px] text-[12px]">
                <div className="flex justify-between">
                  <span className="text-gray-400">Model</span>
                  <span className="font-medium text-[#0A0F1C]">Meta-Ensemble v2.0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Markets</span>
                  <span className="font-medium text-[#0A0F1C]">24 per match</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Leagues today</span>
                  <span className="font-medium text-[#0A0F1C]">{stats.leagues || "—"}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
