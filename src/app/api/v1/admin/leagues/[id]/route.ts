/**
 * PATCH /api/v1/admin/leagues/[id]
 *
 * Update league fields (name, country, is_active, priority) and/or the
 * tunable league_model_params coefficients consumed by the ensemble
 * model. Admin only — service-role client because leagues and
 * league_model_params are service-role-managed under RLS.
 *
 * Body (at least one field required):
 *   - name?: string
 *   - country?: string | null
 *   - is_active?: boolean
 *   - priority?: number  (display order)
 *   - model_params?: { home_advantage?, goal_expectancy?, avg_goals?,
 *       home_win_pct?, draw_pct?, avg_yellow?, avg_corners?,
 *       poisson_weight?, elo_weight?, regression_weight? }
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  successResponse,
  requireAdmin,
  notFound,
  badRequest,
  internalError,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import { leagueAdminUpdateSchema, validateBody } from "@/lib/api/validation";
import { logAdminAction } from "@/lib/admin/audit";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { user } = await requireAdmin(request);
    const rl = checkRateLimit(`admin:leagues:update:${user.id}`, request, 30, 60000);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const validation = validateBody(leagueAdminUpdateSchema, rawBody);
    if (!validation.success) {
      return badRequest("Invalid update data", { details: validation.error });
    }

    const { model_params, ...leagueFields } = validation.data;

    // Fetch the league first — needed for the model_params upsert
    // (league_model_params is keyed by league_name, not league_id) and
    // to produce a 404 instead of a silent no-op update.
    const { data: league, error: fetchError } = await supabaseAdmin
      .from("leagues")
      .select("id, name")
      .eq("id", id)
      .single();

    if (fetchError || !league) {
      return notFound("League");
    }

    let updatedLeague = league;
    const hasLeagueUpdates = Object.keys(leagueFields).length > 0;

    if (hasLeagueUpdates) {
      const leagueUpdate: Database["public"]["Tables"]["leagues"]["Update"] = {};
      if (leagueFields.name !== undefined) leagueUpdate.name = leagueFields.name;
      if (leagueFields.country !== undefined) leagueUpdate.country = leagueFields.country;
      if (leagueFields.is_active !== undefined) leagueUpdate.is_active = leagueFields.is_active;
      if (leagueFields.priority !== undefined) leagueUpdate.priority = leagueFields.priority;

      const { data, error } = await supabaseAdmin
        .from("leagues")
        .update(leagueUpdate)
        .eq("id", id)
        .select()
        .single();

      if (error || !data) {
        return internalError(`Failed to update league: ${error?.message || "unknown error"}`);
      }
      updatedLeague = data;
    }

    let paramsResult: unknown = null;
    if (model_params) {
      // league_model_params has no FK to leagues — rows are matched by
      // league_name. Update in place when a row exists, otherwise insert.
      const { data: existing } = await supabaseAdmin
        .from("league_model_params")
        .select("id")
        .eq("league_name", league.name)
        .maybeSingle();

      if (existing) {
        const { data, error } = await supabaseAdmin
          .from("league_model_params")
          .update(model_params)
          .eq("id", existing.id)
          .select()
          .single();
        if (error) {
          return internalError(`Failed to update league model params: ${error.message}`);
        }
        paramsResult = data;
      } else {
        const { data, error } = await supabaseAdmin
          .from("league_model_params")
          .insert({ league_name: league.name, ...model_params })
          .select()
          .single();
        if (error) {
          return internalError(`Failed to create league model params: ${error.message}`);
        }
        paramsResult = data;
      }
    }

    await logAdminAction(user.id, "league.update", "league", id, {
      league_updates: hasLeagueUpdates ? leagueFields : null,
      model_params: model_params ?? null,
      resulting_name: updatedLeague.name,
    });

    const response = successResponse({
      ...updatedLeague,
      model_params: paramsResult,
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
    console.error("PATCH /api/v1/admin/leagues/[id] error:", error);
    return internalError();
  }
}
