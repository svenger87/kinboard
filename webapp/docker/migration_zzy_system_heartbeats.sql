-- Instance-level liveness marks, so /api/health can answer for the worker.
--
-- Deliberately NOT in `settings`: that table is family-scoped and requires a
-- family_id, while "is the cron worker running" is a property of the
-- deployment, not of any one family. Borrowing a family's row to store it
-- would also mean a single-family instance and a five-family instance
-- disagreed about what the value meant.
--
-- One row per job, overwritten in place. This is a heartbeat, not an audit
-- log — history would grow without bound and answer a question nobody asked.

CREATE TABLE IF NOT EXISTS system_heartbeats (
  job          text PRIMARY KEY,
  last_run_at  timestamptz NOT NULL DEFAULT now()
);

-- Same posture as the integration tables: reachable only by the service role.
-- The anon and authenticated roles reach the database through PostgREST, and
-- nothing a browser does should be able to read — let alone forge — evidence
-- that the worker is alive.
REVOKE ALL ON system_heartbeats FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON system_heartbeats TO service_role;


-- An earlier version of this migration also created a `realtime_slot_health`
-- view, on the theory that realtime's logical replication slots showed whether
-- it was connected. They do not: a slot appears when a client subscribes to
-- postgres_changes, not when realtime starts, so a healthy instance nobody was
-- looking at reported as broken. /api/health asks realtime directly instead.
--
-- Dropped rather than left in place, because a view that looks like a health
-- signal and is not one is worse than no view at all.
DROP VIEW IF EXISTS realtime_slot_health;
