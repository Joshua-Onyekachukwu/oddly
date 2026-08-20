-- ============================================
-- Notification Preferences for ODDLY
-- Run this in Supabase SQL Editor
-- ============================================

-- Add notification_preferences column to profiles
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

-- Update existing users to have default preferences
UPDATE public.profiles 
SET notification_preferences = '{
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
}'::jsonb
WHERE notification_preferences IS NULL;

-- Create an index for fast preference lookups
CREATE INDEX IF NOT EXISTS idx_profiles_notification_prefs 
ON public.profiles USING gin (notification_preferences);

-- RLS policy: users can read their own preferences
CREATE POLICY "Users can view own notification preferences" 
ON public.profiles FOR SELECT 
USING (auth.uid() = id);

-- RLS policy: users can update their own preferences
CREATE POLICY "Users can update own notification preferences" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);
