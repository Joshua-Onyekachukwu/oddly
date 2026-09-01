-- ============================================
-- DAILY REFRESH MATERIALIZED VIEWS
-- Uses pg_cron to refresh analytics views daily.
-- Safe to run multiple times (idempotent).
--
-- If pg_cron is not available, this will
-- gracefully skip (views are still refreshed
-- by the learn cron on Sundays).
-- ============================================

-- Step 1: Enable pg_cron extension (if available)
DO $fn$
BEGIN
  -- Check if pg_cron is already installed
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron already enabled';
  ELSE
    -- Try to create it
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
      RAISE NOTICE 'pg_cron enabled successfully';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron not available: %. Views will be refreshed by the learn cron instead.', SQLERRM;
      RETURN;
    END;
  END IF;
END;
$fn$;

-- Step 2: Schedule daily refresh at 4:00 AM UTC
-- Refreshes all 9 materialized views
DO $fn$
BEGIN
  -- Only proceed if pg_cron is available
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not available, skipping job creation';
    RETURN;
  END IF;

  -- Remove existing job if present (idempotent)
  PERFORM cron.unschedule('refresh-analytics-views-daily');

  -- Create daily refresh job at 4:00 AM UTC
  PERFORM cron.schedule(
    'refresh-analytics-views-daily',
    '0 4 * * *',
    $sql$
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_calibration_buckets;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_market_accuracy;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_accuracy;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_model_accuracy;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_settlement_summary;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_performance;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_probability_buckets;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_trend;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cron_status;
    $sql$
  );

  RAISE NOTICE 'Scheduled daily refresh at 04:00 UTC (job: refresh-analytics-views-daily)';
END;
$fn$;

-- Step 3: Schedule draw views refresh every 6 hours (more frequent)
DO $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  PERFORM cron.unschedule('refresh-draw-views-6h');

  PERFORM cron.schedule(
    'refresh-draw-views-6h',
    '0 */6 * * *',
    $sql$
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_performance;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_probability_buckets;
      REFRESH MATERIALIZED VIEW CONCURRENTLY mv_draw_trend;
    $sql$
  );

  RAISE NOTICE 'Scheduled draw views refresh every 6 hours (job: refresh-draw-views-6h)';
END;
$fn$;

-- Step 4: Verify scheduled jobs
DO $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Active pg_cron jobs:';
    -- cron.job table contains the schedules
  ELSE
    RAISE NOTICE 'pg_cron not available. Use Vercel crons + learn cron for view refresh.';
  END IF;
END;
$fn$;
