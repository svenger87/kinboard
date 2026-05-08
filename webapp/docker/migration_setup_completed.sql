-- migration_setup_completed.sql
-- Adds families.setup_completed boolean. Idempotent: type-guarded so
-- start.sh's run_migrations can apply on every boot without diverging.
-- Existing rows backfill to TRUE so post-1.0.9 self-hosters who already
-- have families don't suddenly see an onboarding banner pointing back
-- into a wizard they don't need.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'families'
      AND column_name = 'setup_completed'
  ) THEN
    ALTER TABLE public.families
      ADD COLUMN setup_completed BOOLEAN NOT NULL DEFAULT FALSE;

    -- Backfill: any pre-existing family is treated as "already set up",
    -- so updating to a Kinboard release that includes this column never
    -- forces existing users back through the wizard.
    UPDATE public.families SET setup_completed = TRUE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
