-- ============================================
-- ODDLY Seed Data
-- Run this AFTER the migration files
-- Inserts sample leagues, teams, fixtures, odds, predictions, and recommendations
-- ============================================

-- ============================================
-- 1. LEAGUES
-- ============================================
INSERT INTO leagues (id, name, country, sport, is_active, priority) VALUES
  ('a1b2c3d4-e5f6-7890-abcd-111111111101', 'Premier League', 'England', 'football', true, 1),
  ('a1b2c3d4-e5f6-7890-abcd-111111111102', 'La Liga', 'Spain', 'football', true, 2),
  ('a1b2c3d4-e5f6-7890-abcd-111111111103', 'Serie A', 'Italy', 'football', true, 3),
  ('a1b2c3d4-e5f6-7890-abcd-111111111104', 'Bundesliga', 'Germany', 'football', true, 4),
  ('a1b2c3d4-e5f6-7890-abcd-111111111105', 'Ligue 1', 'France', 'football', true, 5),
  ('a1b2c3d4-e5f6-7890-abcd-111111111106', 'Eredivisie', 'Netherlands', 'football', true, 6),
  ('a1b2c3d4-e5f6-7890-abcd-111111111107', 'Primeira Liga', 'Portugal', 'football', true, 7),
  ('a1b2c3d4-e5f6-7890-abcd-111111111108', 'Scottish Premiership', 'Scotland', 'football', true, 8),
  ('a1b2c3d4-e5f6-7890-abcd-111111111109', 'Championship', 'England', 'football', true, 9),
  ('a1b2c3d4-e5f6-7890-abcd-111111111110', 'Super Lig', 'Turkey', 'football', true, 10)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 2. TEAMS
-- ============================================

-- Premier League
INSERT INTO teams (id, canonical_name, country, league_id) VALUES
  ('b1b2c3d4-e5f6-7890-abcd-222222222201', 'Arsenal', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222202', 'Manchester City', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222203', 'Liverpool', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222204', 'Chelsea', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222205', 'Manchester United', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222206', 'Tottenham Hotspur', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222207', 'Newcastle United', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222208', 'Aston Villa', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222209', 'Brighton & Hove Albion', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222210', 'West Ham United', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222211', 'Fulham', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222212', 'Brentford', 'England', 'a1b2c3d4-e5f6-7890-abcd-111111111101')

ON CONFLICT (id) DO NOTHING;

-- La Liga
INSERT INTO teams (id, canonical_name, country, league_id) VALUES
  ('b1b2c3d4-e5f6-7890-abcd-222222222213', 'Real Madrid', 'Spain', 'a1b2c3d4-e5f6-7890-abcd-111111111102'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222214', 'Barcelona', 'Spain', 'a1b2c3d4-e5f6-7890-abcd-111111111102'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222215', 'Atletico Madrid', 'Spain', 'a1b2c3d4-e5f6-7890-abcd-111111111102'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222216', 'Athletic Bilbao', 'Spain', 'a1b2c3d4-e5f6-7890-abcd-111111111102'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222217', 'Real Sociedad', 'Spain', 'a1b2c3d4-e5f6-7890-abcd-111111111102'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222218', 'Villarreal', 'Spain', 'a1b2c3d4-e5f6-7890-abcd-111111111102')

ON CONFLICT (id) DO NOTHING;

-- Serie A
INSERT INTO teams (id, canonical_name, country, league_id) VALUES
  ('b1b2c3d4-e5f6-7890-abcd-222222222219', 'Inter Milan', 'Italy', 'a1b2c3d4-e5f6-7890-abcd-111111111103'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222220', 'AC Milan', 'Italy', 'a1b2c3d4-e5f6-7890-abcd-111111111103'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222221', 'Juventus', 'Italy', 'a1b2c3d4-e5f6-7890-abcd-111111111103'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222222', 'Napoli', 'Italy', 'a1b2c3d4-e5f6-7890-abcd-111111111103'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222223', 'AS Roma', 'Italy', 'a1b2c3d4-e5f6-7890-abcd-111111111103'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222224', 'Lazio', 'Italy', 'a1b2c3d4-e5f6-7890-abcd-111111111103')

ON CONFLICT (id) DO NOTHING;

-- Bundesliga
INSERT INTO teams (id, canonical_name, country, league_id) VALUES
  ('b1b2c3d4-e5f6-7890-abcd-222222222225', 'Bayern Munich', 'Germany', 'a1b2c3d4-e5f6-7890-abcd-111111111104'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222226', 'Bayer Leverkusen', 'Germany', 'a1b2c3d4-e5f6-7890-abcd-111111111104'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222227', 'Borussia Dortmund', 'Germany', 'a1b2c3d4-e5f6-7890-abcd-111111111104'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222228', 'RB Leipzig', 'Germany', 'a1b2c3d4-e5f6-7890-abcd-111111111104'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222229', 'VfB Stuttgart', 'Germany', 'a1b2c3d4-e5f6-7890-abcd-111111111104'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222230', 'Eintracht Frankfurt', 'Germany', 'a1b2c3d4-e5f6-7890-abcd-111111111104')

ON CONFLICT (id) DO NOTHING;

-- Ligue 1
INSERT INTO teams (id, canonical_name, country, league_id) VALUES
  ('b1b2c3d4-e5f6-7890-abcd-222222222231', 'Paris Saint-Germain', 'France', 'a1b2c3d4-e5f6-7890-abcd-111111111105'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222232', 'Olympique Marseille', 'France', 'a1b2c3d4-e5f6-7890-abcd-111111111105'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222233', 'AS Monaco', 'France', 'a1b2c3d4-e5f6-7890-abcd-111111111105'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222234', 'Lyon', 'France', 'a1b2c3d4-e5f6-7890-abcd-111111111105'),
  ('b1b2c3d4-e5f6-7890-abcd-222222222235', 'Lille', 'France', 'a1b2c3d4-e5f6-7890-abcd-111111111105')

ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 3. TEAM ALIASES (for matching API data)
-- ============================================
INSERT INTO team_aliases (canonical_name, alias, source) VALUES
  ('Arsenal', 'Arsenal FC', 'manual'),
  ('Arsenal', 'Arsenal London', 'manual'),
  ('Manchester City', 'Man City', 'manual'),
  ('Manchester City', 'Manchester City FC', 'manual'),
  ('Liverpool', 'Liverpool FC', 'manual'),
  ('Chelsea', 'Chelsea FC', 'manual'),
  ('Manchester United', 'Man United', 'manual'),
  ('Manchester United', 'Man Utd', 'manual'),
  ('Tottenham Hotspur', 'Tottenham', 'manual'),
  ('Tottenham Hotspur', 'Spurs', 'manual'),
  ('Real Madrid', 'Real Madrid CF', 'manual'),
  ('Barcelona', 'FC Barcelona', 'manual'),
  ('Barcelona', 'Barça', 'manual'),
  ('Bayern Munich', 'FC Bayern', 'manual'),
  ('Bayern Munich', 'Bayern München', 'manual'),
  ('Borussia Dortmund', 'BVB', 'manual'),
  ('Paris Saint-Germain', 'PSG', 'manual'),
  ('Inter Milan', 'Inter', 'manual'),
  ('Inter Milan', 'FC Internazionale', 'manual'),
  ('AC Milan', 'Milan', 'manual'),
  ('Juventus', 'Juve', 'manual')
ON CONFLICT (canonical_name, alias) DO NOTHING;

-- ============================================
-- 4. FIXTURES (upcoming matches — using relative dates)
-- ============================================

-- Today's matches (use CURRENT_DATE)
INSERT INTO fixtures (id, home_team_id, away_team_id, league_id, kickoff_time, status, is_featured) VALUES
  -- Premier League — today
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'b1b2c3d4-e5f6-7890-abcd-222222222201', 'b1b2c3d4-e5f6-7890-abcd-222222222204', 'a1b2c3d4-e5f6-7890-abcd-111111111101', (CURRENT_DATE + INTERVAL '14 hours 30 minutes')::text, 'scheduled', true),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'b1b2c3d4-e5f6-7890-abcd-222222222202', 'b1b2c3d4-e5f6-7890-abcd-222222222207', 'a1b2c3d4-e5f6-7890-abcd-111111111101', (CURRENT_DATE + INTERVAL '17 hours')::text, 'scheduled', true),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'b1b2c3d4-e5f6-7890-abcd-222222222203', 'b1b2c3d4-e5f6-7890-abcd-222222222205', 'a1b2c3d4-e5f6-7890-abcd-111111111101', (CURRENT_DATE + INTERVAL '19 hours 45 minutes')::text, 'scheduled', true),

  -- La Liga — today
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', 'b1b2c3d4-e5f6-7890-abcd-222222222213', 'b1b2c3d4-e5f6-7890-abcd-222222222215', 'a1b2c3d4-e5f6-7890-abcd-111111111102', (CURRENT_DATE + INTERVAL '21 hours')::text, 'scheduled', true),
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', 'b1b2c3d4-e5f6-7890-abcd-222222222214', 'b1b2c3d4-e5f6-7890-abcd-222222222216', 'a1b2c3d4-e5f6-7890-abcd-111111111102', (CURRENT_DATE + INTERVAL '16 hours')::text, 'scheduled', true),

  -- Serie A — today
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', 'b1b2c3d4-e5f6-7890-abcd-222222222219', 'b1b2c3d4-e5f6-7890-abcd-222222222222', 'a1b2c3d4-e5f6-7890-abcd-111111111103', (CURRENT_DATE + INTERVAL '17 hours 45 minutes')::text, 'scheduled', true),

  -- Bundesliga — today
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', 'b1b2c3d4-e5f6-7890-abcd-222222222225', 'b1b2c3d4-e5f6-7890-abcd-222222222227', 'a1b2c3d4-e5f6-7890-abcd-111111111104', (CURRENT_DATE + INTERVAL '15 hours')::text, 'scheduled', true),

  -- Ligue 1 — today
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', 'b1b2c3d4-e5f6-7890-abcd-222222222231', 'b1b2c3d4-e5f6-7890-abcd-222222222234', 'a1b2c3d4-e5f6-7890-abcd-111111111105', (CURRENT_DATE + INTERVAL '20 hours')::text, 'scheduled', false)

ON CONFLICT (id) DO NOTHING;

-- Tomorrow's matches
INSERT INTO fixtures (id, home_team_id, away_team_id, league_id, kickoff_time, status, is_featured) VALUES
  ('c1b2c3d4-e5f6-7890-abcd-333333333309', 'b1b2c3d4-e5f6-7890-abcd-222222222206', 'b1b2c3d4-e5f6-7890-abcd-222222222208', 'a1b2c3d4-e5f6-7890-abcd-111111111101', (CURRENT_DATE + INTERVAL '1 day 14 hours 30 minutes')::text, 'scheduled', true),
  ('c1b2c3d4-e5f6-7890-abcd-333333333310', 'b1b2c3d4-e5f6-7890-abcd-222222222210', 'b1b2c3d4-e5f6-7890-abcd-222222222211', 'a1b2c3d4-e5f6-7890-abcd-111111111101', (CURRENT_DATE + INTERVAL '1 day 17 hours')::text, 'scheduled', false),
  ('c1b2c3d4-e5f6-7890-abcd-333333333311', 'b1b2c3d4-e5f6-7890-abcd-222222222226', 'b1b2c3d4-e5f6-7890-abcd-222222222229', 'a1b2c3d4-e5f6-7890-abcd-111111111104', (CURRENT_DATE + INTERVAL '1 day 15 hours')::text, 'scheduled', true),
  ('c1b2c3d4-e5f6-7890-abcd-333333333312', 'b1b2c3d4-e5f6-7890-abcd-222222222228', 'b1b2c3d4-e5f6-7890-abcd-222222222230', 'a1b2c3d4-e5f6-7890-abcd-111111111104', (CURRENT_DATE + INTERVAL '1 day 18 hours 30 minutes')::text, 'scheduled', true),
  ('c1b2c3d4-e5f6-7890-abcd-333333333313', 'b1b2c3d4-e5f6-7890-abcd-222222222221', 'b1b2c3d4-e5f6-7890-abcd-222222222223', 'a1b2c3d4-e5f6-7890-abcd-111111111103', (CURRENT_DATE + INTERVAL '1 day 17 hours 45 minutes')::text, 'scheduled', false),
  ('c1b2c3d4-e5f6-7890-abcd-333333333314', 'b1b2c3d4-e5f6-7890-abcd-222222222220', 'b1b2c3d4-e5f6-7890-abcd-222222222224', 'a1b2c3d4-e5f6-7890-abcd-111111111103', (CURRENT_DATE + INTERVAL '1 day 20 hours')::text, 'scheduled', false),
  ('c1b2c3d4-e5f6-7890-abcd-333333333315', 'b1b2c3d4-e5f6-7890-abcd-222222222232', 'b1b2c3d4-e5f6-7890-abcd-222222222233', 'a1b2c3d4-e5f6-7890-abcd-111111111105', (CURRENT_DATE + INTERVAL '1 day 21 hours')::text, 'scheduled', true)

ON CONFLICT (id) DO NOTHING;

-- Day after tomorrow
INSERT INTO fixtures (id, home_team_id, away_team_id, league_id, kickoff_time, status, is_featured) VALUES
  ('c1b2c3d4-e5f6-7890-abcd-333333333316', 'b1b2c3d4-e5f6-7890-abcd-222222222205', 'b1b2c3d4-e5f6-7890-abcd-222222222209', 'a1b2c3d4-e5f6-7890-abcd-111111111101', (CURRENT_DATE + INTERVAL '2 days 14 hours')::text, 'scheduled', false),
  ('c1b2c3d4-e5f6-7890-abcd-333333333317', 'b1b2c3d4-e5f6-7890-abcd-222222222217', 'b1b2c3d4-e5f6-7890-abcd-222222222218', 'a1b2c3d4-e5f6-7890-abcd-111111111102', (CURRENT_DATE + INTERVAL '2 days 16 hours 30 minutes')::text, 'scheduled', false),
  ('c1b2c3d4-e5f6-7890-abcd-333333333318', 'b1b2c3d4-e5f6-7890-abcd-222222222235', 'b1b2c3d4-e5f6-7890-abcd-222222222231', 'a1b2c3d4-e5f6-7890-abcd-111111111105', (CURRENT_DATE + INTERVAL '2 days 20 hours')::text, 'scheduled', false)

ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 5. ODDS SNAPSHOTS (realistic bookmaker odds)
-- ============================================

-- Arsenal vs Chelsea (featured)
INSERT INTO odds_snapshots (fixture_id, bookmaker, market, selection, odds) VALUES
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'bet365', '1X2', 'Home', 1.85),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'bet365', '1X2', 'Draw', 3.60),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'bet365', '1X2', 'Away', 4.20),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'bet365', 'Over/Under 2.5', 'Over', 1.72),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'bet365', 'Over/Under 2.5', 'Under', 2.15),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'bet365', 'BTTS', 'Yes', 1.80),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'Pinnacle', '1X2', 'Home', 1.88),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'Pinnacle', '1X2', 'Draw', 3.55),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'Pinnacle', '1X2', 'Away', 4.15),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'Betfair', '1X2', 'Home', 1.87),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'Betfair', '1X2', 'Draw', 3.58),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'Betfair', '1X2', 'Away', 4.10),

  -- Man City vs Newcastle
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'bet365', '1X2', 'Home', 1.45),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'bet365', '1X2', 'Draw', 4.50),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'bet365', '1X2', 'Away', 7.00),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'bet365', 'Over/Under 2.5', 'Over', 1.55),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'bet365', 'Over/Under 2.5', 'Under', 2.45),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'Pinnacle', '1X2', 'Home', 1.47),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'Pinnacle', '1X2', 'Draw', 4.40),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'Pinnacle', '1X2', 'Away', 7.20),

  -- Liverpool vs Man United
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'bet365', '1X2', 'Home', 1.55),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'bet365', '1X2', 'Draw', 4.20),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'bet365', '1X2', 'Away', 5.50),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'bet365', 'Over/Under 2.5', 'Over', 1.65),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'bet365', 'BTTS', 'Yes', 1.75),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'Pinnacle', '1X2', 'Home', 1.58),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'Pinnacle', '1X2', 'Away', 5.40),

  -- Real Madrid vs Atletico Madrid
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', 'bet365', '1X2', 'Home', 1.70),
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', 'bet365', '1X2', 'Draw', 3.80),
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', 'bet365', '1X2', 'Away', 4.80),
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', 'bet365', 'Over/Under 2.5', 'Over', 1.90),
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', 'Pinnacle', '1X2', 'Home', 1.72),

  -- Barcelona vs Athletic Bilbao
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', 'bet365', '1X2', 'Home', 1.40),
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', 'bet365', '1X2', 'Draw', 4.75),
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', 'bet365', '1X2', 'Away', 8.00),
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', 'bet365', 'Over/Under 2.5', 'Over', 1.50),
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', 'Pinnacle', '1X2', 'Home', 1.42),

  -- Inter Milan vs Napoli
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', 'bet365', '1X2', 'Home', 2.10),
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', 'bet365', '1X2', 'Draw', 3.40),
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', 'bet365', '1X2', 'Away', 3.50),
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', 'bet365', 'Over/Under 2.5', 'Over', 2.00),

  -- Bayern Munich vs Borussia Dortmund
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', 'bet365', '1X2', 'Home', 1.50),
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', 'bet365', '1X2', 'Draw', 4.50),
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', 'bet365', '1X2', 'Away', 6.00),
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', 'bet365', 'Over/Under 2.5', 'Over', 1.60),
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', 'Pinnacle', '1X2', 'Home', 1.52),

  -- PSG vs Lyon
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', 'bet365', '1X2', 'Home', 1.35),
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', 'bet365', '1X2', 'Draw', 5.00),
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', 'bet365', '1X2', 'Away', 9.00),
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', 'bet365', 'Over/Under 2.5', 'Over', 1.45);

-- ============================================
-- 6. PREDICTIONS (model-generated)
-- ============================================
INSERT INTO predictions (fixture_id, market, selection, model_probability, model_version, confidence_lower, confidence_upper, model_disagreement, data_quality_score) VALUES
  -- Arsenal vs Chelsea
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', '1X2', 'Home', 0.58, 'v3.2.1', 0.52, 0.64, 0.08, 0.91),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', '1X2', 'Draw', 0.22, 'v3.2.1', 0.18, 0.26, 0.05, 0.91),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', '1X2', 'Away', 0.20, 'v3.2.1', 0.15, 0.25, 0.06, 0.91),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'Over/Under 2.5', 'Over', 0.62, 'v3.2.1', 0.55, 0.69, 0.07, 0.89),
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', 'BTTS', 'Yes', 0.65, 'v3.2.1', 0.58, 0.72, 0.06, 0.90),

  -- Man City vs Newcastle
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', '1X2', 'Home', 0.68, 'v3.2.1', 0.62, 0.74, 0.06, 0.93),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', '1X2', 'Draw', 0.18, 'v3.2.1', 0.14, 0.22, 0.04, 0.93),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', '1X2', 'Away', 0.14, 'v3.2.1', 0.10, 0.18, 0.05, 0.93),
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'Over/Under 2.5', 'Over', 0.71, 'v3.2.1', 0.64, 0.78, 0.08, 0.88),

  -- Liverpool vs Man United
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', '1X2', 'Home', 0.62, 'v3.2.1', 0.55, 0.69, 0.07, 0.90),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', '1X2', 'Draw', 0.20, 'v3.2.1', 0.16, 0.24, 0.05, 0.90),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', '1X2', 'Away', 0.18, 'v3.2.1', 0.13, 0.23, 0.06, 0.90),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'Over/Under 2.5', 'Over', 0.58, 'v3.2.1', 0.51, 0.65, 0.07, 0.87),
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'BTTS', 'Yes', 0.60, 'v3.2.1', 0.53, 0.67, 0.06, 0.88),

  -- Real Madrid vs Atletico Madrid
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', '1X2', 'Home', 0.52, 'v3.2.1', 0.45, 0.59, 0.09, 0.88),
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', '1X2', 'Draw', 0.25, 'v3.2.1', 0.20, 0.30, 0.05, 0.88),
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', '1X2', 'Away', 0.23, 'v3.2.1', 0.18, 0.28, 0.06, 0.88),
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', 'Over/Under 2.5', 'Over', 0.48, 'v3.2.1', 0.41, 0.55, 0.08, 0.85),

  -- Barcelona vs Athletic Bilbao
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', '1X2', 'Home', 0.72, 'v3.2.1', 0.66, 0.78, 0.06, 0.92),
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', '1X2', 'Draw', 0.16, 'v3.2.1', 0.12, 0.20, 0.04, 0.92),
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', '1X2', 'Away', 0.12, 'v3.2.1', 0.08, 0.16, 0.04, 0.92),

  -- Inter Milan vs Napoli
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', '1X2', 'Home', 0.42, 'v3.2.1', 0.35, 0.49, 0.10, 0.86),
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', '1X2', 'Draw', 0.26, 'v3.2.1', 0.21, 0.31, 0.06, 0.86),
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', '1X2', 'Away', 0.32, 'v3.2.1', 0.26, 0.38, 0.08, 0.86),

  -- Bayern Munich vs Borussia Dortmund
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', '1X2', 'Home', 0.65, 'v3.2.1', 0.58, 0.72, 0.07, 0.91),
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', '1X2', 'Draw', 0.18, 'v3.2.1', 0.14, 0.22, 0.04, 0.91),
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', '1X2', 'Away', 0.17, 'v3.2.1', 0.13, 0.21, 0.05, 0.91),

  -- PSG vs Lyon
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', '1X2', 'Home', 0.70, 'v3.2.1', 0.64, 0.76, 0.06, 0.92),
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', '1X2', 'Draw', 0.16, 'v3.2.1', 0.12, 0.20, 0.04, 0.92),
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', '1X2', 'Away', 0.14, 'v3.2.1', 0.10, 0.18, 0.04, 0.92);

-- ============================================
-- 7. RECOMMENDATIONS (value bets)
-- ============================================

-- Get prediction IDs for value bets
-- Arsenal vs Chelsea — Home Win (high edge)
INSERT INTO recommendations (fixture_id, market, selection, bookmaker_odds, raw_implied_probability, model_probability, edge, opportunity_score, risk_tier, confidence_tier, kelly_fraction, is_recommended, explanation) VALUES
  ('c1b2c3d4-e5f6-7890-abcd-333333333301', '1X2', 'Home', 1.85, 0.5405, 0.58, 0.0395, 0.78, 'low', 'high', 0.028, true, '{"reason":"Arsenal strong home form, model shows 58% win probability vs 54.1% implied from odds. Positive edge of 3.95%.","factors":["Home advantage","Recent form","Model agreement across 5/7 sub-models"]}'::json),

  -- Man City vs Newcastle — Over 2.5 (value detected)
  ('c1b2c3d4-e5f6-7890-abcd-333333333302', 'Over/Under 2.5', 'Over', 1.55, 0.6452, 0.71, 0.0648, 0.85, 'low', 'high', 0.052, true, '{"reason":"Man City home matches average 3.4 goals. Model shows 71% chance of 3+ goals vs 64.5% implied. Strong value.","factors":["City home goal average","Newcastle defensive weakness","Over hit in 7/10 last meetings"]}'::json),

  -- Liverpool vs Man United — BTTS Yes (solid edge)
  ('c1b2c3d4-e5f6-7890-abcd-333333333303', 'BTTS', 'Yes', 1.75, 0.5714, 0.60, 0.0286, 0.72, 'medium', 'medium', 0.022, true, '{"reason":"Both teams scored in 8/10 of their last meetings. Model shows 60% vs 57.1% implied. Moderate edge.","factors":["Historical BTTS record","Both teams attacking intent","Leaky defenses"]}'::json),

  -- Real Madrid vs Atletico — Away Win (high value, higher risk)
  ('c1b2c3d4-e5f6-7890-abcd-333333333304', '1X2', 'Away', 4.80, 0.2083, 0.23, 0.0217, 0.65, 'high', 'low', 0.009, false, '{"reason":"Atletico away win at 4.80 has value (model 23% vs 20.8% implied). But high risk due to Real Madrid home strength.","factors":["Atletico defensive setup","Derby unpredictability","Odds inflated by Real Madrid brand"]}'::json),

  -- Bayern vs Dortmund — Home Win
  ('c1b2c3d4-e5f6-7890-abcd-333333333307', '1X2', 'Home', 1.50, 0.6667, 0.65, -0.0167, 0.45, 'medium', 'medium', -0.012, false, '{"reason":"Bayern slight negative edge (-1.67%). Model and odds roughly aligned. No value detected.","factors":["Odds accurately priced","No significant edge","Dortmund improving form"]}'::json),

  -- Inter vs Napoli — Draw (value)
  ('c1b2c3d4-e5f6-7890-abcd-333333333306', '1X2', 'Draw', 3.40, 0.2941, 0.26, -0.0341, 0.38, 'medium', 'low', -0.022, false, '{"reason":"Draw probability lower than implied. Model shows 26% vs 29.4% implied. Negative edge.","factors":["Tight match expected","Historical low-scoring trend","Both teams cautious approach"]}'::json),

  -- PSG vs Lyon — Home Win (solid)
  ('c1b2c3d4-e5f6-7890-abcd-333333333308', '1X2', 'Home', 1.35, 0.7407, 0.70, -0.0407, 0.35, 'low', 'high', -0.055, false, '{"reason":"PSG heavily favored but odds too short. Model shows 70% vs 74.1% implied. No value at these odds.","factors":["PSG dominant at home","But odds too short for value","Lyon capable of upsets"]}'::json),

  -- Barcelona vs Bilbao — Over 2.5
  ('c1b2c3d4-e5f6-7890-abcd-333333333305', 'Over/Under 2.5', 'Over', 1.50, 0.6667, 0.68, 0.0133, 0.62, 'medium', 'medium', 0.010, true, '{"reason":"Barcelona home matches average 3.1 goals. Small but positive edge at 1.33%.","factors":["Barcelona attacking style","Bilbao away record","Camp Nou factor"]}'::json);
