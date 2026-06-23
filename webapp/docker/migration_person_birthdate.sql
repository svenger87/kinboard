-- migration_person_birthdate.sql
-- Adds people.birth_date for optional birthday display and age-based role labels.
-- Idempotent: re-running on an already-migrated stack is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'people'
      AND column_name = 'birth_date'
  ) THEN
    ALTER TABLE public.people ADD COLUMN birth_date DATE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
