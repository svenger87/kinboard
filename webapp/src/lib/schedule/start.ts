/**
 * Starts the internal scheduler in the server process when
 * KINBOARD_SCHEDULER=internal (RFC-023 §4.5). Called from
 * src/instrumentation.ts, once per server, Node runtime only.
 *
 * Off by default: the legacy docker-compose.yml never sets the variable, so
 * every git install keeps ofelia and no job runs twice. With any other value
 * nothing starts either; an unknown one is logged, so a typo does not look
 * like a scheduler that silently never fires.
 *
 * Each job does what /app/cron-call.sh does for ofelia: POST
 * /api/cron/<route> on this server with `Authorization: Bearer <cron secret>`.
 * The secret is $CRON_SECRET when it is set, otherwise the store's
 * cron_secret, read by the same reader with the same rules
 * (`secrets-store.mjs --get CRON_SECRET`). The entrypoint's exports normally
 * put it in this process's environment already; RFC-023 PR 3 says not to
 * depend on that, so the store is asked when they did not.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JOBS, type ScheduledJob } from "./jobs";
import { Scheduler } from "./runner";

const run = promisify(execFile);

/** No route takes this long; a call that does is abandoned so its job can run again. */
const CALL_TIMEOUT_MS = 30 * 60_000;

const GLOBAL_KEY = Symbol.for("kinboard.internal-scheduler");

/**
 * The cron secret, as /app/cron-call.sh finds it: `env.CRON_SECRET` when it
 * is set, otherwise `secrets-store.mjs --get CRON_SECRET` (the same reader,
 * so the same file, BOM and newline rules). Throws when neither has one.
 */
export async function readCronSecret(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.CRON_SECRET) return env.CRON_SECRET;
  const reader = env.KINBOARD_SECRETS_READER || "/app/secrets-store.mjs";
  try {
    const { stdout } = await run(process.execPath, [reader, "--get", "CRON_SECRET"], { env, timeout: 10_000 });
    if (stdout) return stdout;
  } catch {
    // Not in the store either: refused below, without calling the route.
  }
  throw new Error("no CRON_SECRET in the environment or the secrets store; route not called");
}

/** Read once from the store, then kept: spawning the reader every 30 s would be waste. */
let storedSecret: string | null = null;

async function cronSecret(): Promise<string> {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  storedSecret ??= await readCronSecret();
  return storedSecret;
}

function baseUrl(): string {
  return process.env.KINBOARD_CRON_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
}

async function call(job: ScheduledJob) {
  const secret = await cronSecret();
  const res = await fetch(`${baseUrl()}/api/cron/${job.route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
}

/** Waits until this server answers HTTP at all (any status), for at most `ms`. */
async function serverUp(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(`${baseUrl()}/api/health`, { signal: AbortSignal.timeout(5_000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  return false;
}

export function startInternalScheduler(): Scheduler | null {
  const mode = process.env.KINBOARD_SCHEDULER ?? "";
  if (mode !== "internal") {
    if (mode !== "") {
      console.log(`internal-scheduler: KINBOARD_SCHEDULER="${mode}" is not "internal"; not starting`);
    }
    return null;
  }
  // One per process, even if instrumentation is evaluated twice.
  const g = globalThis as { [GLOBAL_KEY]?: Scheduler };
  if (g[GLOBAL_KEY]) return g[GLOBAL_KEY];

  const scheduler = new Scheduler(JOBS, {
    now: Date.now,
    setTimer: (fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    },
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    call,
    log: (line) => console.log(line),
  });
  g[GLOBAL_KEY] = scheduler;
  scheduler.start();

  // The all-in-one image's scheduled backups (lib/scheduled-backup/runner.ts):
  // not a job of the table above, because a git install's ofelia has no such
  // job (its households keep their own scripts) and the table is held equal
  // to ofelia's labels. They look every few minutes; off unless switched on.
  if (process.env.KINBOARD_AIO === "1") {
    void import("../scheduled-backup/runner")
      .then((m) => m.startBackupScheduler())
      .catch((err) => console.log(`[scheduled-backup] could not start: ${err instanceof Error ? err.message : String(err)}`));
  }

  // Test hook for the rehearsal: run every job once as soon as the server
  // answers, through the same path as a scheduled run (no-overlap included),
  // so every route is exercised without waiting for 03:20 UTC.
  if (process.env.KINBOARD_SCHEDULER_RUN_ON_START === "1") {
    void serverUp(120_000).then(async (up) => {
      if (!up) {
        console.log("internal-scheduler: the server never answered; KINBOARD_SCHEDULER_RUN_ON_START skipped");
        return;
      }
      await Promise.all(JOBS.map((j) => scheduler.run(j.name).catch(() => "failed")));
    });
  }
  return scheduler;
}
