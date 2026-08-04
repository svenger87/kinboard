import { test, expect } from "@playwright/test";
import { comparePriority, priorityRank } from "../src/lib/todo-priority";
import { isRecurringTaskDue, isTodoOpen } from "../src/lib/todo-recurrence";

/**
 * Two bugs that both came from the dashboard and the todos page
 * disagreeing about what a todo's state means.
 *
 * 1. The widget sorted priority with `parseInt(a.priority) || 0`. Priority
 *    is "high" | "medium" | "low", so parseInt gives NaN for all three and
 *    `|| 0` flattened them to the same rank — the priority step of the sort
 *    did nothing at all.
 *
 * 2. A recurring todo is never marked `completed`; ticking it writes
 *    `last_completed` and leaves the row open so it can come round again.
 *    Counting `!completed` therefore counted every chore forever, so the nav
 *    badge never reached zero once a family had a single daily task.
 */

test.describe("priority sorting", () => {
  test("high really does sort above medium above low", () => {
    expect(priorityRank("high")).toBeLessThan(priorityRank("medium"));
    expect(priorityRank("medium")).toBeLessThan(priorityRank("low"));
  });

  test("the old parseInt approach ranked them all the same", () => {
    // Kept as the record of what was wrong.
    for (const p of ["high", "medium", "low"]) {
      expect(parseInt(p) || 0).toBe(0);
    }
  });

  test("sorting a mixed list puts high first", () => {
    const todos = [
      { id: "c", priority: "low" },
      { id: "a", priority: "high" },
      { id: "b", priority: "medium" },
    ];
    expect([...todos].sort(comparePriority).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  test("missing or unrecognised priorities land on medium", () => {
    expect(priorityRank(null)).toBe(priorityRank("medium"));
    expect(priorityRank(undefined)).toBe(priorityRank("medium"));
    expect(priorityRank("URGENT")).toBe(priorityRank("medium"));
    expect(priorityRank("")).toBe(priorityRank("medium"));
  });
});

test.describe("recurring todos and the nav badge", () => {
  const at = (iso: string) => new Date(iso);

  test("a daily chore ticked today is not outstanding", () => {
    const chore = {
      completed: false,
      recurrence: "daily",
      last_completed: at("2026-08-04T09:00:00").toISOString(),
    };
    expect(isTodoOpen(chore, at("2026-08-04T20:00:00"))).toBe(false);
    // The old rule — `!completed` — said it was.
    expect(chore.completed).toBe(false);
  });

  test("it comes back the next morning, not 24 hours later", () => {
    // Ticked at 22:00; the ms-based version wouldn't call it due until 22:00
    // the following night, so the morning chore list was empty.
    const chore = {
      completed: false,
      recurrence: "daily",
      last_completed: at("2026-08-03T22:00:00").toISOString(),
    };
    expect(isTodoOpen(chore, at("2026-08-04T07:00:00"))).toBe(true);
  });

  test("a chore never done is due", () => {
    expect(isRecurringTaskDue({ recurrence: "weekly", last_completed: null })).toBe(true);
  });

  test("the longer intervals hold", () => {
    const done = (iso: string) => at(iso).toISOString();
    const weekly = { recurrence: "weekly", last_completed: done("2026-08-01T10:00:00") };
    expect(isRecurringTaskDue(weekly, at("2026-08-07T10:00:00"))).toBe(false);
    expect(isRecurringTaskDue(weekly, at("2026-08-08T10:00:00"))).toBe(true);

    const monthly = { recurrence: "monthly", last_completed: done("2026-07-01T10:00:00") };
    expect(isRecurringTaskDue(monthly, at("2026-07-30T10:00:00"))).toBe(false);
    expect(isRecurringTaskDue(monthly, at("2026-07-31T10:00:00"))).toBe(true);
  });

  test("one-off todos are unaffected", () => {
    expect(isTodoOpen({ completed: false, recurrence: "once" })).toBe(true);
    expect(isTodoOpen({ completed: false, recurrence: null })).toBe(true);
    expect(isTodoOpen({ completed: true, recurrence: null })).toBe(false);
    expect(isRecurringTaskDue({ recurrence: "once", last_completed: null })).toBe(false);
  });

  test("a completed recurring row still counts as closed", () => {
    expect(isTodoOpen({ completed: true, recurrence: "daily", last_completed: null })).toBe(false);
  });

  test("a corrupt last_completed makes it due rather than stuck", () => {
    expect(isRecurringTaskDue({ recurrence: "daily", last_completed: "not a date" })).toBe(true);
  });

  test("an unknown recurrence doesn't silently become permanently open", () => {
    expect(
      isRecurringTaskDue({ recurrence: "hourly", last_completed: at("2026-08-04T09:00:00").toISOString() }),
    ).toBe(false);
  });

  test("the badge clears once every chore is done", () => {
    const todayIso = at("2026-08-04T08:00:00").toISOString();
    const todos = [
      { completed: true, recurrence: null },
      { completed: false, recurrence: "daily", last_completed: todayIso },
      { completed: false, recurrence: "weekly", last_completed: at("2026-08-02T08:00:00").toISOString() },
    ];
    const open = todos.filter((t) => isTodoOpen(t, at("2026-08-04T20:00:00"))).length;
    expect(open).toBe(0);
    // Under the old rule the badge showed 2, permanently.
    expect(todos.filter((t) => !t.completed).length).toBe(2);
  });
});
