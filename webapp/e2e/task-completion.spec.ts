import { test, expect } from "@playwright/test";
import { completionUpdate } from "../src/lib/task-completion";

/**
 * `completionUpdate` is the decision `PATCH /lists/tasks/{item}` makes when
 * `status` is in the body — pulled out so the four cases (one-off/recurring
 * × completed/needs_action) and the time-zone edge can be tested without a
 * database. The route must apply exactly what this returns.
 */

const BERLIN = "Europe/Berlin";
const LA = "America/Los_Angeles";

test.describe("completing a task", () => {
  test("a one-off task is simply marked completed", () => {
    const r = completionUpdate({ recurrence: "once" }, "completed", new Date("2026-10-03T12:00:00Z"), BERLIN);
    expect(r).toEqual({ ok: true, update: { completed: true } });
  });

  test("a null recurrence behaves like `once`", () => {
    const r = completionUpdate({ recurrence: null }, "completed", new Date("2026-10-03T12:00:00Z"), BERLIN);
    expect(r).toEqual({ ok: true, update: { completed: true } });
  });

  test("a recurring task writes last_completed and last_completed_day, and leaves completed false", () => {
    // Matches app/todos/page.tsx handleToggleTask's shape exactly, since the
    // points trigger keys an award on last_completed_day.
    const now = new Date("2026-10-03T12:00:00Z");
    const r = completionUpdate({ recurrence: "daily" }, "completed", now, BERLIN);
    expect(r).toEqual({
      ok: true,
      update: { last_completed: now.toISOString(), last_completed_day: "2026-10-03", completed: false },
    });
  });

  test("any non-`once` recurrence counts as recurring, including a weekday list", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    for (const recurrence of ["weekly", "biweekly", "monthly", "days:1,3,5"]) {
      const r = completionUpdate({ recurrence }, "completed", now, BERLIN);
      expect(r.ok && r.update.completed).toBe(false);
      expect(r.ok && r.update.last_completed_day).toBe("2026-10-03");
    }
  });

  test("the day is computed in the family's time zone, not UTC or the server's", () => {
    // 23:30 UTC on 2026-10-03 is already 2026-10-04 in Berlin (CEST, UTC+2)
    // but still 2026-10-03 in Los Angeles (PDT, UTC-7) — the same instant,
    // two different calendar days.
    const now = new Date("2026-10-03T23:30:00Z");
    const berlin = completionUpdate({ recurrence: "weekly" }, "completed", now, BERLIN);
    const la = completionUpdate({ recurrence: "weekly" }, "completed", now, LA);
    expect(berlin.ok && berlin.update.last_completed_day).toBe("2026-10-04");
    expect(la.ok && la.update.last_completed_day).toBe("2026-10-03");
  });
});

test.describe("reopening a task", () => {
  test("a one-off task is marked not completed", () => {
    const r = completionUpdate({ recurrence: "once" }, "needs_action", new Date("2026-10-03T12:00:00Z"), BERLIN);
    expect(r).toEqual({ ok: true, update: { completed: false } });
  });

  test("a recurring task cannot be reopened — the UI has no undo for a recurring day", () => {
    const r = completionUpdate({ recurrence: "daily" }, "needs_action", new Date("2026-10-03T12:00:00Z"), BERLIN);
    expect(r).toEqual({ ok: false, conflict: true });
  });
});
