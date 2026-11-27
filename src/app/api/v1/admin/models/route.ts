/**
 * GET /api/v1/admin/models
 *
 * Model observability snapshot for /admin/models:
 *   - weightConfigs:   model_weight_config rows (weights + recalibration jsonb)
 *   - performance:     model_performance aggregated per market
 *   - drift:           latest model_drift_status rows
 *   - gates:           latest league_model_gates verdicts (market = 'ALL')
 *   - gateSummary / driftSummary: verdict/status counts
 *
 * Read-only. Admin only — model_weight_config is service-role managed
 * under RLS, so this uses the service-role client throughout.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  successResponse,
  requireAdmin,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:models:${user.id}`, request, 60, 60000);

    const [weightsRes, perfRes, driftRes, gatesRes] = await Promise.all([
      supabaseAdmin
        .from("model_weight_config")
        .select("*")
        .order("trained_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("model_performance")
        .select("model_version, market, total_predictions, correct_predictions, brier_score, roi, created_at")
        .order("created_at", { ascending: false })
        .limit(2000),
      // Untyped tables (added post-types-generation) — cast rows below.
      (supabaseAdmin as any)
        .from("model_drift_status")
        .select("*")
        .order("computed_at", { ascending: false })
        .limit(500),
      (supabaseAdmin as any)
        .from("league_model_gates")
        .select("*")
        .eq("market", "ALL")
        .order("computed_at", { ascending: false })
        .limit(500),
    ]);

    for (const res of [weightsRes, perfRes, driftRes, gatesRes]) {
      if (res.error) {
        return internalError(`Database query failed: ${res.error.message}`);
      }
    }

    // model_weight_config Row type predates the recalibration/updated_at
    // columns — pass rows through as plain records.
    const weightConfigs = ((weightsRes.data || []) as unknown[]).map(
      (r) => r as Record<string, unknown>
    );

    // Aggregate model_performance per (model_version, market)
    const perfMap = new Map<
      string,
      {
        model_version: string;
        market: string | null;
        total_predictions: number;
        correct_predictions: number;
        brier_score_sum: number;
        brier_count: number;
        roi_sum: number;
        roi_count: number;
        evaluations: number;
        last_evaluated: string;
      }
    >();
    for (const p of perfRes.data || []) {
      const key = `${p.model_version}::${p.market ?? "ALL"}`;
      const agg = perfMap.get(key) || {
        model_version: p.model_version,
        market: p.market,
        total_predictions: 0,
        correct_predictions: 0,
        brier_score_sum: 0,
        brier_count: 0,
        roi_sum: 0,
        roi_count: 0,
        evaluations: 0,
        last_evaluated: p.created_at,
      };
      agg.total_predictions += p.total_predictions || 0;
      agg.correct_predictions += p.correct_predictions || 0;
      if (p.brier_score != null) {
        agg.brier_score_sum += p.brier_score;
        agg.brier_count += 1;
      }
      if (p.roi != null) {
        agg.roi_sum += p.roi;
        agg.roi_count += 1;
      }
      agg.evaluations += 1;
      if (p.created_at > agg.last_evaluated) agg.last_evaluated = p.created_at;
      perfMap.set(key, agg);
    }
    const performance = Array.from(perfMap.values())
      .map((a) => ({
        ...a,
        accuracy:
          a.total_predictions > 0
            ? (a.correct_predictions / a.total_predictions) * 100
            : null,
        avg_brier_score:
          a.brier_count > 0 ? a.brier_score_sum / a.brier_count : null,
        avg_roi: a.roi_count > 0 ? a.roi_sum / a.roi_count : null,
      }))
      .sort((a, b) => b.total_predictions - a.total_predictions);

    // Latest drift row per model_version+market
    const driftSeen = new Set<string>();
    const drift = ((driftRes.data || []) as Record<string, any>[]).filter((r) => {
      const key = `${r.model_version}::${r.market}`;
      if (driftSeen.has(key)) return false;
      driftSeen.add(key);
      return true;
    });
    const driftSummary = drift.reduce<Record<string, number>>((acc, r) => {
      acc[r.drift_status] = (acc[r.drift_status] ?? 0) + 1;
      return acc;
    }, {});

    // Latest gate verdict per league_key (market = 'ALL' already filtered)
    const gateSeen = new Set<string>();
    const gates = ((gatesRes.data || []) as Record<string, any>[]).filter((r) => {
      if (gateSeen.has(r.league_key)) return false;
      gateSeen.add(r.league_key);
      return true;
    });
    const gateSummary = gates.reduce<Record<string, number>>((acc, r) => {
      acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
      return acc;
    }, {});

    const response = successResponse({
      weightConfigs,
      performance,
      drift,
      driftSummary,
      gates,
      gateSummary,
    });
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error) {
      const authErr = error as { code: string; message: string; status: number };
      if (authErr.code === "FORBIDDEN") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("FORBIDDEN", authErr.message, 403);
      }
      if (authErr.code === "UNAUTHORIZED") {
        const { errorResponse } = await import("@/lib/api/utils");
        return errorResponse("UNAUTHORIZED", authErr.message, 401);
      }
    }
    console.error("GET /api/v1/admin/models error:", error);
    return internalError();
  }
}
