/**
 * The internal scheduler (RFC-023 §4.5): runs the job table in the webapp's
 * own server process, at ofelia's times, when KINBOARD_SCHEDULER=internal.
 *
 * Kept free of Next, fetch and real timers: everything it touches comes in
 * through `SchedulerDeps`, so e2e/schedule-runner.spec.ts drives it with a
 * fake clock. ./start.ts wires the real ones.
 *
 * What it promises, each one tested:
 *
 * - **ofelia's times, in UTC** (./cron.ts).
 * - **No overlap.** A job marked no-overlap (all of them today) is skipped
 *   while its previous run is still going, and the skip is logged, as
 *   ofelia's no-overlap does.
 * - **A failing route is one failed run.** A non-2xx answer, a refused
 *   connection or a thrown error is logged and the job's next run is
 *   scheduled as usual; nothing propagates out of the timer.
 * - **No catch-up storm.** Nothing is persisted, so after a restart the
 *   schedule simply starts again: fixed times fire at their next slot and
 *   intervals count from the new start — what ofelia does after its
 *   container restarts. While running, a process that was frozen (a paused
 *   container, a suspended host) runs each overdue job once on waking and
 *   then resumes its schedule; the slots it slept through are skipped. That
 *   is robfig/cron's behaviour, so ofelia's too.
 *
 * Logs go to stdout in ofelia's shape, tagged `internal-scheduler` where
 * ofelia prints its source file, so `docker logs` reads the same either way
 * and a grep tells which scheduler ran a job:
 *
 *   2026-11-26T08:00:00.003Z internal-scheduler ▶ NOTICE [Job "todo-reminders" (3f9c0a1b2c4d)] Started - POST /api/cron/todo-reminders
 *   2026-11-26T08:00:00.161Z internal-scheduler ▶ NOTICE [Job "todo-reminders" (3f9c0a1b2c4d)] StdOut: {"sent":0}
 *   2026-11-26T08:00:00.161Z internal-scheduler ▶ NOTICE [Job "todo-reminders" (3f9c0a1b2c4d)] Finished in "158ms", failed: false, skipped: false, error: none
 */
import { nextRun, parseSchedule, type Schedule } from "./cron";
import type { ScheduledJob } from "./jobs";

/** What one call of a job's route returned. */
export interface CallResult {
  status: number;
  body: string;
}

export interface SchedulerDeps {
  /** ms since the epoch. */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** POST the job's route. May throw (refused, timed out, no secret). */
  call(job: ScheduledJob): Promise<CallResult>;
  /** One line to stdout. */
  log(line: string): void;
  /** The 12 hex digits ofelia tags each execution with. */
  executionId?(): string;
}

/**
 * The longest a timer is armed for before the clock is read again. Short
 * enough that a wall-clock correction (NTP after boot) moves a fixed-time job
 * with it, and far below setTimeout's 24.8-day ceiling.
 */
export const MAX_TIMER_MS = 60_000;

/** The longest a route's answer is quoted in the log. */
export const MAX_LOGGED_BODY = 2_000;

interface Entry {
  job: ScheduledJob;
  schedule: Schedule;
  /** When it is due next, ms since the epoch. */
  next: number;
  running: boolean;
  timer: unknown;
}

const randomId = () =>
  Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(3).replace(/\.?0+$/, "")}s`;
}

function oneLine(body: string): string {
  const flat = body.replace(/\s*\n\s*/g, " ").trim();
  return flat.length > MAX_LOGGED_BODY ? `${flat.slice(0, MAX_LOGGED_BODY)}… (${flat.length} chars)` : flat;
}

export class Scheduler {
  private readonly entries: Entry[];
  private started = false;

  constructor(
    jobs: readonly ScheduledJob[],
    private readonly deps: SchedulerDeps,
  ) {
    const names = new Set<string>();
    this.entries = jobs.map((job) => {
      if (names.has(job.name)) throw new Error(`job "${job.name}" is listed twice`);
      names.add(job.name);
      return { job, schedule: parseSchedule(job.schedule), next: 0, running: false, timer: undefined };
    });
  }

  private line(level: "NOTICE" | "WARNING" | "ERROR", text: string): void {
    // A log that cannot be written (a closed pipe) must not take a job's
    // running flag with it: a run whose flag stayed set would skip forever.
    try {
      this.deps.log(`${new Date(this.deps.now()).toISOString()} internal-scheduler ▶ ${level} ${text}`);
    } catch {
      // nothing to report it to
    }
  }

  /** Arm every job. `@every` jobs count from now, as ofelia's do from its start. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const now = Math.floor(this.deps.now() / 1000) * 1000;
    for (const e of this.entries) {
      e.next = nextRun(e.schedule, now, now);
      this.line("NOTICE", `New job registered "${e.job.name}" - "POST /api/cron/${e.job.route}" - "${e.job.schedule}"`);
      this.arm(e);
    }
    this.line("NOTICE", `Scheduler started: ${this.entries.length} jobs, fixed times in UTC`);
  }

  stop(): void {
    this.started = false;
    for (const e of this.entries) {
      if (e.timer !== undefined) this.deps.clearTimer(e.timer);
      e.timer = undefined;
    }
  }

  /** When each job is due next (for tests and the start-up log). */
  schedule(): { name: string; next: number }[] {
    return this.entries.map((e) => ({ name: e.job.name, next: e.next }));
  }

  private arm(e: Entry): void {
    const wait = Math.max(0, Math.min(e.next - this.deps.now(), MAX_TIMER_MS));
    e.timer = this.deps.setTimer(() => this.tick(e), wait);
  }

  private tick(e: Entry): void {
    e.timer = undefined;
    if (!this.started) return;
    const now = this.deps.now();
    if (now >= e.next) {
      // Due (or overdue after a freeze): run once, then the next slot after now.
      const planned = e.next;
      e.next = nextRun(e.schedule, planned, now);
      // run() catches the route's errors; this catches a failing logger too.
      this.run(e.job.name).catch(() => {});
    }
    this.arm(e);
  }

  /**
   * Run one job now, by the same rules as a scheduled run: skipped while the
   * last one is still going (no-overlap), logged, never throws. The test hook
   * (KINBOARD_SCHEDULER_RUN_ON_START) uses it too. Resolves when the run (or
   * the skip) is done.
   */
  async run(name: string): Promise<"ok" | "failed" | "skipped"> {
    const e = this.entries.find((x) => x.job.name === name);
    if (!e) throw new Error(`no job "${name}"`);
    const tag = `[Job "${e.job.name}" (${(this.deps.executionId ?? randomId)()})]`;
    const started = this.deps.now();
    if (e.running && e.job.noOverlap) {
      this.line("WARNING", `${tag} Finished in "0ms", failed: false, skipped: true, error: skipped execution`);
      return "skipped";
    }
    e.running = true;
    let error: string | null = null;
    try {
      this.line("NOTICE", `${tag} Started - POST /api/cron/${e.job.route}`);
      const res = await this.deps.call(e.job);
      if (res.body) this.line("NOTICE", `${tag} StdOut: ${oneLine(res.body)}`);
      if (res.status < 200 || res.status > 299) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      e.running = false;
    }
    const took = duration(this.deps.now() - started);
    this.line(
      error ? "ERROR" : "NOTICE",
      `${tag} Finished in "${took}", failed: ${error !== null}, skipped: false, error: ${error ?? "none"}`,
    );
    return error ? "failed" : "ok";
  }
}
