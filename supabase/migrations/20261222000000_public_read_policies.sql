-- Public football-data tables: allow read access so dashboard pages and the
-- public /api/v1/fixtures/[id] endpoint (anon key) can serve xG profiles,
-- player importance, and team feature profiles. Data is non-personal sports
-- statistics; writes remain service-role/admin only.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'xg_features' AND policyname = 'Public read xg features'
  ) THEN
    CREATE POLICY "Public read xg features" ON xg_features
      FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'player_importance' AND policyname = 'Public read player importance'
  ) THEN
    CREATE POLICY "Public read player importance" ON player_importance
      FOR SELECT TO anon, authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'team_feature_profiles' AND policyname = 'Public read team feature profiles'
  ) THEN
    CREATE POLICY "Public read team feature profiles" ON team_feature_profiles
      FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;
