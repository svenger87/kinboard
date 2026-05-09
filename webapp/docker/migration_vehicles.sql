-- migration_vehicles.sql
-- Adds the `vehicles` table for the new multi-vehicle, multi-vendor
-- /vehicles surface (replaces the legacy single-Tesla /tesla page).
-- Idempotent: type-guarded so start.sh's run_migrations can apply on
-- every boot without diverging.
--
-- Backfill: each family that previously had a `tesla_config` blob
-- nested under settings (key='home_assistant', value->'tesla_config')
-- gets one row in `vehicles` with vendor='tesla' + the existing config
-- copied over. The legacy nested blob is left in place for one release
-- window for rollback safety; a follow-up migration will drop it.

-- 1. Create the table if it doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vehicles'
  ) THEN
    CREATE TABLE public.vehicles (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      vendor TEXT NOT NULL CHECK (vendor IN ('tesla', 'generic-ev')),
      nickname TEXT NOT NULL,
      color TEXT,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX vehicles_family_id_position_idx
      ON public.vehicles (family_id, position);

    -- Trigger function is `update_updated_at` (init.sql line 308).
    -- Every other table in init.sql uses this same function name.
    CREATE TRIGGER vehicles_set_updated_at
      BEFORE UPDATE ON public.vehicles
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- 2. Backfill from the generic settings table.
--
--    Tesla config is stored at `settings.value->'tesla_config'` where
--    `settings.key = 'home_assistant'` (init.sql line 167). The hooks
--    in webapp/src/hooks/use-home-assistant.ts read it via
--    useHomeAssistantStatus() which queries that same row.
--
--    Idempotent: re-running on an already-migrated stack is a no-op
--    because of the NOT EXISTS guard against existing vehicles rows.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      s.family_id,
      s.value -> 'tesla_config' AS tesla_config
    FROM public.settings s
    WHERE s.key = 'home_assistant'
      AND s.value ? 'tesla_config'
      AND s.value -> 'tesla_config' <> '{}'::jsonb
      AND s.value -> 'tesla_config' IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.vehicles v
        WHERE v.family_id = s.family_id
      )
  LOOP
    INSERT INTO public.vehicles (family_id, position, vendor, nickname, config)
    VALUES (
      rec.family_id,
      0,
      'tesla',
      'Tesla',
      rec.tesla_config
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
