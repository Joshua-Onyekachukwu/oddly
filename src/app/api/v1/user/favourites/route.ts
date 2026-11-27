/**
 * /api/v1/user/favourites
 *
 * GET    — list the authenticated user's favourites
 *          Query: ?entity_type=team|league|player (optional filter)
 * POST   — add a favourite { entity_type, entity_id, entity_name? }
 *          Idempotent: duplicates resolve to the existing row.
 * DELETE — remove a favourite ?entity_type=...&entity_id=...
 *
 * All operations are owner-scoped via requireAuth + RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  successResponse,
  createdResponse,
  noContentResponse,
  requireAuth,
  unprocessable,
  internalError,
  badRequest,
  addRateLimitHeaders,
  checkRateLimit,
} from "@/lib/api/utils";
import {
  favouriteCreateSchema,
  favouriteDeleteSchema,
  favouriteQuerySchema,
  validateBody,
  validateQuery,
} from "@/lib/api/validation";
import {
  listFavourites,
  addFavourite,
  removeFavourite,
  type FavouriteEntityType,
} from "@/lib/favourites";

function isAuthError(error: unknown): error is { code: string; message: string } {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: string }).code === "UNAUTHORIZED"
  );
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);
    const rl = checkRateLimit(`favourites:${user.id}`, request, 60, 60000);

    const validation = validateQuery(favouriteQuerySchema, new URL(request.url).searchParams);
    if (!validation.success) {
      return badRequest(`Invalid query parameters: ${validation.error}`);
    }

    const { data, error } = await listFavourites(
      supabase,
      user.id,
      validation.data.entity_type as FavouriteEntityType | undefined
    );

    if (error) {
      return internalError(`Database query failed: ${error.message}`);
    }

    const response = successResponse(data || []);
    addRateLimitHeaders(response, rl.remaining, rl.resetAt);
    return response;
  } catch (error: unknown) {
    if (isAuthError(error)) return unprocessable(error.message);
    console.error("GET /api/v1/user/favourites error:", error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = validateBody(favouriteCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid favourite data", details: validation.error },
        { status: 400 }
      );
    }

    const { data, error } = await addFavourite(supabase, user.id, validation.data);

    if (error) {
      return internalError(`Failed to save favourite: ${error.message}`);
    }

    return createdResponse(data);
  } catch (error: unknown) {
    if (isAuthError(error)) return unprocessable(error.message);
    console.error("POST /api/v1/user/favourites error:", error);
    return internalError();
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase } = await requireAuth(request);

    const validation = validateQuery(
      favouriteDeleteSchema,
      new URL(request.url).searchParams
    );
    if (!validation.success) {
      return badRequest(`Invalid query parameters: ${validation.error}`);
    }

    const { removed, error } = await removeFavourite(
      supabase,
      user.id,
      validation.data.entity_type as FavouriteEntityType,
      validation.data.entity_id!
    );

    if (error) {
      return internalError(`Failed to remove favourite: ${error.message}`);
    }

    if (!removed) {
      return unprocessable("Favourite not found");
    }

    return noContentResponse();
  } catch (error: unknown) {
    if (isAuthError(error)) return unprocessable(error.message);
    console.error("DELETE /api/v1/user/favourites error:", error);
    return internalError();
  }
}
