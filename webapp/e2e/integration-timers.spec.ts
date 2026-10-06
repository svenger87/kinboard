import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_ACTIVE_TIMERS,
  dismissTimer,
  deleteTimer,
  parseTimerInput,
  readActiveTimers,
  startTimer,
  STALE_RINGING_MS,
  countActiveTimers,
  startIntegrationTimer,
  stopTimerForAssistant,
  timerView,
  pauseTimer,
  resumeTimer,
  type TimerDb,
} from "../src/lib/timers";
import { API_ERROR_CODES } from "../src/lib/api-error";
import { hasScope } from "../src/lib/integration-auth";
import { TOOL_SCOPES } from "../src/lib/mcp/server";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 2: kitchen timers for assistants — list, start (capped at 10
 * running, paused or ringing per family) and stop, sharing lib/timers.ts with the
 * session routes.
 *
 * The fake client applies the `.eq`/`.is` filters it is given to every
 * select, update and delete, so a query that forgets `family_id` or
 * `dismissed_at` really does reach the foreign or dismissed row here.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const T = (n: number) => `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;
const NOW = new Date("2026-10-01T12:00:00.000Z");

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "is", column: string, value: unknown];

function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: "insert" | "update" | "delete"; filters: Filter[]; payload?: Row }> = [];
  let failInsertOn: string | null = null;
  let nextId = 900;

  const matches = (filters: Filter[]) => (row: Row) =>
    filters.every(([op, column, value]) => (op === "is" ? (row[column] ?? null) === value : row[column] === value));

  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Filter[] = [];
      let mode: "select" | "update" | "delete" = "select";
      let head = false;
      let patch: Row = {};

      const result = () => {
        const hit = rows.filter(matches(filters));
        if (mode === "update") {
          writes.push({ table, op: "update", filters: [...filters], payload: patch });
          for (const row of hit) Object.assign(row, patch);
          return { data: hit, error: null };
        }
        if (mode === "delete") {
          writes.push({ table, op: "delete", filters: [...filters] });
          for (const row of hit) rows.splice(rows.indexOf(row), 1);
          return { data: null, error: null };
        }
        return head ? { data: null, count: hit.length, error: null } : { data: hit, error: null };
      };

      const chain = {
        select(_columns?: string, options?: { head?: boolean }) { head = Boolean(options?.head); return chain; },
        eq(column: string, value: unknown) { filters.push(["eq", column, value]); return chain; },
        is(column: string, value: unknown) { filters.push(["is", column, value]); return chain; },
        order() { return chain; },
        update(values: Row) { mode = "update"; patch = values; return chain; },
        delete() { mode = "delete"; return chain; },
        async maybeSingle() { const r = result(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: null }; },
        async single() { const r = result(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: null }; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
        insert(row: Row) {
          const failed = failInsertOn === table;
          const stored: Row = table === "timers"
            ? { id: T(nextId++), started_at: new Date().toISOString(), dismissed_at: null, finished_at: null, ...row }
            : { ...row };
          if (!failed) { rows.push(stored); writes.push({ table, op: "insert", filters: [], payload: stored }); }
          const outcome = failed ? { data: null, error: { message: `${table} insert failed` } } : { data: stored, error: null };
          return {
            select: () => ({ single: async () => outcome }),
            then(resolve: (v: unknown) => unknown) { return Promise.resolve(outcome).then(resolve); },
          };
        },
      };
      return chain;
    },
  };
  return {
    db: db as unknown as TimerDb,
    tables,
    writes,
    failInsertOn(table: string) { failInsertOn = table; },
  };
}

const ASSISTANT = { capped: true, now: NOW };
const MANUAL = { capped: false, now: NOW };

const timer = (n: number, family: string, extra: Row = {}): Row => ({
  id: T(n), family_id: family, label: `T${n}`, duration_seconds: 600,
  started_at: "2026-10-01T11:55:00.000Z", dismissed_at: null, finished_at: null, ...extra,
});

test.describe("input", () => {
  test("duration_seconds is a whole number from 1 to 86400", () => {
    expect(parseTimerInput({ duration_seconds: 1 })).toEqual({ ok: true, value: { label: null, duration_seconds: 1 } });
    expect(parseTimerInput({ duration_seconds: 86_400 }).ok).toBe(true);
    for (const bad of [0, -5, 86_401, 90.5, "600", null, undefined, Number.NaN]) {
      expect(parseTimerInput({ duration_seconds: bad }).ok, String(bad)).toBe(false);
    }
  });

  test("label is optional, trimmed, empty means none, at most 60 characters", () => {
    expect(parseTimerInput({ duration_seconds: 60, label: "  Pasta  " })).toMatchObject({ ok: true, value: { label: "Pasta" } });
    expect(parseTimerInput({ duration_seconds: 60, label: "   " })).toMatchObject({ ok: true, value: { label: null } });
    expect(parseTimerInput({ duration_seconds: 60, label: null })).toMatchObject({ ok: true, value: { label: null } });
    expect(parseTimerInput({ duration_seconds: 60, label: "x".repeat(60) }).ok).toBe(true);
    expect(parseTimerInput({ duration_seconds: 60, label: ` ${"x".repeat(60)} ` }).ok).toBe(true);
    expect(parseTimerInput({ duration_seconds: 60, label: "x".repeat(61) }).ok).toBe(false);
    expect(parseTimerInput({ duration_seconds: 60, label: 42 }).ok).toBe(false);
  });
});

test.describe("reading", () => {
  test("a running timer reports its remaining seconds and end; one past its time is ringing at 0", () => {
    expect(timerView(timer(1, OURS) as never, NOW)).toEqual({
      id: T(1), label: "T1", duration_seconds: 600, started_at: "2026-10-01T11:55:00.000Z",
      ends_at: "2026-10-01T12:05:00.000Z", remaining_seconds: 300, state: "running",
    });
    expect(timerView(timer(2, OURS, { duration_seconds: 60 }) as never, NOW)).toMatchObject({
      remaining_seconds: 0, state: "ringing", ends_at: "2026-10-01T11:56:00.000Z",
    });
  });

  test("only this family's timers that are not dismissed, the one due soonest first", async () => {
    const f = fakeDb({
      timers: [
        timer(1, OURS, { duration_seconds: 1200 }),
        timer(2, OURS, { duration_seconds: 60 }),
        timer(3, OURS, { dismissed_at: "2026-10-01T11:58:00.000Z" }),
        timer(4, THEIRS),
      ],
    });
    const list = await readActiveTimers(OURS, NOW, f.db);
    expect(list.map((t) => [t.id, t.state])).toEqual([[T(2), "ringing"], [T(1), "running"]]);
  });
});

test.describe("starting", () => {
  test("inserts the timer and queues its push, exactly as the session route did", async () => {
    const f = fakeDb({ timers: [] });
    const outcome = await startIntegrationTimer(OURS, { label: "Pasta", duration_seconds: 480 }, ASSISTANT, f.db);
    expect(outcome).toMatchObject({ status: "started", timer: { label: "Pasta", duration_seconds: 480, state: "running" } });
    expect(f.tables.timers).toHaveLength(1);
    expect(f.tables.timers[0]).toMatchObject({ family_id: OURS, label: "Pasta", duration_seconds: 480 });
    expect(f.tables.scheduled_notifications).toEqual([{
      family_id: OURS,
      notification_type: "timer",
      scheduled_for: new Date(Date.parse(f.tables.timers[0].started_at as string) + 480_000).toISOString(),
      title: "Pasta is ready",
      body: null,
      data: { label: "Pasta" },
      related_entity_type: "timer",
      related_entity_id: f.tables.timers[0].id,
    }]);
  });

  test("an unlabelled timer's push falls back to 'Timer finished' with no data", async () => {
    const f = fakeDb({ timers: [] });
    await startTimer(f.db, OURS, null, 60);
    expect(f.tables.scheduled_notifications[0]).toMatchObject({ title: "Timer finished", data: null });
  });

  test("the push failing does not fail the timer", async () => {
    const f = fakeDb({ timers: [] });
    f.failInsertOn("scheduled_notifications");
    const { timer: started, error } = await startTimer(f.db, OURS, null, 60);
    expect(error).toBeNull();
    expect(started).toBeTruthy();
  });

  test("the timer insert failing is reported and nothing is queued", async () => {
    const f = fakeDb({ timers: [] });
    f.failInsertOn("timers");
    const { timer: started, error } = await startTimer(f.db, OURS, null, 60);
    expect(started).toBeNull();
    expect(error).toMatchObject({ message: "timers insert failed" });
    expect(f.tables.scheduled_notifications ?? []).toEqual([]);
    await expect(startIntegrationTimer(OURS, { label: null, duration_seconds: 60 }, ASSISTANT, fakeDbFailing().db)).rejects.toBeTruthy();
  });

  test(`refused once the family has ${MAX_ACTIVE_TIMERS} running, paused or ringing; nothing is written`, async () => {
    const rows = Array.from({ length: MAX_ACTIVE_TIMERS }, (_, i) => timer(i + 1, OURS, i % 2 ? { duration_seconds: 60 } : {}));
    const f = fakeDb({ timers: rows });
    expect(await startIntegrationTimer(OURS, { label: null, duration_seconds: 60 }, ASSISTANT, f.db)).toEqual({ status: "too_many", active: MAX_ACTIVE_TIMERS });
    expect(f.tables.timers).toHaveLength(MAX_ACTIVE_TIMERS);
    expect(f.writes).toEqual([]);
  });

  test("one under the cap still starts; dismissed and other families' timers do not count", async () => {
    const f = fakeDb({
      timers: [
        ...Array.from({ length: MAX_ACTIVE_TIMERS - 1 }, (_, i) => timer(i + 1, OURS)),
        ...Array.from({ length: 5 }, (_, i) => timer(20 + i, OURS, { dismissed_at: "2026-10-01T11:00:00.000Z" })),
        ...Array.from({ length: 12 }, (_, i) => timer(40 + i, THEIRS)),
      ],
    });
    expect((await startIntegrationTimer(OURS, { label: null, duration_seconds: 60 }, ASSISTANT, f.db)).status).toBe("started");
    // Now at the cap.
    expect((await startIntegrationTimer(OURS, { label: null, duration_seconds: 60 }, ASSISTANT, f.db)).status).toBe("too_many");
  });

  test("a hand-made token (Home Assistant) is not capped: it starts past the cap without counting", async () => {
    const rows = Array.from({ length: MAX_ACTIVE_TIMERS + 2 }, (_, i) => timer(i + 1, OURS));
    const f = fakeDb({ timers: rows });
    expect((await startIntegrationTimer(OURS, { label: null, duration_seconds: 60 }, MANUAL, f.db)).status).toBe("started");
    expect(f.tables.timers).toHaveLength(MAX_ACTIVE_TIMERS + 3);
    // The same family, the same rows: an assistant is refused.
    expect((await startIntegrationTimer(OURS, { label: null, duration_seconds: 60 }, ASSISTANT, f.db)).status).toBe("too_many");
  });

  test("a timer that has rung for over an hour unanswered no longer counts; one within the hour still does", async () => {
    const endedAgo = (ms: number) => ({ started_at: new Date(NOW.getTime() - ms - 600_000).toISOString(), duration_seconds: 600 });
    const f = fakeDb({
      timers: [
        ...Array.from({ length: MAX_ACTIVE_TIMERS - 1 }, (_, i) => timer(i + 1, OURS)),
        // Rang 1h01m ago and nobody dismissed it: stale.
        ...Array.from({ length: 4 }, (_, i) => timer(60 + i, OURS, endedAgo(STALE_RINGING_MS + 60_000))),
      ],
    });
    expect(await countActiveTimers(f.db, OURS, NOW)).toBe(MAX_ACTIVE_TIMERS - 1);
    expect((await startIntegrationTimer(OURS, { label: null, duration_seconds: 60 }, ASSISTANT, f.db)).status).toBe("started");

    // Rang 59 minutes ago: it is still ringing on a screen, and counts.
    const g = fakeDb({
      timers: [
        ...Array.from({ length: MAX_ACTIVE_TIMERS - 1 }, (_, i) => timer(i + 1, OURS)),
        timer(70, OURS, endedAgo(STALE_RINGING_MS - 60_000)),
      ],
    });
    expect(await countActiveTimers(g.db, OURS, NOW)).toBe(MAX_ACTIVE_TIMERS);
    expect((await startIntegrationTimer(OURS, { label: null, duration_seconds: 60 }, ASSISTANT, g.db)).status).toBe("too_many");
    // list_timers still shows the stale ones: only the cap forgets them.
    expect(await readActiveTimers(OURS, NOW, f.db)).toHaveLength(MAX_ACTIVE_TIMERS + 4);
  });
});

function fakeDbFailing() {
  const f = fakeDb({ timers: [] });
  f.failInsertOn("timers");
  return f;
}

test.describe("stopping", () => {
  test("dismisses the timer and cancels its push, scoped to the family", async () => {
    const f = fakeDb({
      timers: [timer(1, OURS)],
      scheduled_notifications: [
        { family_id: OURS, related_entity_type: "timer", related_entity_id: T(1) },
        { family_id: OURS, related_entity_type: "timer", related_entity_id: T(2) },
      ],
    });
    expect(await stopTimerForAssistant(OURS, T(1), f.db)).toBe(true);
    expect(f.tables.timers[0].dismissed_at).toEqual(expect.any(String));
    expect(f.tables.timers).toHaveLength(1); // kept, not deleted
    expect(f.tables.scheduled_notifications.map((r) => r.related_entity_id)).toEqual([T(2)]);
    const update = f.writes.find((w) => w.table === "timers" && w.op === "update");
    expect(update?.filters).toEqual(expect.arrayContaining([["eq", "id", T(1)], ["eq", "family_id", OURS]]));
  });

  test("another family's timer is not found and is left alone, push included", async () => {
    const f = fakeDb({
      timers: [timer(4, THEIRS)],
      scheduled_notifications: [{ family_id: THEIRS, related_entity_type: "timer", related_entity_id: T(4) }],
    });
    expect(await stopTimerForAssistant(OURS, T(4), f.db)).toBe(false);
    expect(f.tables.timers[0].dismissed_at).toBeNull();
    expect(f.tables.scheduled_notifications).toHaveLength(1);
    expect(f.writes).toEqual([]);
  });

  test("a missing or already dismissed timer is not found, and its dismissal time is not rewritten", async () => {
    const f = fakeDb({ timers: [timer(3, OURS, { dismissed_at: "2026-10-01T11:58:00.000Z" })] });
    expect(await stopTimerForAssistant(OURS, T(3), f.db)).toBe(false);
    expect(await stopTimerForAssistant(OURS, T(99), f.db)).toBe(false);
    expect(f.tables.timers[0].dismissed_at).toBe("2026-10-01T11:58:00.000Z");
    expect(f.writes).toEqual([]);
  });

  test("the session route's dismiss and delete still cancel the push first", async () => {
    const f = fakeDb({
      timers: [timer(1, OURS), timer(2, OURS)],
      scheduled_notifications: [
        { family_id: OURS, related_entity_type: "timer", related_entity_id: T(1) },
        { family_id: OURS, related_entity_type: "timer", related_entity_id: T(2) },
      ],
    });
    await dismissTimer(f.db, OURS, T(1));
    await deleteTimer(f.db, OURS, T(2));
    expect(f.writes.map((w) => `${w.table}:${w.op}`)).toEqual([
      "scheduled_notifications:delete", "timers:update",
      "scheduled_notifications:delete", "timers:delete",
    ]);
    expect(f.tables.timers.map((r) => r.id)).toEqual([T(1)]);
    expect(f.tables.scheduled_notifications).toEqual([]);
  });
});

test.describe("routes", () => {
  const read = (...p: string[]) => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", ...p), "utf8"));

  test("each Integration route asks for its scope; the start takes an Idempotency-Key and answers too_many_timers", () => {
    const list = read("integration", "v1", "timers", "route.ts");
    expect(list).toContain('withIntegrationAuth(request, "family:read"');
    expect(list).toContain('withIntegrationAuth(request, "timers:write"');
    expect(list).toContain("validateIdempotencyKey(");
    expect(list).toContain("findStoredResult(");
    expect(list).toContain('code: "too_many_timers"');
    expect(list).toContain("status: 429");
    // The cap is an assistant's (RFC-012): a hand-made token is not counted.
    expect(list).toContain("startIntegrationTimer(context.familyId, input.value, { capped: context.assistant })");
    const item = read("integration", "v1", "timers", "[id]", "route.ts");
    expect(item).toContain('withIntegrationAuth(request, "timers:write"');
    expect(item).toContain("destructiveLimitResponse(context)");
    expect(item).toContain("stopTimerForAssistant(context.familyId, id)");
  });

  test("too_many_timers is a stable API error code", () => {
    expect(API_ERROR_CODES).toContain("too_many_timers");
  });

  test("the session routes keep their checks and call the lib", () => {
    const list = read("timers", "route.ts");
    expect(list).toContain("requireSession(request)");
    expect(list).toContain("familyMatchesSession(auth.session, familyId)");
    expect(list).toContain("startTimer(");
    expect(list).toContain("Math.round(duration)");
    expect(list).toContain("listActiveTimers(");
    expect(list).not.toContain("scheduled_notifications");
    const item = read("timers", "[id]", "route.ts");
    expect(item).toContain('rowInFamily(supabase, "timers", id, familyId)');
    expect(item).toContain("dismissTimer(supabase, familyId, id)");
    expect(item).toContain("deleteTimer(supabase, familyId, id)");
  });

  test("list_timers reads with family:read; start_timer and stop_timer need timers:write", () => {
    expect(TOOL_SCOPES.list_timers).toBe("family:read");
    expect(TOOL_SCOPES.start_timer).toBe("timers:write");
    expect(TOOL_SCOPES.stop_timer).toBe("timers:write");
    expect(hasScope(["family:read"], "timers:write")).toBe(false);
  });
});

test.describe("pausing", () => {
  const push = (n: number, family = OURS): Row => ({ family_id: family, related_entity_type: "timer", related_entity_id: T(n) });
  const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

  test("pause stops the clock and cancels the push; resume adds the pause and queues the push at the new end", async () => {
    // T1: ten minutes from 11:55, due 12:05. Paused at 12:00 with five minutes left.
    const f = fakeDb({ timers: [timer(1, OURS)], scheduled_notifications: [push(1), push(2)] });
    const paused = await pauseTimer(f.db, OURS, T(1), NOW);
    expect(paused).toMatchObject({ error: null, timer: { id: T(1), paused_at: NOW.toISOString() } });
    expect(f.tables.scheduled_notifications.map((r) => r.related_entity_id)).toEqual([T(2)]);
    expect(timerView(f.tables.timers[0] as never, later(600))).toMatchObject({ state: "paused", remaining_seconds: 300, ends_at: null });

    // Resumed 90 seconds later: due 12:06:30, and the push with it.
    const resumed = await resumeTimer(f.db, OURS, T(1), later(90));
    expect(resumed).toMatchObject({ error: null, timer: { paused_at: null, paused_seconds: 90 } });
    expect(f.tables.scheduled_notifications.find((r) => r.related_entity_id === T(1))).toMatchObject({
      family_id: OURS, notification_type: "timer", related_entity_type: "timer", scheduled_for: "2026-10-01T12:06:30.000Z",
    });
    expect(timerView(f.tables.timers[0] as never, later(90))).toMatchObject({
      state: "running", remaining_seconds: 300, ends_at: "2026-10-01T12:06:30.000Z",
    });
  });

  test("a pause counts in whole seconds rounded down, so a resumed timer never gains time", async () => {
    const f = fakeDb({ timers: [timer(1, OURS)], scheduled_notifications: [] });
    await pauseTimer(f.db, OURS, T(1), NOW);
    // Paused for 90.9 seconds: 90 count, so the time left can only stay or drop.
    await resumeTimer(f.db, OURS, T(1), new Date(NOW.getTime() + 90_900));
    expect(f.tables.timers[0]).toMatchObject({ paused_seconds: 90 });
    expect(timerView(f.tables.timers[0] as never, new Date(NOW.getTime() + 90_900)).remaining_seconds).toBeLessThanOrEqual(300);
  });

  test("only a running timer of this family pauses, and only a paused one resumes", async () => {
    const f = fakeDb({
      timers: [
        timer(1, OURS, { duration_seconds: 60 }), // ran out at 11:56: ringing
        timer(2, OURS, { dismissed_at: "2026-10-01T11:58:00.000Z" }),
        timer(3, OURS, { paused_at: "2026-10-01T11:59:00.000Z", paused_seconds: 0 }),
        timer(4, THEIRS),
        timer(5, OURS),
        timer(6, THEIRS, { paused_at: "2026-10-01T11:59:00.000Z", paused_seconds: 0 }),
      ],
    });
    for (const id of [T(1), T(2), T(3), T(4), T(99)]) {
      expect((await pauseTimer(f.db, OURS, id, NOW)).timer, id).toBeNull();
    }
    for (const id of [T(1), T(2), T(5), T(6), T(99)]) {
      expect((await resumeTimer(f.db, OURS, id, NOW)).timer, id).toBeNull();
    }
    expect(f.writes).toEqual([]);
  });

  test("a second pause or resume from another screen changes nothing, and each update is guarded", async () => {
    const f = fakeDb({ timers: [timer(1, OURS)], scheduled_notifications: [push(1)] });
    await pauseTimer(f.db, OURS, T(1), NOW);
    expect((await pauseTimer(f.db, OURS, T(1), later(1))).timer).toBeNull();
    await resumeTimer(f.db, OURS, T(1), later(60));
    expect((await resumeTimer(f.db, OURS, T(1), later(61))).timer).toBeNull();
    const [pauseUpdate, resumeUpdate, ...rest] = f.writes.filter((w) => w.table === "timers" && w.op === "update");
    expect(rest).toEqual([]);
    expect(pauseUpdate.filters).toEqual(expect.arrayContaining([
      ["eq", "id", T(1)], ["eq", "family_id", OURS], ["is", "paused_at", null], ["is", "dismissed_at", null],
    ]));
    // Resuming applies only to the pause it read, so the pause is added once.
    expect(resumeUpdate.filters).toEqual(expect.arrayContaining([
      ["eq", "id", T(1)], ["eq", "family_id", OURS], ["eq", "paused_at", NOW.toISOString()], ["is", "dismissed_at", null],
    ]));
    expect(f.tables.timers[0]).toMatchObject({ paused_at: null, paused_seconds: 60 });
    expect(f.tables.scheduled_notifications.filter((r) => r.related_entity_id === T(1))).toHaveLength(1);
  });

  test("an assistant reads a paused timer as paused, with no end, after the ones counting down", async () => {
    const rows = [
      timer(1, OURS, { paused_at: "2026-10-01T11:57:00.000Z", paused_seconds: 0 }),
      timer(2, OURS, { duration_seconds: 900 }),
      timer(3, OURS),
    ];
    expect(timerView(rows[0] as never, NOW)).toEqual({
      id: T(1), label: "T1", duration_seconds: 600, started_at: "2026-10-01T11:55:00.000Z",
      ends_at: null, remaining_seconds: 480, state: "paused",
    });
    const f = fakeDb({ timers: rows });
    expect((await readActiveTimers(OURS, NOW, f.db)).map((v) => v.id)).toEqual([T(3), T(2), T(1)]);
  });

  test("a paused timer counts against the ten however long it stays paused; time paused delays going stale", async () => {
    const f = fakeDb({
      timers: [
        timer(1, OURS, { started_at: "2026-10-01T08:00:00.000Z", paused_at: "2026-10-01T08:05:00.000Z", paused_seconds: 0 }),
        timer(2, OURS, { started_at: "2026-10-01T10:00:00.000Z", duration_seconds: 60, paused_seconds: 3600 }),
        timer(3, OURS, { started_at: "2026-10-01T10:00:00.000Z", duration_seconds: 60 }),
      ],
    });
    expect(await countActiveTimers(f.db, OURS, NOW)).toBe(2);
  });
});
