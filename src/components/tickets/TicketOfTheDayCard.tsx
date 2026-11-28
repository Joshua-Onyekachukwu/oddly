"use client";

/**
 * "Today's High-Confidence Ticket" card — GET /api/v1/ticket-of-the-day.
 *
 * Shows the single daily multi-leg accumulator when one clears the
 * confidence bar, or an honest abstention message (with the closest
 * near-miss) when nothing does. Includes the settled track record.
 */

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { Card, Badge } from "@/components/ui";
import { BettingTooltip, getMarketLabel, getSelectionLabel } from "@/components/ui/BettingTooltip";

interface TicketLeg {
  fixtureId: string;
  fixtureLabel?: string;
  kickoffTime?: string;
  market: string;
  selection: string;
  modelProbability: number;
  odds: number;
  bookmaker?: string | null;
  predictionId?: string | null;
}

interface TicketPayload {
  id: string;
  legs: TicketLeg[];
  legCount: number;
  combinedOdds: number | null;
  combinedProbability: number | null;
  combinedEv: number | null;
}

interface ClosestMiss {
  legCount: number;
  combinedOdds: number;
  adjustedProbability: number;
  gateFailed: string;
  summary: string;
}

interface TicketOfTheDayResponse {
  date: string;
  window: { from: string; to: string };
  status: "qualified" | "abstained";
  ticket: TicketPayload | null;
  abstention: { reason: string; closestMiss: ClosestMiss | null } | null;
  stats: {
    fixturesConsidered: number;
    candidatesWithOdds: number;
    combinationsEvaluated: number;
    qualifiedCount: number;
  };
  trackRecord: {
    total: number;
    won: number;
    lost: number;
    void: number;
    pending: number;
    hitRatePct: number | null;
  };
  generatedAt: string;
}

// Canonical engine market keys → BettingTooltip glossary keys
const MARKET_TERMS: Record<string, string> = {
  "1x2": "1X2", h2h: "1X2",
  ou: "OU", over_under: "OU", totals: "OU", total_goals: "OU",
  btts: "BTTS", both_teams_to_score: "BTTS",
  dc: "DC", double_chance: "DC",
  dnb: "DNB", draw_no_bet: "DNB",
  homegoals: "HomeGoals", home_goals: "HomeGoals",
  awaygoals: "AwayGoals", away_goals: "AwayGoals",
};

const SELECTION_TERMS: Record<string, string> = {
  home: "Home", away: "Away", draw: "Draw",
  "1x": "1X", x2: "X2", "12": "12",
  yes: "Yes", no: "No",
  home_dnb: "Home_DNB", away_dnb: "Away_DNB",
};

function marketDisplay(market: string): { term: string; label: string } {
  const key = (market || "").toLowerCase();
  const term = MARKET_TERMS[key] ?? market;
  return { term, label: getMarketLabel(term) };
}

function selectionDisplay(selection: string): { term: string; label: string } {
  const s = (selection || "").trim();
  const term = SELECTION_TERMS[s.toLowerCase()] ?? s
    .split("_")
    .map((seg) => (/^[a-z]+$/.test(seg) ? seg[0].toUpperCase() + seg.slice(1) : seg))
    .join("_");
  return { term, label: getSelectionLabel(term) };
}

function formatKickoff(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TicketOfTheDayCard() {
  const { session } = useAuth();
  const [data, setData] = useState<TicketOfTheDayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTicket = useCallback(async () => {
    if (!session?.access_token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/ticket-of-the-day", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        const msg =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          `Request failed (${res.status})`;
        throw new Error(msg);
      }
      setData(json.data as TicketOfTheDayResponse);
    } catch (err) {
      console.error("Failed to load ticket of the day:", err);
      setError(err instanceof Error ? err.message : "Failed to load ticket");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  const track = data?.trackRecord;
  const settled = track ? track.won + track.lost + track.void : 0;

  return (
    <Card className="mb-[20px]">
      <div className="flex items-center justify-between mb-[4px]">
        <div>
          <div className="flex items-center gap-[8px]">
            <h2 className="text-[14px] font-display font-bold text-[#0A0F1C]">
              Today&apos;s High-Confidence Ticket
            </h2>
            {data && (
              <Badge variant={data.status === "qualified" ? "success" : "default"} size="sm">
                {data.status === "qualified" ? "QUALIFIED" : "NO TICKET"}
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-gray-400">
            One daily accumulator — only issued when the combined win probability clears the bar
          </p>
        </div>
        <button
          onClick={fetchTicket}
          disabled={loading}
          aria-label="Refresh ticket of the day"
          className="flex items-center gap-[4px] px-[10px] py-[5px] text-[11px] font-medium text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-[6px] transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
        >
          <i className={`ri-refresh-line text-[13px] ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-[8px] mt-[12px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[56px] bg-gray-50 rounded-[10px] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="mt-[12px] flex items-center justify-between gap-[12px] p-[12px] bg-red-50 border border-red-100 rounded-[10px]">
          <div className="flex items-center gap-[8px]">
            <i className="ri-error-warning-line text-[16px] text-red-400" />
            <span className="text-[12px] text-red-600">{error}</span>
          </div>
          <button
            onClick={fetchTicket}
            className="flex-none text-[11px] font-semibold text-red-600 bg-white border border-red-200 px-[10px] py-[4px] rounded-[6px] hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="mt-[12px] p-[16px] bg-gray-50 rounded-[10px] text-center">
          <p className="text-[12px] text-gray-400">Sign in to see today&apos;s ticket.</p>
        </div>
      ) : data.status === "qualified" && data.ticket ? (
        <div className="mt-[12px]">
          {/* Ticket summary */}
          <div className="flex items-center justify-between mb-[8px]">
            <div className="flex items-center gap-[8px]">
              <Badge variant="success" size="sm">
                {data.ticket.legCount} leg{data.ticket.legCount === 1 ? "" : "s"}
              </Badge>
              <span className="text-[15px] font-mono-data font-bold text-[#0A0F1C]">
                @{data.ticket.combinedOdds?.toFixed(2)}
              </span>
            </div>
            <div className="text-right text-[10px] text-gray-400">
              <span className="font-mono-data text-green-600 font-medium">
                {data.ticket.combinedProbability != null &&
                  `${(data.ticket.combinedProbability * 100).toFixed(1)}% win prob`}
              </span>
              {data.ticket.combinedEv != null && (
                <>
                  <span className="mx-[4px]">·</span>
                  <span className="font-mono-data">
                    EV {(data.ticket.combinedEv * 100).toFixed(1)}%
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Legs */}
          <div className="divide-y divide-gray-100">
            {data.ticket.legs.map((leg, idx) => {
              const market = marketDisplay(leg.market);
              const selection = selectionDisplay(leg.selection);
              const kickoff = formatKickoff(leg.kickoffTime);
              return (
                <div
                  key={`${leg.fixtureId}-${leg.market}-${leg.selection}-${idx}`}
                  className="flex items-center justify-between gap-[10px] py-[7px]"
                >
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-[#0A0F1C] truncate">
                      {leg.fixtureLabel ?? leg.fixtureId}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-[1px]">
                      {kickoff && <span>{kickoff} · </span>}
                      <BettingTooltip term={market.term}>{market.label}</BettingTooltip>
                      {" · "}
                      <BettingTooltip term={selection.term}>
                        {selection.label}
                      </BettingTooltip>
                      {leg.bookmaker && <span> · {leg.bookmaker}</span>}
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <span className="text-[12px] font-mono-data font-semibold text-[#0A0F1C]">
                      @{leg.odds.toFixed(2)}
                    </span>
                    <span className="block text-[10px] text-gray-400 font-mono-data">
                      {(leg.modelProbability * 100).toFixed(0)}% model
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-[12px] p-[16px] bg-gray-50 rounded-[10px]">
          <div className="flex items-start gap-[8px]">
            <i className="ri-shield-check-line text-[18px] text-gray-300 flex-none mt-[1px]" />
            <div>
              <p className="text-[13px] font-semibold text-[#0A0F1C] mb-[2px]">
                No ticket today — nothing cleared the confidence bar
              </p>
              <p className="text-[11px] text-gray-400">
                {data.abstention?.reason ||
                  "The model found no combination of upcoming picks that reached the minimum combined win probability."}
              </p>
              {data.abstention?.closestMiss && (
                <p className="text-[10px] text-gray-300 mt-[4px]">
                  Closest miss: {data.abstention.closestMiss.summary}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Track record + scan transparency */}
      {data && !loading && !error && (
        <p className="text-[10px] text-gray-300 mt-[10px]">
          {track && track.total > 0 ? (
            <>
              Track record: {track.won}W / {track.lost}L
              {track.void > 0 && ` / ${track.void} void`}
              {track.pending > 0 && ` · ${track.pending} pending`}
              {track.hitRatePct != null && ` · ${track.hitRatePct}% hit rate`}
              {" · "}
            </>
          ) : null}
          Scanned {data.stats.fixturesConsidered} fixtures ·{" "}
          {data.stats.candidatesWithOdds} with odds ·{" "}
          {data.stats.combinationsEvaluated} combinations evaluated
        </p>
      )}
    </Card>
  );
}
