-- Leads / callbacks + call intent tags
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  interest TEXT,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'ai'
    CHECK (source IN ('ai', 'dashboard', 'transfer_fallback', 'after_hours')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'closed')),
  vapi_call_id TEXT,
  caller_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_business ON leads(business_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users see own leads" ON leads;
CREATE POLICY "Users see own leads" ON leads FOR ALL
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Intent classification on call logs
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS intent TEXT
  CHECK (intent IS NULL OR intent IN ('sales', 'support', 'booking', 'complaint', 'general'));

CREATE INDEX IF NOT EXISTS idx_calls_intent ON call_logs(intent);
