-- migration_settings_write_lockdown.sql — close the anon settings write
-- vector. `settings` is readable AND (until now) writable by the browser
-- directly via PostgREST (anon key, RLS disabled) — a stale or hostile
-- client on the network could INSERT/UPDATE/DELETE any family's settings
-- row (e.g. planting Bring! tokens, flipping feature toggles). Every write
-- now goes through the Next.js server (PUT/DELETE /api/settings), which
-- enforces family membership and splits secret-bearing keys into
-- integration_secrets. SELECT stays granted: useSetting() reads directly
-- via PostgREST, and Realtime broadcasts on this table are unaffected —
-- only the write path changes.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE INSERT, UPDATE, DELETE ON public.settings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE INSERT, UPDATE, DELETE ON public.settings FROM authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
