/**
 * GET /api/v1/ticket-of-the-day
 *
 * The daily high-confidence multi-leg accumulator ("Ticket of the Day").
 * Runs src/lib/tickets/ticket-of-day.ts over the same candidate pipeline
 * as the rollover recommendation and persists ONE row per UTC date in
 * `daily_tickets` — including honest abstentions — so a public track
 * record accumulates over time.
 *
 * Auth: required (any authenticated user). Rate limited per user.
 *
 * Query params:
 *   - date:  YYYY-MM-DD — ticket date / target day (UTC). Default: today.
 *   - hours: look-ahead window in hours when `date` is omitted (default 48,
 *            clamped 1–168)
 *
 * Persistence rules: a row is generated when none exists for ticket_date,
 * or the existing row is still result='pending' and was last generated
 * more than 2h ago (freshness regeneration). Otherwise the stored row is
 * returned as-is.
 *
 * Response shape (successResponse wrapper → { success, data }):
 * {
 *   date: string,                     // ticket_date (UTC)
 *   window: { from: string, to: string },
 *   status: "qualified" | "abstained",
 *   ticket: {                         // null on abstained days
 *     id, legs: [{fixtureId, fixtureLabel, kickoffTime, market,
 *                 selection, modelProbability, odds, bookmaker,
 *                 predictionId}],
 *     legCount, combinedOdds, combinedProbability, combinedEv,
 *   } | null,
 *   abstention: { reason, closestMiss } | null,
 *   stats: { fixturesConsidered, candidatesWithOdds, combinationsEvaluated,
 *            qualifiedCount },
 *   trackRecord: { total, won, lost, void, pending, hitRatePct },
 *   generatedAt: string,
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  requireAuth,
  checkRateLimit,
  addRateLimitHeaders,
  internalError,
  badRequest,
  successResponse,
  AuthError,
} from "@/lib/api/utils";
import { fetchRolloverCandidates } from "@/lib/rollover/candidates";
import {
  selectDailyTicket,
  DailyTicketClosestMiss,
} from "@/lib/tickets/ticket-of-day";
import { featureGateResponse } from "@/lib/subscription/entitlements";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Regenerate a still-pending row only when it is older than this. */
const REGENERATE_AFTER_MS = 2 * 60 * 60 * 1000;
/** Track-record lookback window (days of ticket_date rows). */
const TRACK_RECORD_DAYS = 365;

interface DailyTicketLeg {
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

interface DailyTicketRow {
  id: string;
  ticket_date: string;
  status: "qualified" | "abstained";
  legs: DailyTicketLeg[] | null;
  combined_odds: number | string | null;
  combined_probability: number | string | null;
  combined_ev: number | string | null;
  leg_count: number | null;
  decision_reason: string | null;
  closest_miss: DailyTicketClosestMiss | null;
  result: "pending" | "won" | "lost" | "void" | "partial";
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Serialize a persisted row into the API response shape. */
function serializeTicket(row: DailyTicketRow) {
  if (row.status !== "qualified") return null;
  return {
    id: row.id,
    legs: Array.isArray(row.legs) ? row.legs : [],
    legCount: row.leg_count ?? (Array.isArray(row.legs) ? row.legs.length : 0),
    combinedOdds: row.combined_odds != null ? Number(row.combined_odds) : null,
    // Stored combined_probability/combined_ev are the correlation-adjusted
    // (gated) values — see migration column comments.
    combinedProbability:
      row.combined_probability != null ? Number(row.combined_probability) : null,
    combinedEv: row.combined_ev != null ? Number(row.combined_ev) : null,
  };
}

/** Build the track-record summary from settled daily_tickets rows. */
async function fetchTrackRecord() {
  // daily_tickets is not yet in generated Database types — cast the client
  // for this table only (same pattern as rollover_rejections).
  const { data, error } = await (supabaseAdmin as any)
    .from("daily_tickets")
    .select("result, ticket_date")
    .order("ticket_date", { ascending: false })
    .limit(TRACK_RECORD_DAYS);
  if (error) {
    console.error("[TICKET] track record query failed:", error.message);
    return { total: 0, won: 0, lost: 0, void: 0, pending: 0, hitRatePct: null as number | null };
  }
  const rec = { total: 0, won: 0, lost: 0, void: 0, pending: 0, partial: 0 };
  for (const r of data ?? []) {
    rec.total++;
    const res = r.result as keyof typeof rec | undefined;
    if (res && res in rec) rec[res]++;
    else rec.pending++;
  }
  const decided = rec.won + rec.lost;
  return {
    total: rec.total,
    won: rec.won,
    lost: rec.lost,
    void: rec.void,
    pending: rec.pending + rec.partial,
    hitRatePct: decided > 0 ? Math.round((rec.won / decided) * 1000) / 10 : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);

    // Same entitlement family as the rollover engine it reuses.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("subscription_tier")
      .eq("id", user.id)
      .maybeSingle();
    const gate = featureGateResponse(profile?.subscription_tier, "rollover");
    if (!gate.allowed) {
      return NextResponse.json({ success: false, ...gate.body }, { status: gate.status });
    }

    const rl = checkRateLimit(`ticket-of-day:${user.id}`, request, 30, 60_000);
    if (!rl.allowed) {
      return addRateLimitHeaders(
        NextResponse.json({ success: false, error: "Rate limit exceeded" }, { status: 429 }),
        rl.remaining,
        rl.resetAt
      );
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    const hoursParam = parseInt(searchParams.get("hours") || "48", 10);

    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return badRequest("date must be YYYY-MM-DD");
    }
    const hours = Number.isFinite(hoursParam) ? Math.min(Math.max(hoursParam, 1), 168) : 48;

    // ticket_date is always a UTC calendar date; the fixture window is the
    // requested day when `date` is given, else the next `hours` hours.
    const ticketDate = dateParam || new Date().toISOString().slice(0, 10);
    let windowFrom: Date;
    let windowTo: Date;
    if (dateParam) {
      windowFrom = new Date(`${dateParam}T00:00:00.000Z`);
      windowTo = new Date(`${dateParam}T23:59:59.999Z`);
    } else {
      windowFrom = new Date();
      windowTo = new Date(Date.now() + hours * 60 * 60 * 1000);
    }

    // ── Persistence: reuse a fresh/settled row, regenerate stale pending ──
    const ticketsTable = (supabaseAdmin as any).from("daily_tickets");
    const { data: existingRaw, error: existingErr } = await ticketsTable
      .select("*")
      .eq("ticket_date", ticketDate)
      .maybeSingle();
    if (existingErr) {
      console.error("[TICKET] daily_tickets lookup failed:", existingErr.message);
    }
    const existing = existingRaw as DailyTicketRow | null;

    const generatedAtMs = existing
      ? new Date(existing.updated_at || existing.created_at).getTime()
      : 0;
    const isStalePending =
      existing?.result === "pending" &&
      Date.now() - generatedAtMs > REGENERATE_AFTER_MS;

    let row: DailyTicketRow | null = existing;
    let runStats:
      | {
          fixturesConsidered: number;
          candidatesWithOdds: number;
          combinationsEvaluated: number;
          qualifiedCount: number;
        }
      | undefined;
    let runAbstention:
      | { reason: string; closestMiss: DailyTicketClosestMiss | null }
      | null
      | undefined;

    if (existing && !isStalePending) {
      // Fresh or settled row — serve it verbatim (no regeneration).
    } else {
      // Generate (or regenerate) the day's ticket.
      let bundle;
      try {
        bundle = await fetchRolloverCandidates(windowFrom, windowTo);
      } catch (fetchErr) {
        console.error("[TICKET] candidate fetch failed:", fetchErr);
        return internalError("Failed to load fixtures");
      }

      const selection = selectDailyTicket(bundle.candidates);

      const legs: DailyTicketLeg[] =
        selection.status === "qualified"
          ? selection.ticket.legs.map((l) => ({
              fixtureId: l.fixtureId,
              fixtureLabel: l.fixtureLabel,
              kickoffTime: l.kickoffTime,
              market: l.market,
              selection: l.selection,
              modelProbability: l.modelProbability,
              odds: l.odds,
              bookmaker: l.bookmaker ?? null,
              predictionId: l.sourceId ?? null,
            }))
          : [];

      const ticket = selection.status === "qualified" ? selection.ticket : null;
      const upsertRow = {
        ticket_date: ticketDate,
        status: selection.status,
        legs,
        combined_odds: ticket?.combinedOdds ?? null,
        // combined_probability / combined_ev store the correlation-adjusted
        // (gated) values — the honest numbers the confidence bar used.
        combined_probability: ticket?.adjustedProbability ?? null,
        combined_ev: ticket?.adjustedEv ?? null,
        leg_count: ticket?.legCount ?? 0,
        decision_reason:
          selection.status === "qualified"
            ? `${ticket!.legCount}-leg ticket @ ${ticket!.combinedOdds.toFixed(2)} — adjusted probability ${(ticket!.adjustedProbability * 100).toFixed(1)}%, EV ${(ticket!.adjustedEv * 100).toFixed(1)}%`
            : selection.reason,
        closest_miss:
          selection.closestMiss != null
            ? (selection.closestMiss as unknown as Record<string, unknown>)
            : null,
        updated_at: new Date().toISOString(),
      };

      const { data: upsertedRaw, error: upsertErr } = await ticketsTable
        .upsert(upsertRow, { onConflict: "ticket_date" })
        .select("*")
        .single();

      if (upsertErr) {
        // Persistence failure must not break the response — fall back to
        // an unpersisted payload built from the selection.
        console.error("[TICKET] daily_tickets upsert failed:", upsertErr.message);
        row = {
          id: `ephemeral-${ticketDate}`,
          ticket_date: ticketDate,
          status: selection.status,
          legs,
          combined_odds: ticket?.combinedOdds ?? null,
          combined_probability: ticket?.adjustedProbability ?? null,
          combined_ev: ticket?.adjustedEv ?? null,
          leg_count: ticket?.legCount ?? 0,
          decision_reason: upsertRow.decision_reason,
          closest_miss: selection.closestMiss ?? null,
          result: "pending",
          settled_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        row = upsertedRaw as DailyTicketRow;
      }

      // Stats/abstention from THIS run; stored-row path leaves them
      // undefined and derives abstention from persisted columns below.
      runStats = {
        fixturesConsidered: bundle.fixtures.length,
        candidatesWithOdds: bundle.candidatesWithOdds,
        combinationsEvaluated: selection.stats.combinationsEvaluated,
        qualifiedCount: selection.stats.qualifiedCount,
      };
      runAbstention =
        selection.status === "abstained"
          ? { reason: selection.reason, closestMiss: selection.closestMiss }
          : null;
    }

    const trackRecord = await fetchTrackRecord();

    // When serving a stored row we didn't regenerate, derive abstention
    // from the persisted columns.
    const abstention =
      runAbstention !== undefined
        ? runAbstention
        : row && row.status === "abstained"
          ? {
              reason: row.decision_reason ?? "No ticket today.",
              closestMiss: row.closest_miss,
            }
          : null;

    const stats = runStats ?? {
            fixturesConsidered: 0,
            candidatesWithOdds: 0,
            combinationsEvaluated: 0,
            qualifiedCount: row?.leg_count ?? 0,
          };

    return successResponse({
      date: ticketDate,
      window: { from: windowFrom.toISOString(), to: windowTo.toISOString() },
      status: row?.status ?? "abstained",
      ticket: row ? serializeTicket(row) : null,
      abstention: row?.status === "qualified" ? null : abstention,
      stats,
      trackRecord,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    console.error("[TICKET] ticket-of-the-day failed:", error);
    return internalError("Ticket of the day failed");
  }
}
