import { test, expect } from "@playwright/test";
import {
  LISTS,
  isListId,
  itemDue,
  itemSummary,
  toListItem,
} from "../src/lib/integration-lists";

/**
 * The list descriptions and their mapping to the wire.
 *
 * Two lists that look identical to a user sit on two tables that differ in
 * ways which matter, and the whole point of describing them once is that a
 * route cannot get one of them subtly wrong. These tests are about those
 * differences.
 */

test.describe("the two lists differ where they must", () => {
  test("each maps to its own columns", () => {
    expect(LISTS.shopping.table).toBe("shopping_items");
    expect(LISTS.shopping.titleColumn).toBe("name");
    expect(LISTS.shopping.doneColumn).toBe("checked");
    expect(LISTS.tasks.table).toBe("todos");
    expect(LISTS.tasks.titleColumn).toBe("title");
    expect(LISTS.tasks.doneColumn).toBe("completed");
  });

  test("only tasks are soft-deleted, and only tasks have a due date", () => {
    // shopping_items has no deleted_at column at all: filtering on it would be
    // an error, not an empty filter. And the shopping list deletes for real on
    // one tap by design, because it has Undo in the UI.
    expect(LISTS.tasks.softDeletes).toBe(true);
    expect(LISTS.shopping.softDeletes).toBe(false);
    expect(LISTS.tasks.dueColumn).toBe("due_date");
    expect(LISTS.shopping.dueColumn).toBeNull();
  });

  test("each requires its own write scope", () => {
    // A token that may add shopping items must not be able to create tasks.
    expect(LISTS.shopping.writeScope).toBe("shopping:write");
    expect(LISTS.tasks.writeScope).toBe("tasks:write");
    expect(LISTS.shopping.writeScope).not.toBe(LISTS.tasks.writeScope);
  });

  test("only the two known list names are accepted", () => {
    expect(isListId("shopping")).toBe(true);
    expect(isListId("tasks")).toBe(true);
    expect(isListId("todos")).toBe(false);
    expect(isListId("Shopping")).toBe(false);
    expect(isListId("")).toBe(false);
  });
});

test.describe("rows become to-do items", () => {
  test("an unchecked shopping row needs action", () => {
    const item = toListItem(LISTS.shopping, { id: "a", name: "Milch", checked: false });
    expect(item).toEqual({ id: "a", summary: "Milch", status: "needs_action", due: null, amount: null });
  });

  test("a shopping row carries its amount as the list prints it; a task has none", () => {
    expect(toListItem(LISTS.shopping, { id: "a", name: "Mehl", quantity: "500.00", unit: "g" }).amount).toBe("500 g");
    expect(toListItem(LISTS.shopping, { id: "a", name: "Eier", quantity: 2, unit: "Stück + 1 Packung" }).amount).toBe("2 Stück + 1 Packung");
    expect(toListItem(LISTS.shopping, { id: "a", name: "Salz", quantity: null, unit: null }).amount).toBeNull();
    expect(toListItem(LISTS.tasks, { id: "b", title: "Müll" })).not.toHaveProperty("amount");
  });

  test("a null `checked` needs action, not a third state", () => {
    // shopping_items.checked is NULLABLE with a default of false, so a row
    // inserted with an explicit null is unchecked — treating null as anything
    // other than "needs action" would strand items.
    expect(toListItem(LISTS.shopping, { id: "a", name: "X", checked: null }).status).toBe("needs_action");
    expect(toListItem(LISTS.shopping, { id: "a", name: "X" }).status).toBe("needs_action");
  });

  test("a completed task carries its due date", () => {
    const item = toListItem(LISTS.tasks, {
      id: "b", title: "Müll", completed: true, due_date: "2026-08-09",
    });
    expect(item).toEqual({ id: "b", summary: "Müll", status: "completed", due: "2026-08-09" });
  });

  test("a recurring task done today reads completed — 'today' in the family's time zone", () => {
    const row = { id: "r", title: "Hoover", completed: false, recurrence: "daily", due_date: null, created_at: "2026-09-01T08:00:00Z" };
    // Done at 01:30 Berlin on 2 Oct (23:30 UTC on 1 Oct); asked at 10:00 Berlin on 2 Oct.
    const done = { ...row, last_completed: "2026-10-01T23:30:00Z" };
    const now = new Date("2026-10-02T08:00:00Z");
    expect(toListItem(LISTS.tasks, done, { now, timeZone: "Europe/Berlin" }).status).toBe("completed");
    // In UTC that was yesterday, so it would be due again — the zone matters.
    expect(toListItem(LISTS.tasks, done, { now, timeZone: "UTC" }).status).toBe("needs_action");
    // Done yesterday, or never: due.
    expect(toListItem(LISTS.tasks, { ...row, last_completed: "2026-10-01T06:00:00Z" }, { now, timeZone: "Europe/Berlin" }).status)
      .toBe("needs_action");
    expect(toListItem(LISTS.tasks, { ...row, last_completed: null }, { now, timeZone: "Europe/Berlin" }).status).toBe("needs_action");
  });

  test("a weekly task done three days ago is still completed", () => {
    const row = { id: "w", title: "Bins", completed: false, recurrence: "weekly", last_completed: "2026-09-29T09:00:00Z" };
    expect(toListItem(LISTS.tasks, row, { now: new Date("2026-10-02T09:00:00Z"), timeZone: "Europe/Berlin" }).status).toBe("completed");
    expect(toListItem(LISTS.tasks, row, { now: new Date("2026-10-06T09:00:00Z"), timeZone: "Europe/Berlin" }).status).toBe("needs_action");
  });

  test("custom days (#301): done on Monday, completed on Tuesday, due again on Wednesday", () => {
    // 2026-10-05 is a Monday.
    const row = { id: "d", title: "Lunchbox", completed: false, recurrence: "days:MO,WE,FR", last_completed: "2026-10-05T07:00:00Z", created_at: "2026-09-01T08:00:00Z" };
    const at = (iso: string) => ({ now: new Date(iso), timeZone: "Europe/Berlin" });
    expect(toListItem(LISTS.tasks, row, at("2026-10-05T18:00:00Z")).status).toBe("completed");
    expect(toListItem(LISTS.tasks, row, at("2026-10-06T09:00:00Z")).status).toBe("completed");
    expect(toListItem(LISTS.tasks, row, at("2026-10-07T09:00:00Z")).status).toBe("needs_action");
  });

  test("a one-off task (no recurrence, or 'once') reads its completed column, as before", () => {
    const at = { now: new Date("2026-10-02T08:00:00Z"), timeZone: "Europe/Berlin" };
    expect(toListItem(LISTS.tasks, { id: "o", title: "X", completed: false, recurrence: null }, at).status).toBe("needs_action");
    expect(toListItem(LISTS.tasks, { id: "o", title: "X", completed: true, recurrence: "once" }, at).status).toBe("completed");
    // Shopping never derives: recurrence keys on a shopping row mean nothing.
    expect(toListItem(LISTS.shopping, { id: "s", name: "Milk", checked: false, recurrence: "daily", last_completed: "2026-10-02T07:00:00Z" }, at).status)
      .toBe("needs_action");
  });

  test("a shopping row never reports a due date", () => {
    // Even if something put one there, the list has no such column.
    expect(toListItem(LISTS.shopping, { id: "a", name: "X", checked: false, due_date: "2026-01-01" }).due)
      .toBeNull();
  });
});

test.describe("the text of an item", () => {
  test("is trimmed and required", () => {
    expect(itemSummary("  Milch  ")).toBe("Milch");
    expect(itemSummary("")).toBeNull();
    expect(itemSummary("   ")).toBeNull();
    expect(itemSummary(null)).toBeNull();
    expect(itemSummary(42)).toBeNull();
  });

  test("is bounded", () => {
    expect(itemSummary("a".repeat(300))).not.toBeNull();
    expect(itemSummary("a".repeat(301))).toBeNull();
  });
});

test.describe("the due date", () => {
  test("absent means no date, not an error", () => {
    expect(itemDue(undefined)).toEqual({ ok: true, value: null });
    expect(itemDue(null)).toEqual({ ok: true, value: null });
    expect(itemDue("")).toEqual({ ok: true, value: null });
  });

  test("a datetime is truncated to the day rather than refused", () => {
    // Home Assistant sends a datetime when the user picked a time; the column
    // is a date. Losing the time is what the schema means — refusing the item
    // would lose the whole task.
    expect(itemDue("2026-08-09T14:30:00Z")).toEqual({ ok: true, value: "2026-08-09" });
    expect(itemDue("2026-08-09")).toEqual({ ok: true, value: "2026-08-09" });
  });

  test("nonsense is refused rather than coerced to today", () => {
    expect(itemDue("tomorrow")).toEqual({ ok: false });
    expect(itemDue("09/08/2026")).toEqual({ ok: false });
    expect(itemDue(20260809)).toEqual({ ok: false });
  });
});
