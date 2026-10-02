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
-- WHY A TRIGGER AS WELL
--
-- These are the repo's first RESTRICTIVE policies, and a gap in a
-- restrictive policy *allows* rather than denies. Between that file's sweep
-- and this file running, on every boot, PostgREST is up and the browser is
-- held by family scope alone: a tab could plant an 'openholidays' row or
-- adopt one, and the next sync would treat it as its own.
-- school_holidays_browser_manual_only is a trigger, which the sweep does not
-- touch, and it is replaced in place (CREATE OR REPLACE TRIGGER), so it is
-- never absent. It holds any role that is neither superuser nor BYPASSRLS --
-- anon and authenticated through PostgREST -- to the same rule the policies
-- state. The service role (the sync, the session routes' admin client) and
-- the migration runner pass. The policies stay: with them a synced row is
-- simply invisible to a browser write (0 rows, as before); the trigger is
-- what answers if they are ever missing.
--
-- Two things it does not do:
--
-- * It trusts current_user. It is exactly as strong as RLS, no stronger: a
--   SECURITY DEFINER function that writes this table, or an INVOKER RPC that
--   runs SQL its caller supplies, would get past both. Today there is
--   neither; keep it that way.
-- * It does not depend on who owns the table. A foreign-key cascade (deleting
--   a family, /api/import's rollback) runs as the owner, which RLS never
--   binds but this trigger would if the owner lacked BYPASSRLS. So a DELETE
--   fired from inside another trigger (pg_trigger_depth() > 1) whose family
--   row is already gone passes whoever runs it: verified on PG 15 that,
--   inside the cascade, the parent row is no longer visible.
--
-- WHY A FUNCTION
--
-- The sync writes a whole response or nothing (§5.2). apply_school_holiday_sync
-- does the windowed delete and the upsert in one call, so in one
-- transaction, and every statement in it names source = 'openholidays': a
-- row the family typed in cannot match, whatever its name or dates. Only the
-- service role may call it.
--
-- Two syncs for one family (a region change through the session route and a
-- cron run that fetched the old region) take a per-family advisory lock, so
-- one finishes before the other starts and the family never ends up with
-- both regions' rows.
--
-- Idempotent throughout: migrations run twice here and on every boot.

ALTER TABLE public.school_holidays ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.school_holidays ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.school_holidays ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.school_holidays ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'school_holidays_source_valid'
                    AND conrelid = 'public.school_holidays'::regclass) THEN
    ALTER TABLE public.school_holidays
      ADD CONSTRAINT school_holidays_source_valid CHECK (source IN ('manual', 'openholidays'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'school_holidays_external_id_matches_source'
                    AND conrelid = 'public.school_holidays'::regclass) THEN
    ALTER TABLE public.school_holidays
      ADD CONSTRAINT school_holidays_external_id_matches_source CHECK ((source = 'manual') = (external_id IS NULL));
  END IF;
  -- Only a fetched row can be hidden (§6.2 hides fetched rows; "copy as my
  -- own" hides the original). A hidden manual row would vanish from the
  -- schedule while still listed in the card with nothing to say why. Added
  -- validated: every row before this file is manual and not hidden.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'school_holidays_hidden_synced_only'
                    AND conrelid = 'public.school_holidays'::regclass) THEN
    ALTER TABLE public.school_holidays
      ADD CONSTRAINT school_holidays_hidden_synced_only CHECK (source <> 'manual' OR NOT hidden);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS school_holidays_external_idx
  ON public.school_holidays (family_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- The browser writes manual rows only. Without these a stale tab could edit
-- a fetched row and the next sync would quietly undo it -- or a hostile one
-- could plant "synced" rows the sync would then treat as its own.
ALTER TABLE public.school_holidays ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.school_holidays_browser_manual_only()
RETURNS TRIGGER
LANGUAGE plpgsql
-- INVOKER on purpose: current_user must be the role making the write.
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Superuser or BYPASSRLS (service_role, postgres, supabase_admin) passes.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
              WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- The family is being deleted (an ON DELETE CASCADE from families): its
  -- rows go with it, synced or not, whatever role the cascade runs as.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1
     AND NOT EXISTS (SELECT 1 FROM public.families WHERE id = OLD.family_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.source IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'school_holidays: only manual rows can be changed here'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.source IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'school_holidays: only manual rows can be written here'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.school_holidays_browser_manual_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_holidays_browser_manual_only() FROM anon, authenticated;

CREATE OR REPLACE TRIGGER school_holidays_browser_manual_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.school_holidays
  FOR EACH ROW EXECUTE FUNCTION public.school_holidays_browser_manual_only();

-- One transaction, so the three policies are never half-replaced.
BEGIN;

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

COMMIT;

-- The five-argument version from before the race fix (never released). A
-- no-op on every run after the first.
DROP FUNCTION IF EXISTS public.apply_school_holiday_sync(UUID, JSONB, DATE, DATE, BOOLEAN);
-- The eight-argument version from before p_language (released in
-- v1.13.0-rc.2): replaced, not left callable beside the new one. A no-op on
-- every run after the first.
DROP FUNCTION IF EXISTS public.apply_school_holiday_sync(UUID, JSONB, DATE, DATE, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.apply_school_holiday_sync(
  p_family_id     UUID,
  p_rows          JSONB,
  p_window_from   DATE,
  p_window_to     DATE,
  p_replace       BOOLEAN,
  -- The school region and group the rows were fetched for (ignored when
  -- p_replace): the sync writes only if the family still holds that choice.
  p_expect_region TEXT,
  p_expect_group  TEXT,
  -- Recorded as last_success_at, in the same transaction as the rows.
  p_synced_at     TIMESTAMPTZ,
  -- The language the rows' names were fetched in, recorded as `language`
  -- with last_success_at. The cron compares it with the family's language
  -- now: a family whose language changed is due at once, not a week later.
  p_language      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted  INTEGER := 0;
  v_upserted INTEGER := 0;
  v_setting  JSONB;
BEGIN
  IF p_family_id IS NULL THEN
    RAISE EXCEPTION 'p_family_id is required';
  END IF;
  -- One sync per family at a time, until this transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended('school_holiday_sync:' || p_family_id::text, 0));

  IF p_window_from IS NULL OR p_window_to IS NULL OR p_window_from > p_window_to THEN
    RAISE EXCEPTION 'the sync window must be two dates in order';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  IF p_replace THEN
    -- Switched off, or a new school region: every synced row goes, hidden
    -- flags included (§6.2). The routes save the new setting first, so a
    -- sync that locks after this sees it and writes nothing.
    DELETE FROM public.school_holidays
     WHERE family_id = p_family_id
       AND source = 'openholidays';
  ELSE
    IF p_synced_at IS NULL THEN
      RAISE EXCEPTION 'p_synced_at is required';
    END IF;
    -- A success without a language would read as "fetched in no language"
    -- and make the family due on every run.
    IF p_language IS NULL OR p_language !~ '^[a-z]{2}$' THEN
      RAISE EXCEPTION 'p_language must be a two-letter language code';
    END IF;
    -- Rows are always fetched for a region. Without one there is nothing
    -- to check the family's choice against, and the check below would pass
    -- for a setting that has no region either.
    IF p_expect_region IS NULL THEN
      RAISE EXCEPTION 'p_expect_region is required';
    END IF;
    -- The request took up to ten seconds. If the family switched off, picked
    -- another region or group, or still has one to pick, this answer is for a
    -- choice nobody holds any more: write nothing. FOR UPDATE holds the row
    -- until commit, so the switch cannot flip between this check and the write.
    SELECT value INTO v_setting
      FROM public.settings
     WHERE family_id = p_family_id
       AND key = 'school_holiday_sync'
       FOR UPDATE;
    IF v_setting IS NULL
       OR jsonb_typeof(v_setting) IS DISTINCT FROM 'object'
       OR v_setting->'enabled' IS DISTINCT FROM 'true'::jsonb
       OR COALESCE(v_setting->'pending', 'null'::jsonb) <> 'null'::jsonb
       OR v_setting->>'region' IS DISTINCT FROM p_expect_region
       OR v_setting->>'group'  IS DISTINCT FROM p_expect_group THEN
      RETURN jsonb_build_object('superseded', true);
    END IF;

    -- Gone from a response that covered it: deleted. "Covered" is overlap: the
    -- API answers every row that touches validFrom..validTo, so a row that
    -- straddles the window's start and is missing has really gone. A row that
    -- ended before the window stays as history.
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

  -- Success is recorded with the rows: merged, so only the status moves.
  -- The timestamp has JavaScript's toISOString() shape, as the app writes.
  IF NOT p_replace THEN
    UPDATE public.settings
       SET value = value || jsonb_build_object(
             'last_success_at', to_char(p_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'language', p_language,
             'last_error_at', NULL,
             'last_error', NULL)
     WHERE family_id = p_family_id
       AND key = 'school_holiday_sync';
  END IF;

  RETURN jsonb_build_object('superseded', false, 'deleted', v_deleted, 'upserted', v_upserted);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_school_holiday_sync(UUID, JSONB, DATE, DATE, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_school_holiday_sync(UUID, JSONB, DATE, DATE, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_school_holiday_sync(UUID, JSONB, DATE, DATE, BOOLEAN, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

-- A failed sync notes why on the family's setting: the two error fields,
-- merged in one statement, so a switch flipped meanwhile is never written
-- back. Nothing happens when the setting is gone.
--
-- p_expect_region and p_expect_group are the choice the failed request was
-- for. The request can take ten seconds; if the family switched off or
-- picked another region or group meanwhile, the failure describes a choice
-- nobody holds, and recording it would show "error" on the new one and keep
-- the cron away from it for an hour. So it is recorded only while the
-- family still holds that choice, switched on. A NULL p_expect_region means
-- the failure came before the setting was read (a database error): there is
-- no choice to compare, and it is recorded as before.

-- The three-argument version from before the check (never released). A
-- no-op on every run after the first.
DROP FUNCTION IF EXISTS public.record_school_holiday_sync_error(UUID, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.record_school_holiday_sync_error(
  p_family_id     UUID,
  p_at            TIMESTAMPTZ,
  p_error         TEXT,
  p_expect_region TEXT,
  p_expect_group  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_family_id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'p_family_id and p_at are required';
  END IF;
  UPDATE public.settings
     SET value = value || jsonb_build_object(
           'last_error_at', to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'last_error', left(COALESCE(p_error, ''), 500))
   WHERE family_id = p_family_id
     AND key = 'school_holiday_sync'
     AND jsonb_typeof(value) = 'object'
     AND (p_expect_region IS NULL
          OR (value->'enabled' = 'true'::jsonb
              AND value->>'region' IS NOT DISTINCT FROM p_expect_region
              AND value->>'group'  IS NOT DISTINCT FROM p_expect_group));
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.record_school_holiday_sync_error(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_school_holiday_sync_error(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_school_holiday_sync_error(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO service_role;

-- The families the weekly cron would otherwise never see: a region someone
-- chose and no sync setting at all. That is the default, which is on
-- (RFC-014 §5.4) and which the card shows as on, but only a change saves it.
-- A family ends up here when it picked its region while the install had
-- SCHOOL_HOLIDAY_SYNC=off, when a restored or hand-made family has a chosen
-- region and no setting, or when saving the region worked and saving the
-- setting after it did not. The cron saves the default for each (only if
-- there is still no row) and syncs it like any other.
--
-- Whether OpenHolidays covers the region is the app's call
-- (defaultSchoolRegion), not this function's. Read-only; service role only.
CREATE OR REPLACE FUNCTION public.school_holiday_sync_unset_families()
RETURNS TABLE (family_id UUID, holiday_region TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT r.family_id, r.value->>'code'
    FROM public.settings r
   WHERE r.key = 'holiday_region'
     AND jsonb_typeof(r.value) = 'object'
     AND r.value->'chosen' = 'true'::jsonb
     AND r.value->>'code' IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.settings s
        WHERE s.family_id = r.family_id
          AND s.key = 'school_holiday_sync'
     )
   ORDER BY r.family_id;
$$;

REVOKE ALL ON FUNCTION public.school_holiday_sync_unset_families() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_holiday_sync_unset_families() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.school_holiday_sync_unset_families() TO service_role;

NOTIFY pgrst, 'reload schema';
