-- migration_zzzz_assistant_actions.sql
-- What assistants asked Home Assistant to do, and who said yes. RFC-011 §4.3, §5.
--
-- One row per assistant home action:
--
-- - A sensitive action (a lock, an alarm panel, a garage door, a script, …)
--   is stored `pending` and runs only after a family member approves it on a
--   Kinboard screen with the settings PIN. It then becomes `approved` and,
--   once Home Assistant has answered, `done` or `failed`. Deny, expiry
--   (`expires_at`, two minutes) or a revoked assistant end it without running
--   anything: `denied` / `expired`.
-- - A non-sensitive action runs at once, and is recorded here afterwards as
--   `done` or `failed`, so every action is attributable to the assistant
--   (the token) that asked for it (RFC-011 §7).
--
-- The screens read pending rows through the session route
-- `/api/assistant-actions`; realtime tells them when to read again. So the
-- browser roles may SELECT their own family's rows (RLS) and nothing else —
-- every write goes through the server, which is the only thing that may
-- decide a request or run it.
--
-- Sorts after migration_catalogue_items.sql, migration_oauth_mcp.sql (which
-- adds the integration_tokens columns the routes read) and
-- migration_zz_row_level_security.sql. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.assistant_action_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id            UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: the record of what an assistant did outlives the
  -- token. A pending request whose token is gone is treated as revoked.
  token_id             UUID REFERENCES public.integration_tokens(id) ON DELETE SET NULL,
  client_name          TEXT NOT NULL CHECK (char_length(client_name) <= 200),
  entity_id            TEXT NOT NULL CHECK (char_length(entity_id) <= 255),
  entity_name          TEXT NOT NULL CHECK (char_length(entity_name) <= 200),
  domain               TEXT NOT NULL CHECK (char_length(domain) <= 64),
  service              TEXT NOT NULL CHECK (char_length(service) <= 64),
  -- Validated and rebuilt by the policy before it is stored; run exactly as is.
  data                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'failed', 'done')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  decided_at           TIMESTAMPTZ,
  -- The screen that approved or denied it. NULL for an action that needed no
  -- confirmation, and for one ended by expiry or revocation.
  decided_by_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  -- Only Home Assistant's HTTP status ({"status": 200}), plus a `reason` when
-- it was never reached or its outcome is unknown; never its body.
  result               JSONB
);

-- The screens ask "what is pending for this family"; the integration route
-- asks for one id.
CREATE INDEX IF NOT EXISTS assistant_action_requests_pending_idx
  ON public.assistant_action_requests (family_id, created_at DESC)
  WHERE status = 'pending';

-- Named `*_family_scope` so migration_zz_row_level_security.sql's clean-up
-- loop leaves it alone on every run. The first version of this file called it
-- `_family_read`; dropped here so an install that ran that version ends with
-- exactly one policy.
ALTER TABLE public.assistant_action_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_action_requests_family_read ON public.assistant_action_requests;
DROP POLICY IF EXISTS assistant_action_requests_family_scope ON public.assistant_action_requests;
CREATE POLICY assistant_action_requests_family_scope ON public.assistant_action_requests
  FOR SELECT USING (family_id = public.current_family_id());

-- Read-only for the browser roles, as the other assistant tables: the Supabase
-- image's blanket GRANT ALL would otherwise let a screen's own token approve a
-- request by UPDATE through PostgREST, skipping the PIN. SELECT stays for
-- `authenticated` (filtered by the policy above) because realtime checks it
-- before delivering a change to a screen.
REVOKE ALL ON TABLE public.assistant_action_requests FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.assistant_action_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.assistant_action_requests FROM authenticated;
    GRANT SELECT ON TABLE public.assistant_action_requests TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.assistant_action_requests TO service_role;
  END IF;
END $$;

-- Realtime, or a request sits unseen until the 10-second poll. After this
-- runs on a live install, the realtime container must be restarted: it reads
-- the publication when it starts.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'assistant_action_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.assistant_action_requests;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
