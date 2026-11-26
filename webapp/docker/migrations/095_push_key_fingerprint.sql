-- migrations/095_push_key_fingerprint.sql — which VAPID key a push
-- subscription was made with (RFC-023 §6.4, §6.5).
--
-- A browser's push subscription only works with the server key pair it was
-- made with. When the pair changes (a restore without the config folder, a
-- regenerated vapid_* file, other keys in .env), every device stops getting
-- notifications and nothing says so. Each subscription now records the
-- fingerprint of the public key it belongs to (src/lib/push-key.ts: SHA-256 of
-- the key's bytes; the public key is public, nothing secret is stored), and
-- the install records the one it runs with (instance_settings
-- `push_vapid_key`).
--
-- kinboard.push_key_check(fingerprint) is what the webapp's entrypoint calls
-- on every start, after the migrations:
--   - rows without a fingerprint get the one the install recorded before, or,
--     on the first start with this migration, the current one (they were made
--     with the key the install runs with: nothing else existed);
--   - rows of another key that were already off when the key changed (no
--     vapid_key_retired_at) can never be used again and are removed;
--   - active rows of another key were made before the key changed. They can
--     never receive a push again, so they are switched off and marked with
--     vapid_key_retired_at. Settings lists those devices as needing push
--     turned on again, until each has done so or the family dismisses the
--     notice. A second key change keeps them listed: still no push;
--   - the current fingerprint is recorded.
-- It returns one row: the fingerprint recorded before, and how many rows it
-- backfilled, switched off and removed. A start without a VAPID key passes
-- NULL and nothing happens.
--
-- Additive: two nullable columns and a function. An older image ignores both
-- and inserts rows without a fingerprint, which the next start backfills.
--
-- Not exposed: the function lives in the kinboard schema, which PostgREST
-- does not serve, and only its owner may execute it.

ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS vapid_key_fingerprint TEXT;
-- When a start switched the subscription off because its key had changed. Tells
-- "had push until the key changed" apart from rows that were already off (the
-- device turned push off, the push service dropped it, it was replaced).
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS vapid_key_retired_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION kinboard.push_key_check(p_fingerprint TEXT)
RETURNS TABLE (previous TEXT, backfilled INTEGER, deactivated INTEGER, removed INTEGER)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  previous := NULL;
  backfilled := 0;
  deactivated := 0;
  removed := 0;
  IF p_fingerprint IS NULL OR p_fingerprint = '' THEN
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT value INTO previous FROM public.instance_settings WHERE key = 'push_vapid_key';

  UPDATE public.push_subscriptions
     SET vapid_key_fingerprint = coalesce(previous, p_fingerprint)
   WHERE vapid_key_fingerprint IS NULL;
  GET DIAGNOSTICS backfilled = ROW_COUNT;

  DELETE FROM public.push_subscriptions
   WHERE vapid_key_fingerprint <> p_fingerprint
     AND is_active IS NOT TRUE
     AND vapid_key_retired_at IS NULL;
  GET DIAGNOSTICS removed = ROW_COUNT;

  UPDATE public.push_subscriptions
     SET is_active = false, vapid_key_retired_at = now(), updated_at = now()
   WHERE vapid_key_fingerprint <> p_fingerprint AND is_active IS TRUE;
  GET DIAGNOSTICS deactivated = ROW_COUNT;

  INSERT INTO public.instance_settings (key, value)
  VALUES ('push_vapid_key', p_fingerprint)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
   WHERE public.instance_settings.value IS DISTINCT FROM EXCLUDED.value;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION kinboard.push_key_check(TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION kinboard.push_key_check(TEXT) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION kinboard.push_key_check(TEXT) FROM authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
