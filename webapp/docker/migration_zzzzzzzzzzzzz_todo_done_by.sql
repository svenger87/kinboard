-- Who did it: a tick can say who did the task, and the points go to them.
--
-- A task's points went to whoever it was assigned to, or whose turn it was.
-- When Jonas takes Mira's turn at the dishes, Mira got the points, and the
-- history said Mira did it. The wall display now asks who did a task that
-- has points, and the tick carries the answer.
--
--   todos.done_by          The answer, sent with the tick. An argument, not
--                          state: the trigger below reads it and clears it,
--                          so it is NULL again after every update. A tick
--                          that does not send one (Home Assistant, an
--                          assistant, an older screen) therefore never
--                          inherits the last tick's answer.
--   todos.last_completed_by
--                          Who did the latest completion, or NULL when the
--                          tick did not say. Set by the trigger only.
--   todo_occurrences.completed_by
--                          Who did that due day, next to person_id (whose
--                          turn it was).
--
-- Points go to the person who did it when the tick names one, else, as
-- before, to the assignee or whoever's turn it was. Only children are
-- awarded, as before: a parent who does a child's chore earns nobody points.
--
-- The trigger runs after todos_schedule_update (BEFORE triggers fire in name
-- order), so it sees whether the tick took: a second tick of a day already
-- done is turned back there, and must not change who did it either.
--
-- Idempotent: safe to re-run. Sorts after migration_zzzzzy_todo_turns.sql,
-- whose record_todo_points it replaces.

ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS done_by UUID;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS last_completed_by UUID;
ALTER TABLE public.todo_occurrences ADD COLUMN IF NOT EXISTS completed_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_last_completed_by_fkey') THEN
    ALTER TABLE public.todos ADD CONSTRAINT todos_last_completed_by_fkey
      FOREIGN KEY (last_completed_by) REFERENCES public.people(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todo_occurrences_completed_by_fkey') THEN
    ALTER TABLE public.todo_occurrences ADD CONSTRAINT todo_occurrences_completed_by_fkey
      FOREIGN KEY (completed_by) REFERENCES public.people(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.todo_record_done_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  doer UUID;
  ticked BOOLEAN;
  unticked BOOLEAN;
BEGIN
  -- Only this family's people, and not one in the recycle bin.
  IF NEW.done_by IS NOT NULL THEN
    SELECT p.id INTO doer FROM public.people p
     WHERE p.id = NEW.done_by AND p.family_id = NEW.family_id AND p.deleted_at IS NULL;
  END IF;
  NEW.done_by := NULL;

  IF coalesce(current_setting('kinboard.todo_system', true), 'off') = 'on' THEN
    NEW.last_completed_by := OLD.last_completed_by;
    RETURN NEW;
  END IF;

  IF coalesce(NEW.recurrence, 'once') = 'once' THEN
    ticked := NEW.completed AND NOT coalesce(OLD.completed, false);
    unticked := NOT NEW.completed AND coalesce(OLD.completed, false);
  ELSE
    -- What todos_schedule_update left: a tick moves last_completed forward;
    -- an un-tick moves it back to the previous done day, or to nothing.
    ticked := NEW.last_completed IS NOT NULL
      AND (OLD.last_completed IS NULL OR NEW.last_completed > OLD.last_completed);
    unticked := NOT ticked AND NEW.last_completed IS DISTINCT FROM OLD.last_completed;
  END IF;

  IF ticked THEN
    NEW.last_completed_by := doer;
    IF NEW.last_completed_day IS NOT NULL THEN
      UPDATE public.todo_occurrences SET completed_by = doer
       WHERE todo_id = NEW.id AND day = NEW.last_completed_day AND status = 'done';
    END IF;
    IF doer IS NOT NULL THEN
      -- The log line todo_log just wrote for this tick, in this transaction.
      UPDATE public.todo_events SET detail = detail || jsonb_build_object('done_by', doer)
       WHERE id = (
         SELECT e.id FROM public.todo_events e
          WHERE e.todo_id = NEW.id AND e.kind = 'completed' AND e.at >= now()
          ORDER BY e.at DESC LIMIT 1
       );
    END IF;
  ELSIF unticked THEN
    UPDATE public.todo_occurrences SET completed_by = NULL
     WHERE todo_id = NEW.id AND status <> 'done' AND completed_by IS NOT NULL
       AND day = OLD.last_completed_day;
    -- Back to whoever did the day that is now the latest one done.
    NEW.last_completed_by := (
      SELECT o.completed_by FROM public.todo_occurrences o
       WHERE o.todo_id = NEW.id AND o.day = NEW.last_completed_day AND o.status = 'done'
    );
  ELSE
    -- Set here and nowhere else: an edit does not say who did anything.
    NEW.last_completed_by := OLD.last_completed_by;
  END IF;
  RETURN NEW;
END $$;

-- "todos_zz_…": after todos_schedule_update, which decides whether a tick took.
DROP TRIGGER IF EXISTS todos_zz_done_by ON public.todos;
CREATE TRIGGER todos_zz_done_by BEFORE UPDATE ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.todo_record_done_by();

-- A new row cannot carry an answer: there is no tick to go with it. (It may
-- carry last_completed_by: undoing a delete puts the whole row back.)
CREATE OR REPLACE FUNCTION public.todo_clear_done_by()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.done_by := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS todos_zz_clear_done_by ON public.todos;
CREATE TRIGGER todos_zz_clear_done_by BEFORE INSERT ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.todo_clear_done_by();

-- Replaces migration_zzzzzy_todo_turns.sql's function. Unchanged except for
-- who is awarded: the person who did it, when the tick said, else as before.
CREATE OR REPLACE FUNCTION public.record_todo_points() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  award_key TEXT;
  award_person UUID := coalesce(NEW.last_completed_by, NEW.person_id);
  occ RECORD;
BEGIN
  -- Reopening a one-off task reverses that task's award.
  IF OLD.completed AND NOT NEW.completed AND COALESCE(OLD.recurrence, 'once') = 'once' THEN
    DELETE FROM public.todo_point_awards WHERE todo_id = NEW.id AND completion_key = 'once';
  END IF;

  IF NEW.schedule_start_day IS NOT NULL OR NEW.carry_day IS NOT NULL THEN
    -- Un-ticked: the day it was done on is no longer done.
    IF OLD.last_completed_day IS NOT NULL
       AND NEW.last_completed_day IS DISTINCT FROM OLD.last_completed_day
       AND NOT EXISTS (
         SELECT 1 FROM public.todo_occurrences
          WHERE todo_id = NEW.id AND day = OLD.last_completed_day AND status = 'done'
       ) THEN
      DELETE FROM public.todo_point_awards
       WHERE todo_id = NEW.id AND completion_key = OLD.last_completed_day::TEXT;
    END IF;
    -- Ticked: the day moves forward, never back (an un-tick moves it back).
    IF NEW.last_completed_day IS NOT NULL
       AND (OLD.last_completed_day IS NULL OR NEW.last_completed_day > OLD.last_completed_day) THEN
      SELECT person_id, completed_by, status INTO occ FROM public.todo_occurrences
       WHERE todo_id = NEW.id AND day = NEW.last_completed_day;
      IF FOUND AND occ.status = 'done' THEN
        award_key := NEW.last_completed_day::TEXT;
        award_person := coalesce(occ.completed_by, occ.person_id);
      END IF;
    END IF;
  ELSIF COALESCE(NEW.recurrence, 'once') = 'once' THEN
    IF NEW.completed AND NOT OLD.completed THEN award_key := 'once'; END IF;
  ELSIF NEW.last_completed_day IS NOT NULL
    AND NEW.last_completed_day IS DISTINCT FROM OLD.last_completed_day THEN
    award_key := NEW.last_completed_day::TEXT;
  END IF;

  IF award_key IS NULL OR award_person IS NULL OR NEW.points <= 0 OR NOT EXISTS (
    SELECT 1 FROM public.people WHERE id = award_person AND family_id = NEW.family_id AND is_child
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.todo_point_awards (family_id, person_id, todo_id, completion_key, points)
  VALUES (NEW.family_id, award_person, NEW.id, award_key, NEW.points)
  ON CONFLICT (todo_id, completion_key) DO NOTHING;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
