"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/providers/AuthProvider";
import {
  normalizeEntityKey,
  type FavouriteEntityType,
} from "@/lib/favourites";

interface FavouriteButtonProps {
  entityType: FavouriteEntityType;
  /** Canonical id (team/league UUID) or name (player). */
  entityId: string;
  /** Display name stored on the favourite row. */
  entityName?: string;
  className?: string;
  /** "sm" for inline use next to names, "md" for headers. */
  size?: "sm" | "md";
}

/**
 * Heart toggle for a team / league / player. Persists to user_favourites
 * via the Supabase client (RLS scopes rows to auth.uid()). Unauthenticated
 * users are sent to /login.
 */
export function FavouriteButton({
  entityType,
  entityId,
  entityName,
  className = "",
  size = "md",
}: FavouriteButtonProps) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [isFavourite, setIsFavourite] = useState(false);
  const [busy, setBusy] = useState(false);

  const entityKey = normalizeEntityKey(entityType, entityId);

  // Resolve current favourite state once auth + entity are known.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    const supabase = createClient();
    supabase
      .from("user_favourites")
      .select("id")
      .eq("user_id", user.id)
      .eq("entity_type", entityType)
      .eq("entity_key", entityKey)
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setIsFavourite((data?.length ?? 0) > 0);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, entityType, entityKey]);

  const toggle = useCallback(async () => {
    if (busy) return;

    if (!user) {
      router.push(`/login?redirect=${encodeURIComponent("/matches")}`);
      return;
    }

    const supabase = createClient();
    setBusy(true);

    try {
      if (isFavourite) {
        await supabase
          .from("user_favourites")
          .delete()
          .eq("user_id", user.id)
          .eq("entity_type", entityType)
          .eq("entity_key", entityKey);
        setIsFavourite(false);
      } else {
        await supabase.from("user_favourites").upsert(
          {
            user_id: user.id,
            entity_type: entityType,
            entity_id: entityId.trim(),
            entity_key: entityKey,
            entity_name: entityName?.trim() || null,
          },
          { onConflict: "user_id,entity_type,entity_key", ignoreDuplicates: true }
        );
        setIsFavourite(true);
      }
    } catch (err) {
      console.error("Favourite toggle failed:", err);
    } finally {
      setBusy(false);
    }
  }, [busy, user, isFavourite, entityType, entityId, entityKey, entityName, router]);

  const dim = size === "sm" ? "text-[14px]" : "text-[18px]";
  const pad = size === "sm" ? "p-[4px]" : "p-[6px]";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggle();
      }}
      disabled={busy}
      aria-pressed={isFavourite}
      aria-label={isFavourite ? `Remove ${entityName || entityType} from favourites` : `Add ${entityName || entityType} to favourites`}
      title={isFavourite ? "Remove from favourites" : "Add to favourites"}
      className={`inline-flex items-center justify-center rounded-full transition-all duration-150 ${dim} ${pad} ${
        isFavourite
          ? "text-red-500 hover:bg-red-50"
          : "text-gray-300 hover:text-red-400 hover:bg-gray-50"
      } ${busy ? "opacity-50 cursor-wait" : "cursor-pointer"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B2A4A]/30 ${className}`}
    >
      <i className={isFavourite ? "ri-heart-fill" : "ri-heart-line"} />
    </button>
  );
}
