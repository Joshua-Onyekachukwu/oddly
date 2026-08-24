-- Agent audit log table for tracking betting agent recommendations and actions
CREATE TABLE IF NOT EXISTS agent_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  action TEXT NOT NULL,
  selections JSONB,
  odds_captured JSONB,
  booking_code TEXT,
  bookmaker TEXT,
  model_probability NUMERIC(8,4),
  edge NUMERIC(8,4),
  stake NUMERIC(12,2),
  potential_return NUMERIC(12,2),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by user and action
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON agent_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON agent_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON agent_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_status ON agent_audit_log(status);

-- Enable RLS (allow service role full access, users see their own)
ALTER TABLE agent_audit_log ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON agent_audit_log
  FOR ALL USING (auth.role() = 'service_role');

-- Users can read their own audit logs
CREATE POLICY "Users read own audit logs" ON agent_audit_log
  FOR SELECT USING (auth.uid() = user_id);
