import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  holidaysByDay,
  isTaskEventId,
  nextTaskOccurrences,
  taskDayKeys,
  taskMarkersByDay,
  taskOccurrences,
} from "../src/lib/calendar-markers";
import { isRecurringTaskDue, recurringDueDayKeys, type RecurringFields } from "../src/lib/todo-recurrence";
import { toLocalDateKey } from "../src/lib/local-date";

/**
 * The calendar could only show events. Public holidays appeared only in a
 * day's details, and tasks not at all. These are the rules for the two kinds
 * of marker, pinned to fixed dates so every expectation is a day, not an
 * offset. Local noon keeps "now" clear of midnight in any runner timezone.
 */
const now = new Date(2026, 9, 1, 12); // Thursday 1 October 2026
const from = new Date(2026, 8, 27); // the month grid's first day
const to = new Date(2026, 10, 7); // and its last

test("a daily task never done is marked today and every day after, not before", () => {
  const keys = taskDayKeys({ recurrence: "daily", completed: false, last_completed: null }, from, to, now);
  expect(keys[0]).toBe("2026-10-01");
  expect(keys).toHaveLength(38); // 1 October to 7 November
  expect(keys).not.toContain("2026-09-30");
});

test("ticking a daily task off moves its next mark to tomorrow", () => {
  const keys = taskDayKeys(
    { recurrence: "daily", last_completed: new Date(2026, 9, 1, 8).toISOString() },
    from,
    to,
    now,
  );
  expect(keys[0]).toBe("2026-10-02");
});

test("a weekly task follows its last completion, and an overdue one is marked today", () => {
  const doneThreeDaysAgo = taskDayKeys(
    { recurrence: "weekly", last_completed: new Date(2026, 8, 28, 9).toISOString() },
    from,
    to,
    now,
  );
  expect(doneThreeDaysAgo.slice(0, 3)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19"]);

  const doneTenDaysAgo = taskDayKeys(
    { recurrence: "weekly", last_completed: new Date(2026, 8, 21, 9).toISOString() },
    from,
    to,
    now,
  );
  expect(doneTenDaysAgo.slice(0, 2)).toEqual(["2026-10-01", "2026-10-08"]);
});

test("a repeating task never done starts on its due date, where the task list shows it", () => {
  // Weekly, due Tuesday 6 October, never done, looked at on Thursday 1
  // October. The task list says Tuesday; the calendar used to mark 1, 8 and
  // 15 October.
  const dueTuesday = taskDayKeys({ recurrence: "weekly", last_completed: null, due_date: "2026-10-06" }, from, to, now);
  expect(dueTuesday.slice(0, 3)).toEqual(["2026-10-06", "2026-10-13", "2026-10-20"]);

  // A due date already past is overdue: today, as without one.
  const duePast = taskDayKeys({ recurrence: "weekly", last_completed: null, due_date: "2026-09-29" }, from, to, now);
  expect(duePast[0]).toBe("2026-10-01");

  // Once done, the due date no longer matters -- in the list or here.
  const done = taskDayKeys(
    { recurrence: "weekly", last_completed: new Date(2026, 8, 28, 9).toISOString(), due_date: "2026-10-30" },
    from,
    to,
    now,
  );
  expect(done[0]).toBe("2026-10-05");

  // Custom days count from the day the task was made, in the list as here.
  const weekdays = taskDayKeys(
    { recurrence: "days:MO,WE", last_completed: null, created_at: new Date(2026, 8, 30, 10).toISOString(), due_date: "2026-10-20" },
    from,
    to,
    now,
  );
  expect(weekdays[0]).toBe("2026-10-01"); // Wednesday 30 September came round already: overdue, so today
});

/**
 * The day-by-day walk the calendar used before: every day from the start asks
 * isRecurringTaskDue, and the task is ticked off on each day it is due. It
 * took about a second for 30 tasks ten years ahead, on every refetch, so
 * recurringDueDayKeys now computes the same days. This is the reference it
 * must agree with.
 */
function walkedDueDayKeys(todo: RecurringFields, startKey: string, fromKey: string, toKey: string): string[] {
  const keys: string[] = [];
  let state: RecurringFields = todo;
  const [sy, sm, sd] = startKey.split("-").map(Number);
  for (let day = new Date(sy, sm - 1, sd, 12); toLocalDateKey(day) <= toKey; day.setDate(day.getDate() + 1)) {
    if (!isRecurringTaskDue(state, day)) continue;
    if (toLocalDateKey(day) >= fromKey) keys.push(toLocalDateKey(day));
    state = { ...state, last_completed: day.toISOString() };
  }
  return keys;
}

test("the computed days match the day-by-day walk for every kind of schedule", () => {
  const recurrences = [
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "days:MO,TU,WE,TH,FR",
    "days:MO,WE,FR",
    "days:SA",
    "days:SU,SA",
    "days:", // no valid day: never due
    "yearly", // a schedule nothing knows: due until first done
  ];
  const lastCompleted = [
    null,
    "not a date",
    new Date(2026, 9, 1, 7).toISOString(), // this morning
    new Date(2026, 8, 30, 23, 30).toISOString(), // late last night
    new Date(2026, 8, 28, 9).toISOString(),
    new Date(2026, 7, 20, 18).toISOString(), // weeks ago
  ];
  const createdAt = [null, new Date(2026, 8, 30, 10).toISOString(), new Date(2026, 6, 1, 10).toISOString()];
  const ranges: [string, string][] = [
    ["2026-09-27", "2026-11-07"], // the month grid around today
    ["2026-10-01", "2026-10-07"], // the week ahead
    ["2027-02-22", "2027-04-04"], // a grid months ahead, across a DST change in most zones
    ["2026-08-01", "2026-09-30"], // entirely in the past: nothing
  ];
  let compared = 0;
  for (const recurrence of recurrences) {
    for (const last_completed of lastCompleted) {
      for (const created_at of createdAt) {
        for (const [fromKey, toKey] of ranges) {
          const todo = { recurrence, last_completed, created_at };
          expect(recurringDueDayKeys(todo, "2026-10-01", fromKey, toKey), JSON.stringify({ todo, fromKey, toKey })).toEqual(
            walkedDueDayKeys(todo, "2026-10-01", fromKey, toKey),
          );
          compared++;
        }
      }
    }
  }
  expect(compared).toBe(720);
});

test("a range years ahead costs the days in it, not the days before it", () => {
  // Ten years on, a daily task's 42-day grid is 42 keys, reached without
  // visiting the 3,600-odd days between.
  const keys = recurringDueDayKeys({ recurrence: "daily", last_completed: null }, "2026-10-01", "2036-09-29", "2036-11-09");
  expect(keys).toHaveLength(42);
  expect(keys[0]).toBe("2036-09-29");
  const weekly = recurringDueDayKeys(
    { recurrence: "weekly", last_completed: new Date(2026, 8, 28, 9).toISOString() },
    "2026-10-01",
    "2036-09-29",
    "2036-11-09",
  );
  // 5 October 2026 plus whole weeks: still a Monday.
  expect(weekly.every((key) => new Date(`${key}T12:00:00Z`).getUTCDay() === 1)).toBe(true);
  expect(weekly).toHaveLength(6);
});

test("a one-off task is marked on its due date while open, and never without one", () => {
  expect(taskDayKeys({ due_date: "2026-10-14" }, from, to, now)).toEqual(["2026-10-14"]);
  expect(taskDayKeys({ due_date: "2026-10-14", completed: true }, from, to, now)).toEqual([]);
  expect(taskDayKeys({ due_date: null }, from, to, now)).toEqual([]);
  expect(taskDayKeys({ due_date: "2026-12-24" }, from, to, now)).toEqual([]); // outside the grid
  // An overdue one-off stays on the day it was due.
  expect(taskDayKeys({ recurrence: "once", due_date: "2026-09-29" }, from, to, now)).toEqual(["2026-09-29"]);
  // In the recycle bin: nothing.
  expect(
    taskDayKeys({ due_date: "2026-10-14", deleted_at: "2026-10-01T00:00:00Z" }, from, to, now),
  ).toEqual([]);
});

test("one dot per person per day; unassigned and removed people share one neutral dot", () => {
  const people = [
    { id: "ana", color: "#ec4899" },
    { id: "ben", color: "#3b82f6" },
  ];
  const markers = taskMarkersByDay(
    [
      { dayKey: "2026-10-14", personId: "ben" },
      { dayKey: "2026-10-14", personId: "ana" },
      { dayKey: "2026-10-14", personId: "ana" }, // same person twice: one dot
      { dayKey: "2026-10-14", personId: null },
      { dayKey: "2026-10-15", personId: "gone" }, // a person since removed
    ],
    people,
    "neutral",
  );
  expect(markers.get("2026-10-14")).toEqual(["#ec4899", "#3b82f6", "neutral"]);
  expect(markers.get("2026-10-15")).toEqual(["neutral"]);
  expect(markers.has("2026-10-16")).toBe(false);
});

test("built-in holidays are keyed by their local day, across a year boundary", () => {
  const us = holidaysByDay("us", new Date(2026, 11, 20), new Date(2027, 0, 5));
  expect(us.get("2026-12-25")?.nameKey).toBe("usChristmas");
  expect(us.get("2027-01-01")?.nameKey).toBe("usNewYearsDay");

  const de = holidaysByDay("de", new Date(2026, 9, 1), new Date(2026, 9, 31));
  expect(de.get("2026-10-03")?.nameKey).toBe("tagDerDeutschenEinheit");
});

/**
 * Treated as events, tasks join the lists events appear in -- the Events
 * widget, the week overview, the calendar's day panel -- as all-day items
 * with an id no event row can have, so the panel can send them to the task
 * list instead of the event editor.
 */
test("tasks become all-day items with an id no event can have, coloured by person", () => {
  const occurrences = taskOccurrences(
    [
      { id: "t1", title: "Water the plants", recurrence: "daily", person_id: "emma" },
      { id: "t2", title: "Dentist forms", due_date: "2026-10-03", person_id: null },
    ],
    [{ id: "emma", color: "#ec4899", name: "Emma" }],
    now,
    new Date(2026, 9, 4),
    "neutral",
    now,
  );
  expect(occurrences).toHaveLength(5); // the daily task on 1-4 October, the one-off on the 3rd
  expect(occurrences[0]).toMatchObject({
    id: "task:t1:2026-10-01",
    todoId: "t1",
    dayKey: "2026-10-01",
    color: "#ec4899",
    personName: "Emma", // shown with the title: who the task is for
  });
  // Local midnight of its day: an all-day item.
  const d = occurrences[0].date;
  expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 1, 0]);
  expect(occurrences.find((o) => o.todoId === "t2")).toMatchObject({
    dayKey: "2026-10-03",
    color: "neutral",
    personId: null,
    personName: null,
  });

  expect(occurrences.every((o) => isTaskEventId(o.id))).toBe(true);
  expect(isTaskEventId("5f0c1d2e-6b7a-4c3d-9e8f-0a1b2c3d4e5f")).toBe(false); // an event row's uuid
});

test("an upcoming list gets each task once, at its next occurrence", () => {
  const occurrences = taskOccurrences(
    [
      { id: "t1", title: "Read", recurrence: "daily" },
      { id: "t2", title: "Forms", due_date: "2026-10-03" },
    ],
    [],
    now,
    new Date(2026, 9, 14),
    "neutral",
    now,
  );
  expect(nextTaskOccurrences(occurrences).map((o) => `${o.todoId}@${o.dayKey}`)).toEqual([
    "t1@2026-10-01",
    "t2@2026-10-03",
  ]);
});

test("the week overview compares due dates as dates, not as UTC midnights", () => {
  // The bug, still asserted: a date-only string parses as midnight UTC, which
  // west of UTC is the evening before -- a task due on the 14th was counted
  // on the 13th in the Americas.
  expect(new Date("2026-10-14").toISOString()).toBe("2026-10-14T00:00:00.000Z");

  const source = readFileSync(join(process.cwd(), "src/components/widgets/week-overview-widget.tsx"), "utf8");
  expect(source).not.toMatch(/new Date\(t\.due_date\)/);
  expect(source).toContain("t.due_date?.slice(0, 10) === dayKey");
});

