/**
 * DB-backed application state store.
 *
 * Replaces data/*.json files used by the cron pipeline and admin routes.
 * The filesystem is read-only on Vercel serverless, so all durable state
 * lives in the `app_state` table (key TEXT PK, value JSONB, updated_at).
 *
 * Uses the service-role client — callers must already be authorized
 * (cron secret or admin session) before calling these helpers.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseAdmin: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export const STATE_KEYS = {
  PIPELINE_STATE: "pipeline-state",
  CLV_SNAPSHOTS: "clv-snapshots",
  CLV_FEATURES: "clv-features",
  PREDICTED_LINEUPS: "predicted-lineups",
  MARKET_CONSENSUS: "market-consensus",
} as const;

/**
 * Read a JSONB state value by key.
 * Returns `fallback` when the key is missing or the read fails.
 * Returns `any` — state blobs are heterogeneous JSON documents.
 */
export async function getState(key: string, fallback: any): Promise<any> {
  try {
    const { data, error } = await supabaseAdmin
      .from("app_state")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    if (error) {
      console.error(`[STATE] Read failed for "${key}":`, error.message);
      return fallback;
    }
    if (!data || data.value === null || data.value === undefined) return fallback;
    return data.value;
  } catch (err: any) {
    console.error(`[STATE] Read exception for "${key}":`, err?.message);
    return fallback;
  }
}

/**
 * Upsert a JSONB state value by key.
 */
export async function setState(key: string, value: any): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("app_state").upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    if (error) {
      console.error(`[STATE] Write failed for "${key}":`, error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[STATE] Write exception for "${key}":`, err?.message);
    return false;
  }
}
