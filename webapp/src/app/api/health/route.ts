import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createAdminClient } from "@/lib/supabase/server";
import { readHeartbeat } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";

// Same tiny reader as api/version-check/route.ts — duplicated rather than
// shared so this route has zero dependency surface beyond fs/path.
async function readCurrentVersion(): Promise<string> {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const DB_PROBE_TIMEOUT_MS = 3000;

// Cheap, bounded liveness probe: a head/count select (no rows returned)
// against `families`, raced against a timeout so a hung DB connection
// fails fast instead of hanging the healthcheck (and, transitively, the
// container's healthy/unhealthy signal) indefinitely.
async function probeDb(): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const query = supabase
      .from("families")
      .select("id", { head: true, count: "exact" });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("db probe timeout")), DB_PROBE_TIMEOUT_MS);
    });
    const { error } = await Promise.race([query, timeout]);
    return !error;
  } catch {
    return false;
  }
}

// The worker calls in every 30s. A one-minute window would flag a single
// missed run, which happens during any slow deploy; five minutes means it has
// genuinely stopped rather than hiccuped.
export const WORKER_STALE_AFTER_MS = 5 * 60 * 1000;

// Realtime holds logical replication slots for as long as it is connected, so
// the database can answer for it. That costs one cheap query and needs no
// network path from here to the realtime container — which matters, because a
// probe that depends on its own connectivity reports its own failures as the
// subject's.
async function probeRealtime(): Promise<boolean | null> {
  try {
    const supabase = createAdminClient();
    // Cast for the same reason integration-store.ts does: database.types.ts is
    // generated from the schema and does not know objects added by a docker
    // migration.
    const query = (supabase as any)
      .from("realtime_slot_health")
      .select("active_slots")
      .maybeSingle();
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("realtime probe timeout")), DB_PROBE_TIMEOUT_MS);
    });
    const { data, error } = await Promise.race([query, timeout]);
    // A missing view means an instance that has not applied the migration yet.
    // "I cannot tell" is not "it is broken", and must not page anybody.
    if (error || !data) return null;
    return Number(data.active_slots) > 0;
  } catch {
    return null;
  }
}

async function probeWorker(): Promise<boolean | null> {
  const last = await readHeartbeat();
  // Never reported: a fresh install whose worker has not run yet, not a fault.
  if (last === null) return null;
  return Date.now() - last.getTime() < WORKER_STALE_AFTER_MS;
}

// GET /api/health — unauthenticated liveness probe for the Docker
// healthcheck. No family/user data in the response.
//
// NOTE: this route intentionally breaks the project's "always return 200,
// degrade gracefully" API convention. A container healthcheck needs a
// real failure signal to trigger orchestration behavior (Docker marking
// the container unhealthy, restart policies, etc.) — a 200 with
// `db: false` buried in the body wouldn't do that. This is the one
// documented exception; see CLAUDE.md.
//
// Only the database produces that 503, and the asymmetry is deliberate. This
// endpoint is the *webapp* container's healthcheck, so a non-200 gets the
// webapp restarted — which can fix a lost database connection and does nothing
// at all for a stopped cron container or a wedged realtime. Failing here for
// those would trade one broken component for a restart loop across two, and
// the restart loop is the harder problem to diagnose. They are reported
// instead as `status: "degraded"` with a 200: something a monitor should alert
// on and an orchestrator should leave alone.
export async function GET() {
  const [version, dbOk, realtimeOk, workerOk] = await Promise.all([
    readCurrentVersion(),
    probeDb(),
    probeRealtime(),
    probeWorker(),
  ]);

  if (!dbOk) {
    return NextResponse.json(
      { status: "unhealthy", version, db: false, realtime: realtimeOk, worker: workerOk },
      { status: 503 }
    );
  }

  // `null` means "could not determine", which is not "broken".
  const degraded = realtimeOk === false || workerOk === false;

  return NextResponse.json({
    status: degraded ? "degraded" : "ok",
    version,
    db: true,
    realtime: realtimeOk,
    worker: workerOk,
  });
}
