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
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'birthdays', 'birthday_gift_ideas', 'notes', 'todos', 'subjects',
    'meal_plan_entries', 'pocket_money_goals', 'recipes', 'people'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND cmd = 'ALL'
    LOOP
      -- Only rewrite policies that do not already carry the predicate, so
      -- re-running does not stack it.
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t AND policyname = pol
          AND qual LIKE '%deleted_at IS NULL%'
      ) THEN
        EXECUTE format(
          'ALTER POLICY %I ON public.%I USING (family_id = current_family_id() AND deleted_at IS NULL)',
          pol, t);
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
