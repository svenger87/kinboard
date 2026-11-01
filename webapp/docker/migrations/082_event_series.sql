-- migrations/082_event_series.sql
-- Repeating events in Kinboard's own (local) calendars.
--
--   event_series              one row per series: its rule and what every occurrence copies
--   events.series_id          the series an occurrence belongs to (with its calendar_id)
--   events.series_day         the day of the series it fills, in the series' zone
--   events.series_exception   changed on its own ("This event"), so "All events" leaves it be
--   event_series.skipped_days the days deleted on their own, never made again
--
-- THE OCCURRENCES are ordinary rows in public.events, one per occurrence,
-- each pointing back here and carrying the rule in events.recurrence_rule
-- (a column that has been in init.sql all along, unused until now). That is
-- how a synced Google or CalDAV calendar already stores its repeats, so the
-- calendar, the Home widgets, reminders, the calendar feed and the Integration
-- API show a series without knowing it is one. The rules are in code
-- (webapp/src/lib/event-repeat.ts) and the writes in lib/event-series.ts,
-- which works out the rows and hands them to event_series_write() or
-- event_series_end() below: each write is one transaction, under the series'
-- row lock.
--
-- ONE SERIES, ONE CALENDAR. events is writable from the browser under
-- events_family_scope, which checks calendar_id only, and a foreign key is
-- checked without row-level security. So the key is (series_id, calendar_id)
-- against event_series (id, calendar_id): an event can point only at a series
-- of its own calendar, never at another family's, nor a synced event at a
-- local series. A null series_id is not checked, so plain events are as before.
--
-- ONE ROW PER DAY of a series (series_id, series_day): writing an occurrence
-- twice, from a double tap, a retry or the nightly job running beside an edit,
-- leaves one row (ON CONFLICT DO NOTHING).
--
-- HOW FAR AHEAD. A series keeps occurrences up to a horizon that depends on
-- how often it repeats (about four months daily, thirteen weekly, three years
-- monthly, ten yearly); generated_through is the last day made so far and
-- extend_on the day the nightly job (/api/cron/extend-event-series) should
-- next make more (NULL once the repeat has ended).
--
-- WRITES FROM OUTSIDE A SERIES WRITE (the browser, the Integration API) are
-- kept in step by triggers: changing an occurrence marks it series_exception,
-- deleting one adds its day to skipped_days, and putting one back (the undo)
-- takes the day out again. Only the series writes move an occurrence between
-- series or days. Writes made by another trigger (a person deleted, a whole
-- calendar or family deleted) are left alone.
--
-- DOMAIN EVENTS. kinboard_family_event_created is for events a person makes
-- (RFC-001: an import of 200 events must not emit 200). A series is one
-- event to a person, so migrations/053_domain_events.sql's trigger leaves out
-- the occurrences a series write makes, and event_series_write() emits one,
-- for the first occurrence, when the series is made.
--
-- WHO MAY WRITE. The browser roles read their family's series and write
-- nothing there; every series write is on the service role. TRUNCATE goes
-- with REVOKE ALL. The two write functions are the service role's only.
--
-- Deleting a family or a calendar takes its series with it (ON DELETE
-- CASCADE), and deleting a series takes its occurrences.
--
-- THE NAME sorts after every other migration: it adds a table, columns and
-- triggers to public.events, which init.sql creates.
--
-- Safe to run twice, and twice at once: the session advisory lock serialises
-- two runs. Every step also brings an earlier shape of these tables up to
-- this one.

SELECT pg_advisory_lock(hashtextextended('migration_zzzzzzzzzzzzz_event_series', 0));

-- This file's own writes to events below are series writes, not a person's.
SELECT set_config('kinboard.series_write', 'on', false);

CREATE TABLE IF NOT EXISTS public.event_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
  -- iCalendar RRULE text, the subset lib/event-repeat.ts writes and reads.
  rule TEXT NOT NULL
    CONSTRAINT event_series_rule_check CHECK (rule ~ '^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,]+)*$' AND length(rule) <= 120),
  -- The zone the occurrences keep their wall-clock time in: the browser's,
  -- where the first one was made.
  time_zone TEXT NOT NULL
    CONSTRAINT event_series_time_zone_check CHECK (length(time_zone) BETWEEN 1 AND 64),
  -- The first occurrence, which every other one copies the time and length of.
  first_start_at TIMESTAMPTZ NOT NULL,
  first_end_at TIMESTAMPTZ NOT NULL,
  all_day BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
  -- The last day occurrences have been made for, in time_zone.
  generated_through DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT event_series_order_check CHECK (first_end_at >= first_start_at)
);

ALTER TABLE public.event_series ADD COLUMN IF NOT EXISTS skipped_days DATE[] NOT NULL DEFAULT '{}';
ALTER TABLE public.event_series ADD COLUMN IF NOT EXISTS extend_on DATE;
-- Raised by every series write: the nightly job writes only if nothing else
-- wrote the series since it read it.
ALTER TABLE public.event_series ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;

-- A series no write of this shape has touched yet (revision 0: made before
-- extend_on and revision existed) is due at once, so the nightly job works
-- out when it is next due. Once that job has written it, revision is above 0
-- and this leaves it be.
UPDATE public.event_series SET extend_on = CURRENT_DATE
 WHERE revision = 0 AND (extend_on IS NULL OR extend_on > CURRENT_DATE);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'event_series_id_calendar_key' AND conrelid = 'public.event_series'::regclass) THEN
    ALTER TABLE public.event_series ADD CONSTRAINT event_series_id_calendar_key UNIQUE (id, calendar_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS event_series_family_idx ON public.event_series (family_id);
DROP INDEX IF EXISTS public.event_series_generated_idx;
CREATE INDEX IF NOT EXISTS event_series_extend_idx ON public.event_series (extend_on) WHERE extend_on IS NOT NULL;

ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_series_family_read ON public.event_series;
CREATE POLICY event_series_family_read ON public.event_series
  FOR SELECT USING (family_id = public.current_family_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.event_series FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.event_series FROM authenticated;
    GRANT SELECT ON TABLE public.event_series TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_series TO service_role;
  END IF;
END $$;

-- The occurrences' columns. series_id has no key of its own: the key is the
-- pair, below.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS series_id UUID;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS series_day DATE;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS series_exception BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_series_id_fkey;
DROP INDEX IF EXISTS public.events_series_idx;

-- Rows from before series_day: their day in the series' zone. A row whose
-- series is gone, or in another calendar, is let go of. Two rows on one day
-- of a series keep the first.
UPDATE public.events e SET series_day = (e.start_at AT TIME ZONE s.time_zone)::date
  FROM public.event_series s
 WHERE e.series_id = s.id AND e.series_day IS NULL;
UPDATE public.events e SET series_id = NULL, series_day = NULL, series_exception = false
 WHERE e.series_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.event_series s WHERE s.id = e.series_id AND s.calendar_id = e.calendar_id);
DELETE FROM public.events a USING public.events b
 WHERE a.series_id = b.series_id AND a.series_day = b.series_day AND a.ctid > b.ctid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_series_fkey' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_series_fkey FOREIGN KEY (series_id, calendar_id)
      REFERENCES public.event_series (id, calendar_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_series_day_key' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_series_day_key UNIQUE (series_id, series_day);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_series_day_check' AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events ADD CONSTRAINT events_series_day_check CHECK (series_id IS NULL OR series_day IS NOT NULL);
  END IF;
END $$;

-- Changing an occurrence from outside a series write: it keeps its series
-- and day, and is marked as changed on its own if what it shows changed.
CREATE OR REPLACE FUNCTION public.event_series_occurrence_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF current_setting('kinboard.series_write', true) = 'on' OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  NEW.series_id := OLD.series_id;
  NEW.series_day := OLD.series_day;
  NEW.series_exception := OLD.series_exception OR (
    OLD.series_id IS NOT NULL AND
    (NEW.title, NEW.description, NEW.location, NEW.person_id, NEW.start_at, NEW.end_at, NEW.all_day)
      IS DISTINCT FROM
    (OLD.title, OLD.description, OLD.location, OLD.person_id, OLD.start_at, OLD.end_at, OLD.all_day));
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS events_series_changed ON public.events;
CREATE TRIGGER events_series_changed
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.event_series_occurrence_changed();

-- Deleting an occurrence from outside a series write skips its day for good;
-- putting it back (the calendar's undo) takes the day out of the list again.
-- SECURITY DEFINER: the browser roles cannot write event_series themselves,
-- and the key above means the row's series is in the row's own calendar.
CREATE OR REPLACE FUNCTION public.event_series_occurrence_skipped() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF current_setting('kinboard.series_write', true) = 'on' OR pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE public.event_series SET skipped_days = array_append(skipped_days, OLD.series_day)
     WHERE id = OLD.series_id AND calendar_id = OLD.calendar_id AND NOT (OLD.series_day = ANY (skipped_days));
  ELSE
    UPDATE public.event_series SET skipped_days = array_remove(skipped_days, NEW.series_day)
     WHERE id = NEW.series_id AND calendar_id = NEW.calendar_id;
  END IF;
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS events_series_deleted ON public.events;
CREATE TRIGGER events_series_deleted
  AFTER DELETE ON public.events
  FOR EACH ROW WHEN (OLD.series_id IS NOT NULL)
  EXECUTE FUNCTION public.event_series_occurrence_skipped();
DROP TRIGGER IF EXISTS events_series_restored ON public.events;
CREATE TRIGGER events_series_restored
  AFTER INSERT ON public.events
  FOR EACH ROW WHEN (NEW.series_id IS NOT NULL)
  EXECUTE FUNCTION public.event_series_occurrence_skipped();

-- A series write, in one transaction under the series' row lock: returns
-- {"status": "gone"} when the series is not there (or not in that calendar),
-- {"status": "stale"} when p_revision is given and something else wrote the
-- series since, and otherwise {"status": "ok", "inserted": n, "revision": r}.
--
--   p_template  event_series columns to set (rule, all_day, first_start_at,
--               first_end_at, title, description, location, person_id,
--               generated_through, extend_on); absent keys are kept
--   p_fields    "All events" field changes, {column: {"old": .., "new": ..}}
--               for title / description / location / person_id: every
--               occurrence takes the new value, except one changed on its own
--               that no longer shows the old one
--   p_cut_day   occurrences from this day on are made again, except those
--               changed on their own; those and the skipped days move by
--               p_shift days with the series
--   p_until_day the repeat ends that day: every occurrence after it goes
--   p_rows      the occurrences to make, [{series_day, start_at, end_at}];
--               a skipped day, or a day that already has its row, is left out
CREATE OR REPLACE FUNCTION public.event_series_write(
  p_series_id UUID,
  p_calendar_id UUID,
  p_revision INTEGER,
  p_template JSONB,
  p_fields JSONB,
  p_cut_day DATE,
  p_shift INTEGER,
  p_until_day DATE,
  p_rows JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  s public.event_series;
  creating BOOLEAN;
  moved RECORD;
  inserted INTEGER := 0;
  first_row public.events;
BEGIN
  PERFORM set_config('kinboard.series_write', 'on', true);
  SELECT * INTO s FROM public.event_series WHERE id = p_series_id AND calendar_id = p_calendar_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'gone');
  END IF;
  IF p_revision IS NOT NULL AND s.revision <> p_revision THEN
    RETURN jsonb_build_object('status', 'stale');
  END IF;
  creating := NOT EXISTS (SELECT 1 FROM public.events WHERE series_id = s.id);

  IF p_fields ? 'title' THEN
    UPDATE public.events SET title = p_fields->'title'->>'new'
     WHERE series_id = s.id AND calendar_id = s.calendar_id
       AND (NOT series_exception OR title IS NOT DISTINCT FROM p_fields->'title'->>'old');
  END IF;
  IF p_fields ? 'description' THEN
    UPDATE public.events SET description = p_fields->'description'->>'new'
     WHERE series_id = s.id AND calendar_id = s.calendar_id
       AND (NOT series_exception OR description IS NOT DISTINCT FROM p_fields->'description'->>'old');
  END IF;
  IF p_fields ? 'location' THEN
    UPDATE public.events SET location = p_fields->'location'->>'new'
     WHERE series_id = s.id AND calendar_id = s.calendar_id
       AND (NOT series_exception OR location IS NOT DISTINCT FROM p_fields->'location'->>'old');
  END IF;
  IF p_fields ? 'person_id' THEN
    UPDATE public.events SET person_id = (p_fields->'person_id'->>'new')::uuid
     WHERE series_id = s.id AND calendar_id = s.calendar_id
       AND (NOT series_exception OR person_id IS NOT DISTINCT FROM (p_fields->'person_id'->>'old')::uuid);
  END IF;

  IF p_cut_day IS NOT NULL THEN
    DELETE FROM public.events
     WHERE series_id = s.id AND calendar_id = s.calendar_id AND series_day >= p_cut_day AND NOT series_exception;
    IF coalesce(p_shift, 0) <> 0 THEN
      -- Furthest first in the direction of the move, so no row lands on one
      -- that has yet to move; a day already taken keeps its row.
      FOR moved IN
        SELECT id, series_day FROM public.events
         WHERE series_id = s.id AND calendar_id = s.calendar_id AND series_day >= p_cut_day
         ORDER BY CASE WHEN p_shift > 0 THEN DATE '2000-01-01' - series_day ELSE series_day - DATE '2000-01-01' END
      LOOP
        UPDATE public.events SET series_day = moved.series_day + p_shift
         WHERE id = moved.id
           AND NOT EXISTS (SELECT 1 FROM public.events o WHERE o.series_id = s.id AND o.series_day = moved.series_day + p_shift);
      END LOOP;
      s.skipped_days := ARRAY(SELECT CASE WHEN d >= p_cut_day THEN d + p_shift ELSE d END FROM unnest(s.skipped_days) d);
    END IF;
  END IF;

  IF p_until_day IS NOT NULL THEN
    DELETE FROM public.events WHERE series_id = s.id AND calendar_id = s.calendar_id AND series_day > p_until_day;
    s.skipped_days := ARRAY(SELECT d FROM unnest(s.skipped_days) d WHERE d <= p_until_day);
  END IF;

  UPDATE public.event_series SET
    rule = coalesce(p_template->>'rule', rule),
    all_day = coalesce((p_template->>'all_day')::boolean, all_day),
    first_start_at = coalesce((p_template->>'first_start_at')::timestamptz, first_start_at),
    first_end_at = coalesce((p_template->>'first_end_at')::timestamptz, first_end_at),
    title = coalesce(p_template->>'title', title),
    description = CASE WHEN p_template ? 'description' THEN p_template->>'description' ELSE description END,
    location = CASE WHEN p_template ? 'location' THEN p_template->>'location' ELSE location END,
    person_id = CASE WHEN p_template ? 'person_id' THEN (p_template->>'person_id')::uuid ELSE person_id END,
    generated_through = coalesce((p_template->>'generated_through')::date, generated_through),
    extend_on = CASE WHEN p_template ? 'extend_on' THEN (p_template->>'extend_on')::date ELSE extend_on END,
    skipped_days = s.skipped_days,
    revision = revision + 1,
    updated_at = NOW()
  WHERE id = s.id
  RETURNING * INTO s;

  INSERT INTO public.events (calendar_id, series_id, series_day, recurrence_rule, title, description, location,
                             person_id, start_at, end_at, all_day)
  SELECT s.calendar_id, s.id, r.series_day, s.rule, s.title, s.description, s.location,
         s.person_id, r.start_at, r.end_at, s.all_day
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS r(series_day DATE, start_at TIMESTAMPTZ, end_at TIMESTAMPTZ)
   WHERE NOT (r.series_day = ANY (s.skipped_days))
  ON CONFLICT (series_id, series_day) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  UPDATE public.events SET recurrence_rule = s.rule
   WHERE series_id = s.id AND calendar_id = s.calendar_id AND recurrence_rule IS DISTINCT FROM s.rule;

  IF creating THEN
    SELECT * INTO first_row FROM public.events WHERE series_id = s.id ORDER BY series_day LIMIT 1;
    IF FOUND THEN
      PERFORM public.emit_domain_event(
        s.family_id, 'kinboard_family_event_created',
        jsonb_build_object('id', first_row.id, 'title', first_row.title, 'start_at', first_row.start_at));
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'inserted', inserted, 'revision', s.revision);
END $fn$;

-- The repeat ends on p_last_day: the occurrences after it go, the rule
-- becomes p_rule (its UNTIL that day) and the series is complete. With
-- p_occurrence ({id, title, description?, location, person_id, start_at,
-- end_at, all_day}) that occurrence takes those values too ("Never", made on
-- it). Returns {"status": "gone"}, or {"status": "ok", "series": s} where s is
-- "ended", "deleted" (no occurrence was left) or "single" (only p_occurrence
-- was left, which is now a plain event).
CREATE OR REPLACE FUNCTION public.event_series_end(
  p_series_id UUID,
  p_calendar_id UUID,
  p_last_day DATE,
  p_rule TEXT,
  p_occurrence JSONB
) RETURNS JSONB LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  s public.event_series;
  occ UUID := (p_occurrence->>'id')::uuid;
  remaining INTEGER;
BEGIN
  PERFORM set_config('kinboard.series_write', 'on', true);
  SELECT * INTO s FROM public.event_series WHERE id = p_series_id AND calendar_id = p_calendar_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'gone');
  END IF;

  DELETE FROM public.events WHERE series_id = s.id AND calendar_id = s.calendar_id AND series_day > p_last_day;

  IF occ IS NOT NULL THEN
    UPDATE public.events e SET
      title = p_occurrence->>'title',
      description = CASE WHEN p_occurrence ? 'description' THEN p_occurrence->>'description' ELSE e.description END,
      location = p_occurrence->>'location',
      person_id = (p_occurrence->>'person_id')::uuid,
      start_at = (p_occurrence->>'start_at')::timestamptz,
      end_at = (p_occurrence->>'end_at')::timestamptz,
      all_day = (p_occurrence->>'all_day')::boolean,
      series_exception = e.series_exception OR
        (e.title, e.location, e.person_id, e.start_at, e.end_at, e.all_day) IS DISTINCT FROM
        (p_occurrence->>'title', p_occurrence->>'location', (p_occurrence->>'person_id')::uuid,
         (p_occurrence->>'start_at')::timestamptz, (p_occurrence->>'end_at')::timestamptz, (p_occurrence->>'all_day')::boolean)
     WHERE e.id = occ AND e.series_id = s.id AND e.calendar_id = s.calendar_id;
  END IF;

  SELECT count(*) INTO remaining FROM public.events WHERE series_id = s.id AND calendar_id = s.calendar_id;
  IF remaining = 0 THEN
    DELETE FROM public.event_series WHERE id = s.id;
    RETURN jsonb_build_object('status', 'ok', 'series', 'deleted');
  END IF;
  IF remaining = 1 AND occ IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.events WHERE id = occ AND series_id = s.id) THEN
    UPDATE public.events SET series_id = NULL, series_day = NULL, series_exception = false, recurrence_rule = NULL
     WHERE id = occ;
    DELETE FROM public.event_series WHERE id = s.id;
    RETURN jsonb_build_object('status', 'ok', 'series', 'single');
  END IF;

  UPDATE public.event_series SET
    rule = p_rule,
    generated_through = LEAST(generated_through, p_last_day),
    extend_on = NULL,
    skipped_days = ARRAY(SELECT d FROM unnest(skipped_days) d WHERE d <= p_last_day),
    revision = revision + 1,
    updated_at = NOW()
  WHERE id = s.id;
  UPDATE public.events SET recurrence_rule = p_rule WHERE series_id = s.id AND calendar_id = s.calendar_id;
  RETURN jsonb_build_object('status', 'ok', 'series', 'ended');
END $fn$;

DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.event_series_write(UUID, UUID, INTEGER, JSONB, JSONB, DATE, INTEGER, DATE, JSONB)',
    'public.event_series_end(UUID, UUID, DATE, TEXT, JSONB)',
    'public.event_series_occurrence_changed()',
    'public.event_series_occurrence_skipped()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.event_series_write(UUID, UUID, INTEGER, JSONB, JSONB, DATE, INTEGER, DATE, JSONB) TO service_role;
    GRANT EXECUTE ON FUNCTION public.event_series_end(UUID, UUID, DATE, TEXT, JSONB) TO service_role;
  END IF;
END $$;

SELECT set_config('kinboard.series_write', '', false);

SELECT pg_advisory_unlock(hashtextextended('migration_zzzzzzzzzzzzz_event_series', 0));

NOTIFY pgrst, 'reload schema';
