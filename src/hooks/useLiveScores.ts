"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

interface LiveFixture {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  updated_at: string;
}

interface UseLiveScoresOptions {
  fixtureIds?: string[];
  enabled?: boolean;
}

/**
 * Subscribe to real-time fixture score updates via Supabase Realtime.
 * Returns a map of fixture ID → latest score data.
 */
export function useLiveScores(options: UseLiveScoresOptions = {}) {
  const { fixtureIds, enabled = true } = options;
  const [scores, setScores] = useState<Map<string, LiveFixture>>(new Map());
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<any>(null);

  const handleScoreUpdate = useCallback((payload: Record<string, unknown>) => {
    const newRecord = payload.new as LiveFixture;
    if (!newRecord?.id) return;

    setScores((prev) => {
      const next = new Map(prev);
      next.set(newRecord.id, {
        id: newRecord.id,
        status: newRecord.status,
        home_score: newRecord.home_score,
        away_score: newRecord.away_score,
        updated_at: newRecord.updated_at,
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();

    // Subscribe to all fixture changes (INSERT, UPDATE, DELETE)
    const channel = supabase
      .channel("fixtures-live")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "fixtures",
        },
        handleScoreUpdate
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fixtures",
        },
        handleScoreUpdate
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setConnected(false);
    };
  }, [enabled, handleScoreUpdate]);

  // Get score for a specific fixture
  const getScore = useCallback(
    (fixtureId: string): LiveFixture | null => {
      return scores.get(fixtureId) || null;
    },
    [scores]
  );

  // Check if a fixture is live
  const isLive = useCallback(
    (fixtureId: string): boolean => {
      const score = scores.get(fixtureId);
      return score ? ["live", "halftime"].includes(score.status) : false;
    },
    [scores]
  );

  return {
    scores,
    connected,
    getScore,
    isLive,
  };
}

/**
 * Hook to subscribe to a single fixture's live updates.
 * Useful for the MatchDetail page.
 */
export function useLiveFixture(fixtureId: string, enabled = true) {
  const [fixture, setFixture] = useState<LiveFixture | null>(null);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (!enabled || !fixtureId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`fixture-${fixtureId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "fixtures",
          filter: `id=eq.${fixtureId}`,
        },
        (payload) => {
          const newRecord = payload.new as LiveFixture;
          setFixture({
            id: newRecord.id,
            status: newRecord.status,
            home_score: newRecord.home_score,
            away_score: newRecord.away_score,
            updated_at: newRecord.updated_at,
          });
        }
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setConnected(false);
    };
  }, [fixtureId, enabled]);

  return { fixture, connected };
}
