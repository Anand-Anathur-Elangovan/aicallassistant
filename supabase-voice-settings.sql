-- Voice & Vapi sync settings on businesses
-- Run in Supabase SQL Editor

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS voice_speed REAL DEFAULT 1.0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS background_sound TEXT DEFAULT 'office';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS background_sound_url TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS model_temperature REAL DEFAULT 0.78;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS first_message TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS vapi_synced_at TIMESTAMPTZ;

-- Fix legacy default (rachel = ElevenLabs, fails without BYO key)
UPDATE businesses SET voice_id = 'Elliot' WHERE voice_id IS NULL OR voice_id IN ('rachel', 'adam', 'bella', 'drew');
ALTER TABLE businesses ALTER COLUMN voice_id SET DEFAULT 'Elliot';
