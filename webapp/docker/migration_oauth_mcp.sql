-- AI assistants through a built-in MCP endpoint (RFC-010).
--
-- An approved assistant connection is ONE integration_tokens row: the access
-- token lives in token_hash/expires_at exactly like a manual token, so the
-- existing check (evaluateToken) needs no change. The refresh token rotates
-- in place on the same row, which is why revoking it in Settings ends the
-- connection rather than one link of a chain.
--
-- Sorts after migration_integration_tokens.sql ('o' > 'i'), which creates the
-- table. Safe to run twice: the entrypoint applies every file on every start.

ALTER TABLE public.integration_tokens
  ADD COLUMN IF NOT EXISTS oauth_client_id    TEXT,
  ADD COLUMN IF NOT EXISTS resource           TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_tokens_refresh
  ON public.integration_tokens (refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;

-- Clients that registered through DCR. Registration is anonymous (RFC 7591),
-- so these are not family-scoped; a client is only an identity and a list of
-- redirect URIs until a family approves it.
CREATE TABLE IF NOT EXISTS public.oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT NOT NULL,
  redirect_uris TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per authorization attempt: pending until a family approves it,
-- then holding the code until it is redeemed once. family_id stays NULL while
-- pending, because nobody has said which family yet.
CREATE TABLE IF NOT EXISTS public.oauth_authorization_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT NOT NULL,
  client_name     TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  state           TEXT,
  code_challenge  TEXT NOT NULL,
  scopes          TEXT[] NOT NULL,
  resource        TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  family_id       UUID REFERENCES public.families(id) ON DELETE CASCADE,
  granted_scopes  TEXT[],
  code_hash       TEXT UNIQUE,
  code_expires_at TIMESTAMPTZ,
  used_at         TIMESTAMPTZ,
  grant_id        UUID REFERENCES public.integration_tokens(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_authorization_requests_expiry
  ON public.oauth_authorization_requests (expires_at);

-- Code replay (OAuth 2.1 §4.1.3): a code presented twice must revoke what
-- the first presentation produced — including when both arrive together and
-- the second is answered before the first has written its grant.
--
-- oauth_request_id: the authorization request a connection was minted from,
-- written in the same INSERT as the grant, so there is no moment where the
-- grant exists but cannot be found from its request (grant_id on the request
-- is only linked a statement later). Not a foreign key: requests are swept,
-- and a connection must outlive the request that started it.
--
-- replayed_at: set by the second presentation before it revokes by
-- oauth_request_id. The first presentation checks it after inserting its
-- grant. One of the two always sees the other's write, so the connection
-- cannot survive a replay however the two interleave.
ALTER TABLE public.integration_tokens
  ADD COLUMN IF NOT EXISTS oauth_request_id UUID;
ALTER TABLE public.oauth_authorization_requests
  ADD COLUMN IF NOT EXISTS replayed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_integration_tokens_oauth_request
  ON public.integration_tokens (oauth_request_id)
  WHERE oauth_request_id IS NOT NULL;

-- Same protection as integration_tokens: nothing for anon/authenticated,
-- everything for service_role. The routes are the only way in.
REVOKE ALL ON TABLE public.oauth_clients FROM PUBLIC;
REVOKE ALL ON TABLE public.oauth_authorization_requests FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.oauth_clients FROM anon;
    REVOKE ALL ON TABLE public.oauth_authorization_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.oauth_clients FROM authenticated;
    REVOKE ALL ON TABLE public.oauth_authorization_requests FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.oauth_clients TO service_role;
    GRANT ALL ON TABLE public.oauth_authorization_requests TO service_role;
  END IF;
END $$;
