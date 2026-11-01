-- Migration: Add device fingerprint for fallback recognition
-- When browser storage is cleared, devices can still be recognized by fingerprint

-- Add fingerprint column to devices table
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS fingerprint TEXT;

-- Index for fast fingerprint lookups (used for fallback device recognition)
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON public.devices(fingerprint);

-- Done
SELECT 'Fingerprint migration completed successfully!' as status;
