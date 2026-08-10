-- Transfer handoff context for dashboard (caller ID, time, reason)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS transfer_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vapi_call_id TEXT,
  caller_number TEXT,
  agent_name TEXT,
  agent_phone TEXT,
  department TEXT,
  reason TEXT,
  context_summary TEXT,
  status TEXT NOT NULL DEFAULT 'attempted'
    CHECK (status IN ('attempted', 'connected', 'failed', 'number_given')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handoffs_business ON transfer_handoffs(business_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_created ON transfer_handoffs(created_at DESC);

ALTER TABLE transfer_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own handoffs" ON transfer_handoffs;
CREATE POLICY "Users see own handoffs" ON transfer_handoffs FOR ALL
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
