-- Soft delete + recycle bin.
--
-- A birthday was deleted by a child on the wall tablet and only missed weeks
-- later. It was a hard DELETE: no trace, and the only recovery was a maintainer
-- diffing three-month-old pg_dumps over SSH. One more month and it would have
-- been gone for good.
--
-- WHY THIS IS DONE IN THE DATABASE
--
-- Deletes do not go through API routes. Seventeen files call PostgREST
-- `.delete()` straight from the browser, and reads are just as direct. Rewriting
-- every call site is where the bugs would come from, and any one missed leaves a
-- hole. Two database-level changes cover all of them at once:
--
--   1. a BEFORE DELETE trigger that stamps deleted_at and returns NULL, which
--      cancels the delete. Every existing `.delete()` becomes a soft delete
--      with no client change.
--   2. `deleted_at IS NULL` added to the RLS policy, so every existing read
--      excludes deleted rows with no client change either.
--
-- Cancelling the delete also cancels the ON DELETE CASCADE, which is what makes
-- restore whole: soft-delete a recipe and its ingredients stay put, soft-delete
-- a person and their schedules and pocket-money account stay put. Nothing has to
-- know how to reassemble them.
--
-- WHAT IS IN SCOPE, AND WHAT IS NOT
--
-- Only locally authored content that cannot be got back another way.
--
--   * events are excluded on purpose. They carry google_event_id / caldav_href
--     and the syncers reconcile against the upstream calendar; a soft-deleted
--     event would either come back on the next sync or fight it. Deletion there
--     belongs to the source calendar.
--   * recipe_ingredients, recipe_tag_assignments and recipe_tags are excluded.
--     Editing a recipe deletes and re-inserts them, so a trigger there would
--     fill the recycle bin with junk on every save. Recipe deletion itself is a
--     plain delete on `recipes`, which the trigger cancels, so the children
--     survive untouched.
--   * settings, secrets, devices, calendars, push subscriptions and the rest are
--     configuration. Recreating them is setup, not loss.
--
-- Idempotent: safe to re-run.
--
-- The `zzz` in the filename is load-bearing. Migrations apply in alphabetical
-- order, and `migration_zz_row_level_security.sql` drops and recreates every
-- family-scope policy on every boot. Sorting before it would mean the
-- `deleted_at IS NULL` predicate added in section 3 is wiped on the next
-- restart — with deleted rows quietly reappearing across the whole app — and on
-- a fresh install there would be no policies to amend yet.

-- ---------------------------------------------------------------------------
-- 1. deleted_at
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'birthdays', 'birthday_gift_ideas', 'notes', 'todos', 'subjects',
    'meal_plan_entries', 'pocket_money_goals', 'recipes', 'people'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
      -- Partial index: the recycle bin asks for the few deleted rows, never the
      -- many live ones, so indexing only the deleted side keeps it small.
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS idx_%I_deleted_at ON public.%I (deleted_at) WHERE deleted_at IS NOT NULL',
        t, t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The trigger that turns DELETE into UPDATE
-- ---------------------------------------------------------------------------
--
-- Returning NULL from a BEFORE DELETE trigger tells Postgres to skip the row.
-- The UPDATE is issued first, so the row survives with deleted_at set.
--
-- The purge needs to delete for real. It sets kinboard.hard_delete = 'on' for
-- its transaction; the trigger then steps aside. `true` as the second argument
-- to current_setting means "return NULL if unset" rather than raising.
CREATE OR REPLACE FUNCTION public.soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('kinboard.hard_delete', true), 'off') = 'on' THEN
    RETURN OLD;
  END IF;

  -- Already in the bin: let the real delete through so a second delete is a
  -- purge rather than a no-op that silently refuses.
  IF OLD.deleted_at IS NOT NULL THEN
    RETURN OLD;
  END IF;

  EXECUTE format('UPDATE public.%I SET deleted_at = now() WHERE id = $1', TG_TABLE_NAME)
    USING OLD.id;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'birthdays', 'birthday_gift_ideas', 'notes', 'todos', 'subjects',
    'meal_plan_entries', 'pocket_money_goals', 'recipes', 'people'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_soft_delete', t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.soft_delete()',
        t || '_soft_delete', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Hide deleted rows from every existing query
-- ---------------------------------------------------------------------------
--
-- Each of these tables carries a single `FOR ALL` policy scoping to the family.
-- Adding the predicate there covers SELECT without touching a line of client
-- code. It also stops a deleted row being updated or re-deleted through
-- PostgREST, which is correct: restore and purge run server-side with the
-- service role, which bypasses RLS entirely.
DO $$
DECLARE
  t text;
  pol text;
  existing_qual text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'birthdays', 'birthday_gift_ideas', 'notes', 'todos', 'subjects',
    'meal_plan_entries', 'pocket_money_goals', 'recipes', 'people'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    FOR pol, existing_qual IN
      SELECT policyname, qual FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd = 'ALL'
    LOOP
      -- Append to whatever scoping the table already uses rather than assuming
      -- one. Most scope on family_id, but meal_plan_entries reaches its family
      -- through meal_plans and pocket_money_goals through pocket_money_accounts,
      -- both as EXISTS subqueries. Replacing their qual with a family_id test
      -- would reference a column those tables do not have.
      IF existing_qual IS NOT NULL AND existing_qual NOT LIKE '%deleted_at IS NULL%' THEN
        EXECUTE format(
          'ALTER POLICY %I ON public.%I USING ((%s) AND deleted_at IS NULL)',
          pol, t, existing_qual);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3b. Hide what a binned person owns, without binning it separately
-- ---------------------------------------------------------------------------
--
-- `pocket_money_accounts` and `schedules` are ON DELETE CASCADE children of
-- `people`, and cancelling the person's delete cancels theirs — which is what
-- makes a restore whole. But they carry no `deleted_at` of their own, so they
-- stay readable, and the pocket-money page renders an account card with no name
-- on it: the account is visible, its owner is not.
--
-- Rather than giving them their own soft delete, their policies test the
-- owner's. They disappear while the person sits in the bin and come back the
-- moment the person is restored, with no second thing to keep in step.
DO $$
DECLARE
  t text;
  pol text;
  existing_qual text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pocket_money_accounts', 'schedules'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    FOR pol, existing_qual IN
      SELECT policyname, qual FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd = 'ALL'
    LOOP
      IF existing_qual IS NOT NULL AND existing_qual NOT LIKE '%people%deleted_at%' THEN
        EXECUTE format(
          'ALTER POLICY %I ON public.%I USING ((%s) AND NOT EXISTS ('
          || 'SELECT 1 FROM public.people p WHERE p.id = public.%I.person_id '
          || 'AND p.deleted_at IS NOT NULL))',
          pol, t, existing_qual, t);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Retention default
-- ---------------------------------------------------------------------------
-- How long the bin keeps things, in days. Configurable in Settings; the purge
-- reads it. 0 disables purging entirely (keep forever).
INSERT INTO public.settings (family_id, key, value)
SELECT f.id, 'recycle_bin', '{"retentionDays": 30}'::jsonb
FROM public.families f
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings s WHERE s.family_id = f.id AND s.key = 'recycle_bin'
);

-- ---------------------------------------------------------------------------
-- 5. Purge
-- ---------------------------------------------------------------------------
--
-- Purging has to go through these functions rather than a plain DELETE.
--
-- A plain DELETE on a row that is already in the bin does get through — the
-- trigger steps aside for it. But its ON DELETE CASCADEs do not: each cascaded
-- child hits its own trigger with deleted_at still NULL, gets soft-deleted, and
-- the parent goes away leaving a row pointing at nothing. Postgres does not
-- re-check the constraint after a cascade is suppressed, so this is silent.
--
-- Setting kinboard.hard_delete for the transaction makes every trigger stand
-- down, cascades included, which is the only way a purge leaves nothing behind.
-- `true` scopes the setting to the current transaction.

CREATE OR REPLACE FUNCTION public.purge_deleted(p_table text, p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF p_table NOT IN (
    'birthdays', 'birthday_gift_ideas', 'notes', 'todos', 'subjects',
    'meal_plan_entries', 'pocket_money_goals', 'recipes', 'people'
  ) THEN
    RAISE EXCEPTION 'purge_deleted: % is not a recyclable table', p_table;
  END IF;

  PERFORM set_config('kinboard.hard_delete', 'on', true);
  -- deleted_at IS NOT NULL: only what is already in the bin can be purged, so
  -- this can never become a back door around the soft delete.
  EXECUTE format('DELETE FROM public.%I WHERE id = $1 AND deleted_at IS NOT NULL', p_table)
    USING p_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- The nightly sweep. Retention is per family, so the cutoff is too. 0 days
-- means keep forever and skips the family; an absent setting means the default.
CREATE OR REPLACE FUNCTION public.purge_expired()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fam record;
  t text;
  days integer;
  cutoff timestamptz;
  n integer;
  total integer := 0;
BEGIN
  PERFORM set_config('kinboard.hard_delete', 'on', true);

  FOR fam IN SELECT id FROM public.families LOOP
    SELECT coalesce((s.value ->> 'retentionDays')::integer, 30) INTO days
      FROM public.settings s
      WHERE s.family_id = fam.id AND s.key = 'recycle_bin';

    days := coalesce(days, 30);
    CONTINUE WHEN days <= 0;
    cutoff := now() - make_interval(days => days);

    FOREACH t IN ARRAY ARRAY[
      'birthdays', 'birthday_gift_ideas', 'notes', 'todos', 'subjects',
      'recipes', 'people'
    ] LOOP
      IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
      EXECUTE format(
        'DELETE FROM public.%I WHERE family_id = $1 AND deleted_at IS NOT NULL AND deleted_at < $2', t)
        USING fam.id, cutoff;
      GET DIAGNOSTICS n = ROW_COUNT;
      total := total + n;
    END LOOP;

    -- The two that reach their family through a parent.
    DELETE FROM public.meal_plan_entries e
      USING public.meal_plans m
      WHERE e.meal_plan_id = m.id AND m.family_id = fam.id
        AND e.deleted_at IS NOT NULL AND e.deleted_at < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;

    DELETE FROM public.pocket_money_goals g
      USING public.pocket_money_accounts a
      WHERE g.account_id = a.id AND a.family_id = fam.id
        AND g.deleted_at IS NOT NULL AND g.deleted_at < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;

  RETURN total;
END $$;

-- Both are reachable only with the service role. The API route checks that the
-- row belongs to the caller's family before calling purge_deleted; nothing
-- below it re-checks, so a browser must never be able to reach either.
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.purge_deleted(text, uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.purge_expired() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.purge_deleted(text, uuid) FROM anon;
    REVOKE ALL ON FUNCTION public.purge_expired() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.purge_deleted(text, uuid) FROM authenticated;
    REVOKE ALL ON FUNCTION public.purge_expired() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.purge_deleted(text, uuid) TO service_role;
    GRANT EXECUTE ON FUNCTION public.purge_expired() TO service_role;
  END IF;
END $$;
