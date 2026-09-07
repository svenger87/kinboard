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
-- WHICH FAMILIES, AND WHY ONLY THESE
--
-- Only families whose `settings.key = 'week_start'` row explicitly says
-- "sunday". Nothing is inferred.
--
-- The setting also accepts "locale", which is the default when the row is
-- absent and means "follow the interface language" — English implies Sunday,
-- German and French Monday. The first version of this migration resolved that
-- here, reading `settings.key = 'locale'` and defaulting to 'en'. That was
-- wrong twice over.
--
-- It read a source the app does not use. `useWeekStart` takes its locale from
-- next-intl's `useLocale()`, which resolves from the locale cookie or the
-- browser's Accept-Language header — per device, never the settings table. The
-- settings locale row is written only when someone picks a language explicitly,
-- and is read only by the server-side notification routes
-- (src/lib/family-locale.ts). So a German household that had never opened that
-- setting has no row, would have been read as English, and would have had all
-- of its meal plans re-keyed to Sunday while the app went on computing Monday.
-- Measured on the production box before this was caught: 1 family, 34 plans,
-- no week_start row and no locale row — every one of them in scope.
--
-- And it was unnecessary. Entries are fetched by the dates on screen rather
-- than by meal_plan_id, so a week renders correctly however its rows happen to
-- be keyed. This migration is therefore tidying, not repair: it keeps
-- week_start meaning what it says for households that have stated a preference.
-- Rewriting a household's rows on a guess, to fix nothing they can see, is not
-- a trade worth making.
--
-- A family that switches to Sunday later is not migrated by anything, and does
-- not need to be: new plans are keyed the new way, old rows keep the old key,
-- and every week still renders from its dates.
--
-- Idempotent: it only ever moves an entry to the plan for its own week, so a
-- second run finds every entry already there and changes nothing. Migrations in
-- this repo are applied twice by design (once from the host, once by the webapp
-- entrypoint), and both passes must be safe.

BEGIN;

CREATE TEMP TABLE _sunday_families ON COMMIT DROP AS
SELECT ws.family_id
FROM settings ws
-- `value` is jsonb; #>>'{}' unwraps a bare JSON string to text. Only an
-- explicit "sunday" qualifies: "monday", "locale" and an absent row are all
-- left alone, for the reasons above.
WHERE ws.key = 'week_start' AND (ws.value #>> '{}') = 'sunday';

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
