-- migration_events_unique_source_id.sql
--
-- Stop the same upstream event existing twice in one calendar.
--
-- Every sync path (Google, ICS, CalDAV) looks for an existing row by
-- source id before deciding to insert or update. Two of them used
-- `.single()`, which errors when MORE than one row matches as well as
-- when none does — and both cases arrive as null data. So once a
-- duplicate existed, the lookup reported "nothing here", the sync
-- inserted another one, and the next run found two, then three. Google
-- sync runs every 15 minutes.
--
-- Duplicates are easy to create in the first place: the "Sync now"
-- button and the cron take no lock, so two writers can both be told
-- "no existing row" for the same event.
--
-- The code fixes are in google-sync and ics-sync. This is the backstop
-- underneath them, so a future path that forgets cannot reintroduce it.
--
-- Existing duplicates are removed first, oldest row kept. The rows are
-- copies of one upstream event, so nothing family-authored is lost — and
-- the next sync refreshes the survivor's fields anyway. Keeping the
-- oldest preserves whatever it is referenced by (a reminder row points
-- at an event id).
--
-- Partial index because google_event_id is NULL for events created by
-- hand in Kinboard, and there can be any number of those.

DO $$
DECLARE
  removed INTEGER;
BEGIN
  -- Collapse existing duplicates, keeping the earliest row per
  -- (calendar_id, google_event_id).
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY calendar_id, google_event_id
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.events
    WHERE google_event_id IS NOT NULL
  )
  DELETE FROM public.events e
  USING ranked r
  WHERE e.id = r.id AND r.rn > 1;

  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN
    RAISE NOTICE 'events: removed % duplicate synced event(s)', removed;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS events_calendar_source_id_key
  ON public.events (calendar_id, google_event_id)
  WHERE google_event_id IS NOT NULL;

COMMENT ON INDEX public.events_calendar_source_id_key IS
  'One row per upstream event per calendar. Partial because '
  'google_event_id is NULL for events created in Kinboard itself.';
