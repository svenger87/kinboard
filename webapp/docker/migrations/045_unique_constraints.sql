-- Migration: Backfill UNIQUE constraints that init.sql declares but
-- pre-existing installs are missing.
--
-- Why this exists: init.sql guards every table with CREATE TABLE IF
-- NOT EXISTS, so on installs created before these UNIQUE clauses
-- landed in init.sql, re-running init.sql is a no-op and the
-- constraint never gets added. This breaks PostgREST upserts that
-- name the constraint via on_conflict=col_a,col_b — most visibly,
-- meal-plan creation hits a 400 because the (family_id, week_start)
-- target doesn't exist as a unique constraint.
--
-- Affected tables observed in the wild: meal_plans, item_catalog,
-- recipe_tags. The other UNIQUE-bearing tables (oauth_credentials,
-- settings, notification_preferences, families.join_code,
-- push_subscriptions.endpoint) shipped their constraint at table
-- creation time, so they're already correct on every install.
--
-- Pattern: a DO block with `ALTER TABLE ... ADD CONSTRAINT IF NOT
-- EXISTS` semantics built by hand, since Postgres < 16 doesn't have
-- IF NOT EXISTS for ADD CONSTRAINT directly.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'meal_plans'
      AND c.conname = 'meal_plans_family_id_week_start_key'
  ) THEN
    ALTER TABLE public.meal_plans
      ADD CONSTRAINT meal_plans_family_id_week_start_key
      UNIQUE (family_id, week_start);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'item_catalog'
      AND c.conname = 'item_catalog_family_id_name_normalized_key'
  ) THEN
    ALTER TABLE public.item_catalog
      ADD CONSTRAINT item_catalog_family_id_name_normalized_key
      UNIQUE (family_id, name_normalized);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'recipe_tags'
      AND c.conname = 'recipe_tags_family_id_name_key'
  ) THEN
    ALTER TABLE public.recipe_tags
      ADD CONSTRAINT recipe_tags_family_id_name_key
      UNIQUE (family_id, name);
  END IF;
END $$;

-- Tell PostgREST to refresh its schema cache so the new constraints
-- become available as on_conflict targets without needing a container
-- restart.
NOTIFY pgrst, 'reload schema';
