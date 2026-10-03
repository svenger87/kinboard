import { test, expect } from "@playwright/test";
import {
  currentDay,
  dayStatus,
  dueIndex,
  isDueDay,
  isScheduled,
  isTurnOpen,
  keepsSchedule,
  nextTurnDay,
  prevDueDay,
  recentDays,
  scheduledDueDays,
  todayPerson,
  turnPerson,
  type WrittenDay,
} from "../src/lib/todo-turns";
import { isRecurringTaskDue, isTodoOpen } from "../src/lib/todo-recurrence";
import { taskDayKeys, taskDotsByDay, taskOccurrences } from "../src/lib/calendar-markers";
import { completionUpdate } from "../src/lib/task-completion";
import { toListItem, LISTS } from "../src/lib/integration-lists";

/**
 * lib/todo-turns.ts is the screens' mirror of the schedule functions in
 * docker/migration_zzzzzy_todo_turns.sql (#341). The expected values here
 * are the ones those SQL functions return for the same arguments --
 * todo-turns-db.spec.ts runs the SQL side against a real database -- so a
 * change on one side that is not made on the other fails one of the two.
 *
 * 2026-10-05 is a Monday.
 */

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const dishes = {
  recurrence: "daily",
  rotation_person_ids: [A, B, C],
  track_completion: true,
  schedule_start_day: "2026-10-05",
  tracking_started_day: "2026-10-05",
  carry_day: null,
  person_id: A,
  last_completed_day: null as string | null,
};

test.describe("the schedule", () => {
  test("a task keeps a schedule only when it repeats and rotates or is tracked", () => {
    expect(keepsSchedule({ recurrence: "daily", track_completion: true })).toBe(true);
    expect(keepsSchedule({ recurrence: "weekly", rotation_person_ids: [A] })).toBe(true);
    expect(keepsSchedule({ recurrence: "daily" })).toBe(false);
    expect(keepsSchedule({ recurrence: "once", track_completion: true })).toBe(false);
    expect(keepsSchedule({ recurrence: "daily", rotation_person_ids: [] })).toBe(false);
    // Started by the database: without a start day it is not scheduled yet.
    expect(isScheduled({ recurrence: "daily", track_completion: true })).toBe(false);
    expect(isScheduled({ recurrence: "daily", track_completion: true, schedule_start_day: "2026-10-05" })).toBe(true);
  });

  test("due days, the day before, and the count since the start -- as the SQL gives them", () => {
    // SELECT todo_prev_due_day('days:MO,WE','2026-10-05','2026-10-09') -> 2026-10-07
    expect(prevDueDay("days:MO,WE", "2026-10-05", "2026-10-09")).toBe("2026-10-07");
    // todo_due_index('days:MO,WE','2026-10-05','2026-10-14') -> 3 (Mon, Wed, Mon)
    expect(dueIndex("days:MO,WE", "2026-10-05", "2026-10-14")).toBe(3);
    expect(dueIndex("daily", "2026-10-05", "2026-10-08")).toBe(3);
    expect(dueIndex("weekly", "2026-10-05", "2026-10-19")).toBe(2);
    expect(dueIndex("weekly", "2026-10-05", "2026-10-05")).toBe(0);
    expect(prevDueDay("weekly", "2026-10-05", "2026-10-11")).toBe("2026-10-05");
    expect(prevDueDay("weekly", "2026-10-05", "2026-10-04")).toBeNull();
    expect(isDueDay("biweekly", "2026-10-05", "2026-10-19")).toBe(true);
    expect(isDueDay("biweekly", "2026-10-05", "2026-10-12")).toBe(false);
    expect(isDueDay("monthly", "2026-10-05", "2026-11-04")).toBe(true);
    expect(scheduledDueDays({ recurrence: "days:MO,WE,FR", schedule_start_day: "2026-10-05" }, "2026-10-01", "2026-10-11"))
      .toEqual(["2026-10-05", "2026-10-07", "2026-10-09"]);
  });

  test("turns follow the date, whether or not the turn before was done", () => {
    // The issue's example: A, B and C on a daily task from Monday.
    expect(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) => turnPerson(dishes, d)))
      .toEqual([A, B, C, A]);
    // Picked weekdays count only the picked days.
    const walk = { ...dishes, recurrence: "days:MO,WE,FR", rotation_person_ids: [A, B] };
    expect(["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12"].map((d) => turnPerson(walk, d)))
      .toEqual([A, B, A, B]);
  });

  test("a written-down day keeps the person it was written with", () => {
    const written = new Map<string, WrittenDay>([["2026-10-06", { day: "2026-10-06", person_id: C, status: "missed" }]]);
    expect(turnPerson(dishes, "2026-10-06", written)).toBe(C);
  });

  test("a due day stays open until the next one arrives", () => {
    const bins = { ...dishes, recurrence: "weekly", rotation_person_ids: null, person_id: A };
    expect(currentDay(bins, "2026-10-07")).toBe("2026-10-05");
    expect(currentDay(bins, "2026-10-12")).toBe("2026-10-12");
    expect(currentDay(bins, "2026-10-04")).toBeNull();
    // Carried over from before an edit: open until the new first day.
    const edited = { ...bins, schedule_start_day: "2026-10-12", carry_day: "2026-10-05" };
    expect(currentDay(edited, "2026-10-09")).toBe("2026-10-05");
    expect(currentDay(edited, "2026-10-12")).toBe("2026-10-12");
  });

  test("open while the open day has not been ticked; done when last_completed_day is that day", () => {
    expect(isTurnOpen(dishes, "2026-10-07")).toBe(true);
    expect(isTurnOpen({ ...dishes, last_completed_day: "2026-10-07" }, "2026-10-07")).toBe(false);
    expect(isTurnOpen({ ...dishes, last_completed_day: "2026-10-06" }, "2026-10-07")).toBe(true);
    // And that is what the badge, the widget and Home Assistant read.
    const now = new Date("2026-10-07T12:00:00Z");
    expect(isRecurringTaskDue({ ...dishes, last_completed_day: "2026-10-07", last_completed: "2026-10-07T08:00:00Z" }, now, "UTC")).toBe(false);
    expect(isTodoOpen({ ...dishes, last_completed_day: "2026-10-06", last_completed: "2026-10-06T08:00:00Z" }, now, "UTC")).toBe(true);
  });

  test("today's person, and the day the task is next due", () => {
    expect(todayPerson(dishes, "2026-10-07")).toBe(C);
    expect(todayPerson({ ...dishes, schedule_start_day: "2026-10-10" }, "2026-10-07")).toBe(A);
    expect(nextTurnDay(dishes, "2026-10-07")).toBe("2026-10-07");
    expect(nextTurnDay({ ...dishes, last_completed_day: "2026-10-07" }, "2026-10-07")).toBe("2026-10-08");
    expect(nextTurnDay({ ...dishes, recurrence: "weekly", last_completed_day: "2026-10-05" }, "2026-10-07")).toBe("2026-10-12");
  });
});

test.describe("history", () => {
  const written = new Map<string, WrittenDay>([
    ["2026-10-05", { day: "2026-10-05", person_id: A, status: "missed" }],
    ["2026-10-06", { day: "2026-10-06", person_id: B, status: "done" }],
  ]);

  test("written days are as written; closed ones not yet written count as missed; the open day is open", () => {
    expect(dayStatus(dishes, "2026-10-05", "2026-10-08", written)).toBe("missed");
    expect(dayStatus(dishes, "2026-10-06", "2026-10-08", written)).toBe("done");
    expect(dayStatus(dishes, "2026-10-07", "2026-10-08", written)).toBe("missed");
    expect(dayStatus(dishes, "2026-10-08", "2026-10-08", written)).toBe("open");
    expect(dayStatus({ ...dishes, last_completed_day: "2026-10-08" }, "2026-10-08", "2026-10-08", written)).toBe("done");
    expect(dayStatus(dishes, "2026-10-09", "2026-10-08", written)).toBe("upcoming");
    // Before tracking started there is nothing to say.
    expect(dayStatus({ ...dishes, tracking_started_day: "2026-10-07" }, "2026-10-06", "2026-10-08")).toBe("upcoming");
  });

  test("the strip is the last seven due days, oldest first, from when tracking started", () => {
    const strip = recentDays(dishes, "2026-10-08", written);
    expect(strip.map((d) => d.status)).toEqual(["missed", "done", "missed", "open"]);
    expect(strip.map((d) => d.personId)).toEqual([A, B, C, A]);
    expect(recentDays({ ...dishes, track_completion: false }, "2026-10-08", written)).toEqual([]);
    expect(recentDays({ ...dishes, tracking_started_day: "2026-09-01", schedule_start_day: "2026-09-01" }, "2026-10-08", undefined)).toHaveLength(7);
  });
});

test.describe("the calendar", () => {
  const from = new Date(2026, 9, 1);
  const to = new Date(2026, 9, 11);
  const now = new Date(2026, 9, 7, 12);

  test("a tracked task shows its history from the day tracking started, and its days ahead", () => {
    expect(taskDayKeys(dishes, from, to, now)).toEqual([
      "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11",
    ]);
  });

  test("an untracked rotation shows the open day and what follows, and drops the open day once done", () => {
    const rota = { ...dishes, track_completion: false, recurrence: "weekly" };
    expect(taskDayKeys(rota, from, to, now)).toEqual(["2026-10-05"]);
    expect(taskDayKeys({ ...rota, last_completed_day: "2026-10-05" }, from, to, now)).toEqual([]);
  });

  test("each day takes its person's colour, and a tracked day says how it went", () => {
    const people = [{ id: A, color: "#a00", name: "A" }, { id: B, color: "#0b0", name: "B" }, { id: C, color: "#00c", name: "C" }];
    const history = new Map([["t1", new Map<string, WrittenDay>([["2026-10-06", { day: "2026-10-06", person_id: B, status: "done" }]])]]);
    const occ = taskOccurrences([{ ...dishes, id: "t1", title: "Dishes" }], people, new Date(2026, 9, 5), new Date(2026, 9, 8), "#999", now, history);
    expect(occ.map((o) => [o.dayKey, o.color, o.status])).toEqual([
      ["2026-10-05", "#a00", "missed"],
      ["2026-10-06", "#0b0", "done"],
      ["2026-10-07", "#00c", "open"],
      ["2026-10-08", "#a00", "upcoming"],
    ]);
    const dots = taskDotsByDay(occ, people, "#999");
    expect(dots.get("2026-10-05")).toEqual([{ color: "#a00", status: "missed" }]);
    expect(dots.get("2026-10-06")).toEqual([{ color: "#0b0", status: "done" }]);
    expect(dots.get("2026-10-07")).toEqual([{ color: "#00c" }]);
  });
});

test.describe("ticking from elsewhere", () => {
  test("Home Assistant can take back a scheduled task's open day, but still not a plain repeating task's", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(completionUpdate({ recurrence: "daily", track_completion: true }, "needs_action", now, "UTC"))
      .toEqual({ ok: true, update: { last_completed: null, last_completed_day: "2026-10-07" } });
    expect(completionUpdate({ recurrence: "daily", rotation_person_ids: [A] }, "needs_action", now, "UTC").ok).toBe(true);
    expect(completionUpdate({ recurrence: "daily" }, "needs_action", now, "UTC")).toEqual({ ok: false, conflict: true });
  });

  test("the list status of a scheduled task follows its open day", () => {
    const at = { now: new Date("2026-10-07T12:00:00Z"), timeZone: "UTC" };
    const row = { id: "t1", title: "Dishes", completed: false, last_completed: "2026-10-07T08:00:00Z", ...dishes };
    expect(toListItem(LISTS.tasks, { ...row, last_completed_day: "2026-10-07" }, at).status).toBe("completed");
    expect(toListItem(LISTS.tasks, { ...row, last_completed_day: "2026-10-06" }, at).status).toBe("needs_action");
  });
});
