-- Settings of the install rather than of a family. For now one: the server's
-- own time zone (`server_timezone`), which the webapp's entrypoint writes from
-- its TZ on every start, so the database falls back to the same zone as the
-- rest of the server -- lib/family-time.ts uses process.env.TZ -- for a family
-- that has not picked one (#341), instead of Europe/Berlin.
--
-- Read by SECURITY DEFINER functions and the service role only: no policy, so
-- the browser roles see nothing.
--
-- Idempotent: safe to re-run. Sorts before migrations/066_todo_turns.sql,
-- whose family_time_zone() reads it.

CREATE TABLE IF NOT EXISTS public.instance_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.instance_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.instance_settings FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.instance_settings FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.instance_settings TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
