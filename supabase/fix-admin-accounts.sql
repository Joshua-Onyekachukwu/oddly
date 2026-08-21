-- Fix Admin Accounts and Profiles
-- Run in Supabase SQL Editor

-- Ensure all auth users have profiles
INSERT INTO profiles (id, role, display_name, subscription_tier, bankroll, notification_preferences)
SELECT 
  au.id,
  CASE 
    WHEN au.email IN ('admin@oddly.ai', 'admin1@oddly.ai', 'admin2@oddly.ai') THEN 'admin'
    ELSE 'user'
  END as role,
  COALESCE(au.raw_user_meta_data->>'display_name', split_part(au.email, '@', 1)) as display_name,
  CASE 
    WHEN au.email IN ('admin@oddly.ai', 'admin1@oddly.ai', 'admin2@oddly.ai') THEN 'elite'
    ELSE 'free'
  END as subscription_tier,
  0 as bankroll,
  jsonb_build_object(
    'new_picks', true,
    'crown_jewel', true,
    'model_alert', true,
    'announcement', true,
    'chain_broken', true,
    'match_started', true,
    'rollover_pick', true,
    'result_settled', true,
    'chain_milestone', true,
    'drawdown_warning', true,
    'accumulator_settled', true
  ) as notification_preferences
FROM auth.users au
LEFT JOIN profiles p ON p.id = au.id
WHERE p.id IS NULL;

-- Promote admin accounts
UPDATE profiles SET role = 'admin', subscription_tier = 'elite'
WHERE id IN (SELECT id FROM auth.users WHERE email IN ('admin@oddly.ai', 'admin1@oddly.ai', 'admin2@oddly.ai'));

-- Ensure email confirmation is disabled (users can sign in immediately)
-- This is configured in Supabase Dashboard > Authentication > Email > Disable "Confirm email"

-- Verify
SELECT p.display_name, p.role, p.subscription_tier, u.email
FROM profiles p
JOIN auth.users u ON u.id = p.id
ORDER BY p.role DESC, p.created_at;
