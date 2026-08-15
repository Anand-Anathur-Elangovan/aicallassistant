-- Voice & Vapi sync settings on businesses
-- Run in Supabase SQL Editor

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS voice_speed REAL DEFAULT 1.0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS background_sound TEXT DEFAULT 'office';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS background_sound_url TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS model_temperature REAL DEFAULT 0.78;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS first_message TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS vapi_synced_at TIMESTAMPTZ;
