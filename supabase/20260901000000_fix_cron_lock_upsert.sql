-- ============================================================
-- FIX: acquire_cron_lock duplicate key error
-- 
-- Problem: cron_locks has job_name as PRIMARY KEY. After a lock
-- is released (released_at set), the next acquire() tries INSERT
-- which fails with "duplicate key value violates unique constraint"
--
-- Fix: Use INSERT ... ON CONFLICT DO UPDATE (UPSERT) so re-acquiring
-- after release properly overwrites the old row.
-- ============================================================

CREATE OR REPLACE FUNCTION acquire_cron_lock(
  p_job_name TEXT,
  p_lease_seconds INTEGER DEFAULT 600
)
RETURNS TEXT AS $fn$
DECLARE
  v_lock_id TEXT;
  v_existing RECORD;
BEGIN
  v_lock_id := p_job_name || '_' || md5(random()::text || clock_timestamp()::text);

  -- Check for existing active (unreleased) lock
  SELECT locked_by, locked_at, lease_seconds INTO v_existing
  FROM cron_locks WHERE job_name = p_job_name AND released_at IS NULL;

  IF FOUND THEN
    -- Check if lease expired (stale lock)
    IF NOW() > v_existing.locked_at + (v_existing.lease_seconds || ' seconds')::interval THEN
      -- Stale lock — overwrite with new lock (UPSERT)
      INSERT INTO cron_locks (job_name, locked_by, locked_at, lease_seconds, released_at)
      VALUES (p_job_name, v_lock_id, NOW(), p_lease_seconds, NULL)
      ON CONFLICT (job_name) DO UPDATE SET
        locked_by = v_lock_id,
        locked_at = NOW(),
        lease_seconds = p_lease_seconds,
        released_at = NULL;
      RETURN v_lock_id;
    ELSE
      -- Lock is still active — reject
      RETURN NULL;
    END IF;
  ELSE
    -- No active lock — acquire (UPSERT handles stale released locks too)
    INSERT INTO cron_locks (job_name, locked_by, locked_at, lease_seconds, released_at)
    VALUES (p_job_name, v_lock_id, NOW(), p_lease_seconds, NULL)
    ON CONFLICT (job_name) DO UPDATE SET
      locked_by = v_lock_id,
      locked_at = NOW(),
      lease_seconds = p_lease_seconds,
      released_at = NULL;
    RETURN v_lock_id;
  END IF;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also add an index to speed up the lock check query
CREATE INDEX IF NOT EXISTS idx_cron_locks_job_active
  ON cron_locks (job_name)
  WHERE released_at IS NULL;

-- Verify
SELECT 'acquire_cron_lock fixed — UPSERT prevents duplicate key errors' AS status;
