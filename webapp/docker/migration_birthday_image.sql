-- migration_birthday_image.sql
-- Adds birthdays.image_url for per-birthday uploaded photos (stored as
-- data: URL TEXT, mirrors the people avatar pattern — no storage bucket).
-- Idempotent: re-running on an already-migrated stack is a no-op.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'birthdays'
      AND column_name = 'image_url'
  ) THEN
    ALTER TABLE public.birthdays ADD COLUMN image_url TEXT;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
