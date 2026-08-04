-- Migration: Server-side notification queue
-- Moves notification triggering from client-side to server-side using
-- Postgres triggers + scheduled_notifications table + cron processor.

-- ===================
-- 0. Ensure scheduled_notifications and notification_logs tables exist
-- ===================

CREATE TABLE IF NOT EXISTS public.scheduled_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    scheduled_for TIMESTAMPTZ NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB,
    related_entity_type TEXT,
    related_entity_id UUID,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    data JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Policies for these two tables now come from migration_zz_row_level_security.sql,
-- which scopes them to the caller's family.
--
-- What used to be here was `USING (family_id IS NOT NULL)`, which matches
-- every row that belongs to any family — so it granted every household read
-- and write access to every other household's notifications. Harmless while
-- RLS was disabled, and a live leak the moment it was turned on: permissive
-- policies are OR'd together, so this one overrode the family scoping.
--
-- It also survived the cleanup in migration_zz_row_level_security.sql, because the
-- runner applies migrations in filename order on every boot and
-- `server_notifications` sorts after `enable_rls` — so the leak was recreated
-- on each restart. Measured on 2026-08-04: a token for a family that does not
-- exist read 225 rows of other households' reminders.
--
-- Do not reintroduce a policy here. If these tables need different rules,
-- change them in migration_zz_row_level_security.sql where the rest live.
DROP POLICY IF EXISTS scheduled_notifications_policy ON public.scheduled_notifications;
DROP POLICY IF EXISTS notification_logs_policy ON public.notification_logs;

-- ===================
-- 1. Add source_device_id to shopping_items and todos
-- ===================

ALTER TABLE public.shopping_items
  ADD COLUMN IF NOT EXISTS source_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL;

ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS source_device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL;

-- ===================
-- 2. Trigger function for shopping_items INSERT
-- ===================

CREATE OR REPLACE FUNCTION notify_shopping_item_inserted()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.scheduled_notifications (
    family_id,
    notification_type,
    scheduled_for,
    title,
    body,
    data,
    related_entity_type,
    related_entity_id,
    processed
  ) VALUES (
    NEW.family_id,
    'shopping_collaborative',
    NOW(),
    'Neuer Artikel',
    NEW.name,
    jsonb_build_object(
      'item_name', NEW.name,
      'source_device_id', COALESCE(NEW.source_device_id::text, '')
    ),
    'shopping_item',
    NEW.id,
    false
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================
-- 3. Trigger function for todos INSERT
-- ===================

CREATE OR REPLACE FUNCTION notify_todo_inserted()
RETURNS TRIGGER AS $$
DECLARE
  person_name TEXT;
BEGIN
  -- Look up assigned person name if person_id is set
  IF NEW.person_id IS NOT NULL THEN
    SELECT name INTO person_name FROM public.people WHERE id = NEW.person_id;
  END IF;

  INSERT INTO public.scheduled_notifications (
    family_id,
    notification_type,
    scheduled_for,
    title,
    body,
    data,
    related_entity_type,
    related_entity_id,
    processed
  ) VALUES (
    NEW.family_id,
    CASE WHEN NEW.person_id IS NOT NULL THEN 'todo_assigned' ELSE 'todo_created' END,
    NOW(),
    CASE WHEN NEW.person_id IS NOT NULL THEN 'Aufgabe zugewiesen' ELSE 'Neue Aufgabe' END,
    CASE
      WHEN NEW.person_id IS NOT NULL AND person_name IS NOT NULL
        THEN NEW.title || ' → ' || person_name
      ELSE NEW.title
    END,
    jsonb_build_object(
      'todo_title', NEW.title,
      'person_name', COALESCE(person_name, ''),
      'source_device_id', COALESCE(NEW.source_device_id::text, '')
    ),
    'todo',
    NEW.id,
    false
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===================
-- 4. Create triggers (drop first to be idempotent)
-- ===================

DROP TRIGGER IF EXISTS trg_shopping_item_notify ON public.shopping_items;
CREATE TRIGGER trg_shopping_item_notify
  AFTER INSERT ON public.shopping_items
  FOR EACH ROW
  EXECUTE FUNCTION notify_shopping_item_inserted();

DROP TRIGGER IF EXISTS trg_todo_notify ON public.todos;
CREATE TRIGGER trg_todo_notify
  AFTER INSERT ON public.todos
  FOR EACH ROW
  EXECUTE FUNCTION notify_todo_inserted();

-- ===================
-- 5. Index for efficient polling of unprocessed notifications
-- ===================

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_pending
  ON public.scheduled_notifications(scheduled_for)
  WHERE NOT processed;

-- ===================
-- 6. Grant permissions on scheduled_notifications
-- ===================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_notifications TO anon, authenticated;

-- Done
SELECT 'Server-side notification migration completed!' as status;
