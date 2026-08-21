-- ============================================
-- ODDLY — Idempotent Migration (safe to re-run)
-- Run this in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. DISABLE EMAIL CONFIRMATION
-- ============================================
-- This must be done via the Supabase Dashboard:
-- Go to: Authentication > Settings > Email
-- UNCHECK "Enable email confirmations"
-- Then your admin account will work immediately.

-- ============================================
-- 2. NOTIFICATION PREFERENCES (safe to re-run)
-- ============================================
DO $$ BEGIN
  ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb DEFAULT '{
    "new_picks": true,
    "crown_jewel": true,
    "match_started": true,
    "result_settled": true,
    "chain_milestone": true,
    "chain_broken": true,
    "accumulator_settled": true,
    "model_alert": true,
    "announcement": true,
    "drawdown_warning": true,
    "rollover_pick": true
  }'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================
-- 3. ENABLE REALTIME (safe to re-run)
-- ============================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE fixtures;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE fixtures REPLICA IDENTITY FULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE notifications REPLICA IDENTITY FULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ============================================
-- 4. LOGO COLUMNS (safe to re-run)
-- ============================================
DO $$ BEGIN
  ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS logo text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS logo text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS country_flag text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================
-- 5. FIX EXISTING ADMIN USER
-- ============================================
-- If admin email confirmation is blocking login, force-confirm them:
UPDATE auth.users
SET email_confirmed_at = NOW(),
    confirmed_at = NOW()
WHERE email = 'admin@oddly.ai'
  AND email_confirmed_at IS NULL;

-- Also ensure they have an admin profile:
INSERT INTO public.profiles (id, role, display_name, subscription_tier)
SELECT id, 'admin', 'Admin', 'elite'
FROM auth.users
WHERE email = 'admin@oddly.ai'
ON CONFLICT (id) DO UPDATE SET
  role = 'admin',
  subscription_tier = 'elite';

-- ============================================
-- 6. VERIFY EVERYTHING
-- ============================================
SELECT
  (SELECT count(*) FROM leagues) as total_leagues,
  (SELECT count(*) FROM leagues WHERE logo IS NOT NULL) as leagues_with_logos,
  (SELECT count(*) FROM teams) as total_teams,
  (SELECT count(*) FROM teams WHERE logo IS NOT NULL) as teams_with_logos,
  (SELECT count(*) FROM fixtures) as fixtures,
  (SELECT count(*) FROM odds_snapshots) as odds_snapshots,
  (SELECT count(*) FROM predictions) as predictions,
  (SELECT count(*) FROM recommendations) as recommendations,
  (SELECT count(*) FROM profiles) as profiles,
  (SELECT count(*) FROM profiles WHERE role = 'admin') as admins,
  (SELECT count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime') as realtime_tables;
