-- migration_zzzz_revoke_truncate.sql — take TRUNCATE off the browser roles.
--
-- Every other privilege anon and authenticated hold on these tables is
-- filtered by row-level security: a SELECT, UPDATE or DELETE can only reach
-- rows whose family_id matches the caller's JWT claim. TRUNCATE is the
-- exception. It is not a row operation, so no policy applies to it, and a role
-- holding it empties the table for **every family on the instance** — on a
-- shared or multi-family install, other people's data.
--
-- The Supabase image grants it as part of a blanket
-- `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`, so every
-- table has carried it since the beginning except the few whose own migrations
-- happened to REVOKE ALL (domain_events, integration_tokens, and now
-- attention_items).
--
-- HOW REACHABLE IS IT
--
-- Not, today. PostgREST issues SELECT/INSERT/UPDATE/DELETE and never TRUNCATE,
-- and it is the only path a browser has to the database. That is a reason not
-- to depend on it rather than a reason to leave it: the privilege has no
-- legitimate use here, and "the client library happens not to emit that
-- statement" is a thin thing to be relying on.
--
-- SCOPE
--
-- TRUNCATE only. TRIGGER and REFERENCES are granted by the same blanket and
-- are also useless to a browser, but revoking them is a change whose blast
-- radius is harder to bound — creating a trigger additionally needs EXECUTE on
-- a function and CREATE on the schema, neither of which these roles have, so
-- they buy far less than this one does. Left deliberately, not overlooked.
--
-- Sorted last (`zzzz`) so it runs after every migration that creates a table,
-- including any added later. It re-runs on every boot, which is what keeps new
-- tables covered without anybody having to remember.

DO $$
DECLARE
  t TEXT;
  revoked INT := 0;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'   -- ordinary tables; views cannot be truncated
  LOOP
    -- has_table_privilege rather than revoking unconditionally, so the notice
    -- below reports what actually changed rather than how many tables exist.
    IF has_table_privilege('anon', format('public.%I', t), 'TRUNCATE')
       OR has_table_privilege('authenticated', format('public.%I', t), 'TRUNCATE')
    THEN
      EXECUTE format('REVOKE TRUNCATE ON public.%I FROM anon, authenticated', t);
      revoked := revoked + 1;
    END IF;
  END LOOP;

  IF revoked > 0 THEN
    RAISE NOTICE 'revoked TRUNCATE from anon/authenticated on % table(s)', revoked;
  END IF;
END $$;
