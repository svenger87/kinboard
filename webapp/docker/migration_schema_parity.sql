-- Columns init.sql creates that no migration ever added.
--
-- Found by building a fresh install from init.sql plus every migration and
-- diffing it against a database that had upgraded its way to the same
-- version. They disagreed, which they never should: a self-hoster who
-- installed a year ago and one who installs today are meant to end up with
-- the same schema.
--
-- `notes.pinned` is the one that matters. The notes page pins notes, sorts
-- pinned ones first, and toasts on success (app/notes/page.tsx) — and on any
-- upgraded install the column simply was not there, so the update failed.
-- Fresh installs had it, which is why it went unnoticed.
--
-- `subjects.updated_at` nothing reads today. It is here so the two paths
-- converge rather than staying one column apart, waiting for something to
-- start reading it.
--
-- Safe to run more than once.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT false;

ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
