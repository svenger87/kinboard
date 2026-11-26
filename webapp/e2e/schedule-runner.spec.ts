import { test, expect } from "@playwright/test";
import { Scheduler, MAX_TIMER_MS, type CallResult, type SchedulerDeps } from "../src/lib/schedule/runner";
import { JOBS, type ScheduledJob } from "../src/lib/schedule/jobs";
import { readCronSecret } from "../src/lib/schedule/start";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The internal scheduler (RFC-023 §4.5) on a fake clock: it fires at the
 * schedule's times, never overlaps a job with itself, survives a failing
 * route, and after a freeze runs each overdue job once rather than once per
 * missed slot.
 */

const job = (name: string, schedule: string, noOverlap = true): ScheduledJob => ({
  name,
  schedule,
  command: `/usr/local/bin/${name}`,
  route: name,
  noOverlap,
});

interface Pending {
  job: string;
  at: string;
  resolve: (r: CallResult) => void;
  reject: (e: Error) => void;
}

/** A clock, timers and a route that answer only when the test says so (or at once, with `auto`). */
function rig(startIso: string, auto?: (j: ScheduledJob, n: number) => CallResult | Error) {
  let now = Date.parse(startIso);
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const calls: Pending[] = [];
  const log: string[] = [];
  const counts = new Map<string, number>();
  const deps: SchedulerDeps = {
    now: () => now,
    setTimer: (fn, ms) => {
      if (ms > MAX_TIMER_MS) throw new Error(`timer armed for ${ms} ms, over ${MAX_TIMER_MS}`);
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (h) => void timers.delete(h as number),
    call: (j) =>
      new Promise<CallResult>((resolve, reject) => {
        const n = (counts.get(j.name) ?? 0) + 1;
        counts.set(j.name, n);
        calls.push({ job: j.name, at: new Date(now).toISOString(), resolve, reject });
        const answer = auto?.(j, n);
        if (answer instanceof Error) reject(answer);
        else if (answer) resolve(answer);
      }),
    log: (l) => log.push(l),
    executionId: () => "abcdef012345",
  };
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  /** Moves the clock forward, firing timers at their times, as a running process does. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = Math.max(now, due[1].at);
      due[1].fn();
      await flush();
    }
    now = end;
  };
  /** The process was frozen for `ms` (paused container, suspended host): the clock jumps, then the timers fire late. */
  const freeze = async (ms: number) => {
    now += ms;
    await advance(0);
  };
  return { deps, calls, log, advance, freeze, flush, timers, now: () => now };
}

const started = (log: string[], name: string) => log.filter((l) => l.includes(`[Job "${name}"`) && l.includes("] Started"));

test.describe("internal scheduler", () => {
  test("fires on the schedule, in UTC, and logs in ofelia's shape", async () => {
    const r = rig("2026-11-26T07:59:00Z", () => ({ status: 200, body: '{"ok":true}' }));
    const s = new Scheduler([job("todo-reminders", "0 0 8 * * *"), job("process-notifications", "@every 30s")], r.deps);
    s.start();
    await r.advance(2 * 60_000);
    expect(r.calls.map((c) => `${c.job}@${c.at.slice(11, 19)}`)).toEqual([
      "process-notifications@07:59:30",
      "todo-reminders@08:00:00",
      "process-notifications@08:00:00",
      "process-notifications@08:00:30",
      "process-notifications@08:01:00",
    ]);
    const lines = r.log.filter((l) => l.includes('"todo-reminders" (abcdef012345)'));
    expect(lines).toEqual([
      '2026-11-26T08:00:00.000Z internal-scheduler ▶ NOTICE [Job "todo-reminders" (abcdef012345)] Started - POST /api/cron/todo-reminders',
      '2026-11-26T08:00:00.000Z internal-scheduler ▶ NOTICE [Job "todo-reminders" (abcdef012345)] StdOut: {"ok":true}',
      '2026-11-26T08:00:00.000Z internal-scheduler ▶ NOTICE [Job "todo-reminders" (abcdef012345)] Finished in "0ms", failed: false, skipped: false, error: none',
    ]);
    expect(r.log[0]).toBe(
      '2026-11-26T07:59:00.000Z internal-scheduler ▶ NOTICE New job registered "todo-reminders" - "POST /api/cron/todo-reminders" - "0 0 8 * * *"',
    );
  });

  test("the real job table: a day of runs, each job at its count", async () => {
    const r = rig("2026-11-26T00:00:00Z", () => ({ status: 200, body: "" }));
    new Scheduler(JOBS, r.deps).start();
    await r.advance(24 * 3600_000);
    const count = (n: string) => r.calls.filter((c) => c.job === n).length;
    expect(count("process-notifications")).toBe(2880);
    expect(count("sync-bring")).toBe(720);
    expect(count("evaluate-attention")).toBe(288);
    expect(count("google-sync")).toBe(96);
    expect(count("sync-ics")).toBe(48);
    expect(count("sync-caldav")).toBe(48);
    expect(count("pocket-money-commit-interest")).toBe(24); // 01:00 … 24:00 (the start instant is not included)
    expect(count("sync-school-holidays")).toBe(1);
    for (const n of ["todo-reminders", "birthday-reminders", "meal-prep-reminders", "extend-event-series", "purge-recycle-bin", "purge-domain-events", "pocket-money-accrue-interest"]) {
      expect(count(n), n).toBe(1);
    }
    expect(r.calls.find((c) => c.job === "purge-domain-events")!.at).toBe("2026-11-26T03:45:00.000Z");
  });

  test("no overlap: a run still going makes the next ones skip, logged; then it runs again", async () => {
    const r = rig("2026-11-26T10:00:00Z");
    const s = new Scheduler([job("slow", "@every 30s")], r.deps);
    s.start();
    await r.advance(95_000); // due at 30, 60, 90 s
    expect(r.calls.length).toBe(1);
    const skips = r.log.filter((l) => l.includes("skipped: true"));
    expect(skips).toEqual([
      '2026-11-26T10:01:00.000Z internal-scheduler ▶ WARNING [Job "slow" (abcdef012345)] Finished in "0ms", failed: false, skipped: true, error: skipped execution',
      '2026-11-26T10:01:30.000Z internal-scheduler ▶ WARNING [Job "slow" (abcdef012345)] Finished in "0ms", failed: false, skipped: true, error: skipped execution',
    ]);
    r.calls[0].resolve({ status: 200, body: "" });
    await r.flush();
    expect(r.log.at(-1)).toBe(
      '2026-11-26T10:01:35.000Z internal-scheduler ▶ NOTICE [Job "slow" (abcdef012345)] Finished in "65s", failed: false, skipped: false, error: none',
    );
    await r.advance(30_000);
    expect(r.calls.length).toBe(2);
  });

  test("a run-now while the scheduled run is going is skipped too", async () => {
    const r = rig("2026-11-26T10:00:00Z");
    const s = new Scheduler([job("slow", "@every 30s")], r.deps);
    s.start();
    await r.advance(30_000);
    expect(await s.run("slow")).toBe("skipped");
    expect(r.calls.length).toBe(1);
  });

  test("without no-overlap, runs may overlap (the label is honoured both ways)", async () => {
    const r = rig("2026-11-26T10:00:00Z");
    new Scheduler([job("free", "@every 30s", false)], r.deps).start();
    await r.advance(95_000);
    expect(r.calls.length).toBe(3);
    expect(r.log.some((l) => l.includes("skipped: true"))).toBe(false);
  });

  test("survives a route that throws, refuses or answers 500, and keeps its schedule", async () => {
    const answers: (CallResult | Error)[] = [
      new Error("connect ECONNREFUSED 127.0.0.1:3000"),
      { status: 500, body: '{"error":"Server misconfigured"}' },
      { status: 401, body: '{"error":"Unauthorized"}' },
      { status: 200, body: "{}" },
    ];
    const r = rig("2026-11-26T10:00:00Z", (_j, n) => answers[n - 1]);
    new Scheduler([job("flaky", "@every 30s"), job("steady", "@every 30s")], r.deps).start();
    await r.advance(120_000);
    const finished = r.log.filter((l) => l.includes('"flaky"') && l.includes("Finished"));
    expect(finished.map((l) => l.replace(/^.*\] /, ""))).toEqual([
      'Finished in "0ms", failed: true, skipped: false, error: connect ECONNREFUSED 127.0.0.1:3000',
      'Finished in "0ms", failed: true, skipped: false, error: HTTP 500',
      'Finished in "0ms", failed: true, skipped: false, error: HTTP 401',
      'Finished in "0ms", failed: false, skipped: false, error: none',
    ]);
    expect(finished.slice(0, 3).every((l) => l.includes("▶ ERROR"))).toBe(true);
    expect(started(r.log, "steady").length).toBe(4);
  });

  test("a logger that throws does not stop the schedule", async () => {
    const r = rig("2026-11-26T10:00:00Z", () => ({ status: 200, body: "" }));
    let fail = false;
    const deps = { ...r.deps, log: (l: string) => (fail ? (() => { throw new Error("EPIPE"); })() : r.log.push(l)) };
    new Scheduler([job("j", "@every 30s")], deps).start();
    fail = true;
    await r.advance(30_000);
    fail = false;
    await r.advance(30_000);
    expect(r.calls.length).toBe(2);
  });

  test("after a freeze, each overdue job runs once and then resumes its schedule", async () => {
    const r = rig("2026-11-26T10:00:00Z", () => ({ status: 200, body: "" }));
    const s = new Scheduler([job("often", "@every 30s"), job("hourly", "0 0 * * * *"), job("daily", "0 0 8 * * *")], r.deps);
    s.start();
    await r.advance(40_000); // one "often" run at 10:00:30
    expect(r.calls.length).toBe(1);
    await r.freeze(5 * 24 * 3600_000); // five days asleep: ~14 400 + 120 + 5 slots missed
    expect(r.calls.map((c) => c.job).sort()).toEqual(["daily", "hourly", "often", "often"]);
    const next = Object.fromEntries(s.schedule().map((e) => [e.name, new Date(e.next).toISOString()]));
    expect(next).toEqual({
      often: "2026-12-01T10:01:00.000Z", // on the 30 s cadence from the start, after now (10:00:40)
      hourly: "2026-12-01T11:00:00.000Z",
      daily: "2026-12-02T08:00:00.000Z",
    });
    await r.advance(60 * 60_000);
    expect(r.calls.filter((c) => c.job === "hourly").length).toBe(2);
  });

  test("start is idempotent, stop disarms every timer, and a job listed twice is refused", async () => {
    const r = rig("2026-11-26T10:00:00Z", () => ({ status: 200, body: "" }));
    const s = new Scheduler([job("a", "@every 30s"), job("b", "0 0 8 * * *")], r.deps);
    s.start();
    s.start();
    expect(r.timers.size).toBe(2);
    expect(r.log.filter((l) => l.includes("New job registered")).length).toBe(2);
    s.stop();
    expect(r.timers.size).toBe(0);
    await r.advance(3600_000);
    expect(r.calls.length).toBe(0);
    expect(() => new Scheduler([job("a", "@every 1m"), job("a", "@every 2m")], r.deps)).toThrow(/twice/);
    expect(() => new Scheduler([job("a", "0 8 * * *")], r.deps)).toThrow(/six/);
  });

  test("a long answer is quoted on one line, cut short", async () => {
    const r = rig("2026-11-26T10:00:00Z", () => ({ status: 200, body: `{\n  "x": "${"y".repeat(5000)}"\n}` }));
    const s = new Scheduler([job("big", "@every 1m")], r.deps);
    expect(await s.run("big")).toBe("ok");
    const out = r.log.find((l) => l.includes("StdOut:"))!;
    expect(out).not.toContain("\n");
    expect(out).toMatch(/… \(\d+ chars\)$/);
  });
});

test.describe("the cron secret, as cron-call.sh finds it", () => {
  // The real reader (docker/secrets-store.mjs) against a real store directory.
  const reader = join(__dirname, "../docker/secrets-store.mjs");
  const store = () => mkdtempSync(join(tmpdir(), "sched-secrets-"));

  test("the environment first", async () => {
    const dir = store();
    writeFileSync(join(dir, "cron_secret"), "from-file\n");
    try {
      const env = { ...process.env, CRON_SECRET: "from-env", KINBOARD_SECRETS_READER: reader, KINBOARD_SECRETS_DIR: dir };
      expect(await readCronSecret(env)).toBe("from-env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("then the store's cron_secret, without its byte-order mark and trailing newline", async () => {
    const dir = store();
    writeFileSync(join(dir, "cron_secret"), "﻿from-file\r\n");
    try {
      const env = { ...process.env, CRON_SECRET: "", KINBOARD_SECRETS_READER: reader, KINBOARD_SECRETS_DIR: dir };
      expect(await readCronSecret(env)).toBe("from-file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with neither, it refuses instead of calling with an empty token", async () => {
    const dir = store();
    try {
      const env = { ...process.env, CRON_SECRET: "", KINBOARD_SECRETS_READER: reader, KINBOARD_SECRETS_DIR: dir };
      await expect(readCronSecret(env)).rejects.toThrow(/no CRON_SECRET in the environment or the secrets store/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
