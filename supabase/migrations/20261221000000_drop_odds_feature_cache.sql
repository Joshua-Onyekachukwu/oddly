-- ============================================
-- DROP odds_feature_cache (dead table)
-- Date: December 21, 2026
--
-- odds_feature_cache was created by supabase/create-feature-store.sql as a
-- planned cache of market-averaged odds features. Audit finding: NO code
-- reads from or writes to this table.
--   - src/ has zero references (only the generated type in
--     src/lib/supabase/database.types.ts, which is regenerated separately).
--   - worker/models/feature-store-loader.js mentions it only in a header
--     comment; it actually reads odds_snapshots.
--   - scripts/ and worker/ have no .from("odds_feature_cache") calls.
-- Live odds features come from odds_snapshots via src/lib/sync/odds.ts.
-- ============================================

DROP TABLE IF EXISTS odds_feature_cache;
