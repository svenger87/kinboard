-- migration_pin_secret.sql — move the settings PIN out of the anon-readable
-- `settings` table into the server-only `integration_secrets` table.
-- `settings` is readable by the browser via PostgREST (anon key, RLS
-- disabled) and via the realtime publication, so the raw PIN sat where
-- any device on the network could read it. `integration_secrets` grants
-- nothing to anon/authenticated — only the Next.js server (service_role)
-- can read it, and PIN verification now happens server-side in /api/pin.
--
-- Fresh installs never write a settings_pin row (the PIN dialog now goes
-- straight through /api/pin), so init.sql needs no equivalent seed logic —
-- this migration only matters for upgrading existing installs.
--
-- The settings.value column stores a bare JSON string for this key (e.g.
-- "1234", written by the old client-side useUpdateSetting call), not an
-- object — `value #>> '{}'` extracts the unquoted text from that JSON
-- scalar (unlike `value->>'pin'`, which would look for an object field
-- named "pin" and return NULL).

INSERT INTO public.integration_secrets (family_id, key, value)
SELECT family_id, 'settings_pin', jsonb_build_object('pin', value #>> '{}')
FROM public.settings
WHERE key = 'settings_pin'
  AND value IS NOT NULL
  AND value::text <> 'null'
  AND COALESCE(value #>> '{}', '') <> ''
ON CONFLICT (family_id, key) DO NOTHING;

DELETE FROM public.settings WHERE key = 'settings_pin';

NOTIFY pgrst, 'reload schema';
