-- Force one full calendar resync so existing all-day events are rewritten.
--
-- All-day events were stored at the *server's* local midnight rather than
-- anchored to their own calendar date, so every viewer in a different timezone
-- saw them on the wrong day (issue #145). The parser is fixed, but the sync
-- short-circuits on an unchanged CTag/ETag and would leave already-imported
-- events sitting on the old values until the remote calendar happened to
-- change. Clearing the sync tokens makes the next run do a full pass and
-- rewrite start_at/end_at for everything.
--
-- Idempotent, and cheap: it costs one extra full sync per calendar, once.
-- Events themselves are untouched here -- the sync rewrites them.
--
-- The column guards are load-bearing. Migrations apply in alphabetical order,
-- and this file sorts before migration_caldav.sql and migration_calendars_ics.sql
-- — the ones that add caldav_ctag and ics_etag. On a fresh install the columns
-- do not exist yet when this runs, and the entrypoint refuses to start the
-- webapp on a failed migration, so an unguarded UPDATE here means a brand-new
-- deployment never boots. There is nothing to resync on a fresh install anyway.
DO $$
BEGIN
  IF to_regclass('public.calendars') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'caldav_ctag'
  ) THEN
    UPDATE public.calendars SET caldav_ctag = NULL WHERE caldav_ctag IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'ics_etag'
  ) THEN
    UPDATE public.calendars SET ics_etag = NULL WHERE ics_etag IS NOT NULL;
  END IF;
END $$;
