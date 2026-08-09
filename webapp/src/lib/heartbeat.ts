import { createAdminClient } from "@/lib/supabase/server";

/**
 * Liveness marks for things `/api/health` cannot reach directly.
 *
 * The webapp can probe the database itself, and it can infer realtime from
 * the replication slots. The cron worker is different: it runs in its own
 * container, talks to the webapp over HTTP, and leaves no trace when there
 * happens to be no work to do. A run that processes zero notifications is a
 * perfectly healthy run, so "did any row change" cannot stand in for "is the
 * worker alive".
 */

/** The job whose cadence makes it the useful heartbeat. */
export const HEARTBEAT_WORKER = "worker";

/**
 * Record that the worker ran.
 *
 * Failures are never rethrown. This is observability, and a cron job that did
 * its real work must not be reported as failed because a bookkeeping write did
 * not land — that would turn a healthy run into a red alert and, worse, could
 * make an orchestrator retry work that already happened.
 *
 * They are logged, though. The first version was silent, and when the write
 * genuinely did not land there was nothing at all to go on: /api/health simply
 * reported the worker as unknown forever, with no clue why.
 */
export async function recordHeartbeat(job: string = HEARTBEAT_WORKER): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await (supabase as any)
      .from("system_heartbeats")
      .upsert({ job, last_run_at: new Date().toISOString() }, { onConflict: "job" });
    if (error) console.warn("[heartbeat] rejected for", job, error);
  } catch (err) {
    // Intentionally not rethrown — see above. Logged, though: a heartbeat that
    // never lands makes /api/health report the worker as unknown forever, and
    // silence would leave nothing to diagnose that with.
    console.warn("[heartbeat] could not record", job, err);
  }
}

/** When the job last reported in, or null if it never has. */
export async function readHeartbeat(job: string = HEARTBEAT_WORKER): Promise<Date | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await (supabase as any)
      .from("system_heartbeats")
      .select("last_run_at")
      .eq("job", job)
      .maybeSingle();
    if (error || !data?.last_run_at) return null;
    const parsed = new Date(data.last_run_at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}
