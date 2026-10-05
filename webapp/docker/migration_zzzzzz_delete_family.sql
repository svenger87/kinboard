-- migration_zzzzzz_delete_family.sql — deleting a family deletes all of it (#344).
--
-- DELETE /api/family used to delete the family row with a plain DELETE. Its
-- ON DELETE CASCADEs reach the recycle-bin tables, and each of their
-- soft_delete() triggers (migration_zzz_soft_delete.sql) turned the cascaded
-- delete into `UPDATE ... SET deleted_at = now()`. Two results:
--
--   1. The family's tasks, people, notes, birthdays, ... stayed in the
--      database, binned, with a family_id that points at nothing.
--      purge_expired() loops over `families`, so it never reached them.
--   2. A task assigned to a person who was already in the bin failed the
--      whole delete. The binned person is really deleted, the task's
--      person_id is set null, and then the task's own cascade becomes its
--      soft-delete UPDATE: a second update of the same row in one transaction,
--      so Postgres re-checks todos_family_id_fkey against the family being
--      deleted, and raises.
--
-- The purge already solved this: kinboard.hard_delete set for the transaction
-- makes every soft-delete trigger stand down, cascades included. PostgREST
-- cannot set a transaction-local setting, so the delete goes through this
-- function, and every caller (the route, and the rollbacks when creating or
-- importing a family) calls it by rpc.
--
-- Sorted after migration_zzz_soft_delete.sql and migration_zzzzzy_todo_turns.sql
-- (the triggers it cleans up after), and before
-- migration_zzzzzz_families_server_only.sql, which must stay the last file to
-- touch `families` (e2e/families-grants.spec.ts). Idempotent: the entrypoint
-- re-runs every migration on every boot.

-- ---------------------------------------------------------------------------
-- 1. delete_family
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_family(p_family_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE n integer;
BEGIN
  -- `true`: for this transaction only, exactly as purge_deleted() sets it.
  PERFORM set_config('kinboard.hard_delete', 'on', true);
  DELETE FROM public.families WHERE id = p_family_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;

-- Only the service role. The route checks the session and the typed-back name
-- before calling it; nothing in here re-checks, so a browser must never reach it.
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.delete_family(uuid) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.delete_family(uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.delete_family(uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.delete_family(uuid) TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. What earlier family deletes left behind
-- ---------------------------------------------------------------------------
--
-- Every table carrying the soft_delete() trigger, and in each the rows whose
-- ON DELETE CASCADE parent no longer exists: a family for most of them, a
-- meal plan for meal_plan_entries, a pocket-money account for
-- pocket_money_goals, a birthday for birthday_gift_ideas. Had those parents
-- been deleted with hard_delete set, the rows would have gone with them; no
-- live row points at a parent that is gone, so nothing live can match.
--
-- The tables and their foreign keys are read from the catalogue, so a table
-- that gains the trigger later is covered without editing this file.
--
-- Dependents go first (tasks before the people they are assigned to, gift
-- ideas before their birthdays), so no row is updated twice by an
-- ON DELETE SET NULL on its way out -- the double update that made the
-- original delete fail. Each table runs in its own subtransaction: a cleanup
-- that cannot finish raises a warning and leaves that table for the next
-- boot, rather than stopping the app from starting.
DO $$
DECLARE
  t text;
  fk record;
  n integer;
  orphan_test text;
  dependents_first CONSTANT text[] := ARRAY[
    'birthday_gift_ideas', 'meal_plan_entries', 'pocket_money_goals',
    'todos', 'notes', 'birthdays', 'subjects', 'recipes', 'people'
  ];
BEGIN
  PERFORM set_config('kinboard.hard_delete', 'on', true);

  FOR t IN
    SELECT c.relname
      FROM pg_trigger tg
      JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND tg.tgfoid = 'public.soft_delete()'::regprocedure
       AND NOT tg.tgisinternal
     GROUP BY c.relname
     ORDER BY coalesce(array_position(dependents_first, c.relname::text), 1000), c.relname
  LOOP
    orphan_test := NULL;
    FOR fk IN
      SELECT a.attname AS col, pc.relname AS parent, pa.attname AS parent_col
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        JOIN pg_class pc ON pc.oid = con.confrelid
        JOIN pg_namespace pns ON pns.oid = pc.relnamespace
        JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
       WHERE con.conrelid = format('public.%I', t)::regclass
         AND con.contype = 'f'
         AND con.confdeltype = 'c'
         AND pns.nspname = 'public'
         AND array_length(con.conkey, 1) = 1
    LOOP
      orphan_test := concat_ws(' OR ', orphan_test, format(
        '(o.%1$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%2$I p WHERE p.%3$I = o.%1$I))',
        fk.col, fk.parent, fk.parent_col));
    END LOOP;
    CONTINUE WHEN orphan_test IS NULL;

    BEGIN
      EXECUTE format('DELETE FROM public.%I o WHERE %s', t, orphan_test);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN
        RAISE NOTICE 'delete_family cleanup: removed % orphaned row(s) from %', n, t;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'delete_family cleanup: % left for the next run: %', t, SQLERRM;
    END;
  END LOOP;
END $$;
