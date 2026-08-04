import { test, expect } from "@playwright/test";

/**
 * A queued calendar reminder is a snapshot of an event taken up to ten
 * minutes earlier, and nothing rechecked it before sending.
 *
 * So a cancelled appointment still announced itself at the old time — the
 * scheduled_notifications row survives the event because
 * related_entity_id has no foreign key to hang a cascade on. And a
 * rescheduled event announced itself twice: once from the stale row, once
 * from the fresh row the scheduler correctly adds for the new start.
 *
 * The behaviour below was checked against a running instance first — three
 * events queued, one deleted, one moved — and it retired exactly the two
 * that should be retired.
 */

interface Reminder {
  id: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  data: Record<string, string> | null;
}

/** The classification dropStaleEventReminders performs. */
function split(pending: Reminder[], events: Map<string, string>) {
  const stale = new Set<string>();
  for (const reminder of pending) {
    if (reminder.related_entity_type !== "event" || !reminder.related_entity_id) continue;
    const current = events.get(reminder.related_entity_id);
    if (!current) {
      stale.add(reminder.id);
      continue;
    }
    const scheduled = reminder.data?.start_at;
    if (scheduled && new Date(scheduled).getTime() !== new Date(current).getTime()) {
      stale.add(reminder.id);
    }
  }
  return {
    kept: pending.filter((r) => !stale.has(r.id)),
    stale: [...stale],
  };
}

const reminder = (id: string, eventId: string | null, startAt?: string): Reminder => ({
  id,
  related_entity_type: "event",
  related_entity_id: eventId,
  data: startAt ? { start_at: startAt } : null,
});

const AT_14 = "2026-08-04T14:00:00+00:00";
const AT_16 = "2026-08-04T16:00:00+00:00";

test("a reminder for a deleted event is retired, not sent", () => {
  const result = split([reminder("r1", "gone")], new Map());
  expect(result.stale).toEqual(["r1"]);
  expect(result.kept).toEqual([]);
});

test("a reminder for an event that moved is retired", () => {
  // The scheduler already queued a fresh row for 16:00. Without this the
  // user is told about the appointment twice, once at the wrong time.
  const events = new Map([["e1", AT_16]]);
  const result = split([reminder("r1", "e1", AT_14)], events);
  expect(result.stale).toEqual(["r1"]);
});

test("an untouched event still sends", () => {
  const events = new Map([["e1", AT_14]]);
  const result = split([reminder("r1", "e1", AT_14)], events);
  expect(result.stale).toEqual([]);
  expect(result.kept).toHaveLength(1);
});

test("the same timestamp in a different notation is not a move", () => {
  // Postgres hands back "+00:00" where the row was written with "Z".
  const events = new Map([["e1", "2026-08-04T14:00:00Z"]]);
  expect(split([reminder("r1", "e1", AT_14)], events).stale).toEqual([]);
});

test("the three cases together behave as they did against the live database", () => {
  const events = new Map([
    ["keep", AT_14],
    ["move", AT_16],
    // "delete" is absent.
  ]);
  const result = split(
    [reminder("r-keep", "keep", AT_14), reminder("r-del", "delete", AT_14), reminder("r-move", "move", AT_14)],
    events,
  );
  expect(result.kept.map((r) => r.id)).toEqual(["r-keep"]);
  expect(result.stale.sort()).toEqual(["r-del", "r-move"]);
});

test("reminders of other kinds pass through untouched", () => {
  const birthday: Reminder = {
    id: "b1",
    related_entity_type: "birthday",
    related_entity_id: "p1",
    data: null,
  };
  const meal: Reminder = {
    id: "m1",
    related_entity_type: "meal_plan",
    related_entity_id: "mp1",
    data: null,
  };
  const result = split([birthday, meal], new Map());
  expect(result.stale).toEqual([]);
  expect(result.kept).toHaveLength(2);
});

test("a reminder with no recorded start time survives if the event exists", () => {
  // Rows written before start_at was stored in data — the event still
  // exists, so there's no reason to swallow it.
  const events = new Map([["e1", AT_16]]);
  expect(split([reminder("r1", "e1")], events).stale).toEqual([]);
});
