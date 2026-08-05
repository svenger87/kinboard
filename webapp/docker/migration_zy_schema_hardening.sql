-- Schema corrections an upgraded install never received.
--
-- WHY THIS EXISTS
--
-- init.sql is the canonical schema, but it only ever runs once, against an
-- empty data directory (docker-compose mounts it into
-- /docker-entrypoint-initdb.d, and Postgres skips that directory entirely on
-- a volume that already has a database in it). Everything an existing install
-- gets after day one has to arrive through a migration.
--
-- Several things never did. Each one below is a place where a self-hoster who
-- installed a year ago is running a different schema from one who installs
-- today — the same class of drift migration_schema_parity.sql fixed for
-- columns, found this time by diffing constraints, grants and indexes rather
-- than column lists.
--
-- WHY THE FILENAME STARTS WITH zy
--
-- Migrations apply in filename order on every boot. This one touches
-- scheduled_notifications and notification_logs, which migration_server_
-- notifications.sql creates — so on a fresh install it has to run after that
-- file, or the very first boot dies on a CREATE INDEX against a table that
-- does not exist yet (ON_ERROR_STOP=1 means that is a failed boot, not a
-- warning). It still has to run before migration_zz_row_level_security.sql,
-- which is deliberately last. zy sits in the only gap that satisfies both.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Deleting a person no longer fails because they were assigned an event.
--
-- init.sql and migration_person_assignment.sql both declare
-- events.person_id as ON DELETE SET NULL, and they agree with each other —
-- but the migration wraps the ADD COLUMN in "if the column does not exist".
-- On every install that already had the column, the guard was true, the
-- branch was skipped, and the foreign key kept whatever rule it was born
-- with: NO ACTION.
--
-- That is not a cosmetic difference. Settings → People deletes through
-- PostgREST straight from the browser (useDeletePerson), so the database
-- rejection is the whole story — the request comes back 23503 and the row
-- stays. Anyone who had ever assigned an event to a family member simply
-- could not remove them, and the UI gave no reason why.
--
-- birthdays.person_id and notes.person_id were created correctly and are
-- already SET NULL. This brings events in line with its siblings.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'events'
      AND c.conname = 'events_person_id_fkey'
      AND c.confdeltype <> 'n'   -- 'n' = SET NULL; anything else is the bug
  ) THEN
    ALTER TABLE public.events DROP CONSTRAINT events_person_id_fkey;
    ALTER TABLE public.events
      ADD CONSTRAINT events_person_id_fkey
      FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Gift ideas are readable by the browser at all.
--
-- birthday_gift_ideas had no grant for anon or authenticated, so every
-- request from the browser came back "permission denied for table". The
-- feature looked empty rather than broken: useGiftIdeas catches the error and
-- returns [], and the create/update/delete mutations throw into a toast. A
-- family could open a birthday, see no gift ideas, add one, and have nothing
-- happen.
--
-- The cause is worth writing down, because it is a trap for the next
-- migration that adds a table. ALTER DEFAULT PRIVILEGES in this database
-- grants new tables owned by `postgres` to service_role, authenticator and
-- the two supabase admin roles — and to nobody else. anon and authenticated
-- are not in that list. So a table gets its browser grant only if a migration
-- writes one out by hand, and migration_birthday_gift_ideas.sql did not.
--
-- If you add a table that the browser client reads, add its GRANT in the same
-- file. Nothing will do it for you.
--
-- RLS still applies on top of this: the family_scope policy on the table
-- resolves family_id from the caller's JWT, so the grant widens what the role
-- may touch, not which family's rows it can see.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.birthday_gift_ideas TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Shopping items point at rows that are actually there.
--
-- init.sql adds catalog_item_id, recipe_id and added_by with
-- REFERENCES ... ON DELETE SET NULL. migration.sql adds the same three
-- columns bare, with no foreign key at all — and migration.sql is the path
-- every upgraded install took. Nothing has stopped a deleted recipe or a
-- removed family member from leaving a shopping item pointing at an id that
-- no longer resolves; the item just stops rendering its source.
--
-- The nulling pass ahead of each constraint is the cleanup those missing
-- SET NULL rules would have done at delete time. A dangling id means the
-- parent row is already gone, which is exactly the case the foreign key
-- would have written NULL for. Doing it here rather than letting VALIDATE
-- fail keeps a legacy row from blocking boot.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'shopping_items'
      AND c.conname = 'shopping_items_catalog_item_id_fkey'
  ) THEN
    UPDATE public.shopping_items s SET catalog_item_id = NULL
     WHERE s.catalog_item_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.item_catalog i WHERE i.id = s.catalog_item_id);

    ALTER TABLE public.shopping_items
      ADD CONSTRAINT shopping_items_catalog_item_id_fkey
      FOREIGN KEY (catalog_item_id) REFERENCES public.item_catalog(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'shopping_items'
      AND c.conname = 'shopping_items_recipe_id_fkey'
  ) THEN
    UPDATE public.shopping_items s SET recipe_id = NULL
     WHERE s.recipe_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = s.recipe_id);

    ALTER TABLE public.shopping_items
      ADD CONSTRAINT shopping_items_recipe_id_fkey
      FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'shopping_items'
      AND c.conname = 'shopping_items_added_by_fkey'
  ) THEN
    UPDATE public.shopping_items s SET added_by = NULL
     WHERE s.added_by IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.people p WHERE p.id = s.added_by);

    ALTER TABLE public.shopping_items
      ADD CONSTRAINT shopping_items_added_by_fkey
      FOREIGN KEY (added_by) REFERENCES public.people(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Every foreign key gets an index on the referencing side.
--
-- Postgres indexes the target of a foreign key automatically and the source
-- never. That asymmetry is invisible until something is deleted: removing one
-- parent row makes the database scan the whole child table once per foreign
-- key pointing at it, holding a row lock the entire time. Nineteen keys in
-- this schema had no supporting index, including the ones on the delete paths
-- a family actually uses — removing a device, a person, a recipe.
--
-- Two of them are worth calling out. device_sessions.device_id became
-- ON DELETE CASCADE in migration_device_sessions_cascade.sql, so signing a
-- lost phone out now depends on this scan. And scheduled_notifications had no
-- index on family_id at all, on the fastest-growing table in the schema, for
-- the column every row-level-security policy on it filters by — so the RLS
-- check was a sequential scan on every read.
--
-- Partial where the column is genuinely optional: the index then holds only
-- the rows that have a parent, which on tables like pocket_money_transactions
-- is a small fraction of them. A partial index still serves the foreign key's
-- own lookup, because `col = $1` cannot match a NULL and the planner knows it.
-- ---------------------------------------------------------------------------

-- People and their assignments.
CREATE INDEX IF NOT EXISTS idx_events_person
  ON public.events(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_birthdays_person
  ON public.birthdays(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendars_person
  ON public.calendars(person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_person
  ON public.notes(person_id) WHERE person_id IS NOT NULL;

-- Devices. Not partial: a session or a preference row always belongs to a
-- device — the columns are nullable for historical reasons, not because the
-- link is optional.
CREATE INDEX IF NOT EXISTS idx_device_sessions_device
  ON public.device_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_device
  ON public.notification_preferences(device_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_device
  ON public.notification_logs(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_todos_source_device
  ON public.todos(source_device_id) WHERE source_device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shopping_source_device
  ON public.shopping_items(source_device_id) WHERE source_device_id IS NOT NULL;

-- Family scoping. Both columns are NOT NULL, so a partial index would only
-- add a predicate that is always true.
CREATE INDEX IF NOT EXISTS idx_gift_ideas_family
  ON public.birthday_gift_ideas(family_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_family
  ON public.scheduled_notifications(family_id);

-- Recipes and shopping. The three shopping_items indexes cover the foreign
-- keys section 3 just added, so deleting a catalog entry, a recipe or a
-- person does not scan the list.
CREATE INDEX IF NOT EXISTS idx_recipe_tag_assignments_tag
  ON public.recipe_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_shopping_catalog_item
  ON public.shopping_items(catalog_item_id) WHERE catalog_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shopping_recipe
  ON public.shopping_items(recipe_id) WHERE recipe_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shopping_added_by
  ON public.shopping_items(added_by) WHERE added_by IS NOT NULL;

-- Pocket money. Every one of these is mostly NULL in practice — a transaction
-- usually has no goal attached and a withdrawal request usually has not been
-- decided yet.
CREATE INDEX IF NOT EXISTS idx_pocket_money_transactions_created_by
  ON public.pocket_money_transactions(created_by_person_id) WHERE created_by_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pocket_money_transactions_goal
  ON public.pocket_money_transactions(related_goal_id) WHERE related_goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pocket_money_withdrawal_requests_decided_by
  ON public.pocket_money_withdrawal_requests(parent_decided_by_person_id) WHERE parent_decided_by_person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pocket_money_withdrawal_requests_goal
  ON public.pocket_money_withdrawal_requests(related_goal_id) WHERE related_goal_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Two indexes that were being maintained twice.
--
-- init.sql and migration.sql each created an index on
-- notification_preferences(family_id) under a different name, and init.sql
-- created the same partial index on scheduled_notifications twice, once at
-- line 615 and once at line 726. A duplicate index is not a read problem —
-- it is write cost and disk for nothing, on the two tables that take the most
-- inserts.
--
-- Which name survives is not arbitrary. The one that keeps being recreated
-- has to be the one we keep, or the drop reappears on the next boot:
--
--   idx_notification_preferences_family  <- migration.sql, re-runs every boot
--   idx_notification_prefs_family        <- init.sql only, first boot only
--   idx_scheduled_notifications_pending  <- migration_server_notifications.sql
--   idx_scheduled_notifications_time     <- init.sql only, first boot only
--
-- So the init.sql-only names go. On an existing install init.sql never runs
-- again and they stay gone; on a fresh install init.sql creates them and this
-- file removes them a few seconds later in the same boot. Both paths land in
-- the same place.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_notification_prefs_family;
DROP INDEX IF EXISTS public.idx_scheduled_notifications_time;

-- ---------------------------------------------------------------------------
-- 6. The two CHECK constraints init.sql declares inline.
--
-- recipes.difficulty and meal_plan_entries.meal_type are constrained to a
-- fixed set of values on a fresh install and to nothing at all on an upgraded
-- one, because migration.sql creates both tables without the CHECK clause.
-- The UI only ever offers the valid values, so this is about what an import
-- or a direct PostgREST write can put in — meal_type in particular is read
-- back as a lookup key, and an unrecognised value silently renders nothing.
--
-- Added NOT VALID first, then validated separately. NOT VALID starts enforcing
-- immediately for inserts and updates while leaving existing rows alone, so
-- the constraint is doing its job even where the backfill cannot finish. The
-- validation pass is wrapped so that a legacy row with an unexpected value
-- produces a warning in the boot log instead of a failed migration and a
-- webapp that will not start. Fix the row, restart, and the validation
-- completes on its own.
--
-- The constraint names match what Postgres generates for the inline CHECK in
-- init.sql, so a fresh install already has them under these names and skips
-- this section entirely.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'recipes'
      AND c.conname = 'recipes_difficulty_check'
  ) THEN
    ALTER TABLE public.recipes
      ADD CONSTRAINT recipes_difficulty_check
      CHECK (difficulty IN ('einfach', 'mittel', 'schwer')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'meal_plan_entries'
      AND c.conname = 'meal_plan_entries_meal_type_check'
  ) THEN
    ALTER TABLE public.meal_plan_entries
      ADD CONSTRAINT meal_plan_entries_meal_type_check
      CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'recipes'
      AND c.conname = 'recipes_difficulty_check' AND NOT c.convalidated
  ) THEN
    ALTER TABLE public.recipes VALIDATE CONSTRAINT recipes_difficulty_check;
  END IF;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'recipes.difficulty holds a value outside (einfach, mittel, schwer). The constraint is in place for new writes but stays unvalidated until the existing row is corrected.';
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public' AND r.relname = 'meal_plan_entries'
      AND c.conname = 'meal_plan_entries_meal_type_check' AND NOT c.convalidated
  ) THEN
    ALTER TABLE public.meal_plan_entries VALIDATE CONSTRAINT meal_plan_entries_meal_type_check;
  END IF;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'meal_plan_entries.meal_type holds a value outside (breakfast, lunch, dinner, snack). The constraint is in place for new writes but stays unvalidated until the existing row is corrected.';
END $$;

-- Retention for scheduled_notifications and notification_logs is swept by
-- /api/cron/process-notifications, which already runs every 30 seconds and
-- already owns the lifecycle of these rows. See the sweep there rather than
-- adding a second mechanism here.

-- The grant above is a schema change as far as PostgREST is concerned; it
-- caches which tables a role may touch and will keep refusing gift-idea
-- requests until told otherwise.
NOTIFY pgrst, 'reload schema';
