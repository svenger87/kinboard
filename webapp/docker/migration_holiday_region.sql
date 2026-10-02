-- migration_holiday_region.sql — RFC-014 §4.2: the holiday region gets its
-- own setting.
--
-- Public holidays used to follow `holiday_country` (de, us, uk, nl, fr), and
-- a family without that row got Germany — Niedersachsen's list, the only
-- German one there was. `holiday_region` replaces it:
-- { "code": "<ISO 3166-2 or 3166-1>", "chosen": <bool> }.
--
-- Every family gets the region it effectively had, so nothing it sees
-- changes: no row or `de` -> DE-NI, `uk` -> GB-ENG (the list was England and
-- Wales), `us` -> US (federal only), `nl` -> NL, `fr` -> FR. Any other value
-- (unreachable from the UI) broke the old widget; it becomes the default,
-- DE-NI. This CASE and LEGACY_REGIONS in src/lib/holidays/region.ts must
-- agree; e2e/holiday-region-migration.spec.ts checks one against the other.
-- `chosen: false` records that nobody picked it: the Heute-Motor asks once
-- (rule `holiday-region`) and Settings -> Holidays offers to keep it.
--
-- A family created from this release on already has
-- { "code": null, "chosen": false } from /api/session/create (which does not
-- create a family without it, src/lib/family-create.ts), so this
-- backfill cannot hand a new family a region it never had. ON CONFLICT DO
-- NOTHING keeps that row and every row a family or an earlier run wrote:
-- migrations run twice here and on every boot, and every pass after the
-- first inserts nothing.
--
-- `holiday_country` stays where it is, read by nothing, and is dropped in
-- the release after this one (RFC-006 §3.2's pattern). `settings` is
-- already in the realtime publication; no restart is needed.

INSERT INTO public.settings (family_id, key, value)
SELECT f.id,
       'holiday_region',
       jsonb_build_object(
         'code',
         CASE hc.value #>> '{}'
           WHEN 'uk' THEN 'GB-ENG'
           WHEN 'us' THEN 'US'
           WHEN 'nl' THEN 'NL'
           WHEN 'fr' THEN 'FR'
           ELSE 'DE-NI'
         END,
         'chosen', false
       )
FROM public.families f
LEFT JOIN public.settings hc
  ON hc.family_id = f.id AND hc.key = 'holiday_country'
ON CONFLICT (family_id, key) DO NOTHING;
