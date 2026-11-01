-- migrations/044_todos_show_in_events.sql — a task can be listed among the Events on Home.
--
-- show_in_events: set per task, in the task's create / edit dialog. A flagged
-- task is listed in the Events widget on its day (lib/task-events.ts), whether
-- or not Settings -> Calendar -> "Tasks as events" lists every task there.
-- Off for every existing task, so nothing on a family's Home changes until
-- somebody ticks it.
--
-- Idempotent: the entrypoint re-runs every migration on every boot.

ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS show_in_events BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
