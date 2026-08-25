"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PageHeader, Badge } from "@/components/ui";

/* ─── Types ──────────────────────────────────────────────── */

interface OddsData {
  home: number;
  draw: number;
  away: number;
  overround: number;
  implied_probs: { home: number; draw: number; away: number };
  selection_odds: number;
  implied_probability: number;
  edge: number;
  edge_pct: number;
  bookmaker_count: number;
  total_snapshots: number;
}

interface CLVData {
  raw?: { home: number; draw: number; away: number };
  sharp_money?: { home: boolean; draw: boolean; away: boolean };
  movement_pct?: { home: number; draw: number; away: number };
  implied_shift?: { home: number; draw: number; away: number };
  sharpest_side?: string;
  consensus_strength?: number;
  overround_change?: number;
  closing_overround?: number;
  snapshot_count?: number;
  first_snapshot?: string;
  last_snapshot?: string;
  raw_snapshots?: any[];
}

interface LineupPlayer {
  position: string;
  slot: number;
  player: string;
  isAvailable: boolean;
  impactScore: number;
  injury: any;
}

interface LineupSide {
  formation: string;
  strength_pct: number;
  missing_count: number;
  key_missing: number;
  xi: LineupPlayer[];
  injuries: any[];
}

interface Prediction {
  id: string;
  market: string;
  selection: string;
  probability: number;
  model_version: string;
  settlement_result: string | null;
}

interface FixtureDetail {
  fixture_id: string;
  home: { name: string; short: string; id: string };
  away: { name: string; short: string; id: string };
  kickoff_time: string;
  league: { name: string; country: string } | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  minutes_until_kickoff: number;
  predictions: Prediction[];
  best_prediction: { market: string; selection: string; probability: number; model_version: string } | null;
  odds: OddsData;
  clv: CLVData | null;
  lineup: { home: LineupSide; away: LineupSide; confidence: number; generated_at: string } | null;
  market_consensus: any;
  composite_score: number;
  confidence_tier: string;
}

interface PicksData {
  today_pick: FixtureDetail | null;
  all_fixtures: FixtureDetail[];
  pipeline_picks: any[];
  historical_picks: any[];
  pipeline: any;
  clv: any;
  lineups: any;
  meta: { date: string; generated_at: string };
}

/* ─── Small UI atoms ─────────────────────────────────────── */

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white rounded-[14px] border border-gray-100 ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-[20px] py-[16px] border-b border-gray-50 flex items-center justify-between">
      <div>
        <h3 className="text-[14px] font-semibold text-[#0A0F1C]">{title}</h3>
        {description && (
          <p className="text-[11px] text-gray-400 mt-[2px]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

function StatBox({
  label,
  value,
  sub,
  color = "bg-gray-50 text-[#0A0F1C]",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className={`p-[12px] rounded-[10px] ${color}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-[4px]">
        {label}
      </div>
      <div className="text-[22px] font-bold font-mono tabular-nums leading-none">{value}</div>
      {sub && <div className="text-[10px] opacity-50 mt-[4px]">{sub}</div>}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const cls =
    tier === "ELITE"
      ? "bg-green-50 text-green-700 border-green-200"
      : tier === "HIGH"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`text-[11px] font-bold px-[10px] py-[3px] rounded-full border ${cls}`}>
      {tier}
    </span>
  );
}

function DecisionBadge({ decision }: { decision: string }) {
  return decision === "BET" ? (
    <span className="text-[12px] font-bold px-[14px] py-[5px] rounded-full bg-[#BFFF00] text-[#0A0F1C]">
      BET
    </span>
  ) : (
    <span className="text-[12px] font-bold px-[14px] py-[5px] rounded-full bg-gray-100 text-gray-500">
      WATCH
    </span>
  );
}

function Progress({ value, color = "bg-[#1B2A4A]" }: { value: number; color?: string }) {
  return (
    <div className="w-full h-[5px] bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

function CLVArrow({ value }: { value: number }) {
  if (value < -0.02) return <span className="text-green-600">↓ {Math.abs(value).toFixed(3)}</span>;
  if (value > 0.02) return <span className="text-red-500">↑ {value.toFixed(3)}</span>;
  return <span className="text-gray-400">— {value.toFixed(3)}</span>;
}

/* ─── Formation Display ──────────────────────────────────── */

function FormationDisplay({ side, label }: { side: LineupSide; label: string }) {
  const positions = side.formation?.split("-").map(Number) || [];
  const totalOutfield = positions.reduce((a, b) => a + b, 0);

  // Group XI by row
  const rows: string[][] = [[]];
  let posIdx = 0;

  // GK is always first
  rows[0] = [side.xi?.[0]?.position || "GK"];

  // Build rows from formation
  for (const count of positions) {
    const row: string[] = [];
    for (let i = 0; i < count; i++) {
      row.push(side.xi?.[posIdx + 1]?.position || "—");
      posIdx++;
    }
    rows.push(row);
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-[8px]">
        <span className="text-[12px] font-bold text-[#0A0F1C]">{label}</span>
        <span className="text-[11px] font-mono font-bold text-[#1B2A4A] bg-blue-50 px-[8px] py-[2px] rounded-full">
          {side.formation}
        </span>
      </div>

      {/* Pitch visualization */}
      <div className="bg-green-50 rounded-[10px] p-[12px] border border-green-100">
        <div className="flex flex-col-reverse items-center gap-[4px]">
          {rows.map((row, ri) => (
            <div key={ri} className="flex items-center justify-center gap-[6px]">
              {row.map((pos, pi) => {
                const xiEntry = side.xi?.find(
                  (p) => p.position === pos && !rows.slice(0, ri).flat().includes(`${pos}-${pi}`)
                );
                const isAvailable = xiEntry?.isAvailable !== false;
                const isMissing = !isAvailable;

                return (
                  <div
                    key={`${ri}-${pi}`}
                    className={`w-[36px] h-[36px] rounded-full flex items-center justify-center text-[9px] font-bold border ${
                      isMissing
                        ? "bg-red-100 text-red-600 border-red-300"
                        : "bg-white text-[#0A0F1C] border-green-300"
                    }`}
                    title={isMissing ? `${pos} — MISSING` : pos}
                  >
                    {pos}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Stats bar */}
        <div className="flex items-center justify-between mt-[8px] pt-[8px] border-t border-green-200/60">
          <span className="text-[10px] text-green-700">
            Strength: <strong>{side.strength_pct}%</strong>
          </span>
          <span className="text-[10px] text-green-700">
            Missing: <strong>{side.missing_count}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */

export default function AdminPicksPage() {
  const [data, setData] = useState<PicksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [expandedFixture, setExpandedFixture] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/picks");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json.data || json);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-[16px]">
        <div className="h-[40px] w-[260px] bg-gray-100 rounded-[10px] animate-pulse" />
        <div className="h-[200px] bg-gray-50 rounded-[14px] animate-pulse" />
        <div className="grid grid-cols-2 gap-[16px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[120px] bg-gray-50 rounded-[14px] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader
          title="One Game Pick"
          description="Today's single best prediction with CLV analysis and lineup data."
        />
        <Card className="p-[40px] text-center">
          <i className="ri-error-warning-line text-[36px] text-red-400 block mb-[8px]" />
          <p className="text-[14px] font-semibold text-red-600 mb-[4px]">Failed to load picks</p>
          <p className="text-[12px] text-gray-400">{error}</p>
          <button
            onClick={fetchData}
            className="mt-[16px] text-[12px] text-[#1B2A4A] underline hover:no-underline"
          >
            Try again
          </button>
        </Card>
      </div>
    );
  }

  const pick = data?.today_pick;
  const _clvData = pick?.clv;  // extracted for safe narrowing
  const allFixtures = data?.all_fixtures || [];
  const historical = data?.historical_picks || [];
  const pipeline = data?.pipeline || {};
  const clvSummary = data?.clv || {};

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-[20px]">
        <div>
          <div className="flex items-center gap-[8px] mb-[4px]">
            <h1 className="font-display text-[22px] md:text-[26px] font-bold text-[#0A0F1C]">
              One Game Pick
            </h1>
            {pick?.confidence_tier && <TierBadge tier={pick.confidence_tier} />}
          </div>
          <p className="text-[13px] text-gray-500">
            Today&apos;s single best prediction — ranked by composite score, CLV, lineup, and edge.
          </p>
        </div>
        <div className="flex items-center gap-[12px]">
          <div className="text-right">
            <div className="text-[11px] text-gray-400">Last refresh</div>
            <div className="text-[12px] font-mono text-gray-500">
              {lastRefresh.toLocaleTimeString()}
            </div>
          </div>
          <button
            onClick={fetchData}
            className="w-[36px] h-[36px] rounded-[10px] flex items-center justify-center text-gray-400 hover:text-[#1B2A4A] hover:bg-gray-50 transition-colors border border-gray-100"
          >
            <i className="ri-refresh-line text-[16px]" />
          </button>
        </div>
      </div>

      {/* ─── HERO: Today's ONE GAME PICK ──────────────────── */}
      {pick ? (
        <Card className="mb-[20px] overflow-hidden">
          <div className="bg-gradient-to-r from-[#0A0F1C] to-[#1B2A4A] px-[24px] py-[20px]">
            <div className="flex items-center justify-between mb-[12px]">
              <div className="flex items-center gap-[10px]">
                <span className="text-[10px] font-bold text-[#BFFF00] uppercase tracking-wider">
                  🎯 THE ONE GAME PICK
                </span>
                <span className="text-[10px] text-white/40">•</span>
                <span className="text-[10px] text-white/50">
                  {pick.league?.name || "Unknown League"}
                </span>
                <span className="text-[10px] text-white/40">•</span>
                <span className="text-[10px] text-white/50">
                  {new Date(pick.kickoff_time).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <DecisionBadge
                decision={
                  pick.odds.edge > 0.02 && pick.confidence_tier !== "MEDIUM" ? "BET" : "WATCH"
                }
              />
            </div>

            {/* Match title */}
            <div className="flex items-center gap-[12px] mb-[16px]">
              <span className="text-[28px] font-bold text-white font-display">
                {pick.home.name}
              </span>
              <span className="text-[14px] text-white/40 font-medium">vs</span>
              <span className="text-[28px] font-bold text-white font-display">
                {pick.away.name}
              </span>
            </div>

            {/* Key numbers */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-[12px]">
              <div className="bg-white/5 rounded-[10px] p-[12px]">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-[4px]">Pick</div>
                <div className="text-[16px] font-bold text-[#BFFF00] font-mono uppercase">
                  {pick.best_prediction?.selection}
                </div>
                <div className="text-[10px] text-white/50 capitalize">
                  {pick.best_prediction?.market?.replace(/_/g, " ")}
                </div>
              </div>
              <div className="bg-white/5 rounded-[10px] p-[12px]">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-[4px]">Model</div>
                <div className="text-[16px] font-bold text-white font-mono">
                  {pick.best_prediction
                    ? `${(pick.best_prediction.probability * 100).toFixed(1)}%`
                    : "—"}
                </div>
                <div className="text-[10px] text-white/50">{pick.best_prediction?.model_version}</div>
              </div>
              <div className="bg-white/5 rounded-[10px] p-[12px]">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-[4px]">Odds</div>
                <div className="text-[16px] font-bold text-white font-mono">
                  {pick.odds.selection_odds > 0 ? pick.odds.selection_odds.toFixed(2) : "—"}
                </div>
                <div className="text-[10px] text-white/50">
                  Implied: {(pick.odds.implied_probability * 100).toFixed(1)}%
                </div>
              </div>
              <div className="bg-white/5 rounded-[10px] p-[12px]">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-[4px]">Edge</div>
                <div
                  className={`text-[16px] font-bold font-mono ${
                    pick.odds.edge > 0.02 ? "text-[#BFFF00]" : "text-white/60"
                  }`}
                >
                  {pick.odds.edge > 0 ? "+" : ""}
                  {(pick.odds.edge * 100).toFixed(1)}%
                </div>
                <div className="text-[10px] text-white/50">
                  {pick.odds.edge_pct > 0 ? `+${pick.odds.edge_pct.toFixed(1)}% vs implied` : "—"}
                </div>
              </div>
              <div className="bg-white/5 rounded-[10px] p-[12px]">
                <div className="text-[10px] text-white/40 uppercase tracking-wider mb-[4px]">Score</div>
                <div className="text-[16px] font-bold text-white font-mono">
                  {pick.composite_score.toFixed(0)}
                </div>
                <div className="text-[10px] text-white/50">Composite</div>
              </div>
            </div>
          </div>

          {/* Bottom bar — odds comparison */}
          <div className="px-[24px] py-[14px] flex items-center gap-[20px] bg-gray-50 border-t border-gray-100 flex-wrap">
            <div className="flex items-center gap-[6px]">
              <span className="text-[10px] text-gray-400 uppercase">Home</span>
              <span className="text-[13px] font-bold font-mono text-[#0A0F1C]">
                {pick.odds.home > 0 ? pick.odds.home.toFixed(2) : "—"}
              </span>
              <span className="text-[10px] text-gray-400">
                ({(pick.odds.implied_probs.home * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex items-center gap-[6px]">
              <span className="text-[10px] text-gray-400 uppercase">Draw</span>
              <span className="text-[13px] font-bold font-mono text-[#0A0F1C]">
                {pick.odds.draw > 0 ? pick.odds.draw.toFixed(2) : "—"}
              </span>
              <span className="text-[10px] text-gray-400">
                ({(pick.odds.implied_probs.draw * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="flex items-center gap-[6px]">
              <span className="text-[10px] text-gray-400 uppercase">Away</span>
              <span className="text-[13px] font-bold font-mono text-[#0A0F1C]">
                {pick.odds.away > 0 ? pick.odds.away.toFixed(2) : "—"}
              </span>
              <span className="text-[10px] text-gray-400">
                ({(pick.odds.implied_probs.away * 100).toFixed(1)}%)
              </span>
            </div>
            <div className="w-px h-[20px] bg-gray-200" />
            <div className="flex items-center gap-[6px]">
              <span className="text-[10px] text-gray-400">Overround</span>
              <span className="text-[12px] font-mono font-semibold text-[#0A0F1C]">
                {(pick.odds.overround * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-[6px]">
              <span className="text-[10px] text-gray-400">Bookmakers</span>
              <span className="text-[12px] font-mono font-semibold text-[#0A0F1C]">
                {pick.odds.bookmaker_count}
              </span>
            </div>
            <div className="flex items-center gap-[6px]">
              <span className="text-[10px] text-gray-400">KO</span>
              <span
                className={`text-[12px] font-mono font-semibold ${
                  pick.minutes_until_kickoff < 0
                    ? "text-red-500"
                    : pick.minutes_until_kickoff < 60
                      ? "text-amber-600"
                      : "text-[#0A0F1C]"
                }`}
              >
                {pick.minutes_until_kickoff < 0
                  ? "Started"
                  : pick.minutes_until_kickoff < 60
                    ? `${pick.minutes_until_kickoff}min`
                    : `${Math.round(pick.minutes_until_kickoff / 60)}h`}
              </span>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mb-[20px] p-[40px] text-center">
          <i className="ri-moon-line text-[36px] text-gray-300 block mb-[8px]" />
          <p className="text-[14px] font-semibold text-gray-500 mb-[4px]">No picks today</p>
          <p className="text-[12px] text-gray-400">
            No fixtures in the 5–45min window. The ONE GAME PICK is generated 15 minutes before
            kickoff.
          </p>
          <p className="text-[11px] text-gray-300 mt-[8px]">
            Pipeline last ran: {pipeline.last_run ? new Date(pipeline.last_run).toLocaleString() : "never"}
          </p>
        </Card>
      )}

      {/* ─── CLV ANALYSIS + LINEUP ────────────────────────── */}
      {pick && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[20px]">
          {/* CLV Analysis */}
          <Card>
            <CardHeader
              title="CLV Analysis"
              description="Closing Line Value — sharp money movement"
            />
            <div className="p-[16px]">
              {_clvData ? (
                <div className="space-y-[10px]">
                  {/* CLV direction header */}
                  <div className="flex items-center gap-[8px] mb-[8px]">
                    <span className="text-[11px] font-bold text-[#0A0F1C]">Sharpest side:</span>
                    <TierBadge
                      tier={
                        _clvData.sharpest_side === pick.best_prediction?.selection
                          ? "ELITE"
                          : "HIGH"
                      }
                    />
                    <span className="text-[11px] text-gray-500 font-mono">
                      {_clvData.sharpest_side || "none"}
                    </span>
                  </div>

                  {/* Per-selection CLV */}
                  {(["home", "draw", "away"] as const).map((sel) => {
                    const rawVal = _clvData.raw?.[sel] ?? 0;
                    const sharp = _clvData.sharp_money?.[sel] ?? false;
                    const movement = _clvData.movement_pct?.[sel] ?? 0;
                    const shift = _clvData.implied_shift?.[sel] ?? 0;

                    return (
                      <div
                        key={sel}
                        className={`flex items-center justify-between p-[10px] rounded-[8px] ${
                          sharp ? "bg-green-50 border border-green-100" : "bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center gap-[8px]">
                          <span className="text-[11px] font-bold text-[#0A0F1C] uppercase w-[40px]">
                            {sel}
                          </span>
                          {sharp && (
                            <span className="text-[9px] font-bold px-[6px] py-[1px] rounded-full bg-green-100 text-green-700">
                              SHARP
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-[12px] text-[12px] font-mono">
                          <div className="text-right">
                            <div className="text-[10px] text-gray-400">CLV</div>
                            <CLVArrow value={rawVal} />
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-gray-400">Move</div>
                            <span className="font-semibold text-[#0A0F1C]">{movement.toFixed(1)}%</span>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-gray-400">Implied Δ</div>
                            <span
                              className={`font-semibold ${
                                shift > 0.01
                                  ? "text-green-600"
                                  : shift < -0.01
                                    ? "text-red-500"
                                    : "text-gray-500"
                              }`}
                            >
                              {shift > 0 ? "+" : ""}
                              {(shift * 100).toFixed(1)}pp
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Market efficiency metrics */}
                  <div className="mt-[10px] pt-[10px] border-t border-gray-100 grid grid-cols-3 gap-[8px]">
                    <div className="text-center p-[8px] bg-gray-50 rounded-[8px]">
                      <div className="text-[9px] text-gray-400 uppercase mb-[2px]">Consensus</div>
                      <div className="text-[14px] font-bold font-mono text-[#0A0F1C]">
                        {((_clvData.consensus_strength || 0) * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="text-center p-[8px] bg-gray-50 rounded-[8px]">
                      <div className="text-[9px] text-gray-400 uppercase mb-[2px]">Overround</div>
                      <div className="text-[14px] font-bold font-mono text-[#0A0F1C]">
                        {_clvData.closing_overround
                          ? `${(_clvData.closing_overround * 100).toFixed(1)}%`
                          : "—"}
                      </div>
                    </div>
                    <div className="text-center p-[8px] bg-gray-50 rounded-[8px]">
                      <div className="text-[9px] text-gray-400 uppercase mb-[2px]">Snapshots</div>
                      <div className="text-[14px] font-bold font-mono text-[#0A0F1C]">
                        {_clvData.snapshot_count || 0}
                      </div>
                    </div>
                  </div>

                  {/* Timeline */}
                  {_clvData.first_snapshot && _clvData.last_snapshot && (
                    <div className="text-[10px] text-gray-400 flex items-center gap-[6px]">
                      <i className="ri-time-line" />
                      Tracking from{" "}
                      {new Date(_clvData.first_snapshot).toLocaleString()} →{" "}
                      {new Date(_clvData.last_snapshot).toLocaleString()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-[24px]">
                  <i className="ri-line-chart-line text-[28px] text-gray-200 block mb-[6px]" />
                  <p className="text-[12px] text-gray-400">No CLV data available for this fixture</p>
                  <p className="text-[10px] text-gray-300 mt-[2px]">
                    CLV requires at least 2 odds snapshots at different times
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* Lineup */}
          <Card>
            <CardHeader
              title="Predicted Lineups"
              description={
                pick.lineup
                  ? `Generated ${new Date(pick.lineup.generated_at).toLocaleString()}`
                  : "No lineup data"
              }
            />
            <div className="p-[16px]">
              {pick.lineup ? (
                <div className="space-y-[14px]">
                  {/* Both formations */}
                  <div className="flex gap-[14px]">
                    <FormationDisplay side={pick.lineup.home} label={pick.home.name} />
                    <FormationDisplay side={pick.lineup.away} label={pick.away.name} />
                  </div>

                  {/* Injury summary */}
                  {(pick.lineup.home.injuries?.length > 0 ||
                    pick.lineup.away.injuries?.length > 0) && (
                    <div className="pt-[10px] border-t border-gray-100">
                      <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-[6px]">
                        Injuries & Suspensions
                      </div>
                      <div className="grid grid-cols-2 gap-[8px]">
                        {pick.lineup.home.injuries?.length > 0 && (
                          <div className="bg-red-50 rounded-[8px] p-[10px]">
                            <div className="text-[10px] font-bold text-red-700 mb-[4px]">
                              {pick.home.short} — {pick.lineup.home.injuries.length} out
                            </div>
                            {pick.lineup.home.injuries.map((inj: any, i: number) => (
                              <div key={i} className="text-[10px] text-red-600 flex items-center gap-[4px]">
                                <span className="font-semibold">{inj.player_name || inj.position}</span>
                                <span className="text-red-400">—</span>
                                <span>{inj.status}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {pick.lineup.away.injuries?.length > 0 && (
                          <div className="bg-red-50 rounded-[8px] p-[10px]">
                            <div className="text-[10px] font-bold text-red-700 mb-[4px]">
                              {pick.away.short} — {pick.lineup.away.injuries.length} out
                            </div>
                            {pick.lineup.away.injuries.map((inj: any, i: number) => (
                              <div key={i} className="text-[10px] text-red-600 flex items-center gap-[4px]">
                                <span className="font-semibold">{inj.player_name || inj.position}</span>
                                <span className="text-red-400">—</span>
                                <span>{inj.status}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Lineup confidence */}
                  <div className="flex items-center gap-[8px]">
                    <span className="text-[10px] text-gray-400">Lineup Confidence</span>
                    <Progress value={(pick.lineup.confidence || 0) * 100} />
                    <span className="text-[11px] font-mono text-[#0A0F1C]">
                      {((pick.lineup.confidence || 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-[24px]">
                  <i className="ri-team-line text-[28px] text-gray-200 block mb-[6px]" />
                  <p className="text-[12px] text-gray-400">No lineup data for this fixture</p>
                  <p className="text-[10px] text-gray-300 mt-[2px]">
                    Run: node worker/predicted-lineups.js
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ─── ALL PREDICTIONS FOR THE PICK ─────────────────── */}
      {pick && pick.predictions.length > 0 && (
        <Card className="mb-[20px]">
          <CardHeader
            title="All Predictions"
            description={`${pick.predictions.length} prediction${pick.predictions.length !== 1 ? "s" : ""} for this fixture`}
          />
          <div className="p-[16px]">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Market</th>
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Selection</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Probability</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Model</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {pick.predictions.map((p, i) => (
                    <tr
                      key={p.id || i}
                      className={`border-b border-gray-50 last:border-0 ${
                        i === 0 ? "bg-[#BFFF00]/5" : "hover:bg-gray-50/50"
                      }`}
                    >
                      <td className="py-[10px] px-[10px] font-semibold text-[#0A0F1C] capitalize">
                        {p.market?.replace(/_/g, " ")}
                      </td>
                      <td className="py-[10px] px-[10px] text-gray-600 capitalize">{p.selection}</td>
                      <td className="text-center py-[10px] px-[10px]">
                        <span className="font-mono font-bold text-[#0A0F1C]">
                          {(p.probability * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-center py-[10px] px-[10px] text-gray-400 font-mono text-[10px]">
                        {p.model_version}
                      </td>
                      <td className="text-center py-[10px] px-[10px]">
                        {p.settlement_result === "correct" ? (
                          <Badge variant="success">✓</Badge>
                        ) : p.settlement_result === "wrong" ? (
                          <Badge variant="danger">✗</Badge>
                        ) : (
                          <Badge variant="default">Pending</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* ─── ALL FIXTURES TODAY (Ranked) ──────────────────── */}
      <Card className="mb-[20px]">
        <CardHeader
          title="All Today's Fixtures"
          description={`${allFixtures.length} fixture${allFixtures.length !== 1 ? "s" : ""} ranked by composite score`}
          action={
            <Badge variant="info">
              {allFixtures.filter((f) => f.confidence_tier === "ELITE").length} ELITE
            </Badge>
          }
        />
        <div className="p-[16px]">
          {allFixtures.length === 0 ? (
            <div className="text-center py-[32px]">
              <i className="ri-calendar-todo-line text-[36px] text-gray-200 block mb-[6px]" />
              <p className="text-[13px] text-gray-400">No fixtures today</p>
            </div>
          ) : (
            <div className="space-y-[6px]">
              {allFixtures.map((f, idx) => {
                const isExpanded = expandedFixture === f.fixture_id;
                const decision =
                  f.odds.edge > 0.02 && f.confidence_tier !== "MEDIUM" ? "BET" : "WATCH";

                return (
                  <div key={f.fixture_id}>
                    {/* Summary row */}
                    <button
                      onClick={() =>
                        setExpandedFixture(isExpanded ? null : f.fixture_id)
                      }
                      className="w-full text-left flex items-center gap-[12px] p-[12px] rounded-[10px] hover:bg-gray-50/80 transition-colors group"
                    >
                      {/* Rank */}
                      <span
                        className={`w-[24px] h-[24px] rounded-full flex items-center justify-center text-[11px] font-bold flex-none ${
                          idx === 0
                            ? "bg-[#BFFF00] text-[#0A0F1C]"
                            : idx < 3
                              ? "bg-gray-200 text-gray-600"
                              : "bg-gray-100 text-gray-400"
                        }`}
                      >
                        {idx + 1}
                      </span>

                      {/* Teams */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-[6px]">
                          <span className="text-[13px] font-bold text-[#0A0F1C] truncate">
                            {f.home.name}
                          </span>
                          <span className="text-[10px] text-gray-400">vs</span>
                          <span className="text-[13px] font-bold text-[#0A0F1C] truncate">
                            {f.away.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-[6px] mt-[2px]">
                          <span className="text-[10px] text-gray-400 capitalize">
                            {f.best_prediction?.market?.replace(/_/g, " ")} — {f.best_prediction?.selection}
                          </span>
                          <span className="text-[10px] text-gray-300">•</span>
                          <span className="text-[10px] text-gray-400">{f.league?.name}</span>
                        </div>
                      </div>

                      {/* Badges */}
                      <TierBadge tier={f.confidence_tier} />
                      <DecisionBadge decision={decision} />

                      {/* Key numbers */}
                      <div className="flex items-center gap-[10px] flex-none">
                        <div className="text-right">
                          <div className="text-[13px] font-bold font-mono text-[#0A0F1C]">
                            {f.best_prediction
                              ? `${(f.best_prediction.probability * 100).toFixed(1)}%`
                              : "—"}
                          </div>
                          <div className="text-[9px] text-gray-400">Model</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[13px] font-bold font-mono text-[#0A0F1C]">
                            {f.odds.selection_odds > 0 ? f.odds.selection_odds.toFixed(2) : "—"}
                          </div>
                          <div className="text-[9px] text-gray-400">Odds</div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`text-[13px] font-bold font-mono ${
                              f.odds.edge > 0.02 ? "text-green-600" : "text-gray-400"
                            }`}
                          >
                            {f.odds.edge > 0 ? "+" : ""}
                            {(f.odds.edge * 100).toFixed(1)}%
                          </div>
                          <div className="text-[9px] text-gray-400">Edge</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[13px] font-bold font-mono text-gray-500">
                            {f.composite_score.toFixed(0)}
                          </div>
                          <div className="text-[9px] text-gray-400">Score</div>
                        </div>
                      </div>

                      <i
                        className={`ri-arrow-down-s-line text-[16px] text-gray-300 transition-transform duration-200 flex-none ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="ml-[36px] mr-[12px] mb-[8px] p-[14px] bg-gray-50 rounded-[10px] space-y-[12px]">
                        {/* Odds grid */}
                        <div>
                          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-[6px]">
                            Odds Comparison
                          </div>
                          <div className="grid grid-cols-4 gap-[6px]">
                            {(["home", "draw", "away"] as const).map((sel) => (
                              <div key={sel} className="bg-white rounded-[8px] p-[10px] text-center">
                                <div className="text-[9px] text-gray-400 uppercase mb-[2px]">{sel}</div>
                                <div className="text-[14px] font-bold font-mono text-[#0A0F1C]">
                                  {f.odds[sel] > 0 ? f.odds[sel].toFixed(2) : "—"}
                                </div>
                                <div className="text-[9px] text-gray-400">
                                  {(f.odds.implied_probs[sel] * 100).toFixed(1)}%
                                </div>
                              </div>
                            ))}
                            <div className="bg-white rounded-[8px] p-[10px] text-center">
                              <div className="text-[9px] text-gray-400 uppercase mb-[2px]">Overround</div>
                              <div className="text-[14px] font-bold font-mono text-[#0A0F1C]">
                                {(f.odds.overround * 100).toFixed(1)}%
                              </div>
                              <div className="text-[9px] text-gray-400">
                                {f.odds.bookmaker_count} bookmakers
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* CLV summary */}
                        {f.clv && (
                          <div>
                            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-[4px]">
                              CLV Signal
                            </div>
                            <div className="flex items-center gap-[12px]">
                              <span className="text-[11px] font-mono text-[#0A0F1C]">
                                Sharpest: <strong>{f.clv.sharpest_side || "none"}</strong>
                              </span>
                              <span className="text-[11px] font-mono text-[#0A0F1C]">
                                Consensus:{" "}
                                <strong>{((f.clv.consensus_strength || 0) * 100).toFixed(0)}%</strong>
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Lineup summary */}
                        {f.lineup && (
                          <div>
                            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-[4px]">
                              Lineup
                            </div>
                            <div className="flex items-center gap-[12px]">
                              <span className="text-[11px] font-mono text-[#0A0F1C]">
                                {f.home.short}: <strong>{f.lineup.home.formation}</strong> ({f.lineup.home.strength_pct}%)
                              </span>
                              <span className="text-[11px] font-mono text-[#0A0F1C]">
                                {f.away.short}: <strong>{f.lineup.away.formation}</strong> ({f.lineup.away.strength_pct}%)
                              </span>
                            </div>
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
      </Card>

      {/* ─── PIPELINE STATUS ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px] mb-[20px]">
        <Card>
          <CardHeader title="Pipeline Status" description="Pre-match update pipeline state" />
          <div className="p-[16px] space-y-[8px]">
            <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
              <span className="text-[12px] text-gray-500">Last Run</span>
              <span className="text-[12px] font-mono font-semibold text-[#0A0F1C]">
                {pipeline.last_run
                  ? new Date(pipeline.last_run).toLocaleString()
                  : "Never"}
              </span>
            </div>
            <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
              <span className="text-[12px] text-gray-500">Total Picks</span>
              <span className="text-[12px] font-mono font-semibold text-[#0A0F1C]">
                {pipeline.total_picks || 0}
              </span>
            </div>
            <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
              <span className="text-[12px] text-gray-500">Phases Completed</span>
              <span className="text-[12px] font-mono font-semibold text-[#0A0F1C]">
                {pipeline.phases_completed || 0}
              </span>
            </div>
            {pipeline.last_results && (
              <div className="mt-[8px] pt-[8px] border-t border-gray-100">
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-[4px]">
                  Last Run Results
                </div>
                {Object.entries(pipeline.last_results).map(([key, val]: [string, any]) => (
                  <div key={key} className="flex items-center gap-[8px] py-[4px]">
                    <Badge variant={val?.success ? "success" : "danger"}>
                      {val?.success ? "✓" : "✗"}
                    </Badge>
                    <span className="text-[11px] font-semibold text-[#0A0F1C] capitalize">{key}</span>
                    {val?.error && (
                      <span className="text-[10px] text-red-500 truncate flex-1">{val.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Data Summary */}
        <Card>
          <CardHeader title="Data Coverage" description="CLV, lineups, and pipeline data" />
          <div className="p-[16px] space-y-[8px]">
            <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
              <div className="flex items-center gap-[6px]">
                <i className="ri-line-chart-line text-[14px] text-gray-400" />
                <span className="text-[12px] text-gray-500">CLV Fixtures Tracked</span>
              </div>
              <span className="text-[12px] font-mono font-semibold text-[#0A0F1C]">
                {clvSummary.total_fixtures_tracked || 0}
              </span>
            </div>
            <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
              <div className="flex items-center gap-[6px]">
                <i className="ri-line-chart-line text-[14px] text-green-400" />
                <span className="text-[12px] text-gray-500">CLV Features Computed</span>
              </div>
              <span className="text-[12px] font-mono font-semibold text-[#0A0F1C]">
                {clvSummary.total_features_computed || 0}
              </span>
            </div>
            <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
              <div className="flex items-center gap-[6px]">
                <i className="ri-team-line text-[14px] text-blue-400" />
                <span className="text-[12px] text-gray-500">Lineups Predicted</span>
              </div>
              <span className="text-[12px] font-mono font-semibold text-[#0A0F1C]">
                {data?.lineups?.total_predicted || 0}
              </span>
            </div>
            <div className="flex items-center justify-between p-[10px] bg-gray-50 rounded-[8px]">
              <div className="flex items-center gap-[6px]">
                <i className="ri-time-line text-[14px] text-amber-400" />
                <span className="text-[12px] text-gray-500">Last CLV Snapshot</span>
              </div>
              <span className="text-[11px] font-mono text-gray-500">
                {clvSummary.last_snapshot
                  ? new Date(clvSummary.last_snapshot).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* ─── HISTORICAL PICKS ─────────────────────────────── */}
      {historical.length > 0 && (
        <Card className="mb-[20px]">
          <CardHeader
            title="Recent Pipeline Picks"
            description={`Last ${historical.length} picks from the ONE GAME decision engine`}
          />
          <div className="p-[16px]">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Time</th>
                    <th className="text-left py-[8px] px-[10px] font-medium text-gray-500">Match</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Pick</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Confidence</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Odds</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Edge</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">CLV</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Score</th>
                    <th className="text-center py-[8px] px-[10px] font-medium text-gray-500">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {historical.map((h, i) => (
                    <tr
                      key={i}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                    >
                      <td className="py-[10px] px-[10px] text-gray-400 font-mono text-[10px]">
                        {h.decided_at
                          ? new Date(h.decided_at).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="py-[10px] px-[10px] font-semibold text-[#0A0F1C]">
                        {h.match || "—"}
                      </td>
                      <td className="text-center py-[10px] px-[10px] capitalize">
                        <span className="font-mono text-[#0A0F1C]">
                          {h.bestPrediction?.selection}
                        </span>
                        <span className="text-gray-400 ml-[4px]">
                          {h.bestPrediction?.market?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="text-center py-[10px] px-[10px]">
                        <TierBadge tier={h.confidenceTier || "MEDIUM"} />
                      </td>
                      <td className="text-center py-[10px] px-[10px] font-mono font-semibold text-[#0A0F1C]">
                        {h.odds?.selection > 0 ? h.odds.selection.toFixed(2) : "—"}
                      </td>
                      <td className="text-center py-[10px] px-[10px]">
                        <span
                          className={`font-mono font-semibold ${
                            (h.odds?.edge || 0) > 0.02 ? "text-green-600" : "text-gray-400"
                          }`}
                        >
                          {h.odds?.edge > 0 ? "+" : ""}
                          {((h.odds?.edge || 0) * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-center py-[10px] px-[10px] text-gray-400 font-mono text-[10px]">
                        {h.clv?.sharpMoney || "none"}
                      </td>
                      <td className="text-center py-[10px] px-[10px] font-mono text-[#0A0F1C]">
                        {h.compositeScore?.toFixed(0) || "—"}
                      </td>
                      <td className="text-center py-[10px] px-[10px]">
                        <DecisionBadge decision={h.decision || "WATCH"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
