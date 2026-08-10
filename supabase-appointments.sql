-- Appointments, store hours, and closures
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS store_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  is_closed BOOLEAN DEFAULT FALSE,
  open_time TIME NOT NULL DEFAULT '09:00',
  close_time TIME NOT NULL DEFAULT '17:00',
  max_appointments INTEGER NOT NULL DEFAULT 4 CHECK (max_appointments BETWEEN 0 AND 50),
  slot_minutes INTEGER NOT NULL DEFAULT 60 CHECK (slot_minutes IN (30, 45, 60, 90, 120)),
  UNIQUE (business_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS store_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  is_emergency BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  showroom TEXT DEFAULT 'general',
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes TEXT,
  source TEXT DEFAULT 'dashboard' CHECK (source IN ('dashboard', 'ai', 'phone')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_business ON appointments(business_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled ON appointments(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_closures_business ON store_closures(business_id);
CREATE INDEX IF NOT EXISTS idx_store_hours_business ON store_hours(business_id);

ALTER TABLE store_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own store hours" ON store_hours FOR ALL
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
CREATE POLICY "Users see own closures" ON store_closures FOR ALL
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));
CREATE POLICY "Users see own appointments" ON appointments FOR ALL
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Seed default Mon–Sat hours for an existing business (replace BUSINESS_ID if needed)
-- Living Fire defaults applied via API after deploy
