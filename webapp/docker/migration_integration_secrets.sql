-- migration_integration_secrets.sql — move integration credentials out of
-- the anon-readable `settings` table into a server-only table.
-- The settings table is readable by the browser both via PostgREST (anon
-- key, RLS disabled) and via the realtime publication; tokens must not
-- live there. integration_secrets is NOT in the realtime publication and
-- anon/authenticated privileges are revoked — only service_role (the
-- Next.js server's admin client) can read it.

CREATE TABLE IF NOT EXISTS public.integration_secrets (
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, key)
);

REVOKE ALL ON TABLE public.integration_secrets FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.integration_secrets FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.integration_secrets FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.integration_secrets TO service_role;
  END IF;
END $$;

-- ---- one-time data moves (idempotent: source field removed after move) ----

-- home_assistant.access_token
INSERT INTO public.integration_secrets (family_id, key, value)
SELECT family_id, 'home_assistant',
       jsonb_build_object('access_token', value->>'access_token')
FROM public.settings
WHERE key = 'home_assistant'
  AND COALESCE(value->>'access_token', '') <> ''
ON CONFLICT (family_id, key)
  DO UPDATE SET value = public.integration_secrets.value || EXCLUDED.value,
                updated_at = now();
UPDATE public.settings SET value = value - 'access_token'
WHERE key = 'home_assistant' AND value ? 'access_token';

-- immich.api_key
INSERT INTO public.integration_secrets (family_id, key, value)
SELECT family_id, 'immich', jsonb_build_object('api_key', value->>'api_key')
FROM public.settings
WHERE key = 'immich' AND COALESCE(value->>'api_key', '') <> ''
ON CONFLICT (family_id, key)
  DO UPDATE SET value = public.integration_secrets.value || EXCLUDED.value,
                updated_at = now();
UPDATE public.settings SET value = value - 'api_key'
WHERE key = 'immich' AND value ? 'api_key';

-- unsplash.access_key
INSERT INTO public.integration_secrets (family_id, key, value)
SELECT family_id, 'unsplash', jsonb_build_object('access_key', value->>'access_key')
FROM public.settings
WHERE key = 'unsplash' AND COALESCE(value->>'access_key', '') <> ''
ON CONFLICT (family_id, key)
  DO UPDATE SET value = public.integration_secrets.value || EXCLUDED.value,
                updated_at = now();
UPDATE public.settings SET value = value - 'access_key'
WHERE key = 'unsplash' AND value ? 'access_key';

-- google_calendar.access_token + refresh_token
INSERT INTO public.integration_secrets (family_id, key, value)
SELECT family_id, 'google_calendar',
       jsonb_strip_nulls(jsonb_build_object(
         'access_token',  value->>'access_token',
         'refresh_token', value->>'refresh_token'))
FROM public.settings
WHERE key = 'google_calendar'
  AND (COALESCE(value->>'access_token', '') <> '' OR COALESCE(value->>'refresh_token', '') <> '')
ON CONFLICT (family_id, key)
  DO UPDATE SET value = public.integration_secrets.value || EXCLUDED.value,
                updated_at = now();
UPDATE public.settings SET value = (value - 'access_token') - 'refresh_token'
WHERE key = 'google_calendar' AND (value ? 'access_token' OR value ? 'refresh_token');

-- bring_settings.credentials.{accessToken,refreshToken} (nested shape preserved)
INSERT INTO public.integration_secrets (family_id, key, value)
SELECT family_id, 'bring_settings',
       jsonb_build_object('credentials', jsonb_strip_nulls(jsonb_build_object(
         'accessToken',  value#>>'{credentials,accessToken}',
         'refreshToken', value#>>'{credentials,refreshToken}')))
FROM public.settings
WHERE key = 'bring_settings'
  AND (COALESCE(value#>>'{credentials,accessToken}', '') <> ''
       OR COALESCE(value#>>'{credentials,refreshToken}', '') <> '')
ON CONFLICT (family_id, key)
  DO UPDATE SET value = public.integration_secrets.value || EXCLUDED.value,
                updated_at = now();
UPDATE public.settings
SET value = jsonb_set(value, '{credentials}',
                      ((value->'credentials') - 'accessToken') - 'refreshToken')
WHERE key = 'bring_settings'
  AND jsonb_typeof(value->'credentials') = 'object'
  AND (value->'credentials' ? 'accessToken' OR value->'credentials' ? 'refreshToken');

NOTIFY pgrst, 'reload schema';
