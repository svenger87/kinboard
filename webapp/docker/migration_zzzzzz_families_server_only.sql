-- migration_zzzzzz_families_server_only.sql — only the server creates or
-- deletes a family.
--
-- The browser roles held INSERT and DELETE on `families` from the Supabase
-- image's blanket grant, and the table's row-level security policy was
-- FOR ALL. Together that let a family's own token delete the family through
-- the database API, and the delete cascades to everything the family owns.
-- The intended path is DELETE /api/family, which needs a session and the
-- family's name typed back as confirmation.
--
-- What the browser does with `families` (src/hooks/use-supabase-queries.ts):
--   SELECT  its own row (useValidateStoredFamily)
--   UPDATE  its own row (useRenameFamily, useRegenerateJoinCode)
-- Nothing in the browser inserts or deletes one. Creating a family is
-- /api/session/create and deleting it is /api/family, both on the service
-- role, which these revokes do not touch.
--
-- Two layers, on purpose. migration_zz_row_level_security.sql now defines
-- only SELECT and UPDATE policies on `families`, so a DELETE would match no
-- rows; the REVOKE makes it a permission error instead, and it holds even if
-- a broader policy ever comes back.
--
-- Sorted after every other migration (`zzzzzz`) and idempotent: REVOKE of a
-- privilege that is not held is a no-op, so this is safe on every boot.

REVOKE INSERT, DELETE ON TABLE public.families FROM anon, authenticated;

-- The FOR ALL policy this replaces, in case a database still carries it from
-- before migration_zz_row_level_security.sql stopped creating it. That file
-- already drops it; this is only so the two layers never depend on each other.
DROP POLICY IF EXISTS families_family_scope ON public.families;
