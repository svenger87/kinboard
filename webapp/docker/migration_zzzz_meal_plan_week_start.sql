-- Re-key meal plans onto the household's chosen first day of the week.
--
-- THE PROBLEM
--
-- `meal_plans` is keyed (family_id, week_start), and `week_start` was always a
-- Monday: the client computed it with a helper that hardcoded Monday, written
-- before "week starts on" was a setting. So a household that chose Sunday got a
-- Monday-to-Sunday grid on the Meals page and no way to change it (issue #228).
--
-- The client now computes `week_start` from the setting. That alone would strand
-- the rows already written: a Sunday-start household's visible week spans two
-- Monday-keyed plans, so entries would still be in the table and no longer in
-- any week the grid asks for. This migration moves them.
--
-- WHAT IT DOES
--
-- For every family whose effective week start is Sunday, each meal plan entry is
-- moved to the plan row for the Sunday-start week that contains its own `date`,
-- creating that row if it does not exist. Entries carry their own date, so this
-- is a re-partition rather than a rename: one Monday-keyed week's entries can
-- land in two Sunday-keyed weeks. Plan rows left holding nothing afterwards are
-- removed, but only if they were empty of everything, `notes` included.
--
-- EFFECTIVE WEEK START
--
-- The setting is `settings.key = 'week_start'`, holding "monday", "sunday" or
-- "locale". "locale", which is also the default when the row is absent, means
-- "follow the interface language": English implies Sunday, German and French
-- Monday. That mapping is `weekStartForLocale` in src/hooks/use-week-start.ts
-- and is reproduced here; the interface language is `settings.key = 'locale'`,
-- defaulting to 'en' (src/i18n/locales.ts). A family with no rows at all is
-- therefore an English, Sunday-start family and IS migrated — which is the
-- point, since that is precisely the household that has been looking at a
-- Monday calendar.
--
-- Idempotent: it only ever moves an entry to the plan for its own week, so a
-- second run finds every entry already there and changes nothing. Migrations in
-- this repo are applied twice by design (once from the host, once by the webapp
-- entrypoint), and both passes must be safe.

BEGIN;

CREATE TEMP TABLE _sunday_families ON COMMIT DROP AS
SELECT f.id AS family_id
FROM families f
LEFT JOIN settings ws ON ws.family_id = f.id AND ws.key = 'week_start'
LEFT JOIN settings loc ON loc.family_id = f.id AND loc.key = 'locale'
WHERE
  -- `value` is jsonb; #>>'{}' unwraps a bare JSON string to text.
  CASE
    WHEN (ws.value #>> '{}') = 'sunday' THEN true
    WHEN (ws.value #>> '{}') = 'monday' THEN false
    -- 'locale', or no row at all
    ELSE COALESCE(loc.value #>> '{}', 'en') LIKE 'en%'
  END;

-- The Sunday on or before a date. EXTRACT(DOW) is 0 for Sunday, so this is a
-- no-op on a Sunday and steps back up to six days otherwise.
CREATE TEMP TABLE _entry_target ON COMMIT DROP AS
SELECT
  e.id                                                    AS entry_id,
  mp.family_id                                            AS family_id,
  (e.date - (EXTRACT(DOW FROM e.date))::int)::date        AS want_week_start,
  e.meal_plan_id                                          AS old_meal_plan_id
FROM meal_plan_entries e
JOIN meal_plans mp ON mp.id = e.meal_plan_id
WHERE mp.family_id IN (SELECT family_id FROM _sunday_families);

-- Create whatever Sunday-keyed plan rows are missing.
INSERT INTO meal_plans (family_id, week_start)
SELECT DISTINCT t.family_id, t.want_week_start
FROM _entry_target t
ON CONFLICT (family_id, week_start) DO NOTHING;

-- Point every entry at the plan for its own week.
UPDATE meal_plan_entries e
SET meal_plan_id = mp.id
FROM _entry_target t
JOIN meal_plans mp
  ON mp.family_id = t.family_id AND mp.week_start = t.want_week_start
WHERE e.id = t.entry_id
  AND e.meal_plan_id <> mp.id;

-- Drop the plan rows the move emptied. `notes` is a household's own writing, so
-- a row that still has one is kept even with no entries left in it.
DELETE FROM meal_plans mp
WHERE mp.family_id IN (SELECT family_id FROM _sunday_families)
  AND COALESCE(mp.notes, '') = ''
  AND NOT EXISTS (SELECT 1 FROM meal_plan_entries e WHERE e.meal_plan_id = mp.id);

COMMIT;
