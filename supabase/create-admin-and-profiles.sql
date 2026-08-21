-- ============================================
-- Create profiles for ALL existing users
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Force-confirm ALL unconfirmed users
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
WHERE email_confirmed_at IS NULL;

-- 2. Create profiles for ALL users who don't have one
-- Note: user_metadata may not exist in all Supabase versions, so we use email for display_name
INSERT INTO public.profiles (id, role, display_name, subscription_tier)
SELECT
  id,
  CASE WHEN email = 'admin@oddly.ai' OR email = 'admin1@oddly.ai' THEN 'admin' ELSE 'user' END,
  split_part(email, '@', 1),
  CASE WHEN email IN ('admin@oddly.ai', 'admin1@oddly.ai') THEN 'elite' ELSE 'free' END
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  role = EXCLUDED.role,
  display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
  subscription_tier = EXCLUDED.subscription_tier;

-- 3. Add notification preferences (safe)
DO $$ BEGIN
  ALTER TABLE public.profiles ADD COLUMN notification_preferences jsonb DEFAULT '{"new_picks":true,"crown_jewel":true,"match_started":true,"result_settled":true,"chain_milestone":true,"chain_broken":true,"accumulator_settled":true,"model_alert":true,"announcement":true,"drawdown_warning":true,"rollover_pick":true}'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 4. Add logo columns (safe)
DO $$ BEGIN ALTER TABLE public.leagues ADD COLUMN logo text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE public.teams ADD COLUMN logo text; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 5. Enable Realtime (safe)
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE fixtures; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE fixtures REPLICA IDENTITY FULL; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE notifications REPLICA IDENTITY FULL; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- 6. Verify
SELECT
  u.email,
  CASE WHEN u.email_confirmed_at IS NOT NULL THEN 'CONFIRMED' ELSE 'BLOCKED' END as status,
  p.role,
  p.subscription_tier
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id;
