-- migration_integration_tokens.sql — machine credentials for the Integration
-- API (RFC-001 §4, §6.3).
--
-- These are NOT family-member credentials. A join code, a settings PIN and a
-- device session all identify a person at a screen; an integration token
-- identifies a program — Home Assistant today, the Bridge later — and carries
-- an explicit, narrower set of permissions. Reusing a family credential for a
-- machine would mean a program holding everything a person can do, with no way
-- to revoke one without disturbing the other.
--
-- Protection follows integration_secrets exactly: privileges are REVOKEd from
-- anon and authenticated and GRANTed only to service_role. That is stronger
-- than RLS here — RLS still exposes the table through PostgREST and merely
-- returns no rows, whereas a revoked privilege means the endpoint does not
-- exist for the browser at all. Token hashes must never be reachable from a
-- device on the household network.
--
-- Neither table is added to the supabase_realtime publication. Membership is
-- explicit in this project (`puballtables = false`), so a new table is not
-- published by default — but it is worth stating, because a token hash inside
-- a realtime broadcast would defeat everything above.

-- ---------------------------------------------------------------- tokens

CREATE TABLE IF NOT EXISTS public.integration_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id    UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

  -- Shown in Settings so a household can tell two tokens apart a year later
  -- ("Home Assistant", "Bridge — kitchen"). Not a secret.
  name         TEXT NOT NULL,

  -- SHA-256 hex of the token, matching public.sessions and lib/session.ts.
  -- The plaintext exists once, in the response that creates it, and is never
  -- stored. A leaked database therefore yields no usable credential.
  token_hash   TEXT NOT NULL UNIQUE,

  -- e.g. {family:read, shopping:write}. Deliberately no CHECK constraint
  -- against a fixed list: RFC-001 says scopes may be added over time, and a
  -- constraint here would make every addition a schema migration while the
  -- server already validates on issue. The authoritative list lives in
  -- lib/integration-auth.ts.
  scopes       TEXT[] NOT NULL DEFAULT '{}',

  expires_at   TIMESTAMPTZ,
  -- Heartbeat, not an access log — written at most hourly (see
  -- LAST_USED_REFRESH_MS in lib/session.ts, the same reasoning).
  last_used_at TIMESTAMPTZ,

  -- Revocation keeps the row rather than deleting it: the name and last_used_at
  -- are what let someone answer "what was this, and was it still in use?"
  -- after they revoke it. A revoked token is refused exactly like an unknown
  -- one.
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The hot path is "hash -> token", on every Integration API request. UNIQUE on
-- token_hash already provides that index; this one serves the Settings list.
CREATE INDEX IF NOT EXISTS idx_integration_tokens_family
  ON public.integration_tokens (family_id, created_at DESC);

-- --------------------------------------------------------------- clients

CREATE TABLE IF NOT EXISTS public.integration_clients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id      UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

  -- Which token it authenticated with. ON DELETE SET NULL rather than CASCADE:
  -- if a token is ever hard-deleted, the record that something connected is
  -- still worth having.
  token_id       UUID REFERENCES public.integration_tokens(id) ON DELETE SET NULL,

  client_type    TEXT NOT NULL,      -- 'home_assistant' | 'bridge' | ...
  client_version TEXT,
  capabilities   JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integration_clients_family
  ON public.integration_clients (family_id, last_seen_at DESC);

-- ------------------------------------------------------------ privileges

REVOKE ALL ON TABLE public.integration_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.integration_clients FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.integration_tokens FROM anon;
    REVOKE ALL ON TABLE public.integration_clients FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.integration_tokens FROM authenticated;
    REVOKE ALL ON TABLE public.integration_clients FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.integration_tokens TO service_role;
    GRANT ALL ON TABLE public.integration_clients TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
