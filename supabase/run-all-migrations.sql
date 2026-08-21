-- ============================================
-- ODDLY — Run All Remaining Migrations
-- Run this ONCE in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. AUTO-CONFIRM USERS (no email confirmation)
-- ============================================
-- This disables email confirmation so users can sign up and use the app immediately.
-- Go to Supabase Dashboard > Authentication > Settings > Email
-- and UNCHECK "Confirm email" OR run this:

-- Note: This must be done via the Supabase Dashboard:
-- Authentication > Settings > Email > Disable "Confirm email"

-- ============================================
-- 2. NOTIFICATION PREFERENCES
-- ============================================
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

-- ============================================
-- 3. ENABLE REALTIME
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE fixtures;
ALTER TABLE fixtures REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- ============================================
-- 4. ADD LOGO COLUMNS
-- ============================================
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS logo text;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS logo text;
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS country_flag text;

-- ============================================
-- 5. CREATE ADMIN USER
-- ============================================
-- First, create the auth user via Supabase Dashboard > Auth > Users
-- Email: admin@oddly.ai
-- Password: Admin123!
-- Then run this to set the role:

-- INSERT INTO public.profiles (id, role, display_name, subscription_tier)
-- VALUES (
--   (SELECT id FROM auth.users WHERE email = 'admin@oddly.ai'),
--   'admin',
--   'Admin',
--   'elite'
-- )
-- ON CONFLICT (id) DO UPDATE SET role = 'admin', subscription_tier = 'elite';

-- ============================================
-- 6. VERIFICATION
-- ============================================
SELECT
  (SELECT count(*) FROM leagues) as leagues,
  (SELECT count(*) FROM leagues WHERE logo IS NOT NULL) as leagues_with_logos,
  (SELECT count(*) FROM teams) as teams,
  (SELECT count(*) FROM teams WHERE logo IS NOT NULL) as teams_with_logos,
  (SELECT count(*) FROM fixtures) as fixtures,
  (SELECT count(*) FROM odds_snapshots) as odds,
  (SELECT count(*) FROM predictions) as predictions,
  (SELECT count(*) FROM recommendations) as recommendations,
  (SELECT count(*) FROM profiles) as profiles;

-- Expected output after running sync scripts:
-- leagues: 60+, leagues_with_logos: 12+
-- teams: 150+, teams_with_logos: varies
-- fixtures: 100+
-- odds: 1000+
-- predictions: 30+
-- recommendations: 8+
-- profiles: 0+ (after creating admin)
