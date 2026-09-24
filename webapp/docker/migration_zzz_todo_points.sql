-- Optional kid-friendly task icons and points. Awards are recorded by the
-- database so both the dashboard and task page use the same rules.
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS last_completed_day DATE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'todos_points_nonnegative') THEN
    ALTER TABLE public.todos ADD CONSTRAINT todos_points_nonnegative CHECK (points BETWEEN 0 AND 10000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.todo_point_awards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  todo_id UUID REFERENCES public.todos(id) ON DELETE SET NULL,
  completion_key TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (todo_id, completion_key)
);
CREATE INDEX IF NOT EXISTS todo_point_awards_person_idx ON public.todo_point_awards (person_id);

ALTER TABLE public.todo_point_awards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS todo_point_awards_family_read ON public.todo_point_awards;
CREATE POLICY todo_point_awards_family_read ON public.todo_point_awards
  FOR SELECT USING (family_id = public.current_family_id());
GRANT SELECT ON public.todo_point_awards TO authenticated;
GRANT ALL ON public.todo_point_awards TO service_role;

CREATE OR REPLACE FUNCTION public.record_todo_points() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  award_key TEXT;
BEGIN
  -- Reopening a one-off task reverses that task's award.
  IF OLD.completed AND NOT NEW.completed AND COALESCE(OLD.recurrence, 'once') = 'once' THEN
    DELETE FROM public.todo_point_awards WHERE todo_id = NEW.id AND completion_key = 'once';
  END IF;

  IF NEW.person_id IS NULL OR NEW.points <= 0 OR NOT EXISTS (
    SELECT 1 FROM public.people WHERE id = NEW.person_id AND family_id = NEW.family_id AND is_child
  ) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.recurrence, 'once') = 'once' THEN
    IF NEW.completed AND NOT OLD.completed THEN award_key := 'once'; END IF;
  ELSIF NEW.last_completed_day IS NOT NULL
    AND NEW.last_completed_day IS DISTINCT FROM OLD.last_completed_day THEN
    award_key := NEW.last_completed_day::TEXT;
  END IF;

  IF award_key IS NOT NULL THEN
    INSERT INTO public.todo_point_awards (family_id, person_id, todo_id, completion_key, points)
    VALUES (NEW.family_id, NEW.person_id, NEW.id, award_key, NEW.points)
    ON CONFLICT (todo_id, completion_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS todos_record_points ON public.todos;
CREATE TRIGGER todos_record_points AFTER UPDATE ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.record_todo_points();

NOTIFY pgrst, 'reload schema';
