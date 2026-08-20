-- ============================================
-- ODDLY Quick Seed (v3 — Works With Existing Data)
-- Run this AFTER setup-all.sql in Supabase SQL Editor
-- Uses subqueries to reference existing teams/leagues
-- ============================================

-- 1. Fixtures (today + tomorrow) using existing team/league IDs
DO $$
DECLARE
  pl_id UUID;
  ll_id UUID;
  sa_id UUID;
  bl_id UUID;
  l1_id UUID;
  ars_id UUID;
  mci_id UUID;
  liv_id UUID;
  che_id UUID;
  mun_id UUID;
  tot_id UUID;
  new_id UUID;
  avl_id UUID;
  whu_id UUID;
  ful_id UUID;
  bre_id UUID;
  rma_id UUID;
  bar_id UUID;
  atm_id UUID;
  ath_id UUID;
  rsoc_id UUID;
  vil_id UUID;
  int_id UUID;
  mil_id UUID;
  juv_id UUID;
  nap_id UUID;
  rom_id UUID;
  laz_id UUID;
  bay_id UUID;
  lev_id UUID;
  bvb_id UUID;
  lei_id UUID;
  stu_id UUID;
  fra_id UUID;
  psg_id UUID;
  mar_id UUID;
  mon_id UUID;
  lyo_id UUID;
  lil_id UUID;
BEGIN
  -- Get league IDs by name
  SELECT id INTO pl_id FROM leagues WHERE name = 'Premier League' LIMIT 1;
  SELECT id INTO ll_id FROM leagues WHERE name = 'La Liga' LIMIT 1;
  SELECT id INTO sa_id FROM leagues WHERE name = 'Serie A' LIMIT 1;
  SELECT id INTO bl_id FROM leagues WHERE name = 'Bundesliga' LIMIT 1;
  SELECT id INTO l1_id FROM leagues WHERE name = 'Ligue 1' LIMIT 1;

  -- Get team IDs by name
  SELECT id INTO ars_id FROM teams WHERE canonical_name = 'Arsenal' LIMIT 1;
  SELECT id INTO mci_id FROM teams WHERE canonical_name = 'Manchester City' LIMIT 1;
  SELECT id INTO liv_id FROM teams WHERE canonical_name = 'Liverpool' LIMIT 1;
  SELECT id INTO che_id FROM teams WHERE canonical_name = 'Chelsea' LIMIT 1;
  SELECT id INTO mun_id FROM teams WHERE canonical_name = 'Manchester United' LIMIT 1;
  SELECT id INTO tot_id FROM teams WHERE canonical_name = 'Tottenham Hotspur' LIMIT 1;
  SELECT id INTO new_id FROM teams WHERE canonical_name = 'Newcastle United' LIMIT 1;
  SELECT id INTO avl_id FROM teams WHERE canonical_name = 'Aston Villa' LIMIT 1;
  SELECT id INTO whu_id FROM teams WHERE canonical_name = 'West Ham United' LIMIT 1;
  SELECT id INTO ful_id FROM teams WHERE canonical_name = 'Fulham' LIMIT 1;
  SELECT id INTO bre_id FROM teams WHERE canonical_name = 'Brentford' LIMIT 1;
  SELECT id INTO rma_id FROM teams WHERE canonical_name = 'Real Madrid' LIMIT 1;
  SELECT id INTO bar_id FROM teams WHERE canonical_name = 'Barcelona' LIMIT 1;
  SELECT id INTO atm_id FROM teams WHERE canonical_name = 'Atletico Madrid' LIMIT 1;
  SELECT id INTO ath_id FROM teams WHERE canonical_name = 'Athletic Bilbao' LIMIT 1;
  SELECT id INTO rsoc_id FROM teams WHERE canonical_name = 'Real Sociedad' LIMIT 1;
  SELECT id INTO vil_id FROM teams WHERE canonical_name = 'Villarreal' LIMIT 1;
  SELECT id INTO int_id FROM teams WHERE canonical_name = 'Inter Milan' LIMIT 1;
  SELECT id INTO mil_id FROM teams WHERE canonical_name = 'AC Milan' LIMIT 1;
  SELECT id INTO juv_id FROM teams WHERE canonical_name = 'Juventus' LIMIT 1;
  SELECT id INTO nap_id FROM teams WHERE canonical_name = 'Napoli' LIMIT 1;
  SELECT id INTO rom_id FROM teams WHERE canonical_name = 'AS Roma' LIMIT 1;
  SELECT id INTO laz_id FROM teams WHERE canonical_name = 'Lazio' LIMIT 1;
  SELECT id INTO bay_id FROM teams WHERE canonical_name = 'Bayern Munich' LIMIT 1;
  SELECT id INTO lev_id FROM teams WHERE canonical_name = 'Bayer Leverkusen' LIMIT 1;
  SELECT id INTO bvb_id FROM teams WHERE canonical_name = 'Borussia Dortmund' LIMIT 1;
  SELECT id INTO lei_id FROM teams WHERE canonical_name = 'RB Leipzig' LIMIT 1;
  SELECT id INTO stu_id FROM teams WHERE canonical_name = 'VfB Stuttgart' LIMIT 1;
  SELECT id INTO fra_id FROM teams WHERE canonical_name = 'Eintracht Frankfurt' LIMIT 1;
  SELECT id INTO psg_id FROM teams WHERE canonical_name = 'Paris Saint-Germain' LIMIT 1;
  SELECT id INTO mar_id FROM teams WHERE canonical_name = 'Olympique Marseille' LIMIT 1;
  SELECT id INTO mon_id FROM teams WHERE canonical_name = 'AS Monaco' LIMIT 1;
  SELECT id INTO lyo_id FROM teams WHERE canonical_name = 'Lyon' LIMIT 1;
  SELECT id INTO lil_id FROM teams WHERE canonical_name = 'Lille' LIMIT 1;

  -- Only insert if we found the required IDs
  IF pl_id IS NOT NULL AND ars_id IS NOT NULL AND che_id IS NOT NULL THEN
    -- Today's matches
    INSERT INTO fixtures (home_team_id, away_team_id, league_id, kickoff_time, status, is_featured)
    VALUES
      (ars_id, che_id, pl_id, (CURRENT_DATE + INTERVAL '14 hours 30 minutes')::timestamptz, 'scheduled', true),
      (mci_id, new_id, pl_id, (CURRENT_DATE + INTERVAL '17 hours')::timestamptz, 'scheduled', true),
      (liv_id, mun_id, pl_id, (CURRENT_DATE + INTERVAL '19 hours 45 minutes')::timestamptz, 'scheduled', true),
      (rma_id, atm_id, ll_id, (CURRENT_DATE + INTERVAL '21 hours')::timestamptz, 'scheduled', true),
      (bar_id, ath_id, ll_id, (CURRENT_DATE + INTERVAL '16 hours')::timestamptz, 'scheduled', true),
      (int_id, nap_id, sa_id, (CURRENT_DATE + INTERVAL '17 hours 45 minutes')::timestamptz, 'scheduled', true),
      (bay_id, bvb_id, bl_id, (CURRENT_DATE + INTERVAL '15 hours')::timestamptz, 'scheduled', true),
      (psg_id, lyo_id, l1_id, (CURRENT_DATE + INTERVAL '20 hours')::timestamptz, 'scheduled', false)
    ON CONFLICT DO NOTHING;

    -- Tomorrow's matches
    INSERT INTO fixtures (home_team_id, away_team_id, league_id, kickoff_time, status, is_featured)
    VALUES
      (tot_id, avl_id, pl_id, (CURRENT_DATE + INTERVAL '1 day 14 hours 30 minutes')::timestamptz, 'scheduled', true),
      (whu_id, ful_id, pl_id, (CURRENT_DATE + INTERVAL '1 day 17 hours')::timestamptz, 'scheduled', false),
      (lev_id, stu_id, bl_id, (CURRENT_DATE + INTERVAL '1 day 15 hours')::timestamptz, 'scheduled', true),
      (lei_id, fra_id, bl_id, (CURRENT_DATE + INTERVAL '1 day 18 hours 30 minutes')::timestamptz, 'scheduled', true),
      (juv_id, rom_id, sa_id, (CURRENT_DATE + INTERVAL '1 day 17 hours 45 minutes')::timestamptz, 'scheduled', false),
      (mil_id, laz_id, sa_id, (CURRENT_DATE + INTERVAL '1 day 20 hours')::timestamptz, 'scheduled', false),
      (mar_id, mon_id, l1_id, (CURRENT_DATE + INTERVAL '1 day 21 hours')::timestamptz, 'scheduled', true)
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Fixtures inserted successfully';
  ELSE
    RAISE NOTICE 'Missing required leagues or teams. Run setup-all.sql first.';
  END IF;
END $$;

-- 2. Odds snapshots for today's fixtures
DO $$
DECLARE
  f_id UUID;
BEGIN
  -- Arsenal vs Chelsea
  SELECT id INTO f_id FROM fixtures WHERE home_team_id = (SELECT id FROM teams WHERE canonical_name = 'Arsenal' LIMIT 1) AND kickoff_time::date = CURRENT_DATE LIMIT 1;
  IF f_id IS NOT NULL THEN
    INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
      (f_id, 'bet365', '1X2', 'Home', 1.85), (f_id, 'bet365', '1X2', 'Draw', 3.60), (f_id, 'bet365', '1X2', 'Away', 4.20),
      (f_id, 'bet365', 'Over/Under 2.5', 'Over', 1.72), (f_id, 'bet365', 'Over/Under 2.5', 'Under', 2.15),
      (f_id, 'bet365', 'BTTS', 'Yes', 1.80), (f_id, 'Pinnacle', '1X2', 'Home', 1.88),
      (f_id, 'Pinnacle', '1X2', 'Draw', 3.55), (f_id, 'Pinnacle', '1X2', 'Away', 4.15)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Man City vs Newcastle
  SELECT id INTO f_id FROM fixtures WHERE home_team_id = (SELECT id FROM teams WHERE canonical_name = 'Manchester City' LIMIT 1) AND kickoff_time::date = CURRENT_DATE LIMIT 1;
  IF f_id IS NOT NULL THEN
    INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
      (f_id, 'bet365', '1X2', 'Home', 1.45), (f_id, 'bet365', '1X2', 'Draw', 4.50), (f_id, 'bet365', '1X2', 'Away', 7.00),
      (f_id, 'bet365', 'Over/Under 2.5', 'Over', 1.55), (f_id, 'bet365', 'Over/Under 2.5', 'Under', 2.45),
      (f_id, 'Pinnacle', '1X2', 'Home', 1.47), (f_id, 'Pinnacle', '1X2', 'Draw', 4.40), (f_id, 'Pinnacle', '1X2', 'Away', 7.20)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Liverpool vs Man United
  SELECT id INTO f_id FROM fixtures WHERE home_team_id = (SELECT id FROM teams WHERE canonical_name = 'Liverpool' LIMIT 1) AND kickoff_time::date = CURRENT_DATE LIMIT 1;
  IF f_id IS NOT NULL THEN
    INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
      (f_id, 'bet365', '1X2', 'Home', 1.55), (f_id, 'bet365', '1X2', 'Draw', 4.20), (f_id, 'bet365', '1X2', 'Away', 5.50),
      (f_id, 'bet365', 'Over/Under 2.5', 'Over', 1.65), (f_id, 'bet365', 'BTTS', 'Yes', 1.75),
      (f_id, 'Pinnacle', '1X2', 'Home', 1.58), (f_id, 'Pinnacle', '1X2', 'Away', 5.40)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Real Madrid vs Atletico
  SELECT id INTO f_id FROM fixtures WHERE home_team_id = (SELECT id FROM teams WHERE canonical_name = 'Real Madrid' LIMIT 1) AND kickoff_time::date = CURRENT_DATE LIMIT 1;
  IF f_id IS NOT NULL THEN
    INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
      (f_id, 'bet365', '1X2', 'Home', 1.70), (f_id, 'bet365', '1X2', 'Draw', 3.80), (f_id, 'bet365', '1X2', 'Away', 4.80),
      (f_id, 'bet365', 'Over/Under 2.5', 'Over', 1.90), (f_id, 'Pinnacle', '1X2', 'Home', 1.72)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Barcelona vs Bilbao
  SELECT id INTO f_id FROM fixtures WHERE home_team_id = (SELECT id FROM teams WHERE canonical_name = 'Barcelona' LIMIT 1) AND kickoff_time::date = CURRENT_DATE LIMIT 1;
  IF f_id IS NOT NULL THEN
    INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
      (f_id, 'bet365', '1X2', 'Home', 1.40), (f_id, 'bet365', '1X2', 'Draw', 4.75), (f_id, 'bet365', '1X2', 'Away', 8.00),
      (f_id, 'bet365', 'Over/Under 2.5', 'Over', 1.50), (f_id, 'Pinnacle', '1X2', 'Home', 1.42)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Inter vs Napoli
  SELECT id INTO f_id FROM fixtures WHERE home_team_id = (SELECT id FROM teams WHERE canonical_name = 'Inter Milan' LIMIT 1) AND kickoff_time::date = CURRENT_DATE LIMIT 1;
  IF f_id IS NOT NULL THEN
    INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
      (f_id, 'bet365', '1X2', 'Home', 2.10), (f_id, 'bet365', '1X2', 'Draw', 3.40), (f_id, 'bet365', '1X2', 'Away', 3.50),
      (f_id, 'bet365', 'Over/Under 2.5', 'Over', 2.00)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Bayern vs Dortmund
  SELECT id INTO f_id FROM fixtures WHERE home_team_id = (SELECT id FROM teams WHERE canonical_name = 'Bayern Munich' LIMIT 1) AND kickoff_time::date = CURRENT_DATE LIMIT 1;
  IF f_id IS NOT NULL THEN
    INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
      (f_id, 'bet365', '1X2', 'Home', 1.50), (f_id, 'bet365', '1X2', 'Draw', 4.50), (f_id, 'bet365', '1X2', 'Away', 6.00),
      (f_id, 'bet365', 'Over/Under 2.5', 'Over', 1.60), (f_id, 'Pinnacle', '1X2', 'Home', 1.52)
    ON CONFLICT DO NOTHING;
  END IF;

  -- PSG vs Lyon
  SELECT id INTO f_id FROM fixtures WHERE home_team_id = (SELECT id FROM teams WHERE canonical_name = 'Paris Saint-Germain' LIMIT 1) AND kickoff_time::date = CURRENT_DATE LIMIT 1;
  IF f_id IS NOT NULL THEN
    INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
      (f_id, 'bet365', '1X2', 'Home', 1.35), (f_id, 'bet365', '1X2', 'Draw', 5.00), (f_id, 'bet365', '1X2', 'Away', 9.00),
      (f_id, 'bet365', 'Over/Under 2.5', 'Over', 1.45)
    ON CONFLICT DO NOTHING;
  END IF;

  RAISE NOTICE 'Odds snapshots inserted';
END $$;

-- 3. Verify counts
DO $$
DECLARE
  f_count INT; o_count INT;
BEGIN
  SELECT count(*) INTO f_count FROM fixtures WHERE kickoff_time::date >= CURRENT_DATE;
  SELECT count(*) INTO o_count FROM odds_snapshots;
  RAISE NOTICE 'Fixtures today+: %, Odds snapshots: %', f_count, o_count;
END $$;
