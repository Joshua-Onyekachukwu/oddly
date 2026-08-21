"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader, Card, Badge, StatCard, EmptyState } from "@/components/ui";

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

export default function PredictionsPage() {
  const [picks, setPicks] = useState<GoldenPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<"ELITE" | "HIGH" | "ALL">("ELITE");
  const [stats, setStats] = useState({ elite: 0, high: 0, total: 0 });

  const fetchPicks = useCallback(async () => {
    const supabase = createClient();

    // Get upcoming fixtures with predictions and odds
    const now = new Date().toISOString();
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString();

    const { data: fixtures } = await supabase
      .from("fixtures")
      .select(`
        id, kickoff_time,
        home_team_id, away_team_id, league_id
      `)
      .gte("kickoff_time", now)
      .lte("kickoff_time", weekEnd)
      .order("kickoff_time", { ascending: true });

    if (!fixtures || fixtures.length === 0) { setLoading(false); return; }

    const fixtureIds = fixtures.map((f: any) => f.id);

    // Get predictions for these fixtures
    const { data: predictions } = await supabase
      .from("predictions")
      .select("fixture_id, market, selection, model_probability")
      .in("fixture_id", fixtureIds);

    // Get team names and logos
    const homeIds = [...new Set(fixtures.map((f: any) => f.home_team_id).filter(Boolean))];
    const awayIds = [...new Set(fixtures.map((f: any) => f.away_team_id).filter(Boolean))];
    const allTeamIds = [...new Set([...homeIds, ...awayIds])];
    const leagueIds = [...new Set(fixtures.map((f: any) => f.league_id).filter(Boolean))];

    const [teamsRes, leaguesRes] = await Promise.all([
      allTeamIds.length > 0 ? supabase.from("teams").select("id, canonical_name, logo").in("id", allTeamIds) : { data: [] },
      leagueIds.length > 0 ? supabase.from("leagues").select("id, name, logo").in("id", leagueIds) : { data: [] },
    ]);

    const teamMap: Record<string, any> = {};
    for (const t of teamsRes.data || []) teamMap[t.id] = t;
    const leagueMap: Record<string, any> = {};
    for (const l of leaguesRes.data || []) leagueMap[l.id] = l;

    // Map predictions to fixtures
    const predsByFixture: Record<string, any[]> = {};
    for (const p of predictions || []) {
      if (!predsByFixture[p.fixture_id]) predsByFixture[p.fixture_id] = [];
      predsByFixture[p.fixture_id].push(p);
    }

    // Attach team/league data to fixtures
    const enrichedFixtures = fixtures.map((f: any) => ({
      ...f,
      home: teamMap[f.home_team_id],
      away: teamMap[f.away_team_id],
      league: leagueMap[f.league_id],
      predictions: predsByFixture[f.id] || [],
    }));

    // Get odds for all fixtures
    const { data: oddsData } = await supabase
      .from("odds_snapshots")
      .select("fixture_id, selection, odds")
      .in("fixture_id", fixtureIds);

    const oddsByFixture: Record<string, Record<string, number[]>> = {};
    if (oddsData) {
      for (const o of oddsData) {
        if (!oddsByFixture[o.fixture_id]) oddsByFixture[o.fixture_id] = {};
        if (!oddsByFixture[o.fixture_id][o.selection]) oddsByFixture[o.fixture_id][o.selection] = [];
        oddsByFixture[o.fixture_id][o.selection].push(o.odds);
      }
    }

    const avg = (arr: number[]) => arr && arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

    // Build golden picks
    const allPicks: GoldenPick[] = [];
    let eliteCount = 0, highCount = 0;

    for (const fixture of enrichedFixtures) {
      const home = fixture.home?.canonical_name || "Unknown";
      const away = fixture.away?.canonical_name || "Unknown";
      const league = fixture.league?.name || "Unknown";
      const odds = oddsByFixture[fixture.id] || {};
      const hOdds = avg(odds["Home"] || odds["home"] || []);
      const dOdds = avg(odds["Draw"] || odds["draw"] || []);
      const aOdds = avg(odds["Away"] || odds["away"] || []);

      // Get best prediction
      const preds = fixture.predictions || [];
      for (const pred of preds) {
        const tier = pred.model_probability >= 0.70 ? "ELITE" : pred.model_probability >= 0.60 ? "HIGH" : pred.model_probability >= 0.50 ? "MEDIUM" : "LOW";
        if (tier === "ELITE") eliteCount++;
        if (tier === "HIGH") highCount++;

        // Calculate edge
        let impliedProb = null;
        if (pred.selection === "Home" && hOdds) impliedProb = 1 / hOdds;
        else if (pred.selection === "Draw" && dOdds) impliedProb = 1 / dOdds;
        else if (pred.selection === "Away" && aOdds) impliedProb = 1 / aOdds;

        const edge = impliedProb ? pred.model_probability - impliedProb : 0;

        allPicks.push({
          fixture_id: fixture.id,
          match: `${home} vs ${away}`,
          league,
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
          edge,
        });
      }
    }

    setStats({ elite: eliteCount, high: highCount, total: allPicks.length });
    setPicks(allPicks);
    setLoading(false);
  }, []);

  useEffect(() => { fetchPicks(); }, [fetchPicks]);

  const filtered = picks.filter((p) => {
    if (tierFilter === "ALL") return true;
    return p.confidence_tier === tierFilter;
  }).sort((a, b) => b.model_probability - a.model_probability);

  // Group by fixture
  const grouped: Record<string, GoldenPick[]> = {};
  for (const pick of filtered) {
    if (!grouped[pick.fixture_id]) grouped[pick.fixture_id] = [];
    grouped[pick.fixture_id].push(pick);
  }

  return (
    <div>
      <PageHeader
        title="Golden Picks"
        description="AI-powered predictions with the highest confidence for upcoming matches."
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-[12px] mb-[20px]">
        <StatCard
          label="ELITE Picks"
          value={loading ? "—" : String(stats.elite)}
          icon="ri-vip-crown-line"
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="HIGH Picks"
          value={loading ? "—" : String(stats.high)}
          icon="ri-shield-check-line"
          color="bg-green-50 text-green-600"
        />
        <StatCard
          label="Total Predictions"
          value={loading ? "—" : String(stats.total)}
          icon="ri-brain-line"
          color="bg-blue-50 text-blue-600"
        />
      </div>

      {/* Tier Filter */}
      <div className="flex gap-[4px] bg-gray-100 rounded-[10px] p-[4px] mb-[16px] w-fit">
        {(["ELITE", "HIGH", "ALL"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            className={`px-[16px] py-[8px] rounded-[8px] text-[12px] font-semibold transition-all ${
              tierFilter === t
                ? t === "ELITE" ? "bg-amber-500 text-white shadow-[0_2px_8px_rgba(245,158,11,0.3)]"
                : t === "HIGH" ? "bg-green-500 text-white shadow-[0_2px_8px_rgba(34,197,94,0.3)]"
                : "bg-white text-[#0A0F1C] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {t === "ELITE" ? "👑 " : t === "HIGH" ? "✅ " : ""}
            {t}
          </button>
        ))}
      </div>

      {/* Picks */}
      {loading ? (
        <div className="space-y-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[120px] bg-white rounded-[14px] animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="ri-vip-crown-line"
          title={`No ${tierFilter} picks available`}
          description="Check back after the next data sync, or try a different filter."
        />
      ) : (
        <div className="space-y-[16px]">
          {Object.entries(grouped).map(([fixtureId, fixturePicks]) => {
            const pick = fixturePicks[0];
            const bestPick = fixturePicks.reduce((best, p) =>
              p.model_probability > best.model_probability ? p : best
            );

            return (
              <Card key={fixtureId} className="overflow-hidden">
                {/* Match Header */}
                <div className="flex items-center justify-between px-[16px] py-[12px] bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center gap-[10px]">
                    {pick.league_logo && (
                      <img src={pick.league_logo} alt="" className="w-[16px] h-[16px] object-contain" />
                    )}
                    <span className="text-[11px] font-semibold text-gray-500 uppercase">{pick.league}</span>
                  </div>
                  <span className="text-[11px] text-gray-400">
                    {new Date(pick.kickoff).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    {" "}
                    {new Date(pick.kickoff).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                {/* Teams */}
                <div className="flex items-center justify-between px-[16px] py-[14px]">
                  <div className="flex items-center gap-[10px] flex-1">
                    {pick.home_logo && (
                      <img src={pick.home_logo} alt="" className="w-[28px] h-[28px] object-contain" />
                    )}
                    <span className="text-[14px] font-semibold text-[#0A0F1C]">{pick.home_team}</span>
                  </div>
                  <span className="text-[12px] text-gray-400 font-semibold px-[12px]">VS</span>
                  <div className="flex items-center gap-[10px] flex-1 justify-end">
                    <span className="text-[14px] font-semibold text-[#0A0F1C]">{pick.away_team}</span>
                    {pick.away_logo && (
                      <img src={pick.away_logo} alt="" className="w-[28px] h-[28px] object-contain" />
                    )}
                  </div>
                </div>

                {/* Predictions */}
                <div className="px-[16px] pb-[14px] space-y-[8px]">
                  {fixturePicks
                    .sort((a, b) => b.model_probability - a.model_probability)
                    .map((fp, i) => (
                      <div key={i} className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
                        <div className="flex items-center gap-[8px]">
                          <span className={`text-[10px] font-bold px-[6px] py-[2px] rounded-full ${
                            fp.confidence_tier === "ELITE" ? "bg-amber-100 text-amber-700" :
                            fp.confidence_tier === "HIGH" ? "bg-green-100 text-green-700" :
                            "bg-gray-200 text-gray-600"
                          }`}>
                            {fp.confidence_tier}
                          </span>
                          <span className="text-[12px] font-medium text-[#0A0F1C] uppercase">{fp.market}</span>
                          <span className="text-[12px] text-gray-500">→</span>
                          <span className="text-[12px] font-semibold text-[#0A0F1C]">{fp.selection}</span>
                        </div>
                        <div className="flex items-center gap-[12px]">
                          {fp.edge > 0 && (
                            <span className="text-[11px] font-semibold text-green-600">
                              +{(fp.edge * 100).toFixed(1)}% edge
                            </span>
                          )}
                          <div className="text-right">
                            <span className="text-[16px] font-bold text-[#0A0F1C]">
                              {Math.round(fp.model_probability * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>

                {/* Odds */}
                {(pick.odds_home || pick.odds_draw || pick.odds_away) && (
                  <div className="flex items-center justify-center gap-[16px] px-[16px] pb-[14px]">
                    <span className="text-[11px] text-gray-400">Odds:</span>
                    {pick.odds_home && <span className="text-[12px] font-mono text-gray-500">H {pick.odds_home.toFixed(2)}</span>}
                    {pick.odds_draw && <span className="text-[12px] font-mono text-gray-500">D {pick.odds_draw.toFixed(2)}</span>}
                    {pick.odds_away && <span className="text-[12px] font-mono text-gray-500">A {pick.odds_away.toFixed(2)}</span>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
