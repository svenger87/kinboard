-- migration_timers_pause.sql — a running timer can be paused and resumed.
--
-- paused_at: set while the timer is paused; its clock stopped at that moment.
-- paused_seconds: how long it has spent paused so far, in whole seconds.
--
-- A timer runs out at started_at + duration_seconds + paused_seconds, so
-- started_at stays the moment it was started: the screens list timers by it,
-- and an assistant reads it as such. Resuming adds the pause to
-- paused_seconds and clears paused_at (lib/timers.ts, resumeTimer).
--
-- Both columns are already in the realtime publication with the table
-- (migration_timers.sql), so a pause reaches every screen as an UPDATE.
--
-- Idempotent: the entrypoint re-runs every migration on every boot.

ALTER TABLE public.timers ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
ALTER TABLE public.timers ADD COLUMN IF NOT EXISTS paused_seconds INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timers_paused_seconds_check') THEN
    ALTER TABLE public.timers ADD CONSTRAINT timers_paused_seconds_check CHECK (paused_seconds >= 0);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
