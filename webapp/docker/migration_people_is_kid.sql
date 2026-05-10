-- migration_people_is_kid.sql
-- Adds an `is_kid` boolean to the existing `people` table. The
-- pocket-money plugin uses this to filter who's eligible for an
-- account. Future kid-specific surfaces (kid-mode dashboard, age-
-- appropriate widgets) can reuse the flag.
--
-- Idempotent: re-running on a migrated stack is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'people'
      AND column_name = 'is_kid'
  ) THEN
    ALTER TABLE public.people
      ADD COLUMN is_kid BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
