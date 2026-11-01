-- The change feed: every row change on a table the screens follow is
-- announced on the `kinboard_changes` NOTIFY channel, and the webapp turns
-- those into Server-Sent Events (src/lib/realtime/hub.ts,
-- src/app/api/realtime/route.ts). It replaces Supabase Realtime, which read
-- the same changes out of a logical replication slot through the
-- `supabase_realtime` publication. The publication migrations stay; with
-- nothing reading the publication they are inert.
--
-- The payload, as JSON:
--   table      the table's name
--   op         INSERT, UPDATE or DELETE
--   family_id  whose change it is; the webapp sends it to that family only
--   new, old   the row after and before, cut down to `id` and the few fields
--              a screen reads from the change itself (see `keep` below).
--              Everything else a screen needs it refetches, through its own
--              session and row-level security, so nothing here can leak a
--              column a screen could not read anyway.
--
-- NOTIFY payloads are limited to 8000 bytes. The kept fields are small, and a
-- payload that still comes out over 7000 bytes is sent without `new`/`old`:
-- the screens then refetch without reacting to the row, which is what they do
-- for most tables anyway.
--
-- The family: most tables carry `family_id`. The rest take it from their
-- parent:
--   events                            calendars.family_id via calendar_id
--   recipe_ingredients                recipes.family_id via recipe_id
--   meal_plan_entries                 meal_plans.family_id via meal_plan_id
--   pocket_money_transactions,
--   pocket_money_goals,
--   pocket_money_withdrawal_requests  pocket_money_accounts.family_id via
--                                     account_id
-- A change whose family cannot be found is not announced. That is the child
-- row of a cascade delete, whose parent is already gone; the parent's own
-- change (calendars, recipes, meal_plans, pocket_money_accounts) is announced
-- and refetches the same lists.
--
-- A soft delete (migrations/056_soft_delete.sql) turns a DELETE into an UPDATE
-- of deleted_at, so it is announced as that UPDATE, and the screens refetch
-- without the row. A hard delete is announced as a DELETE.
--
-- SECURITY DEFINER so the parent lookup sees the parent whoever made the
-- change: a browser role writing through PostgREST is under row-level
-- security, and a soft-deleted parent is hidden from it. The function reads
-- one column of one row and sends a notification; it returns nothing to the
-- caller.
--
-- `e2e/realtime-change-feed.spec.ts` fails when a table the screens follow
-- (ALL_TABLES in src/hooks/use-realtime.ts) is missing from the list below.
--
-- Idempotent: the function is replaced and every trigger dropped and
-- recreated, so a re-run (an edited file is re-applied) is safe. A table that
-- does not exist is skipped.

CREATE OR REPLACE FUNCTION public.kinboard_notify_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_row jsonb;
  old_row jsonb;
  row_any jsonb;
  family  uuid;
  keep    text[] := ARRAY['id'];
  payload jsonb;
  body    text;
BEGIN
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  row_any := coalesce(new_row, old_row);

  IF row_any ? 'family_id' THEN
    family := (row_any ->> 'family_id')::uuid;
  ELSIF TG_TABLE_NAME = 'events' THEN
    SELECT c.family_id INTO family FROM public.calendars c
     WHERE c.id = (row_any ->> 'calendar_id')::uuid;
  ELSIF TG_TABLE_NAME = 'recipe_ingredients' THEN
    SELECT r.family_id INTO family FROM public.recipes r
     WHERE r.id = (row_any ->> 'recipe_id')::uuid;
  ELSIF TG_TABLE_NAME = 'meal_plan_entries' THEN
    SELECT m.family_id INTO family FROM public.meal_plans m
     WHERE m.id = (row_any ->> 'meal_plan_id')::uuid;
  ELSIF row_any ? 'account_id' THEN
    SELECT a.family_id INTO family FROM public.pocket_money_accounts a
     WHERE a.id = (row_any ->> 'account_id')::uuid;
  END IF;

  IF family IS NULL THEN
    RETURN NULL;
  END IF;

  -- What the screens read from the change itself (src/hooks/use-realtime.ts).
  IF TG_TABLE_NAME = 'todos' THEN
    -- TickRow, src/lib/pocket-money/creature-reactions.ts: a creature cheers
    -- for a tick seen on another screen.
    keep := keep || ARRAY[
      'completed', 'last_completed', 'last_completed_by', 'points',
      'recurrence', 'person_id', 'rotation_person_ids', 'track_completion',
      'schedule_start_day', 'schedule_anchor_day', 'rotation_offset',
      'carry_day', 'tracking_started_day', 'last_completed_day'];
  ELSIF TG_TABLE_NAME = 'settings' THEN
    keep := keep || ARRAY['key'];
  ELSIF TG_TABLE_NAME = 'birthday_gift_ideas' THEN
    keep := keep || ARRAY['birthday_id'];
  ELSIF TG_TABLE_NAME = 'assistant_action_requests' THEN
    -- actionChangeMatters, src/lib/home/action-prompt.ts
    keep := keep || ARRAY['status'];
  END IF;

  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'family_id', family,
    'new', (SELECT jsonb_object_agg(k, new_row -> k) FROM unnest(keep) k WHERE new_row ? k),
    'old', (SELECT jsonb_object_agg(k, old_row -> k) FROM unnest(keep) k WHERE old_row ? k));

  body := payload::text;
  IF octet_length(body) > 7000 THEN
    body := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'family_id', family)::text;
  END IF;

  PERFORM pg_notify('kinboard_changes', body);
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.kinboard_notify_change() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'people', 'events', 'calendars', 'todos', 'shopping_items', 'subjects',
    'schedules', 'birthdays', 'notes', 'settings', 'recipes',
    'recipe_ingredients', 'recipe_tags', 'meal_plans', 'meal_plan_entries',
    'item_catalog', 'push_subscriptions', 'notification_preferences',
    'birthday_gift_ideas', 'timers', 'camera_takeovers', 'messages',
    'catalogue_items', 'rooms', 'assistant_action_requests',
    'todo_occurrences', 'point_rewards', 'point_redemptions',
    'point_purchases', 'todo_point_awards', 'creatures',
    'pocket_money_accounts', 'pocket_money_transactions',
    'pocket_money_goals', 'pocket_money_withdrawal_requests'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS kinboard_change_feed ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER kinboard_change_feed AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.kinboard_notify_change()', t);
    END IF;
  END LOOP;
END $$;
