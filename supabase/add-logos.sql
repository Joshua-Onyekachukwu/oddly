-- ============================================
-- Add Logo Columns to Leagues and Teams
-- Run this in Supabase SQL Editor
-- ============================================

-- Add logo column to leagues
ALTER TABLE public.leagues
ADD COLUMN IF NOT EXISTS logo text;

-- Add logo column to teams
ALTER TABLE public.teams
ADD COLUMN IF NOT EXISTS logo text;

-- Add country_flag to leagues for the flag icon
ALTER TABLE public.leagues
ADD COLUMN IF NOT EXISTS country_flag text;

-- Create index for logo lookups
CREATE INDEX IF NOT EXISTS idx_leagues_logo ON public.leagues (logo) WHERE logo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teams_logo ON public.teams (logo) WHERE logo IS NOT NULL;
