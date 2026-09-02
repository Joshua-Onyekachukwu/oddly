/**
 * POST /api/v1/betting-agent/betslip
 *
 * Builds a proposed betslip from selected value picks.
 * Validates odds, calculates risk, and generates a booking code representation.
 *
 * Body:
 *   - selections: Array of { fixtureId, match, market, selection, odds, modelProbability, edge, tier }
 *   - stake?: number (100-100000) — proposed stake in Naira (default: 1000)
 *   - bookmaker?: string — target bookmaker (default: "sportybet")
 *   - maxLegs?: number (1-10) — max accumulator legs (default: 10)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { requireAuth, checkRateLimit, addRateLimitHeaders } from "@/lib/api/utils";
import { RATE_LIMITS } from "@/lib/api/rate-limits";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Selection {
  fixtureId: string;
  match: string;
  market: string;
  selection: string;
  odds: number;
  modelProbability: number;
  edge: number;
  tier: string;
  reasoning?: string;
}

interface RiskLimit {
  maxStake: number;
  maxDailyExposure: number;
  maxBetsPerDay: number;
  minEdgeRequired: number;
}

const DEFAULT_LIMITS: RiskLimit = {
  maxStake: 10000,
  maxDailyExposure: 50000,
  maxBetsPerDay: 5,
  minEdgeRequired: 3,
};

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require authentication
    const auth = await requireAuth(request);

    // Rate limit: 20 requests per minute per user
    const rl = checkRateLimit(
      `user:${auth.user.id}:betting-agent-betslip`,
      request,
      RATE_LIMITS.bettingAgent.betslip.limit,
      RATE_LIMITS.bettingAgent.betslip.windowMs
    );
    if (!rl.allowed) {
      return addRateLimitHeaders(
        NextResponse.json({ error: "Rate limit exceeded. Try again in a minute." }, { status: 429 }),
        rl.remaining,
        rl.resetAt
      );
    }

    const body = await request.json();
    const selections: Selection[] = body.selections || [];
    const stake = Math.min(100000, Math.max(100, body.stake || 1000));
    const bookmaker = body.bookmaker || "sportybet";
    const maxLegs = Math.min(10, Math.max(1, body.maxLegs || 10));

    // ─── Validate Input ─────────────────────────────────────────
    if (!selections.length) {
      return NextResponse.json({ error: "No selections provided" }, { status: 400 });
    }

    if (selections.length > maxLegs) {
      return NextResponse.json(
        { error: `Maximum ${maxLegs} legs allowed. Got ${selections.length}.` },
        { status: 400 }
      );
    }

    // ─── Validate Odds Are Still Current ────────────────────────
    const fixtureIds = [...new Set(selections.map((s) => s.fixtureId))];
    const { data: currentOdds } = await supabaseAdmin
      .from("odds_snapshots")
      .select("fixture_id, market, selection, odds")
      .in("fixture_id", fixtureIds);

    // Build current odds map
    const currentOddsAccum: Record<string, Record<string, number[]>> = {};
    const currentOddsMap: Record<string, Record<string, number>> = {};
    for (const o of (currentOdds || []) as { fixture_id: string; market: string; selection: string; odds: number }[]) {
      if (!currentOddsAccum[o.fixture_id]) currentOddsAccum[o.fixture_id] = {};
      const key = `${o.market}|${o.selection}`;
      if (!currentOddsAccum[o.fixture_id][key]) currentOddsAccum[o.fixture_id][key] = [];
      currentOddsAccum[o.fixture_id][key].push(o.odds);
    }
    // Average
    for (const fid of Object.keys(currentOddsAccum)) {
      currentOddsMap[fid] = {};
      for (const key of Object.keys(currentOddsAccum[fid])) {
        const arr = currentOddsAccum[fid][key];
        currentOddsMap[fid][key] = arr.reduce((s: number, v: number) => s + v, 0) / arr.length;
      }
    }

    // ─── Validate Each Selection ────────────────────────────────
    const validatedSelections: Record<string, unknown>[] = [];
    const warnings: string[] = [];
    const oddsChanged: string[] = [];

    for (const sel of selections) {
      if (!sel.match || !sel.market || !sel.selection || !sel.odds) {
        warnings.push(`Skipped invalid selection: ${sel.match || "unknown"}`);
        continue;
      }

      // Check if odds have changed significantly (>10%)
      const currentKey = `${sel.market}|${sel.selection}`;
      const currentOddsForSel = currentOddsMap[sel.fixtureId]?.[currentKey];
      if (currentOddsForSel) {
        const oddsChange = Math.abs(currentOddsForSel - sel.odds) / sel.odds;
        if (oddsChange > 0.1) {
          oddsChanged.push(
            `${sel.match} ${sel.market}-${sel.selection}: odds moved from ${sel.odds} to ${currentOddsForSel.toFixed(2)}`
          );
        }
        // Use current odds
        sel.odds = currentOddsForSel;
      }

      // Check match hasn't started
      const { data: fixture } = await supabaseAdmin
        .from("fixtures")
        .select("kickoff_time, status")
        .eq("id", sel.fixtureId)
        .single();

      if (fixture) {
        if (fixture.status !== "scheduled") {
          warnings.push(`${sel.match} — match already ${fixture.status}`);
          continue;
        }
        if (new Date(fixture.kickoff_time) <= new Date()) {
          warnings.push(`${sel.match} — match has started or is about to start`);
          continue;
        }
      }

      validatedSelections.push({
        fixtureId: sel.fixtureId,
        match: sel.match,
        market: sel.market,
        selection: sel.selection,
        odds: sel.odds,
        modelProbability: sel.modelProbability,
        edge: sel.edge,
        tier: sel.tier,
        reasoning: sel.reasoning || "",
      });
    }

    if (!validatedSelections.length) {
      return NextResponse.json(
        { error: "No valid selections after validation", warnings },
        { status: 400 }
      );
    }

    // ─── Calculate Betslip Metrics ──────────────────────────────
    const combinedOdds = validatedSelections.reduce(
      (acc: number, s: Record<string, unknown>) => acc * (s.odds as number),
      1
    );
    const potentialReturn = stake * combinedOdds;
    const profit = potentialReturn - stake;
    const combinedProb = validatedSelections.reduce(
      (acc: number, s: Record<string, unknown>) => acc * ((s.modelProbability as number) / 100),
      1
    );
    const avgEdge =
      validatedSelections.reduce((s: number, v: Record<string, unknown>) => s + (v.edge as number), 0) /
      validatedSelections.length;

    const riskLevel =
      validatedSelections.length >= 8 ? "HIGH" : validatedSelections.length >= 5 ? "MEDIUM" : "LOW";

    // Kelly criterion (fractional for safety)
    const kellyStake =
      validatedSelections.length === 1
        ? Math.round(
            (stake * (validatedSelections[0].edge as number)) /
              ((validatedSelections[0].odds as number) - 1) *
              0.25
          )
        : Math.round((stake * avgEdge) / (combinedOdds - 1) * 0.25);

    // ─── Risk Assessment ────────────────────────────────────────
    const limits = DEFAULT_LIMITS;
    const risks: { level: string; message: string }[] = [];

    if (stake > limits.maxStake) {
      risks.push({ level: "BLOCK", message: `Stake ₦${stake} exceeds maximum ₦${limits.maxStake}` });
    }
    if (stake > limits.maxStake * 0.5) {
      risks.push({
        level: "WARNING",
        message: `High stake: ₦${stake} (${Math.round((stake / limits.maxStake) * 100)}% of max)`,
      });
    }
    if (riskLevel === "HIGH") {
      risks.push({
        level: "WARNING",
        message: `${validatedSelections.length} legs — higher risk of one leg failing`,
      });
    }
    if (combinedProb < 0.05) {
      risks.push({
        level: "WARNING",
        message: `Combined probability only ${(combinedProb * 100).toFixed(1)}% — very unlikely to win`,
      });
    }
    if (oddsChanged.length > 0) {
      risks.push({
        level: "INFO",
        message: `${oddsChanged.length} odds changed since selection. Please review.`,
      });
    }

    const approved = risks.filter((r) => r.level === "BLOCK").length === 0;
    const riskScore = Math.min(
      100,
      validatedSelections.length * 8 +
        (riskLevel === "HIGH" ? 30 : riskLevel === "MEDIUM" ? 15 : 0) +
        (stake > limits.maxStake * 0.7 ? 20 : 0) +
        (combinedProb < 0.1 ? 15 : 0)
    );

    // ─── Build Response ─────────────────────────────────────────
    const betslip = {
      id: `slip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      bookmaker,
      selections: validatedSelections,
      summary: {
        totalLegs: validatedSelections.length,
        combinedOdds: Math.round(combinedOdds * 100) / 100,
        stake,
        potentialReturn: Math.round(potentialReturn * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        combinedProbability: Math.round(combinedProb * 1000) / 10,
        avgEdge: Math.round(avgEdge * 100) / 10,
        riskLevel,
        kellyStake: Math.max(100, Math.min(kellyStake, stake)),
      },
      risk: {
        approved,
        riskScore,
        risks,
      },
      warnings,
      oddsChanged,
      status: approved ? "pending_review" : "blocked",
      bookingCode: null, // Would be generated via Convert Bet Codes API
      instructions: `Open ${bookmaker.charAt(0).toUpperCase() + bookmaker.slice(1)} app and add these selections manually, or use the booking code when available.`,
    };

    // ─── Audit Log ──────────────────────────────────────────────
    try {
      const authHeader = request.headers.get("authorization");
      let userId = "anonymous";
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) userId = user.id;
      }

      // Log to console since agent_audit_log may not exist in DB types yet
      console.log("[BettingAgent] Betslip created:", {
        userId,
        action: "betslip_created",
        selections: validatedSelections.length,
        bookmaker,
        stake,
        potentialReturn,
        status: approved ? "pending_review" : "blocked",
      });
    } catch (auditErr) {
      // Don't fail the request if audit logging fails
      console.error("[BettingAgent] Audit log error:", auditErr);
    }

    return NextResponse.json({ success: true, data: betslip });
  } catch (error) {
    console.error("Betting agent betslip error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
