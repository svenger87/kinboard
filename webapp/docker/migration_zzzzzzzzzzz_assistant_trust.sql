-- migration_zzzzzzzzzzz_assistant_trust.sql
-- "Trust this assistant": one switch per assistant connection, under
-- Settings -> Integrations. While it is on, what that assistant asks for
-- that would wait for a person on a Kinboard screen (a lock, the alarm, a
-- garage door, a scene, a pocket-money booking, a reward decision) runs at
-- once instead, through the same steps an approval runs.
--
-- integration_tokens.trusted_at / trusted_by_device_id
--   An assistant connection is ONE integration_tokens row: the refresh token
--   rotates in place on it (migration_oauth_mcp.sql), so a refreshed token
--   keeps its trust, and a new authorization -- a reconnect -- is a new row
--   that starts untrusted. Off for every existing row: the columns are added
--   NULL and nothing here sets them.
--
--   The trigger below holds two rules whatever writes the row:
--   * a row is never born trusted -- an INSERT always clears both columns,
--     so no authorization flow, refresh or replay can create trust;
--   * a revoked row, or one that is not an assistant connection
--     (oauth_client_id NULL: a hand-made token), is never trusted -- setting
--     revoked_at clears trust in the same UPDATE, from Settings' Revoke, the
--     "Allow AI assistants" switch going off, or a code replay alike.
--   The CHECK says the same, so a disabled trigger fails loudly rather than
--   leaving a revoked connection trusted.
--
--   Only the server writes these columns, from one session route that checks
--   the settings PIN (/api/assistants/{id}/trust). integration_tokens stays
--   REVOKEd from anon and authenticated (migration_integration_tokens.sql);
--   this file grants nothing.
--
-- assistant_action_requests.decided_by_trust
--   The record: true on a request nobody confirmed because the family trusted
--   the assistant. Such a row has no deciding device. Defaults to false, so
--   every existing row and every untrusted request reads as before.
--
-- messages.action_request_id
--   The quiet notice a trusted action leaves on the screens is a screen
--   message linked to its request. The link is what stops an assistant from
--   acknowledging the notice away (Integration API acknowledge answers 403).
--
-- Grants: nothing is granted or revoked. The browser roles keep SELECT on
-- their family's assistant_action_requests and messages rows; the new
-- columns come under the existing table privileges and RLS policies. Both
-- tables are already in supabase_realtime, and adding a column does not
-- change membership, so the realtime container needs no restart.
--
-- Sorts after migration_zzzzzzzzzz_reward_decision_kind.sql (and so after
-- migration_zzzz_assistant_actions.sql, migration_oauth_mcp.sql and
-- migration_messages.sql), in byte order and under an en_US glob alike.
-- Safe to run twice, and twice at once: the advisory lock makes a second
-- concurrent run wait, and each step only changes what is not already so.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzzzzz_assistant_trust', 0));

ALTER TABLE public.integration_tokens
  ADD COLUMN IF NOT EXISTS trusted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trusted_by_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.integration_tokens_trust_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.revoked_at IS NOT NULL OR NEW.oauth_client_id IS NULL THEN
    NEW.trusted_at := NULL;
    NEW.trusted_by_device_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.integration_tokens_trust_guard() FROM PUBLIC;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.integration_tokens'::regclass
      AND tgname = 'integration_tokens_trust_guard' AND NOT tgisinternal) THEN
    CREATE TRIGGER integration_tokens_trust_guard
      BEFORE INSERT OR UPDATE ON public.integration_tokens
      FOR EACH ROW EXECUTE FUNCTION public.integration_tokens_trust_guard();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.integration_tokens'::regclass
      AND conname = 'integration_tokens_trust_check') THEN
    ALTER TABLE public.integration_tokens
      ADD CONSTRAINT integration_tokens_trust_check CHECK (
        trusted_at IS NULL OR (revoked_at IS NULL AND oauth_client_id IS NOT NULL)
      );
  END IF;
END $$;

ALTER TABLE public.assistant_action_requests
  ADD COLUMN IF NOT EXISTS decided_by_trust BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.assistant_action_requests'::regclass
      AND conname = 'assistant_action_requests_trust_check') THEN
    ALTER TABLE public.assistant_action_requests
      ADD CONSTRAINT assistant_action_requests_trust_check CHECK (
        NOT decided_by_trust OR decided_by_device_id IS NULL
      );
  END IF;
END $$;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS action_request_id UUID REFERENCES public.assistant_action_requests(id) ON DELETE SET NULL;

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzzzzz_assistant_trust', 0));

NOTIFY pgrst, 'reload schema';
