-- migration_school_holidays.sql
-- School holiday periods, so the Heute-Motor stops asking a child to pack a
-- sports kit for a term that isn't running.
--
-- WHY A TABLE RATHER THAN THE TIMETABLE
--
-- `schedules` stores one row per person per weekday. That is the right shape
-- for a timetable and the wrong shape for a holiday: a break is a date range,
-- and no amount of weekday data can express "the whole of August". The
-- school-bag and school-tomorrow rules therefore fired every evening right
-- through the summer, because Monday still has sport on the timetable whether
-- or not anybody is going.
--
-- WHY DATE, NOT TIMESTAMPTZ
--
-- A holiday is a calendar day in the family's own timezone, not an instant.
-- The attention rules already reduce every decision to a local `YYYY-MM-DD`
-- string, so storing plain DATE lets the comparison stay a string comparison
-- and keeps the whole feature clear of timezone arithmetic.
--
-- `ends_on` is INCLUSIVE — the last day of the holiday, which is what someone
-- typing "1 August to 31 August" means. The CHECK enforces a non-empty range.
--
-- Family-wide on purpose: siblings at schools with different holidays is a
-- real case, but it is not this one, and a nullable person_id nobody sets is
-- a column that later has to be explained. It can be added when someone needs
-- it, which is a smaller change than getting the shape wrong now.
--
-- Idempotent: re-running on a migrated stack is a no-op. RLS lives in
-- migration_zz_row_level_security.sql, which runs last and re-asserts every
-- policy — adding one here would be undone by it (see that file's header).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'school_holidays'
  ) THEN
    CREATE TABLE public.school_holidays (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
      -- The family's own word for it: "Sommerferien", "half term".
      name TEXT NOT NULL,
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT school_holidays_range_valid CHECK (ends_on >= starts_on)
    );

    -- Every read is "which breaks does this family have around now", so the
    -- family and the range travel together.
    CREATE INDEX school_holidays_family_range_idx
      ON public.school_holidays (family_id, starts_on, ends_on);
  END IF;
END $$;

-- GRANTS
--
-- The browser talks to PostgREST directly as `anon` (with a family-scoped
-- JWT), so a table with no grant to that role is invisible to the app however
-- correct its RLS policy is. Postgres grants nothing on a new table by
-- default, and the failure is quiet in the worst way: the insert is refused at
-- the privilege layer, PostgREST returns the error, and a UI that does not
-- surface it simply appears to do nothing.
--
-- This was missed first time round because a development database that has
-- picked up ALTER DEFAULT PRIVILEGES grants them anyway — so the feature
-- worked locally and was dead on a correctly configured install. The grant is
-- explicit here for that reason.
--
-- RLS is still what scopes rows to one family; the grant only says the role
-- may reach the table at all. Both layers are required.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.school_holidays TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.school_holidays TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.school_holidays TO service_role;
  END IF;
END $$;
