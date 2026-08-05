-- Server-issued device sessions.
--
-- Until now the only thing standing between the internet and a family's data
-- was the family_id UUID appearing in every API URL. The cookie the app set
-- (`family-calendar-storage`) is the Zustand store serialised to JSON by
-- document.cookie: not HttpOnly, unsigned, and never read by the server. It
-- is client state, not a credential.
--
-- This table holds credentials the server issued and can revoke.
--
-- Only the SHA-256 of the token is stored. A dump of this table therefore
-- doesn't hand anyone a working session, the same reason password hashes
-- exist. The plaintext lives in the client's cookie and nowhere else.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.device_sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- SHA-256 of the session token, hex encoded. Unique so a lookup by hash
    -- is a single index probe and a collision can't silently share a session.
    token_hash    TEXT NOT NULL UNIQUE,
    family_id     UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    -- The device may be removed while its session is still current; the
    -- session survives so the request can still be attributed to the family.
    device_id     UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    -- Touched at most once an hour, not on every request: this is for "when
    -- did that tablet last check in", not an access log, and writing on every
    -- request would put a write in front of every read.
    last_used_at  TIMESTAMPTZ,
    -- Set rather than deleted, so signing a device out is auditable.
    revoked_at    TIMESTAMPTZ,
    -- Free-text, for a future "your sessions" screen.
    user_agent    TEXT
);

-- The verification path: look up by hash, reject if revoked or expired.
CREATE INDEX IF NOT EXISTS idx_device_sessions_lookup
    ON public.device_sessions (token_hash)
    WHERE revoked_at IS NULL;

-- "Sign out every device in this family", and the expiry sweep.
CREATE INDEX IF NOT EXISTS idx_device_sessions_family
    ON public.device_sessions (family_id);

CREATE INDEX IF NOT EXISTS idx_device_sessions_expiry
    ON public.device_sessions (expires_at)
    WHERE revoked_at IS NULL;

-- RLS is disabled across this schema by design (see SECURITY.md); this table
-- follows the same rule so it doesn't behave differently from its neighbours.
-- (Superseded: migration_zz_row_level_security.sql now enables RLS on every
-- table including this one. Left in place because it runs before that file.)
ALTER TABLE public.device_sessions DISABLE ROW LEVEL SECURITY;

-- The browser must never touch this table.
--
-- It used to hold SELECT, INSERT, UPDATE and DELETE here, from when RLS was
-- off schema-wide and every table was granted alike. Nothing in the app needs
-- it: session.ts is the only consumer and it goes through the service role.
-- What the grant did allow, for anyone able to make a PostgREST call as their
-- own family, was to write their own credentials — INSERT a row with a chosen
-- token hash and a far-future expiry to mint a session that never ends, clear
-- revoked_at to undo a sign-out, or DELETE to sign the kitchen display out.
-- That is the same failure the ON DELETE SET NULL foreign key caused, reached
-- through a different door: a credential outliving the control meant to end it.
--
-- Row-level security stays as the second layer, but the grant is the first.
REVOKE ALL ON TABLE public.device_sessions FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.device_sessions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.device_sessions FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.device_sessions TO service_role;
  END IF;
END $$;
