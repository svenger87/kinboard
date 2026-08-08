-- migration_zzy_domain_events.sql — the domain event outbox (RFC-001 §2.1, §6.3).
--
-- WHY THIS IS IN THE DATABASE AND NOT IN THE API LAYER
--
-- The plan (§6.4) has writes producing domain events through a transactional
-- outbox. Read as "the API route writes an outbox row", that design would miss
-- most of the events it exists to produce. Measured against main: twenty
-- "use client" components write straight to PostgREST via
-- @/lib/supabase/client — birthdays, calendar, shopping, meals, notes,
-- recipes — against 48 server-side writers. kinboard_shopping_item_added and
-- kinboard_task_completed ARE those browser-side actions. A parent ticking off
-- a task on the kitchen tablet never traverses a route handler.
--
-- So events are produced by triggers. The database is the only layer every
-- write passes through, so it is the only place a guarantee can be made. This
-- is the same conclusion the recycle bin reached for the same reason, and that
-- runs in production today with no call site changed.
--
-- THE FILE NAME
--
-- `zzy` so it sorts after every migration that CREATEs a table these triggers
-- attach to — pocket_money_goals comes from migration_pocket_money.sql, which
-- would otherwise sort after a plainly-named migration_domain_events.sql and
-- the trigger would fail on a fresh install. It sorts before
-- migration_zz_row_level_security.sql, which is fine: this file defines no
-- family-scope policy for that file to recreate over.

-- ------------------------------------------------------------------ table

CREATE TABLE IF NOT EXISTS public.domain_events (
  -- BIGSERIAL, not UUID. The cursor has to be *ordered*: a consumer stores
  -- "I have processed up to 4711" and asks for everything above it. A UUID
  -- cannot be compared, and occurred_at collides under concurrency.
  id              BIGSERIAL PRIMARY KEY,
  family_id       UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,

  -- Versioned separately from the event name so a payload can gain a field
  -- without minting a new event type and breaking every existing automation.
  payload_version INT  NOT NULL DEFAULT 1,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Who acted. NULL is allowed and expected: a trigger does not inherently
  -- know, and an event with an unknown actor is still useful whereas a
  -- missing event is not. See the actor note below.
  actor_id        UUID,

  -- 'app' for a person acting, 'sync' for an importer, 'system' for cron.
  source          TEXT NOT NULL DEFAULT 'app',
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only read pattern that matters: "everything for this family after N".
CREATE INDEX IF NOT EXISTS idx_domain_events_family_cursor
  ON public.domain_events (family_id, id);

-- For the retention sweep.
CREATE INDEX IF NOT EXISTS idx_domain_events_occurred
  ON public.domain_events (occurred_at);

-- Payloads carry family data — a task title, a shopping item. Same protection
-- as integration_tokens and integration_secrets: the browser must not be able
-- to read this table, and it is not in the realtime publication.
REVOKE ALL ON TABLE public.domain_events FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.domain_events FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.domain_events FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.domain_events TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.domain_events_id_seq TO service_role;
  END IF;
END $$;

-- ------------------------------------------------------------------ emit

-- Actor and source come from transaction-local settings, the same mechanism
-- soft delete already uses for kinboard.hard_delete (see
-- migration_zzz_soft_delete.sql, lines ~89 and ~239). A caller that knows who
-- is acting does:
--
--   SELECT set_config('kinboard.actor_id', '<uuid>', true);
--
-- The `true` makes it transaction-local, so it cannot leak into the next
-- statement on a pooled connection. Both are optional: requiring them would
-- mean a write that forgot the setting *fails*, trading a complete event log
-- for broken writes. An event with a NULL actor is still worth having.
CREATE OR REPLACE FUNCTION public.emit_domain_event(
  p_family_id  UUID,
  p_event_type TEXT,
  p_payload    JSONB DEFAULT '{}'::jsonb,
  p_version    INT DEFAULT 1
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor  UUID;
  v_source TEXT;
  v_id     BIGINT;
BEGIN
  -- A malformed setting must never break the write it is describing.
  BEGIN
    v_actor := nullif(current_setting('kinboard.actor_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_actor := NULL;
  END;

  v_source := coalesce(nullif(current_setting('kinboard.event_source', true), ''), 'app');

  INSERT INTO public.domain_events (family_id, event_type, payload_version, payload, actor_id, source)
  VALUES (p_family_id, p_event_type, p_version, coalesce(p_payload, '{}'::jsonb), v_actor, v_source)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_domain_event(UUID, TEXT, JSONB, INT) FROM PUBLIC;

-- --------------------------------------------------------------- triggers

-- kinboard_task_completed — only on the false -> true edge.
--
-- Note what this must NOT fire on: soft delete is an UPDATE that sets
-- deleted_at, and it would otherwise re-emit for every binned task. The
-- edge condition covers it (a delete does not flip `completed`), and the
-- deleted_at guard makes that explicit rather than incidental.
CREATE OR REPLACE FUNCTION public.trg_event_task_completed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.completed IS TRUE AND OLD.completed IS DISTINCT FROM TRUE
     AND NEW.deleted_at IS NULL THEN
    PERFORM public.emit_domain_event(
      NEW.family_id, 'kinboard_task_completed',
      jsonb_build_object('id', NEW.id, 'title', NEW.title));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_task_completed ON public.todos;
CREATE TRIGGER event_task_completed
  AFTER UPDATE ON public.todos
  FOR EACH ROW EXECUTE FUNCTION public.trg_event_task_completed();

-- kinboard_shopping_item_added
CREATE OR REPLACE FUNCTION public.trg_event_shopping_item_added()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.emit_domain_event(
    NEW.family_id, 'kinboard_shopping_item_added',
    jsonb_build_object('id', NEW.id, 'name', NEW.name));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_shopping_item_added ON public.shopping_items;
CREATE TRIGGER event_shopping_item_added
  AFTER INSERT ON public.shopping_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_event_shopping_item_added();

-- kinboard_family_event_created
--
-- RFC-001 open question 2, decided here: a CalDAV or Google sync pulling 200
-- events must not produce 200 kinboard_family_event_created events. An event
-- that arrives carrying a foreign id (caldav_href or google_event_id) came
-- from an importer, not from a person, so it is suppressed. An event a person
-- creates in a synced calendar has neither at insert time and is emitted —
-- which is the right answer, because a person did create it.
CREATE OR REPLACE FUNCTION public.trg_event_family_event_created()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_family UUID;
BEGIN
  IF NEW.caldav_href IS NOT NULL OR NEW.google_event_id IS NOT NULL THEN
    RETURN NEW;  -- imported, not authored
  END IF;

  SELECT family_id INTO v_family FROM public.calendars WHERE id = NEW.calendar_id;
  IF v_family IS NULL THEN
    RETURN NEW;  -- orphaned calendar; nothing to scope the event to
  END IF;

  PERFORM public.emit_domain_event(
    v_family, 'kinboard_family_event_created',
    jsonb_build_object('id', NEW.id, 'title', NEW.title, 'start_at', NEW.start_at));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_family_event_created ON public.events;
CREATE TRIGGER event_family_event_created
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.trg_event_family_event_created();

-- kinboard_device_joined
CREATE OR REPLACE FUNCTION public.trg_event_device_joined()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.emit_domain_event(
    NEW.family_id, 'kinboard_device_joined',
    jsonb_build_object('id', NEW.id, 'name', NEW.name));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_device_joined ON public.devices;
CREATE TRIGGER event_device_joined
  AFTER INSERT ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.trg_event_device_joined();

-- kinboard_saving_goal_reached — on the NULL -> set edge of target_reached_at,
-- so re-saving an already-reached goal does not re-announce it.
CREATE OR REPLACE FUNCTION public.trg_event_saving_goal_reached()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.target_reached_at IS NOT NULL AND OLD.target_reached_at IS NULL THEN
    PERFORM public.emit_domain_event(
      NEW.family_id, 'kinboard_saving_goal_reached',
      jsonb_build_object('id', NEW.id, 'target_amount_cents', NEW.target_amount_cents));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_saving_goal_reached ON public.pocket_money_goals;
CREATE TRIGGER event_saving_goal_reached
  AFTER UPDATE ON public.pocket_money_goals
  FOR EACH ROW EXECUTE FUNCTION public.trg_event_saving_goal_reached();

-- -------------------------------------------------------------- retention

-- The log is not an archive. A Bridge that was offline for a week must be able
-- to catch up; nothing needs last spring. Swept by the same nightly Ofelia job
-- pattern as purge-recycle-bin.
CREATE OR REPLACE FUNCTION public.purge_domain_events(p_keep_days INT DEFAULT 30)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted BIGINT;
BEGIN
  DELETE FROM public.domain_events
   WHERE occurred_at < now() - make_interval(days => greatest(p_keep_days, 1));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_domain_events(INT) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
