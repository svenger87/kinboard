-- migration_calendars_ics.sql
-- Adds ICS feed support to the calendars table:
--   - `ics_url`        — the publicly-fetchable .ics URL (https or webcal-rewritten)
--   - `ics_etag`       — last seen ETag for conditional GETs (skip parse on 304)
--   - `last_synced_at` — most recent successful sync timestamp (UI hint)
-- A calendar row is "Google-backed" if google_calendar_id IS NOT NULL,
-- "ICS-backed" if ics_url IS NOT NULL. The two are mutually exclusive at
-- the application level (validated in API routes); the schema does not
-- enforce it because the existing google_calendar_id is already nullable
-- and adding a CHECK constraint requires schema-version juggling that
-- isn't worth it for one row of validation.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'ics_url'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN ics_url TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'ics_etag'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN ics_etag TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'last_synced_at'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN last_synced_at TIMESTAMPTZ;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
