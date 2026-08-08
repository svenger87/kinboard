-- migration_zzy_integration_idempotency.sql — make Integration API writes safe
-- to retry (RFC-001 §3).
--
-- Home Assistant automations retry. A flaky wifi link, a restart mid-request,
-- a `retry` in a script — and "add milk to the shopping list" runs twice. The
-- household then finds milk on the list twice and has no way to know why.
--
-- So every write carries an Idempotency-Key and the result is remembered. A
-- repeat returns the original response without doing the work again.
--
-- `zzy` for the same reason as the domain events file: it sorts after every
-- migration that creates a table it references.

CREATE TABLE IF NOT EXISTS public.integration_idempotency (
  family_id       UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,

  -- Client-chosen. Scoped per family, not globally: two households must be
  -- able to use the same key without colliding, and a key from one family
  -- must never return another family's stored response.
  idempotency_key TEXT NOT NULL,

  service         TEXT NOT NULL,

  -- SHA-256 of the request body. The point of storing it: if the same key
  -- arrives with DIFFERENT arguments, that is a client bug — two different
  -- operations sharing one key — and returning the first response would
  -- silently discard the second request. That case answers 409 instead.
  request_hash    TEXT NOT NULL,

  status          INT NOT NULL,
  response        JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (family_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_integration_idempotency_created
  ON public.integration_idempotency (created_at);

-- Stored responses echo back what was written — a task title, a shopping item.
-- Same protection as the other integration tables: service_role only.
REVOKE ALL ON TABLE public.integration_idempotency FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.integration_idempotency FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.integration_idempotency FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.integration_idempotency TO service_role;
  END IF;
END $$;

-- Retention is short by design. These records exist to absorb a retry, and a
-- retry happens within seconds or minutes — not days. Keeping them longer
-- would mean a key reused a week later returns a week-old response, which is
-- far more surprising than doing the work again.
CREATE OR REPLACE FUNCTION public.purge_integration_idempotency(p_keep_hours INT DEFAULT 24)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  DELETE FROM public.integration_idempotency
   WHERE created_at < now() - make_interval(hours => greatest(p_keep_hours, 1));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_integration_idempotency(INT) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
