-- migration_zzzzz_school_holiday_sync.sql — RFC-014 §5.1: school holidays
-- synced from the OpenHolidays API live in the same table as the family's
-- own.
--
--   source       'manual' (every existing row) or 'openholidays'
--   external_id  OpenHolidays' id for a synced row; NULL exactly for manual rows
--   hidden       the family said "not for us" (§6.2); the sync never touches it
--   synced_at    when the sync last saw the row
--
-- WHY THIS FILE SORTS AFTER migration_zz_row_level_security.sql
--
-- That file drops every policy not named *_family_scope on every boot. The
-- three restrictive policies below, which keep the browser to manual rows,
-- are created after it has run, so they survive -- the zzy_attention
-- pattern. The family-scope policy still comes from that file; Postgres ANDs
-- restrictive policies with it.
--
-- WHY A FUNCTION
--
-- The sync writes a whole response or nothing (§5.2). apply_school_holiday_sync
-- does the windowed delete and the upsert in one call, so in one
-- transaction, and every statement in it names source = 'openholidays': a
-- row the family typed in cannot match, whatever its name or dates. Only the
-- service role may call it.
--
-- Idempotent throughout: migrations run twice here and on every boot.

ALTER TABLE public.school_holidays ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.school_holidays ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.school_holidays ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.school_holidays ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_holidays_source_valid') THEN
    ALTER TABLE public.school_holidays
      ADD CONSTRAINT school_holidays_source_valid CHECK (source IN ('manual', 'openholidays'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'school_holidays_external_id_matches_source') THEN
    ALTER TABLE public.school_holidays
      ADD CONSTRAINT school_holidays_external_id_matches_source CHECK ((source = 'manual') = (external_id IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS school_holidays_external_idx
  ON public.school_holidays (family_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- The browser writes manual rows only. Without these a stale tab could edit
-- a fetched row and the next sync would quietly undo it -- or a hostile one
-- could plant "synced" rows the sync would then treat as its own.
ALTER TABLE public.school_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS school_holidays_manual_insert ON public.school_holidays;
CREATE POLICY school_holidays_manual_insert ON public.school_holidays
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (source = 'manual');

DROP POLICY IF EXISTS school_holidays_manual_update ON public.school_holidays;
CREATE POLICY school_holidays_manual_update ON public.school_holidays
  AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (source = 'manual')
  WITH CHECK (source = 'manual');

DROP POLICY IF EXISTS school_holidays_manual_delete ON public.school_holidays;
CREATE POLICY school_holidays_manual_delete ON public.school_holidays
  AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (source = 'manual');

CREATE OR REPLACE FUNCTION public.apply_school_holiday_sync(
  p_family_id   UUID,
  p_rows        JSONB,
  p_window_from DATE,
  p_window_to   DATE,
  p_replace     BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted  INTEGER := 0;
  v_upserted INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  IF p_replace THEN
    -- Switched off, or a new school region: every synced row goes, hidden
    -- flags included (§6.2).
    DELETE FROM public.school_holidays
     WHERE family_id = p_family_id
       AND source = 'openholidays';
  ELSE
    -- Gone from a response that covered it: deleted. A row that ended before
    -- the window stays as history.
    DELETE FROM public.school_holidays s
     WHERE s.family_id = p_family_id
       AND s.source = 'openholidays'
       AND s.starts_on <= p_window_to
       AND s.ends_on >= p_window_from
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE r->>'external_id' = s.external_id
       );
  END IF;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.school_holidays (family_id, source, external_id, name, starts_on, ends_on, synced_at)
  SELECT p_family_id, 'openholidays', r->>'external_id', r->>'name',
         (r->>'starts_on')::date, (r->>'ends_on')::date, now()
    FROM jsonb_array_elements(p_rows) r
  ON CONFLICT (family_id, source, external_id) WHERE external_id IS NOT NULL
  DO UPDATE SET
    name       = EXCLUDED.name,
    starts_on  = EXCLUDED.starts_on,
    ends_on    = EXCLUDED.ends_on,
    synced_at  = EXCLUDED.synced_at,
    -- hidden is never touched. updated_at moves only when something a family
    -- can see changed, so an identical sync leaves the row as it was.
    updated_at = CASE
      WHEN (school_holidays.name, school_holidays.starts_on, school_holidays.ends_on)
           IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.starts_on, EXCLUDED.ends_on)
      THEN now()
      ELSE school_holidays.updated_at
    END;
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted, 'upserted', v_upserted);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_school_holiday_sync(UUID, JSONB, DATE, DATE, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_school_holiday_sync(UUID, JSONB, DATE, DATE, BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_school_holiday_sync(UUID, JSONB, DATE, DATE, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';
