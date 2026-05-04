-- Migration: Add kiosk mode column to devices table
-- Run this on existing databases to add kiosk mode support

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS is_kiosk BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.devices.is_kiosk IS 'Whether this device runs in kiosk mode (auto-hide cursor, prevent interactions, wake lock)';
