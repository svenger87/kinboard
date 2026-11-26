-- migrations/094_first_run.sql — existing installs have had their first run.
--
-- RFC-024 §8: a new install's first family is shown two steps that belong to
-- the install rather than to the family (the address calendar links use, and
-- the contact for push services), once, in front of the setup wizard. The
-- webapp shows them while instance_settings has no `first_run_done`.
--
-- An install that already has a family is past its first run: its operator
-- set SITE_URL and VAPID_SUBJECT through setup.sh, or chose not to. Recorded
-- here so that no existing household ever sees those steps after an update.
-- A fresh database has no family yet when this runs, so nothing is written
-- and the steps appear once the first family exists.
--
-- Additive: one row, written only if absent. Idempotent.

INSERT INTO public.instance_settings (key, value)
SELECT 'first_run_done', 'before-094'
WHERE EXISTS (SELECT 1 FROM public.families)
ON CONFLICT (key) DO NOTHING;
