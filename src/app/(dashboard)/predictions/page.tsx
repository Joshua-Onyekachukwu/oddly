"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { EmptyState } from "@/components/ui";
import { BettingTooltip, getMarketLabel, getSelectionLabel, getAbbrevLabel } from "@/components/ui/BettingTooltip";

interface GoldenPick {
  fixture_id: string;
  match: string;
  league: string;
  league_logo: string | null;
  home_team: string;
  home_logo: string | null;
  away_team: string;
  away_logo: string | null;
  kickoff: string;
  market: string;
  selection: string;
  model_probability: number;
  confidence_tier: string;
  odds_home: number | null;
  odds_draw: number | null;
  odds_away: number | null;
  edge: number;
}

function getTierStyle(tier: string) {
  switch (tier) {
    case "ELITE": return { bg: "bg-[#F59E0B]/10", text: "text-[#D97706]", border: "border-[#F59E0B]/20", ring: "ring-[#F59E0B]/20" };
    case "HIGH": return { bg: "bg-[#10B981]/10", text: "text-[#059669]", border: "border-[#10B981]/20", ring: "ring-[#10B981]/20" };
    default: return { bg: "bg-gray-50", text: "text-gray-500", border: "border-gray-100", ring: "ring-gray-100" };
  }
}

export default function PredictionsPage() {
  const [picks, setPicks] = useState<GoldenPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<"ELITE" | "HIGH" | "ALL">("ELITE");
  const [leagueFilter, setLeagueFilter] = useState<string>("ALL");
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all">("week");
  const [stats, setStats] = useState({ elite: 0, high: 0, total: 0 });
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [availableLeagues, setAvailableLeagues] = useState<string[]>([]);

  const fetchPicks = useCallback(async () => {
    const supabase = createClient();
    const now = new Date();
    let startDate = now.toISOString();
    let endDate: string | null = null;
    if (dateRange === "today") {
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      endDate = todayEnd.toISOString();
    } else if (dateRange === "week") {
      endDate = new Date(now.getTime() + 7 * 86400000).toISOString();
    } else if (dateRange === "month") {
      endDate = new Date(now.getTime() + 30 * 86400000).toISOString();
    }

    let fixtureQuery = supabase
      .from("fixtures")
      .select("id, kickoff_time, home_team_id, away_team_id, league_id")
      .gte("kickoff_time", startDate)
      .order("kickoff_time", { ascending: true });
    if (endDate) fixtureQuery = fixtureQuery.lte("kickoff_time", endDate);
    fixtureQuery = fixtureQuery.limit(500);
    const { data: fixtures } = await fixtureQuery;

    if (!fixtures || fixtures.length === 0) { setLoading(false); return; }

    const fixtureIds = fixtures.map((f: any) => f.id);

    const [predsRes, teamsRes, leaguesRes, oddsRes] = await Promise.all([
      supabase.from("predictions").select("fixture_id, market, selection, model_probability").in("fixture_id", fixtureIds),
      supabase.from("teams").select("id, canonical_name, logo").in("id", [...new Set([...fixtures.map((f: any) => f.home_team_id), ...fixtures.map((f: any) => f.away_team_id)])]),
      supabase.from("leagues").select("id, name, logo").in("id", [...new Set(fixtures.map((f: any) => f.league_id))]),
      supabase.from("odds_snapshots").select("fixture_id, selection, odds").in("fixture_id", fixtureIds),
    ]);

    const teamMap: Record<string, any> = {};
    for (const t of teamsRes.data || []) teamMap[t.id] = t;
    const leagueMap: Record<string, any> = {};
    for (const l of leaguesRes.data || []) leagueMap[l.id] = l;

    const oddsByFixture: Record<string, Record<string, number[]>> = {};
    for (const o of oddsRes.data || []) {
      if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
      if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
      oddsByFixture[o.fixture_id][o.selection].push(o.odds);
    }
    const avg = (arr: number[]) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    const predsByFixture: Record<string, any[]> = {};
    for (const p of predsRes.data || []) {
      if (!predsByFixture[p.fixture_id]) predsByFixture[p.fixture_id] = [];
      predsByFixture[p.fixture_id].push(p);
    }

    const enrichedFixtures = fixtures.map((f: any) => ({
      ...f,
      home: teamMap[f.home_team_id],
      away: teamMap[f.away_team_id],
      league: leagueMap[f.league_id],
      predictions: predsByFixture[f.id] || [],
    }));

    const allPicks: GoldenPick[] = [];
    let eliteCount = 0, highCount = 0;

    for (const fixture of enrichedFixtures) {
      const home = fixture.home?.canonical_name || "Unknown";
      const away = fixture.away?.canonical_name || "Unknown";
      const odds = oddsByFixture[fixture.id] || {};
      const hOdds = avg(odds["Home"] || odds["home"] || []);
      const dOdds = avg(odds["Draw"] || odds["draw"] || []);
      const aOdds = avg(odds["Away"] || odds["away"] || []);

      for (const pred of fixture.predictions || []) {
        const tier = pred.model_probability >= 0.70 ? "ELITE" : pred.model_probability >= 0.60 ? "HIGH" : "MEDIUM";
        if (tier === "ELITE") eliteCount++;
        if (tier === "HIGH") highCount++;

        let impliedProb = null;
        const sel = (pred.selection || "").toLowerCase();
        if (sel === "home" && hOdds) impliedProb = 1 / hOdds;
        else if (sel === "draw" && dOdds) impliedProb = 1 / dOdds;
        else if (sel === "away" && aOdds) impliedProb = 1 / aOdds;

        allPicks.push({
          fixture_id: fixture.id,
          match: `${home} vs ${away}`,
          league: fixture.league?.name || "Unknown",
          league_logo: fixture.league?.logo,
          home_team: home,
          home_logo: fixture.home?.logo,
          away_team: away,
          away_logo: fixture.away?.logo,
          kickoff: fixture.kickoff_time,
          market: pred.market,
          selection: pred.selection,
          model_probability: pred.model_probability,
          confidence_tier: tier,
          odds_home: hOdds,
          odds_draw: dOdds,
          odds_away: aOdds,
          edge: impliedProb ? pred.model_probability - impliedProb : 0,
        });
      }
    }

    const leagues = [...new Set(allPicks.map(p => p.league))].sort();
    setAvailableLeagues(leagues);
    setStats({ elite: eliteCount, high: highCount, total: allPicks.length });
    setPicks(allPicks);
    setLoading(false);
  }, [dateRange]);

  useEffect(() => { fetchPicks(); }, [fetchPicks]);

  const filtered = picks.filter((p) => {
    if (tierFilter !== "ALL" && p.confidence_tier !== tierFilter) return false;
    if (leagueFilter !== "ALL" && p.league !== leagueFilter) return false;
    return true;
  }).sort((a, b) => b.model_probability - a.model_probability);

  const grouped: Record<string, GoldenPick[]> = {};
  for (const pick of filtered) {
    if (!grouped[pick.fixture_id]) grouped[pick.fixture_id] = [];
    grouped[pick.fixture_id].push(pick);
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="mb-[24px]">
        <div className="flex items-center gap-[12px] mb-[6px]">
          <div className="w-[36px] h-[36px] rounded-[10px] bg-gradient-to-br from-[#F59E0B] to-[#D97706] flex items-center justify-center shadow-[0_2px_12px_rgba(245,158,11,0.3)]">
            <span className="text-[18px]">👑</span>
          </div>
          <div>
            <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C]">
              Golden Picks
            </h1>
          </div>
        </div>
        <p className="text-[13px] text-gray-500 ml-[48px] max-w-[500px]">
          The system searches <BettingTooltip term="1X2">26 betting markets</BettingTooltip> per match and selects the most predictable outcome. Each pick shows confidence and edge — hover any underlined term for details.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-[10px] mb-[20px]">
        {[
          { label: "ELITE", value: stats.elite, color: "from-[#F59E0B] to-[#D97706]", icon: "ri-vip-crown-fill", desc: "70%+ confidence" },
          { label: "HIGH", value: stats.high, color: "from-[#10B981] to-[#059669]", icon: "ri-check-double-line", desc: "60%+ confidence" },
          { label: "TOTAL", value: stats.total, color: "from-[#6366F1] to-[#4F46E5]", icon: "ri-bar-chart-grouped-line", desc: "all predictions" },
        ].map((stat) => (
          <div key={stat.label} className="relative overflow-hidden rounded-[14px] bg-white border border-gray-100 p-[16px] group hover:border-gray-200 transition-[border-color,box-shadow] duration-200 ease-out">
            <div className={`absolute top-0 right-0 w-[80px] h-[80px] bg-gradient-to-br ${stat.color} opacity-[0.06] rounded-bl-[40px] group-hover:opacity-[0.1] transition-opacity`} />
            <div className="relative">
              <div className="flex items-center gap-[6px] mb-[6px]">
                <i className={`${stat.icon} text-[14px]`} />
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{stat.label}</span>
              </div>
              <span className="text-[28px] font-bold text-[#0A0F1C] font-mono tabular-nums block">
                {loading ? "—" : stat.value}
              </span>
              <span className="text-[10px] text-gray-400 mt-[2px] block">{stat.desc}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-[8px] mb-[20px]">
        {/* Tier Tabs */}
        <div className="flex gap-[4px] bg-gray-100/80 rounded-[12px] p-[4px]">
        {(["ELITE", "HIGH", "ALL"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            aria-pressed={tierFilter === t}
            className={`px-[18px] py-[8px] rounded-[9px] text-[12px] font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
              tierFilter === t
                ? t === "ELITE" ? "bg-[#F59E0B] text-white shadow-[0_2px_12px_rgba(245,158,11,0.3)]"
                : t === "HIGH" ? "bg-[#10B981] text-white shadow-[0_2px_12px_rgba(16,185,129,0.3)]"
                : "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                : "text-gray-400 hover:text-gray-600 hover:bg-white/50"
            }`}
          >
            {t === "ELITE" ? <i className="ri-vip-crown-fill text-[10px]" /> : t === "HIGH" ? <i className="ri-check-double-line text-[10px]" /> : null}{" "}{t}
          </button>
        ))}
      </div>

        {/* League Filter */}
        {availableLeagues.length > 1 && (
          <select
            value={leagueFilter}
            onChange={(e) => setLeagueFilter(e.target.value)}
            className="h-[34px] px-[12px] rounded-[9px] bg-white border border-gray-200 text-[12px] font-semibold text-[#0A0F1C] focus:outline-none focus:ring-2 focus:ring-[#6366F1]/30 focus:border-[#6366F1] transition-all"
          >
            <option value="ALL">All Leagues ({availableLeagues.length})</option>
            {availableLeagues.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        )}

        {/* Date Range Picker */}
        <div className="flex gap-[4px] bg-gray-100/80 rounded-[12px] p-[4px]">
          {([
            { key: "today" as const, label: "Today", icon: "ri-calendar-line" },
            { key: "week" as const, label: "This Week", icon: "ri-calendar-event-line" },
            { key: "month" as const, label: "This Month", icon: "ri-calendar-todo-line" },
            { key: "all" as const, label: "All", icon: "ri-list-unordered" },
          ]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setDateRange(key)}
              className={`px-[14px] py-[6px] rounded-[9px] text-[11px] font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
                dateRange === key
                  ? "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                  : "text-gray-400 hover:text-gray-600 hover:bg-white/50"
              }`}
            >
              <i className={`${icon} text-[10px] mr-[4px]`} />{label}
            </button>
          ))}
        </div>
      </div>

      {/* Match Cards */}
      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[140px] bg-white rounded-[16px] animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <EmptyState
          icon="ri-vip-crown-line"
          title={`No ${tierFilter} picks this week`}
          description="Check back after the next data sync, or try a different filter."
        />
      ) : (
        <div className="space-y-[10px]">
          {Object.entries(grouped).map(([fixtureId, fixturePicks], idx) => {
            const pick = fixturePicks[0];
            const bestPick = fixturePicks.reduce((best, p) =>
              p.model_probability > best.model_probability ? p : best
            );
            const isExpanded = expandedMatch === fixtureId;
            const tierStyle = getTierStyle(bestPick.confidence_tier);

            return (
              <div
                key={fixtureId}
                role="article"
                aria-label={`${pick.home_team} vs ${pick.away_team} — ${getMarketLabel(bestPick.market)} ${getSelectionLabel(bestPick.selection)} ${Math.round(bestPick.model_probability * 100)}% confidence`}
                className={`rounded-[16px] bg-white border overflow-hidden transition-[border-color,box-shadow] duration-200 ease-out hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] ${
                  bestPick.confidence_tier === "ELITE" ? "border-[#F59E0B]/20" : "border-gray-100 hover:border-gray-200"
                }`}
                style={{ animationDelay: `${idx * 40}ms` }}
              >
                {/* Match Header — Clickable */}
                <button
                  onClick={() => setExpandedMatch(isExpanded ? null : fixtureId)}
                  aria-expanded={isExpanded}
                  aria-label={`Toggle details for ${pick.home_team} vs ${pick.away_team}`}
                  className="w-full text-left p-[16px] flex items-center gap-[12px] active:scale-[0.99] transition-transform duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-inset rounded-[16px]"
                >
                  {/* League + Time */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-[8px] mb-[10px]">
                      {pick.league_logo && (
                        <img src={pick.league_logo} alt={pick.league} className="w-[16px] h-[16px] object-contain flex-none" />
                      )}
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{pick.league}</span>
                      <span className="text-[10px] text-gray-300">•</span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(pick.kickoff).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        {" "}
                        {new Date(pick.kickoff).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    {/* Teams */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-[10px] flex-1 min-w-0">
                        {pick.home_logo && (
                          <img src={pick.home_logo} alt={pick.home_team} className="w-[24px] h-[24px] object-contain flex-none" />
                        )}
                        <span className="text-[14px] font-semibold text-[#0A0F1C] truncate">{pick.home_team}</span>
                      </div>
                      <span className="text-[11px] font-bold text-gray-300 px-[12px] flex-none">VS</span>
                      <div className="flex items-center gap-[10px] flex-1 min-w-0 justify-end">
                        <span className="text-[14px] font-semibold text-[#0A0F1C] truncate text-right">{pick.away_team}</span>
                        {pick.away_logo && (
                          <img src={pick.away_logo} alt={pick.away_team} className="w-[24px] h-[24px] object-contain flex-none" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Best Pick Badge */}
                  <div className="flex-none text-right">
                    <div className="inline-flex items-center gap-[6px] px-[10px] py-[6px] rounded-[8px] bg-[#0A0F1C]/[0.03]">
                      <span className={`text-[10px] font-bold px-[5px] py-[2px] rounded-[4px] ${tierStyle.bg} ${tierStyle.text}`}>
                        {bestPick.confidence_tier}
                      </span>
                      <span className="text-[18px] font-bold text-[#0A0F1C] font-mono tabular-nums">
                        {Math.round(bestPick.model_probability * 100)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-[4px]">
                      <BettingTooltip term={bestPick.market} showAbbrev>{bestPick.market}</BettingTooltip>
                      {" → "}
                      <BettingTooltip term={bestPick.selection} showAbbrev>{bestPick.selection}</BettingTooltip>
                    </div>
                  </div>

                  {/* Expand Arrow */}
                  <svg
                    className={`w-[16px] h-[16px] text-gray-300 flex-none transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded: All Predictions */}
                {isExpanded && (
                  <div className="px-[16px] pb-[16px] border-t border-gray-50">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-[6px] pt-[12px]">
                      {fixturePicks
                        .sort((a, b) => b.model_probability - a.model_probability)
                        .slice(0, 12)
                        .map((fp, i) => {
                          const ts = getTierStyle(fp.confidence_tier);
                          return (
                            <div
                              key={i}
                              className="flex items-center justify-between p-[10px] rounded-[10px] bg-gray-50/80 hover:bg-gray-100/80 transition-colors duration-150"
                            >
                              <div className="flex items-center gap-[8px] min-w-0">
                                <span className={`text-[9px] font-bold px-[5px] py-[2px] rounded-[4px] ${ts.bg} ${ts.text}`}>
                                  {fp.confidence_tier}
                                </span>
                                <div className="min-w-0">
                                  <span className="text-[11px] font-medium text-gray-500 block">
                                    <BettingTooltip term={fp.market}>{getMarketLabel(fp.market)}</BettingTooltip>
                                  </span>
                                  <span className="text-[12px] font-semibold text-[#0A0F1C]">
                                    <BettingTooltip term={fp.selection}>{getSelectionLabel(fp.selection)}</BettingTooltip>
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-[8px] flex-none">
                                {fp.edge > 0 && (
                                  <span className="text-[10px] font-semibold text-[#10B981]" title={`Edge over bookmaker: model says ${Math.round(fp.model_probability * 100)}% but odds imply ${Math.round((1 / (fp.model_probability - fp.edge + 0.001)) * 100)}%`}>
                                    +{(fp.edge * 100).toFixed(0)}%
                                  </span>
                                )}
                                <span className="text-[15px] font-bold text-[#0A0F1C] font-mono tabular-nums">
                                  {Math.round(fp.model_probability * 100)}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    {/* Odds Row */}
                    {(pick.odds_home || pick.odds_draw || pick.odds_away) && (
                      <div className="flex items-center justify-center gap-[16px] pt-[12px] mt-[8px] border-t border-gray-100">
                        <span className="text-[10px] text-gray-400 font-medium">BOOKMAKER ODDS</span>
                        {pick.odds_home && (
                          <span className="text-[12px] font-mono text-gray-500" title="Home win odds">
                            H {pick.odds_home.toFixed(2)}
                          </span>
                        )}
                        {pick.odds_draw && (
                          <span className="text-[12px] font-mono text-gray-500" title="Draw odds">
                            D {pick.odds_draw.toFixed(2)}
                          </span>
                        )}
                        {pick.odds_away && (
                          <span className="text-[12px] font-mono text-gray-500" title="Away win odds">
                            A {pick.odds_away.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
