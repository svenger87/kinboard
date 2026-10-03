-- Taking turns, a done / not-done history for repeating tasks, and a task log
-- (#341).
--
-- WHAT A TASK GAINS
--
--   rotation_person_ids  the people who take turns, in order; NULL when the
--                        task does not rotate. Day k of the schedule goes to
--                        rotation_person_ids[k mod n], whether or not the
--                        turn before it was done.
--   track_completion     every due day that has passed is written down as
--                        done or missed (todo_occurrences).
--
-- Both are off by default, and a repeating task with neither keeps the
-- behaviour it always had: it comes round again N days after it was last
-- done, wherever that lands. A task with either one *keeps a schedule*
-- instead: its due days are fixed by the calendar and counted from
-- schedule_start_day, which is what lets every screen say whose turn any day
-- is, and what makes "Monday was not done" a fact rather than a guess.
--
-- WHY THIS LIVES IN THE DATABASE
--
-- The same reason points do (migration_zzz_todo_points.sql). A task is ticked
-- from the board, from a phone, from Home Assistant and from the assistant,
-- and every one of those writes `last_completed` on the row straight through
-- PostgREST or the Integration API. A trigger is the one place all of them
-- pass, so the rules -- which day a tick lands on, that a closed day cannot be
-- ticked any more, who gets the points -- exist once.
--
-- THE SCHEDULE
--
-- A due day stays open until the next one arrives. Ticking the task marks
-- the open day done, however late; once the next due day comes, the old one
-- is closed and stays as it is. So a tick always lands on the *current* day
-- (todo_current_day), never on an earlier one: there is no way to send a tick
-- for a missed turn, from any client.
--
-- An edit to the schedule -- the people, their order, the recurrence, the
-- start, the person of a task that does not rotate -- applies from the next
-- due day. The days already over are written down first (todo_close_days),
-- so an edit can never rewrite them. The day still open when the edit is made
-- keeps its person: it is written as an 'open' row and remembered in
-- carry_day, and stays open until the new schedule's first day.
--
-- Missed days are written by a pass that runs every quarter of an hour
-- (/api/cron/close-task-days) and by every edit, not worked out on read:
-- history must not change under an edit.
--
-- Days are the family's days: the `timezone` setting, as last_completed_day
-- has always been. A tick may carry the caller's own day in
-- last_completed_day, as the screens and the Integration API already send it;
-- within a day of the server's it is believed.
--
-- THE LOG
--
-- todo_events records every tick and un-tick (with the device and whose turn
-- it was), and every create, edit, delete and restore. domain_events cannot
-- double as it: it records a one-off task's first completion only and is
-- purged after 30 days. Kept 90 days by default; the family changes that in
-- Settings → Task log (settings key `task_log`, `retentionDays`, 0 = for
-- good), applied nightly by purge_todo_events().
--
-- Idempotent: safe to re-run. Sorts after migration_zzz_soft_delete.sql and
-- migration_zzz_todo_points.sql, whose function it replaces.

-- ---------------------------------------------------------------------------
-- 1. Columns and tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS rotation_person_ids UUID[];
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS track_completion BOOLEAN NOT NULL DEFAULT false;
-- Set by the trigger, never by a client: the day tracking was last switched
-- on (history starts there, without back-filling), the day the schedule
-- counts from, and the day still open from before the last edit.
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS tracking_started_day DATE;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS schedule_start_day DATE;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS carry_day DATE;

CREATE TABLE IF NOT EXISTS public.todo_occurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  todo_id UUID NOT NULL REFERENCES public.todos(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'done', 'missed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (todo_id, day)
);
CREATE INDEX IF NOT EXISTS todo_occurrences_family_day_idx ON public.todo_occurrences (family_id, day);

CREATE TABLE IF NOT EXISTS public.todo_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: a task emptied from the recycle bin keeps its
  -- log, which carries the title in `detail`.
  todo_id UUID REFERENCES public.todos(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'edited', 'completed', 'uncompleted', 'deleted', 'restored')),
  -- clock_timestamp: a delete and its close-out in one transaction keep their order.
  at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  -- Whose turn it was, for a tick or un-tick.
  person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
  -- The due day a tick or un-tick landed on.
  day DATE,
  -- {title, source: device|integration|server, fields: [...] for an edit}
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS todo_events_family_at_idx ON public.todo_events (family_id, at DESC);
CREATE INDEX IF NOT EXISTS todo_events_todo_idx ON public.todo_events (todo_id) WHERE todo_id IS NOT NULL;

-- Read-only to the browser: every write goes through the triggers below,
-- which run as their owner. A screen's token must not be able to write
-- itself a history.
ALTER TABLE public.todo_occurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS todo_occurrences_family_read ON public.todo_occurrences;
CREATE POLICY todo_occurrences_family_read ON public.todo_occurrences
  FOR SELECT USING (family_id = public.current_family_id());

ALTER TABLE public.todo_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS todo_events_family_read ON public.todo_events;
CREATE POLICY todo_events_family_read ON public.todo_events
  FOR SELECT USING (family_id = public.current_family_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.todo_occurrences FROM anon;
    REVOKE ALL ON TABLE public.todo_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.todo_occurrences FROM authenticated;
    REVOKE ALL ON TABLE public.todo_events FROM authenticated;
    GRANT SELECT ON TABLE public.todo_occurrences TO authenticated;
    GRANT SELECT ON TABLE public.todo_events TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.todo_occurrences TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.todo_events TO service_role;
  END IF;
END $$;

-- Ticks on another screen show up without a reload.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'todo_occurrences'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.todo_occurrences;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The schedule, as pure functions of the date
-- ---------------------------------------------------------------------------
-- Mirrored line for line in webapp/src/lib/todo-turns.ts; a change here is a
-- change there.

-- Days between due days of an interval recurrence, or NULL.
CREATE OR REPLACE FUNCTION public.todo_interval_days(p_recurrence TEXT)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_recurrence
    WHEN 'daily' THEN 1 WHEN 'weekly' THEN 7 WHEN 'biweekly' THEN 14 WHEN 'monthly' THEN 30
  END;
$$;

-- The picked weekdays of a "days:MO,WE" recurrence (0 = Sunday), or NULL.
CREATE OR REPLACE FUNCTION public.todo_weekdays(p_recurrence TEXT)
RETURNS INTEGER[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_recurrence LIKE 'days:%' THEN ARRAY(
    SELECT DISTINCT array_position(ARRAY['SU','MO','TU','WE','TH','FR','SA'], upper(trim(code))) - 1
    FROM unnest(string_to_array(substr(p_recurrence, 6), ',')) AS code
    WHERE array_position(ARRAY['SU','MO','TU','WE','TH','FR','SA'], upper(trim(code))) IS NOT NULL
    ORDER BY 1
  ) END;
$$;

-- True when a task with this recurrence and these options keeps a schedule.
CREATE OR REPLACE FUNCTION public.todo_keeps_schedule(p_recurrence TEXT, p_rotation UUID[], p_track BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT (coalesce(p_track, false) OR coalesce(cardinality(p_rotation), 0) > 0)
     AND (public.todo_interval_days(p_recurrence) IS NOT NULL
          OR coalesce(cardinality(public.todo_weekdays(p_recurrence)), 0) > 0);
$$;

-- The first due day on or after p_from: for an interval, counted in steps
-- from p_phase; for picked weekdays, the first picked one.
CREATE OR REPLACE FUNCTION public.todo_first_due_day(p_recurrence TEXT, p_phase DATE, p_from DATE)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  step INTEGER := public.todo_interval_days(p_recurrence);
  days INTEGER[] := public.todo_weekdays(p_recurrence);
  d DATE;
BEGIN
  IF step IS NOT NULL THEN
    IF p_from <= p_phase THEN RETURN p_phase; END IF;
    RETURN p_phase + ((p_from - p_phase + step - 1) / step) * step;
  END IF;
  IF coalesce(cardinality(days), 0) = 0 THEN RETURN NULL; END IF;
  FOR i IN 0..6 LOOP
    d := p_from + i;
    IF extract(dow FROM d)::INTEGER = ANY (days) THEN RETURN d; END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- True when p_day is a due day of a schedule starting at p_start (itself a due day).
CREATE OR REPLACE FUNCTION public.todo_is_due_day(p_recurrence TEXT, p_start DATE, p_day DATE)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT p_day >= p_start AND CASE
    WHEN public.todo_interval_days(p_recurrence) IS NOT NULL
      THEN (p_day - p_start) % public.todo_interval_days(p_recurrence) = 0
    ELSE extract(dow FROM p_day)::INTEGER = ANY (coalesce(public.todo_weekdays(p_recurrence), '{}'))
  END;
$$;

-- The last due day on or before p_day, or NULL before the schedule starts.
CREATE OR REPLACE FUNCTION public.todo_prev_due_day(p_recurrence TEXT, p_start DATE, p_day DATE)
RETURNS DATE LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  step INTEGER := public.todo_interval_days(p_recurrence);
  d DATE;
BEGIN
  IF p_start IS NULL OR p_day < p_start THEN RETURN NULL; END IF;
  IF step IS NOT NULL THEN
    RETURN p_start + ((p_day - p_start) / step) * step;
  END IF;
  FOR i IN 0..6 LOOP
    d := p_day - i;
    IF d < p_start THEN RETURN NULL; END IF;
    IF public.todo_is_due_day(p_recurrence, p_start, d) THEN RETURN d; END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- How many due days lie in [p_start, p_day): day k of the rotation.
CREATE OR REPLACE FUNCTION public.todo_due_index(p_recurrence TEXT, p_start DATE, p_day DATE)
RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  step INTEGER := public.todo_interval_days(p_recurrence);
  days INTEGER[] := public.todo_weekdays(p_recurrence);
  span INTEGER := p_day - p_start;
  n INTEGER;
BEGIN
  IF span <= 0 THEN RETURN 0; END IF;
  IF step IS NOT NULL THEN RETURN (span + step - 1) / step; END IF;
  n := (span / 7) * coalesce(cardinality(days), 0);
  FOR i IN 0..(span % 7) - 1 LOOP
    IF extract(dow FROM p_start + i)::INTEGER = ANY (days) THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END $$;

-- The day a tick on p_today lands on: the open due day, or NULL when there
-- is none yet (the schedule starts later and nothing carries over).
CREATE OR REPLACE FUNCTION public.todo_current_day(t public.todos, p_today DATE)
RETURNS DATE LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t.schedule_start_day IS NOT NULL AND p_today >= t.schedule_start_day
      THEN public.todo_prev_due_day(t.recurrence, t.schedule_start_day, p_today)
    WHEN t.carry_day IS NOT NULL AND t.carry_day <= p_today THEN t.carry_day
  END;
$$;

-- Whose turn p_day is: a written-down day keeps the person it was written
-- with; otherwise the rotation's, or the task's own person.
CREATE OR REPLACE FUNCTION public.todo_turn_person(t public.todos, p_day DATE)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  written RECORD;
  n INTEGER := coalesce(cardinality(t.rotation_person_ids), 0);
BEGIN
  IF p_day IS NULL THEN RETURN t.person_id; END IF;
  SELECT person_id INTO written FROM public.todo_occurrences WHERE todo_id = t.id AND day = p_day;
  IF FOUND THEN RETURN written.person_id; END IF;
  IF n > 0 AND t.schedule_start_day IS NOT NULL AND p_day >= t.schedule_start_day THEN
    RETURN t.rotation_person_ids[public.todo_due_index(t.recurrence, t.schedule_start_day, p_day) % n + 1];
  END IF;
  RETURN t.person_id;
END $$;

-- The family's today, in its `timezone` setting; else p_fallback (the
-- server's TZ, which the cron passes); else Europe/Berlin, the stack's
-- default.
CREATE OR REPLACE FUNCTION public.family_today(p_family UUID, p_fallback TEXT DEFAULT NULL)
RETURNS DATE LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  zone TEXT;
BEGIN
  SELECT s.value #>> '{}' INTO zone FROM public.settings s WHERE s.family_id = p_family AND s.key = 'timezone';
  FOREACH zone IN ARRAY ARRAY[zone, p_fallback, 'Europe/Berlin'] LOOP
    CONTINUE WHEN zone IS NULL OR zone = '';
    BEGIN
      RETURN (now() AT TIME ZONE zone)::DATE;
    EXCEPTION WHEN OTHERS THEN
      -- An unknown zone name: try the next.
    END;
  END LOOP;
  RETURN now()::DATE;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Writing closed days down
-- ---------------------------------------------------------------------------
-- Every due day before the open one is closed. With tracking on, each closed
-- day without a row becomes 'missed', with whose turn it was, from the day
-- tracking started; an 'open' row left from an edit becomes 'missed' too.
-- Without tracking, nothing is recorded and an 'open' row is dropped.
--
-- Takes the row rather than an id so an edit can close the days of the
-- schedule as it was (OLD), before the new one is written.
CREATE OR REPLACE FUNCTION public.todo_close_days(t public.todos, p_today DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  bound DATE;
  lower_day DATE;
  written INTEGER := 0;
  n INTEGER;
BEGIN
  IF t.schedule_start_day IS NULL THEN RETURN 0; END IF;
  -- Days before `bound` are closed.
  bound := coalesce(public.todo_current_day(t, p_today), p_today + 1);

  IF NOT t.track_completion THEN
    DELETE FROM public.todo_occurrences WHERE todo_id = t.id AND status = 'open' AND day < bound;
    RETURN 0;
  END IF;

  UPDATE public.todo_occurrences SET status = 'missed'
    WHERE todo_id = t.id AND status = 'open' AND day < bound;
  GET DIAGNOSTICS n = ROW_COUNT;
  written := written + n;

  -- Resume after the last day already written down as missed, so the pass
  -- does not re-walk a task's whole life every quarter of an hour.
  SELECT greatest(t.tracking_started_day, t.schedule_start_day, max(day) + 1) INTO lower_day
    FROM public.todo_occurrences WHERE todo_id = t.id AND status = 'missed';
  lower_day := greatest(coalesce(lower_day, t.tracking_started_day, t.schedule_start_day), t.schedule_start_day);
  IF lower_day IS NULL OR lower_day >= bound THEN RETURN written; END IF;

  INSERT INTO public.todo_occurrences (family_id, todo_id, day, person_id, status)
  SELECT t.family_id, t.id, d::DATE, public.todo_turn_person(t, d::DATE), 'missed'
    FROM generate_series(lower_day, bound - 1, INTERVAL '1 day') AS d
   WHERE public.todo_is_due_day(t.recurrence, t.schedule_start_day, d::DATE)
  ON CONFLICT (todo_id, day) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN written + n;
END $$;

-- The pass the cron runs: closes every scheduled task's days and moves a
-- rotating task's person_id on to today's turn, so everything that reads
-- person_id -- the person filter, reminders, the family widget -- shows
-- today's person. Returns the rows written.
CREATE OR REPLACE FUNCTION public.close_todo_days(p_fallback_tz TEXT DEFAULT NULL)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public.todos;
  today DATE;
  total INTEGER := 0;
  turn UUID;
BEGIN
  -- Writes made here are bookkeeping, not edits: the trigger steps aside.
  PERFORM set_config('kinboard.todo_system', 'on', true);
  FOR t IN
    SELECT * FROM public.todos
     WHERE deleted_at IS NULL AND schedule_start_day IS NOT NULL
       AND public.todo_keeps_schedule(recurrence, rotation_person_ids, track_completion)
  LOOP
    today := public.family_today(t.family_id, p_fallback_tz);
    total := total + public.todo_close_days(t, today);
    IF coalesce(cardinality(t.rotation_person_ids), 0) > 0 THEN
      turn := public.todo_turn_person(t, coalesce(public.todo_current_day(t, today), t.schedule_start_day));
      IF turn IS DISTINCT FROM t.person_id THEN
        UPDATE public.todos SET person_id = turn WHERE id = t.id;
      END IF;
    END IF;
  END LOOP;
  PERFORM set_config('kinboard.todo_system', 'off', true);
  RETURN total;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Who made a change
-- ---------------------------------------------------------------------------
-- A screen's token carries its device (lib/family-jwt.ts); the Integration
-- API says so in a header. Anything else with the service key is the server.
CREATE OR REPLACE FUNCTION public.todo_actor(p_family UUID, OUT device_id UUID, OUT source TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  claims JSONB;
  claimed TEXT;
  actor TEXT;
BEGIN
  BEGIN
    claims := nullif(current_setting('request.jwt.claims', true), '')::JSONB;
  EXCEPTION WHEN OTHERS THEN claims := NULL;
  END;
  claimed := claims ->> 'device_id';
  IF claimed ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT d.id INTO device_id FROM public.devices d WHERE d.id = claimed::UUID AND d.family_id = p_family;
  END IF;
  IF device_id IS NOT NULL THEN source := 'device'; RETURN; END IF;
  BEGIN
    actor := nullif(current_setting('request.headers', true), '')::JSONB ->> 'x-kinboard-actor';
  EXCEPTION WHEN OTHERS THEN actor := NULL;
  END;
  source := CASE
    WHEN actor = 'integration' THEN 'integration'
    WHEN claims ->> 'role' = 'authenticated' THEN 'device'
    ELSE 'server'
  END;
END $$;

CREATE OR REPLACE FUNCTION public.todo_log(
  t public.todos, p_kind TEXT, p_person UUID DEFAULT NULL, p_day DATE DEFAULT NULL, p_extra JSONB DEFAULT '{}'::jsonb
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  who RECORD;
BEGIN
  SELECT * INTO who FROM public.todo_actor(t.family_id);
  INSERT INTO public.todo_events (family_id, todo_id, kind, device_id, person_id, day, detail)
  VALUES (t.family_id, t.id, p_kind, who.device_id,
          CASE WHEN p_person IS NOT NULL AND EXISTS (SELECT 1 FROM public.people WHERE id = p_person) THEN p_person END,
          p_day,
          jsonb_build_object('title', t.title, 'source', who.source) || coalesce(p_extra, '{}'::jsonb));
END $$;

-- ---------------------------------------------------------------------------
-- 5. The triggers
-- ---------------------------------------------------------------------------

-- The people a rotation may hold: this family's, not in the recycle bin,
-- each once, in the order given.
CREATE OR REPLACE FUNCTION public.todo_clean_rotation(p_family UUID, p_ids UUID[])
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT nullif(ARRAY(
    SELECT id FROM (
      SELECT DISTINCT ON (r.id) r.id, r.ord
        FROM unnest(p_ids) WITH ORDINALITY AS r(id, ord)
        JOIN public.people p ON p.id = r.id AND p.family_id = p_family AND p.deleted_at IS NULL
       ORDER BY r.id, r.ord
    ) kept ORDER BY ord
  ), '{}');
$$;

CREATE OR REPLACE FUNCTION public.todo_schedule_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  today DATE;
BEGIN
  NEW.rotation_person_ids := CASE WHEN public.todo_keeps_schedule(NEW.recurrence, '{}', true)
    THEN public.todo_clean_rotation(NEW.family_id, NEW.rotation_person_ids) END;
  NEW.carry_day := NULL;
  IF NOT public.todo_keeps_schedule(NEW.recurrence, NEW.rotation_person_ids, NEW.track_completion) THEN
    NEW.schedule_start_day := NULL;
    NEW.tracking_started_day := CASE WHEN NEW.track_completion THEN public.family_today(NEW.family_id) END;
    RETURN NEW;
  END IF;
  today := public.family_today(NEW.family_id);
  -- From the start date picked in the form, or today; never in the past,
  -- which would back-fill missed days nobody could have done.
  NEW.schedule_start_day := public.todo_first_due_day(
    NEW.recurrence, coalesce(NEW.due_date, today), greatest(coalesce(NEW.due_date, today), today));
  NEW.tracking_started_day := CASE WHEN NEW.track_completion THEN today END;
  IF NEW.rotation_person_ids IS NOT NULL THEN
    NEW.person_id := NEW.rotation_person_ids[1];
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.todo_schedule_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  today DATE;
  utc_today DATE := (now() AT TIME ZONE 'UTC')::DATE;
  was_scheduled BOOLEAN;
  is_scheduled BOOLEAN;
  rotates BOOLEAN;
  changed TEXT[] := '{}';
  schedule_changed BOOLEAN;
  open_day DATE;
  from_day DATE;
  phase DATE;
  ticking BOOLEAN;
  unticking BOOLEAN;
  occ RECORD;
  turn UUID;
  prev RECORD;
BEGIN
  IF coalesce(current_setting('kinboard.todo_system', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  -- The family is being deleted, and everything of it with it: there is no
  -- history left to keep.
  IF NOT EXISTS (SELECT 1 FROM public.families WHERE id = NEW.family_id) THEN
    RETURN NEW;
  END IF;

  -- The columns only this trigger writes.
  NEW.schedule_start_day := OLD.schedule_start_day;
  NEW.carry_day := OLD.carry_day;
  NEW.tracking_started_day := OLD.tracking_started_day;
  -- Only a repeating task can take turns.
  NEW.rotation_person_ids := CASE WHEN public.todo_keeps_schedule(NEW.recurrence, '{}', true)
    THEN public.todo_clean_rotation(NEW.family_id, NEW.rotation_person_ids) END;

  was_scheduled := OLD.schedule_start_day IS NOT NULL
    AND public.todo_keeps_schedule(OLD.recurrence, OLD.rotation_person_ids, OLD.track_completion);
  is_scheduled := public.todo_keeps_schedule(NEW.recurrence, NEW.rotation_person_ids, NEW.track_completion);
  rotates := NEW.rotation_person_ids IS NOT NULL;

  ticking := NEW.last_completed IS NOT NULL AND NEW.last_completed IS DISTINCT FROM OLD.last_completed;
  unticking := NEW.last_completed IS NULL AND OLD.last_completed IS NOT NULL;

  -- Today: the caller's own day when it sent one within a day of ours (the
  -- screens send their local day with a tick), else the family's.
  IF (ticking OR unticking) AND NEW.last_completed_day IS NOT NULL
     AND NEW.last_completed_day IS DISTINCT FROM OLD.last_completed_day
     AND NEW.last_completed_day BETWEEN utc_today - 1 AND utc_today + 1 THEN
    today := NEW.last_completed_day;
  ELSE
    today := public.family_today(NEW.family_id);
  END IF;

  -- What changed, for the log and to know whether the schedule did.
  IF NEW.title IS DISTINCT FROM OLD.title THEN changed := array_append(changed, 'title'); END IF;
  IF NEW.person_id IS DISTINCT FROM OLD.person_id AND NOT rotates THEN changed := array_append(changed, 'person'); END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN changed := array_append(changed, 'due_date'); END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN changed := array_append(changed, 'priority'); END IF;
  IF NEW.recurrence IS DISTINCT FROM OLD.recurrence THEN changed := array_append(changed, 'recurrence'); END IF;
  IF NEW.icon IS DISTINCT FROM OLD.icon THEN changed := array_append(changed, 'icon'); END IF;
  IF NEW.points IS DISTINCT FROM OLD.points THEN changed := array_append(changed, 'points'); END IF;
  IF NEW.rotation_person_ids IS DISTINCT FROM OLD.rotation_person_ids THEN changed := array_append(changed, 'rotation'); END IF;
  IF NEW.track_completion IS DISTINCT FROM OLD.track_completion THEN changed := array_append(changed, 'tracking'); END IF;
  schedule_changed := changed && ARRAY['person', 'due_date', 'recurrence', 'rotation'];

  -- Deleted: write its days down first, so the bin does not swallow them.
  -- Restored: the days spent in the bin are not missed -- nobody could tick
  -- the task there -- so tracking resumes today.
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF was_scheduled THEN PERFORM public.todo_close_days(OLD, today); END IF;
    PERFORM public.todo_log(NEW, 'deleted');
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN
    IF NEW.track_completion THEN NEW.tracking_started_day := greatest(OLD.tracking_started_day, today); END IF;
    PERFORM public.todo_log(NEW, 'restored');
  END IF;

  -- Tracking switched on: history starts today, without back-filling.
  IF NEW.track_completion AND NOT OLD.track_completion THEN
    NEW.tracking_started_day := today;
  END IF;

  IF NOT is_scheduled THEN
    IF was_scheduled THEN PERFORM public.todo_close_days(OLD, today); END IF;
    NEW.schedule_start_day := NULL;
    NEW.carry_day := NULL;
  ELSIF NOT was_scheduled THEN
    -- Starting to keep a schedule: as a new task would.
    NEW.carry_day := NULL;
    NEW.schedule_start_day := public.todo_first_due_day(
      NEW.recurrence, coalesce(NEW.due_date, today), greatest(coalesce(NEW.due_date, today), today));
  ELSIF schedule_changed THEN
    -- Applies from the next due day. The days already over are written
    -- down under the schedule they had; the day still open keeps its person
    -- and stays open until the new schedule's first day.
    PERFORM public.todo_close_days(OLD, today);
    open_day := public.todo_current_day(OLD, today);
    IF open_day IS NOT NULL THEN
      INSERT INTO public.todo_occurrences (family_id, todo_id, day, person_id, status)
      VALUES (NEW.family_id, NEW.id, open_day, public.todo_turn_person(OLD, open_day), 'open')
      ON CONFLICT (todo_id, day) DO NOTHING;
      from_day := today + 1;
    ELSE
      from_day := today;
    END IF;
    NEW.carry_day := open_day;
    -- Keep the weekday a weekly task falls on unless a new start was picked.
    phase := coalesce(NEW.due_date, OLD.schedule_start_day, from_day);
    NEW.schedule_start_day := public.todo_first_due_day(
      NEW.recurrence, phase, greatest(from_day, coalesce(NEW.due_date, from_day)));
  END IF;

  IF array_length(changed, 1) > 0 AND (OLD.deleted_at IS NULL) THEN
    PERFORM public.todo_log(NEW, 'edited', NULL, NULL, jsonb_build_object('fields', to_jsonb(changed)));
  END IF;

  IF is_scheduled THEN
    open_day := public.todo_current_day(NEW, today);

    IF ticking THEN
      IF open_day IS NULL THEN
        RAISE EXCEPTION 'no turn of this task is open yet' USING ERRCODE = 'P0001', HINT = 'no_open_turn';
      END IF;
      turn := public.todo_turn_person(NEW, open_day);
      SELECT * INTO occ FROM public.todo_occurrences WHERE todo_id = NEW.id AND day = open_day;
      IF FOUND AND occ.status = 'done' THEN
        -- Already done: a second tick changes nothing.
        NEW.last_completed := OLD.last_completed;
        NEW.last_completed_day := OLD.last_completed_day;
      ELSE
        INSERT INTO public.todo_occurrences (family_id, todo_id, day, person_id, status, completed_at)
        VALUES (NEW.family_id, NEW.id, open_day, turn, 'done', NEW.last_completed)
        ON CONFLICT (todo_id, day) DO UPDATE SET status = 'done', completed_at = EXCLUDED.completed_at;
        NEW.last_completed_day := open_day;
        PERFORM public.todo_log(NEW, 'completed', turn, open_day);
      END IF;
    ELSIF unticking THEN
      SELECT * INTO occ FROM public.todo_occurrences WHERE todo_id = NEW.id AND day = open_day;
      IF open_day IS NOT NULL AND FOUND AND occ.status = 'done' THEN
        UPDATE public.todo_occurrences SET status = 'open', completed_at = NULL WHERE id = occ.id;
        SELECT completed_at, day INTO prev FROM public.todo_occurrences
          WHERE todo_id = NEW.id AND status = 'done' AND day < open_day
          ORDER BY day DESC LIMIT 1;
        NEW.last_completed := prev.completed_at;
        NEW.last_completed_day := prev.day;
        PERFORM public.todo_log(NEW, 'uncompleted', occ.person_id, open_day);
      ELSE
        -- Nothing open is done: nothing to take back.
        NEW.last_completed := OLD.last_completed;
        NEW.last_completed_day := OLD.last_completed_day;
      END IF;
    END IF;

    IF rotates THEN
      NEW.person_id := public.todo_turn_person(NEW, coalesce(open_day, NEW.schedule_start_day));
    END IF;
  ELSE
    -- A task without a schedule logs its ticks as it always made them.
    IF ticking AND NEW.recurrence IS NOT NULL AND NEW.recurrence <> 'once' THEN
      PERFORM public.todo_log(NEW, 'completed', NEW.person_id, NEW.last_completed_day);
    END IF;
  END IF;

  IF coalesce(NEW.recurrence, 'once') = 'once' THEN
    IF NEW.completed AND NOT coalesce(OLD.completed, false) THEN
      PERFORM public.todo_log(NEW, 'completed', NEW.person_id, NULL);
    ELSIF NOT NEW.completed AND coalesce(OLD.completed, false) THEN
      PERFORM public.todo_log(NEW, 'uncompleted', NEW.person_id, NULL);
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.todo_log_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(current_setting('kinboard.todo_system', true), 'off') <> 'on' THEN
    PERFORM public.todo_log(NEW, 'created');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS todos_schedule_insert ON public.todos;
CREATE TRIGGER todos_schedule_insert BEFORE INSERT ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.todo_schedule_insert();

DROP TRIGGER IF EXISTS todos_schedule_update ON public.todos;
CREATE TRIGGER todos_schedule_update BEFORE UPDATE ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.todo_schedule_update();

DROP TRIGGER IF EXISTS todos_log_insert ON public.todos;
CREATE TRIGGER todos_log_insert AFTER INSERT ON public.todos
FOR EACH ROW EXECUTE FUNCTION public.todo_log_insert();

-- A person removed from the family drops out of every rotation from the next
-- due day, through the same edit path; their past days stay.
CREATE OR REPLACE FUNCTION public.todo_rotation_person_removed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.families WHERE id = NEW.family_id) THEN
    UPDATE public.todos
       SET rotation_person_ids = array_remove(rotation_person_ids, NEW.id)
     WHERE family_id = NEW.family_id AND NEW.id = ANY (rotation_person_ids);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS people_leave_rotations ON public.people;
CREATE TRIGGER people_leave_rotations AFTER UPDATE OF deleted_at ON public.people
FOR EACH ROW EXECUTE FUNCTION public.todo_rotation_person_removed();

-- ---------------------------------------------------------------------------
-- 6. Points go to whoever's turn it was
-- ---------------------------------------------------------------------------
-- Replaces migration_zzz_todo_points.sql's function. A task without a
-- schedule is awarded exactly as before. A scheduled one is awarded to the
-- person written on the day it was ticked, and an un-tick -- the day going
-- back to open -- takes those points back.
CREATE OR REPLACE FUNCTION public.record_todo_points() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  award_key TEXT;
  award_person UUID := NEW.person_id;
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
      SELECT person_id, status INTO occ FROM public.todo_occurrences
       WHERE todo_id = NEW.id AND day = NEW.last_completed_day;
      IF FOUND AND occ.status = 'done' THEN
        award_key := NEW.last_completed_day::TEXT;
        award_person := occ.person_id;
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

-- The un-tick above deletes from todo_point_awards, which the browser may
-- only read; the function runs as its owner, so that is fine.

-- ---------------------------------------------------------------------------
-- 7. The log's retention
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_todo_events()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  fam RECORD;
  days INTEGER;
  n INTEGER;
  total INTEGER := 0;
BEGIN
  FOR fam IN SELECT id FROM public.families LOOP
    days := NULL;
    SELECT CASE WHEN jsonb_typeof(s.value -> 'retentionDays') = 'number'
                THEN (s.value ->> 'retentionDays')::NUMERIC::INTEGER END
      INTO days FROM public.settings s WHERE s.family_id = fam.id AND s.key = 'task_log';
    days := coalesce(days, 90);
    CONTINUE WHEN days <= 0;
    DELETE FROM public.todo_events WHERE family_id = fam.id AND at < now() - make_interval(days => days);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  RETURN total;
END $$;

-- Only the server runs the passes; every function here that writes is a
-- trigger's helper or a cron's, never something a screen should call.
DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.close_todo_days(text)',
    'public.purge_todo_events()',
    'public.todo_close_days(public.todos, date)',
    'public.todo_log(public.todos, text, uuid, date, jsonb)',
    'public.todo_turn_person(public.todos, date)',
    'public.todo_actor(uuid)',
    'public.todo_clean_rotation(uuid, uuid[])',
    'public.family_today(uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
