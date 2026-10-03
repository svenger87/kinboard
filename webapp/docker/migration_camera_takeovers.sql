-- A camera put on the wall displays from outside, for a minute (#335).
--
-- Home Assistant calls `show_camera` when the doorbell rings, and the screens
-- it names — by default every kiosk device — show that camera full screen
-- until `ends_at`. One row per family: a second call, a second ring, replaces
-- the first, which restarts the time or switches the camera, and the table
-- never grows. `ends_at` comes from the server's clock; a screen compares it
-- with its measured offset to that clock (RFC-005 §4.3), so a screen that
-- catches up late shows only what is left.
--
-- `camera_id` is TEXT: cameras live in the `cameras` setting, where an id is
-- whatever string the settings page gave it, not a row a foreign key could
-- point at. `device_ids` is resolved when the call is made, so a screen only
-- has to look for itself in it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'camera_takeovers'
  ) THEN
    CREATE TABLE public.camera_takeovers (
      family_id UUID PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,
      camera_id TEXT NOT NULL,
      device_ids UUID[] NOT NULL DEFAULT '{}',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ NOT NULL
    );
  END IF;
END $$;

-- The cap is the database's as well as the service's. show_camera never
-- writes more than 300 seconds, but a row is only as bounded as the last
-- thing that could write it, and a takeover that never ends holds every wall
-- display's screensaver off for good. Dropped and re-added rather than
-- guarded, because the entrypoint re-runs every migration on each boot and
-- this way a changed definition reaches databases that already have one.
ALTER TABLE public.camera_takeovers DROP CONSTRAINT IF EXISTS camera_takeovers_duration_check;
ALTER TABLE public.camera_takeovers ADD CONSTRAINT camera_takeovers_duration_check
  CHECK (ends_at > started_at AND ends_at <= started_at + interval '300 seconds');

-- Only the server writes a takeover. show_camera is where `announcements:write`
-- is checked, the 5-per-10-minutes budget is spent and the 5-300 s range is
-- enforced; the shared family policy in migration_zz_row_level_security.sql
-- is FOR ALL, so with the image's default grants a family's own browser token
-- could have INSERTed, UPDATEd or DELETEd its row directly and skipped all
-- three — put any camera on every screen, or keep one there indefinitely.
-- The screens only read the row (over realtime and /api/camera-takeover), so
-- SELECT stays: realtime checks it before streaming a change to a browser.
--
-- TRUNCATE goes with them: it is not filtered by row-level security, so it
-- would clear every family's takeover. migration_zzzz_revoke_truncate.sql
-- would take it too, but this table should not depend on that.
--
-- Nothing that sorts after this file grants these back (RLS only adds
-- policies, and policies cannot widen a revoked privilege), and REVOKE of a
-- privilege that is not held is a no-op, so this is safe on every boot.
-- e2e/camera-takeover-grants.spec.ts checks both, and the result live.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.camera_takeovers FROM anon, authenticated;
GRANT SELECT ON public.camera_takeovers TO anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='camera_takeovers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.camera_takeovers;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
