-- Migration: add opt-in join-code expiry to families
-- NULL = never expires (existing behaviour unchanged)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'families'
      AND column_name  = 'join_code_expires_at'
  ) THEN
    ALTER TABLE public.families
      ADD COLUMN join_code_expires_at TIMESTAMPTZ;
  END IF;
END$$;

NOTIFY pgrst, 'reload schema';
