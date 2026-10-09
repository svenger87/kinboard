-- migration_zzzzzzzzzzzz_point_adjustments.sql
-- A parent adds or removes a child's points by hand (discussion #349): a
-- bonus for something that was no task, or a correction for a task that was
-- given the wrong points.
--
-- WHERE THEY LIVE. In todo_point_awards, as rows of kind 'adjustment': no
-- task, a signed number of points and a parent's note. Every reader of a
-- child's points already sums that table -- point_person_totals() (the
-- balance, which reward requests, approvals, purchases, the Integration API
-- and the assistants all go through), the screens' pointTotals(), the
-- creature's stage, the week summary, and export and import -- so an
-- adjustment counts everywhere at once, with no second sum to keep in step.
--
--   kind   'task'        what a ticked task awarded (every row before this)
--          'adjustment'  a parent's, from Settings -> Creatures & rewards
--   note   the parent's reason, shown in the list of adjustments
--
-- A task's award stays positive, as before. An adjustment may be negative;
-- a correction that takes away points already spent works like a task
-- un-ticked after its points were spent: the balance shows 0 and the
-- difference is paid back from the next points earned (`owed`).
--
-- An adjustment counts as earned: a bonus grows the creature like a task
-- would, and a correction undoes growth a mistaken task gave.
--
-- WHO MAY WRITE. As every other write to points: the service role, behind a
-- server route that checks the settings PIN. The browser roles keep reading
-- the table as before, family-scoped. adjust_person_points() and
-- remove_person_point_adjustment() take the child's lock (point_lock_person),
-- so an adjustment and a purchase or an approval for the same child are
-- served in turn.
--
-- LIVE. The table joins the realtime publication: an adjustment touches no
-- task, so without it the other screens would see it only on their next
-- refetch. Restart the realtime container after the first run.
--
-- Sorts after migration_zzzzzzzzz_point_purchases.sql and every other points
-- migration. Safe to run twice; it runs on every boot.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzzzzzz_point_adjustments', 0));

-- ---------------------------------------------------------------------------
-- 1. The kind, the note, and what the points may be
-- ---------------------------------------------------------------------------
ALTER TABLE public.todo_point_awards ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'task';
ALTER TABLE public.todo_point_awards ADD COLUMN IF NOT EXISTS note TEXT;

DO $$
BEGIN
  -- The original inline CHECK (points > 0) allowed no negative row at all.
  ALTER TABLE public.todo_point_awards DROP CONSTRAINT IF EXISTS todo_point_awards_points_check;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_point_awards_kind_points_check') THEN
    ALTER TABLE public.todo_point_awards ADD CONSTRAINT todo_point_awards_kind_points_check CHECK (
      (kind = 'task' AND points > 0)
      OR (kind = 'adjustment' AND points <> 0 AND points BETWEEN -10000 AND 10000 AND todo_id IS NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_point_awards_note_check') THEN
    ALTER TABLE public.todo_point_awards ADD CONSTRAINT todo_point_awards_note_check
      CHECK (note IS NULL OR char_length(note) <= 200);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Adding and removing
-- ---------------------------------------------------------------------------

-- A parent adds (positive) or removes (negative) points. Answers:
--   { ok: true, adjustment: {...}, balance }
--   { ok: false, error: 'not_found' }       no such child in this family, or
--                                           one in the recycle bin
--   { ok: false, error: 'invalid_points' }  0, or beyond +-10000
CREATE OR REPLACE FUNCTION public.adjust_person_points(
  p_family_id UUID, p_person_id UUID, p_points INTEGER, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.todo_point_awards;
  v_note TEXT := nullif(left(btrim(coalesce(p_note, '')), 200), '');
BEGIN
  IF p_points IS NULL OR p_points = 0 OR p_points NOT BETWEEN -10000 AND 10000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_points');
  END IF;
  PERFORM public.point_lock_person(p_person_id);
  IF NOT EXISTS (SELECT 1 FROM public.people
                  WHERE id = p_person_id AND family_id = p_family_id AND is_child AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  INSERT INTO public.todo_point_awards (family_id, person_id, todo_id, completion_key, points, kind, note)
  VALUES (p_family_id, p_person_id, NULL, 'adjustment:' || gen_random_uuid()::TEXT, p_points, 'adjustment', v_note)
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'adjustment', to_jsonb(v_row),
    'balance', public.point_person_totals(p_family_id, p_person_id)->'balance');
END $$;

-- A parent takes an adjustment back -- a typo, say. Only an adjustment: a
-- task's award goes when the task is un-ticked, and never from here. Answers:
--   { ok: true, removed: {...}, balance }
--   { ok: false, error: 'not_found' }   no such adjustment in this family
CREATE OR REPLACE FUNCTION public.remove_person_point_adjustment(
  p_family_id UUID, p_adjustment_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_person UUID;
  v_row public.todo_point_awards;
BEGIN
  SELECT person_id INTO v_person FROM public.todo_point_awards
   WHERE id = p_adjustment_id AND family_id = p_family_id AND kind = 'adjustment';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  PERFORM public.point_lock_person(v_person);

  DELETE FROM public.todo_point_awards
   WHERE id = p_adjustment_id AND family_id = p_family_id AND kind = 'adjustment'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  RETURN jsonb_build_object('ok', true, 'removed', to_jsonb(v_row),
    'balance', public.point_person_totals(p_family_id, v_row.person_id)->'balance');
END $$;

-- The service role only, as for a purchase and a refund. Written out rather
-- than built with format(), so every grant is one a spec can read.
REVOKE ALL ON FUNCTION public.adjust_person_points(uuid, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_person_point_adjustment(uuid, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.adjust_person_points(uuid, uuid, integer, text) FROM anon;
    REVOKE ALL ON FUNCTION public.remove_person_point_adjustment(uuid, uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.adjust_person_points(uuid, uuid, integer, text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.remove_person_point_adjustment(uuid, uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.adjust_person_points(uuid, uuid, integer, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.remove_person_point_adjustment(uuid, uuid) TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Live on every screen
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'todo_point_awards') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.todo_point_awards;
  END IF;
END $$;

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzzzzzz_point_adjustments', 0));

NOTIFY pgrst, 'reload schema';
