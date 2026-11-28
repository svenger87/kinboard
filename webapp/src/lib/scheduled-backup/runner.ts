import { spawn } from "node:child_process";
import { createAdminClient } from "@/lib/db/server";
import {
  arm,
  decide,
  finished,
  markCutOff,
  nextRunAt,
  resolveConfig,
  safeZone,
  started,
  type BackupState,
  type ResolvedConfig,
} from "./schedule";
import {
  backupDataDir,
  listBackupFiles,
  readState,
  resolveBackupDir,
  sameDiskAsData,
  SETTINGS_KEY,
  writeState,
  type BackupFile,
  type BackupLocation,
} from "./store";

/**
 * Runs the all-in-one image's scheduled backups (./schedule.ts has the
 * rules, image/kinboard-scheduled-backup.mjs does the work). Started by the
 * internal scheduler (lib/schedule/start.ts) in the all-in-one image only.
 *
 * Every few minutes it reads the schedule (the server's variables, or what
 * Settings stored) and the state in /data/config/scheduled-backup.json, and
 * when a backup is due it starts one in a child process as the server's own
 * user (PUID): `node /app/kinboard-scheduled-backup.mjs --dir … --keep …`,
 * under the backup lock. The lock (KINBOARD_BACKUP_LOCK, a flock) is the one
 * kinboard-backup.sh takes for the dump before an update, a migration or a
 * PostgreSQL upgrade: a scheduled backup does not start while one of those
 * runs (it is tried again at the next look), and kinboard-updater's dump
 * waits for a scheduled backup to finish before the update stops the
 * container. A backup the container's stop cuts off anyway leaves only a
 * dot-file, never counted as a backup; the next start records it as cut off
 * and retries ten minutes later.
 *
 * Server only.
 */

export const CHECK_EVERY_MS = 5 * 60_000;
/** The first look after a start: after the start's own work and an updater's health check. */
export const FIRST_CHECK_MS = 5 * 60_000;

/**
 * For the rehearsal (scripts/rigs/test-aio-backups.sh), which cannot wait
 * five minutes per look: KINBOARD_BACKUP_CHECK_SECONDS and
 * KINBOARD_BACKUP_FIRST_CHECK_SECONDS, 5 seconds at least. Nothing sets them.
 */
export function intervalMs(name: string, fallback: number, env: Record<string, string | undefined> = process.env): number {
  const v = env[name];
  if (!v || !/^\d{1,6}$/.test(v)) return fallback;
  return Math.max(5, Number(v)) * 1000;
}
/** A backup that takes longer is stopped (a hung disk); the next look tries again. */
export const RUN_TIMEOUT_MS = 6 * 60 * 60_000;

const RUNNER = () => process.env.KINBOARD_BACKUP_RUNNER || "/app/kinboard-scheduled-backup.mjs";
/** fd 9 on the lock file, flock'd without waiting: 75 when another backup holds it. */
export const LOCKED = 'exec 9>>"$0" || exit 74; flock -n 9 || exit 75; exec "$@"';

export type RunOutcome =
  | { status: "ok"; file: string; bytes: number }
  | { status: "failed"; error: string }
  | { status: "busy" }
  | { status: "unavailable" };

interface Shared {
  current: Promise<RunOutcome> | null;
  timer: ReturnType<typeof setTimeout> | null;
  started: boolean;
}

// Route handlers and instrumentation are separate bundles in one process: one shared record.
const KEY = Symbol.for("kinboard.scheduled-backup");
function shared(): Shared {
  const g = globalThis as { [KEY]?: Shared };
  g[KEY] ??= { current: null, timer: null, started: false };
  return g[KEY];
}

export function isRunning(): boolean {
  return shared().current !== null;
}

const log = (line: string) => console.log(`[scheduled-backup] ${line}`);

export function timeZone(): string {
  return safeZone(process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export async function readStoredConfig(): Promise<string | null> {
  const { data, error } = await (createAdminClient() as any)
    .from("instance_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.value === "string" ? data.value : null;
}

export async function writeStoredConfig(value: string): Promise<void> {
  const { error } = await (createAdminClient() as any)
    .from("instance_settings")
    .upsert({ key: SETTINGS_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function currentConfig(): Promise<ResolvedConfig> {
  return resolveConfig(process.env, await readStoredConfig());
}

/** What the child said: its exit code, and the JSON object on its last line. */
export interface ChildResult {
  code: number | null;
  result: { ok: boolean; file?: string; bytes?: number; error?: string } | null;
  stderrTail: string;
}

export function runChild(dir: string, keep: number): Promise<ChildResult> {
  const args = [RUNNER(), "--dir", dir, "--keep", String(keep)];
  const lock = process.env.KINBOARD_BACKUP_LOCK;
  const [cmd, argv] = lock ? ["sh", ["-c", LOCKED, lock, process.execPath, ...args]] : [process.execPath, args];
  return new Promise((resolve) => {
    const child = spawn(cmd, argv as string[], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
    let out = "";
    let errTail = "";
    let errBuf = "";
    child.stdout.on("data", (b: Buffer) => {
      out = (out + b.toString("utf8")).slice(-64 * 1024);
    });
    child.stderr.on("data", (b: Buffer) => {
      errBuf += b.toString("utf8");
      const lines = errBuf.split("\n");
      errBuf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) console.log(l);
      errTail = (errTail + b.toString("utf8")).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), RUN_TIMEOUT_MS);
    timer.unref?.();
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, result: null, stderrTail: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (errBuf.trim()) console.log(errBuf);
      let result: ChildResult["result"] = null;
      const last = out.trim().split("\n").pop() ?? "";
      try {
        const parsed = JSON.parse(last);
        if (parsed && typeof parsed === "object" && typeof parsed.ok === "boolean") result = parsed;
      } catch {
        /* no result line */
      }
      resolve({ code, result, stderrTail: errTail.trim() });
    });
  });
}

export interface RunDeps {
  now: () => number;
  child: (dir: string, keep: number) => Promise<ChildResult>;
  read: (data: string) => Promise<BackupState>;
  write: (data: string, s: BackupState) => Promise<void>;
}

const realDeps: RunDeps = { now: Date.now, child: runChild, read: readState, write: writeState };

/**
 * One backup now, by the same path whether scheduled or asked for in
 * Settings. "busy" when one is already running here, or another backup (an
 * update's dump) holds the lock: nothing is recorded then.
 */
export function runBackup(
  trigger: "schedule" | "manual",
  opts: { data: string; location: BackupLocation; keep: number; slot: number | null },
  deps: RunDeps = realDeps,
): Promise<RunOutcome> {
  const s = shared();
  if (s.current) return Promise.resolve({ status: "busy" });
  const run = (async (): Promise<RunOutcome> => {
    const before = await deps.read(opts.data);
    let state = started(before, trigger, deps.now(), opts.slot);
    await deps.write(opts.data, state);
    log(`${trigger === "manual" ? "asked for in Settings" : "due"}: backing up into ${opts.location.dir}, keeping ${opts.keep}`);
    const r: ChildResult = opts.location.problem
      ? { code: 1, result: { ok: false, error: opts.location.problem }, stderrTail: "" }
      : await deps.child(opts.location.dir, opts.keep);
    if (r.code === 75) {
      // Another backup holds the lock: as if this one had not started.
      await deps.write(opts.data, { ...(await deps.read(opts.data)), lastAttempt: before.lastAttempt, slot: before.slot, slotAttempts: before.slotAttempts });
      log("another backup (an update's or a migration's dump) is running; trying again at the next look");
      return { status: "busy" };
    }
    state = await deps.read(opts.data);
    if (r.result?.ok && r.code === 0 && r.result.file) {
      state = finished(state, deps.now(), { ok: true, file: r.result.file, dir: opts.location.dir, bytes: Number(r.result.bytes) || 0 });
      await deps.write(opts.data, state);
      return { status: "ok", file: r.result.file, bytes: Number(r.result.bytes) || 0 };
    }
    const error =
      r.result?.error ||
      (r.code === 74 ? `could not open the backup lock ${process.env.KINBOARD_BACKUP_LOCK}` : "") ||
      r.stderrTail.split("\n").pop() ||
      `the backup exited with ${r.code ?? "an error"}`;
    state = finished(state, deps.now(), { ok: false, error });
    await deps.write(opts.data, state);
    log(`FAILED: ${error}. The backups already there are kept.`);
    return { status: "failed", error };
  })();
  s.current = run.finally(() => {
    s.current = null;
  });
  return s.current;
}

/** One look: arm the schedule, and run a backup when one is due. */
export async function checkOnce(deps: RunDeps = realDeps, cfgIn?: ResolvedConfig): Promise<RunOutcome | null> {
  const data = backupDataDir();
  const location = resolveBackupDir();
  if (!data || !location) return null;
  const cfg = cfgIn ?? (await currentConfig());
  const now = deps.now();
  const stored = await deps.read(data);
  const armed = arm(cfg, isRunning() ? stored : markCutOff(stored, now), now);
  if (armed !== stored) await deps.write(data, armed);
  const d = decide(cfg, armed, now, timeZone());
  if (!d.due) return null;
  return runBackup("schedule", { data, location, keep: cfg.keep, slot: d.slot }, deps);
}

function describe(cfg: ResolvedConfig, loc: BackupLocation): string {
  if (cfg.error) return `off: ${cfg.error}`;
  if (cfg.frequency === "off") return `off (${cfg.source === "server" ? "KINBOARD_BACKUP_SCHEDULE=off" : "switch it on in Settings → Data & safety"})`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const when = cfg.frequency === "daily" ? `daily at ${cfg.time}` : `weekly on ${days[cfg.day]} at ${cfg.time}`;
  return `${when} (${timeZone()}), keeping ${cfg.keep}, into ${loc.dir}${cfg.source === "server" ? " (set by the server)" : ""}`;
}

/** Starts the looks, in the all-in-one image only. Idempotent. */
export function startBackupScheduler(): void {
  const s = shared();
  const data = backupDataDir();
  const location = resolveBackupDir();
  if (s.started || !data || !location) return;
  s.started = true;
  const loop = async () => {
    try {
      await checkOnce();
    } catch (err) {
      log(`could not check whether a backup is due: ${err instanceof Error ? err.message : String(err)}`);
    }
    s.timer = setTimeout(loop, intervalMs("KINBOARD_BACKUP_CHECK_SECONDS", CHECK_EVERY_MS));
    s.timer.unref?.();
  };
  void (async () => {
    try {
      const st = await readState(data);
      const cut = markCutOff(st, Date.now());
      if (cut !== st) {
        await writeState(data, cut);
        log("the last backup was cut off when Kinboard stopped; it is tried again shortly");
      }
    } catch {
      /* the first look reports it */
    }
    try {
      log(describe(await currentConfig(), location));
    } catch {
      /* the database is not up yet: the first look reads it */
    }
  })();
  s.timer = setTimeout(loop, intervalMs("KINBOARD_BACKUP_FIRST_CHECK_SECONDS", FIRST_CHECK_MS));
  s.timer.unref?.();
}

/* -------------------------------------------------------------- status */

export interface ScheduledBackupStatus {
  config: ResolvedConfig;
  timeZone: string;
  location: { dir: string; source: BackupLocation["source"]; sameDiskAsData: boolean | null };
  lastSuccess: BackupState["lastSuccess"];
  lastAttempt: BackupState["lastAttempt"];
  failing: boolean;
  failingSince: string | null;
  running: boolean;
  nextRunAt: string | null;
  newest: BackupFile | null;
  count: number;
}

export async function readStatus(now = Date.now()): Promise<ScheduledBackupStatus | null> {
  const data = backupDataDir();
  const location = resolveBackupDir();
  if (!data || !location) return null;
  const cfg = await currentConfig();
  let state = await readState(data);
  const running = isRunning() || (state.lastAttempt !== null && state.lastAttempt.finishedAt === null);
  if (!running) state = markCutOff(state, now);
  state = arm(cfg, state, now);
  const files = await listBackupFiles(location.dir);
  const next = nextRunAt(cfg, state, now, timeZone());
  return {
    config: cfg,
    timeZone: timeZone(),
    location: { ...location, sameDiskAsData: await sameDiskAsData(location.dir, data) },
    lastSuccess: state.lastSuccess,
    lastAttempt: state.lastAttempt,
    failing: !running && state.lastAttempt?.ok === false,
    failingSince: state.failingSince,
    running,
    nextRunAt: running ? null : next === null ? null : new Date(Math.max(next, now)).toISOString(),
    newest: files[0] ?? null,
    count: files.length,
  };
}
