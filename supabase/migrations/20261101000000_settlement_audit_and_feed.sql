-- ============================================================
-- SETTLEMENT HARDENING (Phase 1)
-- Date: November 1, 2026
--
-- 1. settlement_events — append-only audit trail for every
--    prediction settle/correction (when, source, previous→new result).
-- 2. settlement_feed — add prediction_id natural key so writers can
--    upsert instead of delete-all + reinsert; switch retention from
--    "latest 500 rows" to 90-day history window.
-- 3. model_performance — unique natural key (model_version, market,
--    league_id) so settle/tracking can upsert instead of delete+insert.
-- ============================================================

-- ------------------------------------------------------------
-- 1. settlement_events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL,
  fixture_id UUID REFERENCES fixtures(id) ON DELETE SET NULL,
  market TEXT,
  selection TEXT,
  previous_result TEXT,
  new_result TEXT NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'unknown',
  raw_score JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_events_prediction ON settlement_events(prediction_id);
CREATE INDEX IF NOT EXISTS idx_settlement_events_fixture ON settlement_events(fixture_id);
CREATE INDEX IF NOT EXISTS idx_settlement_events_settled ON settlement_events(settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlement_events_source ON settlement_events(source, settled_at DESC);

ALTER TABLE settlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages settlement_events" ON settlement_events;
DROP POLICY IF EXISTS "Admins can read settlement_events" ON settlement_events;

-- service_role writes (and reads, for convenience); admins read-only
CREATE POLICY "Service role manages settlement_events" ON settlement_events
  FOR ALL USING (public.is_service_role());
CREATE POLICY "Admins can read settlement_events" ON settlement_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

GRANT SELECT ON settlement_events TO authenticated;
REVOKE ALL ON settlement_events FROM anon;

COMMENT ON TABLE settlement_events IS 'Append-only audit trail of prediction settlements and corrections';

-- ------------------------------------------------------------
-- 2. settlement_feed: prediction_id natural key + 90d retention
-- ------------------------------------------------------------
ALTER TABLE settlement_feed
  ADD COLUMN IF NOT EXISTS prediction_id UUID REFERENCES predictions(id) ON DELETE SET NULL;

-- Unique so writers can UPSERT on prediction_id. NULLs stay distinct,
-- so legacy rows and realtime-route inserts without a prediction_id
-- are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_feed_prediction_id_key
  ON settlement_feed(prediction_id);

-- Replace the "keep latest 500 rows" trim with a 90-day history window
-- (matches cleanup-cron retention conventions). History is preserved;
-- the feed remains bounded by age rather than count.
CREATE OR REPLACE FUNCTION trim_settlement_feed()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM settlement_feed
  WHERE settled_at < NOW() - INTERVAL '90 days';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 3. model_performance: natural-key uniqueness for upserts
-- ------------------------------------------------------------
-- Dedupe existing rows first (keep the most recently created row per
-- natural key) so the unique index can be created.
DELETE FROM model_performance mp
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY model_version, market, league_id
           ORDER BY created_at DESC NULLS LAST, id
         ) AS rn
  FROM model_performance
) ranked
WHERE mp.id = ranked.id AND ranked.rn > 1;

-- NULLS NOT DISTINCT (Postgres 15+) so league_id NULL rows collide too.
CREATE UNIQUE INDEX IF NOT EXISTS model_performance_natural_key
  ON model_performance (model_version, market, league_id) NULLS NOT DISTINCT;
