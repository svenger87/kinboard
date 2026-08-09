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


-- Realtime's own liveness, answered by the database rather than by a network
-- call to the realtime container. Realtime holds these logical replication
-- slots for exactly as long as it is connected, so `active` is a direct
-- reading of "is it attached right now".
--
-- Asking over HTTP instead would mean the webapp's own connectivity became
-- part of the answer, and a probe that fails for its own reasons reports them
-- as the subject's.
--
-- A plain (non-invoker) view runs with its owner's privileges, which is what
-- lets service_role read pg_replication_slots through it without being granted
-- that right directly.
CREATE OR REPLACE VIEW realtime_slot_health AS
  SELECT count(*)::int AS active_slots
  FROM pg_replication_slots
  WHERE slot_name LIKE 'supabase_realtime%'
    AND active;

REVOKE ALL ON realtime_slot_health FROM anon, authenticated;
GRANT SELECT ON realtime_slot_health TO service_role;
