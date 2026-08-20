-- ============================================
-- Enable Supabase Realtime
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Enable Realtime on fixtures table (for live scores)
-- Add to the supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE fixtures;

-- Set replica identity to FULL so we get the full row data on updates
ALTER TABLE fixtures REPLICA IDENTITY FULL;

-- 2. Enable Realtime on notifications table (for live notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Set replica identity to FULL
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- 3. Verify Realtime is enabled
SELECT
  schemaname,
  tablename,
  pubname
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- Expected output:
-- schemaname | tablename    | pubname
-- -----------+--------------+------------------
-- public     | fixtures     | supabase_realtime
-- public     | notifications| supabase_realtime
