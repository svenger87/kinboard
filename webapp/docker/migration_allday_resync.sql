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

UPDATE calendars
SET caldav_ctag = NULL,
    ics_etag    = NULL
WHERE caldav_ctag IS NOT NULL
   OR ics_etag IS NOT NULL;
