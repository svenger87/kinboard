-- migration_caldav.sql
-- Adds two-way CalDAV support (discussion #18).
--
-- A calendar row's backing source is identified by which of three columns
-- is non-NULL — google_calendar_id (Google OAuth), ics_url (read-only .ics
-- subscription), caldav_url (this migration, read/write). The three are
-- mutually exclusive at the application level; the schema doesn't enforce
-- it for the same reason migration_calendars_ics.sql didn't (every column
-- is already nullable, and a CHECK would need version juggling for one
-- row of validation that the API routes do anyway).
--
-- CalDAV credentials are deliberately NOT stored here. They live in
-- public.integration_secrets under key 'caldav:<calendar_id>', which is
-- REVOKEd from anon/authenticated and only reachable via service_role
-- (see migration_integration_secrets.sql). The calendars table is read
-- directly by the browser through PostgREST, so a password column here
-- would be a password handed to every device in the family.

DO $$
BEGIN
  -- --- calendars ---------------------------------------------------

  -- Absolute URL of the CalDAV *collection* (the calendar itself, not
  -- the principal or the calendar-home). Discovery resolves this from a
  -- user-supplied server URL; we persist the resolved collection so
  -- syncs don't re-walk current-user-principal → calendar-home-set.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'caldav_url'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN caldav_url TEXT;
  END IF;

  -- Server base URL as the user typed it. Kept alongside caldav_url
  -- because tsdav's DAVClient is constructed from the server root (it
  -- re-runs its own principal discovery on login), and because the
  -- settings UI shows "which server is this calendar on".
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'caldav_server_url'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN caldav_server_url TEXT;
  END IF;

  -- CTag (calendar-server:getctag): changes whenever anything in the
  -- collection changes. The CalDAV equivalent of the ICS path's ETag —
  -- an unchanged CTag lets a sync skip the REPORT entirely.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'caldav_ctag'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN caldav_ctag TEXT;
  END IF;

  -- True when the server's current-user-privilege-set lacks write access
  -- (someone else's shared calendar, a subscribed holiday collection).
  -- Drives the UI's read-only badge and short-circuits write attempts
  -- before they hit the network. Defaults to false: when a server
  -- doesn't report privileges we assume writable and let a failed PUT
  -- be the authority, rather than locking the user out of their own
  -- calendar over a missing property.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'caldav_read_only'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN caldav_read_only BOOLEAN NOT NULL DEFAULT false;
  END IF;

  -- Last sync error, surfaced in the settings UI. ICS feeds get away
  -- without this (a broken public URL is self-evident when you re-test
  -- it); CalDAV failures are usually credential expiry, which is
  -- invisible unless we persist the reason.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'calendars' AND column_name = 'caldav_last_error'
  ) THEN
    ALTER TABLE public.calendars ADD COLUMN caldav_last_error TEXT;
  END IF;

  -- --- events ------------------------------------------------------

  -- Path of the calendar object resource on the server. Required for
  -- writes: CalDAV addresses events by URL, not by UID, and the mapping
  -- is server-chosen (Nextcloud uses <uid>.ics, others don't).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'caldav_href'
  ) THEN
    ALTER TABLE public.events ADD COLUMN caldav_href TEXT;
  END IF;

  -- Per-resource ETag, used as the If-Match precondition on PUT/DELETE
  -- so a Kinboard edit can't silently clobber a change made on a phone
  -- since the last sync (the server answers 412 instead).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'caldav_etag'
  ) THEN
    ALTER TABLE public.events ADD COLUMN caldav_etag TEXT;
  END IF;
END $$;

-- Sync's per-event lookup is (calendar_id, google_event_id) — already the
-- shape the ICS path uses, and covered by the index below for both. The
-- href index serves the write path, which starts from the local event row.
CREATE INDEX IF NOT EXISTS idx_events_calendar_caldav_href
  ON public.events (calendar_id, caldav_href);

-- Cron fan-out selects every CalDAV-backed calendar across all families.
CREATE INDEX IF NOT EXISTS idx_calendars_caldav_url
  ON public.calendars (caldav_url)
  WHERE caldav_url IS NOT NULL;

NOTIFY pgrst, 'reload schema';
