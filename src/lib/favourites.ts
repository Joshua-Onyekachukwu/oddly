/**
 * User favourites — shared helpers.
 *
 * Storage model (user_favourites table):
 *   entity_type : 'team' | 'league' | 'player'
 *   entity_id   : canonical id — team/league UUID, or raw name for players
 *   entity_key  : normalized value used for matching + the UNIQUE constraint
 *   entity_name : display label captured when the favourite was created
 *
 * For teams and leagues the entity_id IS the UUID, so entity_key is just the
 * lowercased id. For players (no canonical id) entity_key is the normalized
 * name so "N. Fofana" and "n. fofana" dedupe to the same row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type FavouriteEntityType = "team" | "league" | "player";

export const FAVOURITE_ENTITY_TYPES: FavouriteEntityType[] = ["team", "league", "player"];

export interface Favourite {
  id: string;
  user_id: string;
  entity_type: FavouriteEntityType;
  entity_id: string;
  entity_key: string;
  entity_name: string | null;
  created_at: string;
}

type DbClient = SupabaseClient<Database>;

/**
 * Normalize an entity reference into its dedup/matching key.
 * - team/league: entity_id is a UUID (or provider id) → lowercase + trim
 * - player: entity_id is a name → lowercase, collapse whitespace, trim
 */
export function normalizeEntityKey(
  entityType: FavouriteEntityType,
  entityId: string
): string {
  const trimmed = entityId.trim().toLowerCase();
  if (entityType === "player") {
    return trimmed.replace(/\s+/g, " ");
  }
  return trimmed;
}

/** Build the insert payload for a favourite row (user_id excluded). */
export function buildFavouriteRow(input: {
  entity_type: FavouriteEntityType;
  entity_id: string;
  entity_name?: string | null;
}): { entity_type: FavouriteEntityType; entity_id: string; entity_key: string; entity_name: string | null } {
  const entityId = input.entity_id.trim();
  return {
    entity_type: input.entity_type,
    entity_id: entityId,
    entity_key: normalizeEntityKey(input.entity_type, entityId),
    entity_name: input.entity_name?.trim() || null,
  };
}

/** List a user's favourites, optionally filtered by entity_type. */
export async function listFavourites(
  supabase: DbClient,
  userId: string,
  entityType?: FavouriteEntityType
): Promise<{ data: Favourite[] | null; error: { message: string } | null }> {
  let query = supabase
    .from("user_favourites")
    .select("id, user_id, entity_type, entity_id, entity_key, entity_name, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (entityType) {
    query = query.eq("entity_type", entityType);
  }

  const { data, error } = await query;
  return {
    data: (data as Favourite[] | null) ?? null,
    error: error ? { message: error.message } : null,
  };
}

/**
 * Add a favourite. Idempotent — relies on the
 * UNIQUE(user_id, entity_type, entity_key) constraint; duplicate inserts
 * return the existing row via upsert-ignore semantics handled by callers.
 */
export async function addFavourite(
  supabase: DbClient,
  userId: string,
  input: { entity_type: FavouriteEntityType; entity_id: string; entity_name?: string | null }
): Promise<{ data: Favourite | null; error: { message: string; code?: string } | null }> {
  const row = buildFavouriteRow(input);
  const { data, error } = await supabase
    .from("user_favourites")
    .upsert({ user_id: userId, ...row }, { onConflict: "user_id,entity_type,entity_key", ignoreDuplicates: true })
    .select("id, user_id, entity_type, entity_id, entity_key, entity_name, created_at")
    .single();

  if (error) {
    // ignoreDuplicates + single() errors when the row already existed —
    // fetch it instead so callers get a consistent shape.
    if (error.code === "PGRST116" || /duplicate|unique/i.test(error.message)) {
      const existing = await supabase
        .from("user_favourites")
        .select("id, user_id, entity_type, entity_id, entity_key, entity_name, created_at")
        .eq("user_id", userId)
        .eq("entity_type", row.entity_type)
        .eq("entity_key", row.entity_key)
        .single();
      return {
        data: (existing.data as Favourite | null) ?? null,
        error: existing.error ? { message: existing.error.message } : null,
      };
    }
    return { data: null, error: { message: error.message, code: error.code } };
  }

  return { data: data as Favourite | null, error: null };
}

/** Remove a favourite by entity reference. Returns true if a row was deleted. */
export async function removeFavourite(
  supabase: DbClient,
  userId: string,
  entityType: FavouriteEntityType,
  entityId: string
): Promise<{ removed: boolean; error: { message: string } | null }> {
  const entityKey = normalizeEntityKey(entityType, entityId);
  const { data, error } = await supabase
    .from("user_favourites")
    .delete()
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_key", entityKey)
    .select("id");

  if (error) return { removed: false, error: { message: error.message } };
  return { removed: (data?.length ?? 0) > 0, error: null };
}
