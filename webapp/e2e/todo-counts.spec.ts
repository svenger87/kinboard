import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { matchesStatus, todoCounts } from "../src/lib/todo-counts";
import type { RecurringFields } from "../src/lib/todo-recurrence";
import { codeOnly } from "./source-helpers";

/**
 * The Tasks page's counts and its Open / Done filter. A recurring task's row
 * never says `completed`, so counting rows called one done this morning,
 * next due tomorrow, open and not done all day. No stack.
 */

// 19:00 UTC: midday in the Americas, evening in Europe. An hour earlier is
// the same day wherever this runs, and a day earlier is the day before.
const NOW = new Date("2026-10-06T19:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const task = (over: Partial<RecurringFields> = {}): RecurringFields => ({ completed: false, recurrence: "once", last_completed: null, ...over });

const oneOffOpen = task();
const oneOffDone = task({ completed: true });
const dailyDoneToday = task({ recurrence: "daily", last_completed: ago(1) });
const dailyDoneYesterday = task({ recurrence: "daily", last_completed: ago(24) });
const dailyNeverDone = task({ recurrence: "daily" });
const weeklyDoneThreeDaysAgo = task({ recurrence: "weekly", last_completed: ago(72) });

test("two daily tasks done today and one still to do: two of three done, one open", () => {
  expect(todoCounts([dailyDoneToday, { ...dailyDoneToday }, oneOffOpen], NOW)).toEqual({
    total: 3, open: 1, done: 2, completed: 0, recurring: 2,
  });
});

test("a recurring task is open once it has come round again, and done until then", () => {
  expect(todoCounts([dailyDoneYesterday], NOW)).toMatchObject({ open: 1, done: 0 });
  expect(todoCounts([dailyNeverDone], NOW)).toMatchObject({ open: 1, done: 0 });
  expect(todoCounts([weeklyDoneThreeDaysAgo], NOW)).toMatchObject({ open: 0, done: 1 });
});

test("only ticked-off one-offs are what Delete completed removes", () => {
  expect(todoCounts([oneOffDone, oneOffOpen, dailyDoneToday], NOW)).toEqual({
    total: 3, open: 1, done: 2, completed: 1, recurring: 1,
  });
});

test("the Open and Done filters list what the counts count", () => {
  const all = [oneOffOpen, oneOffDone, dailyDoneToday, dailyDoneYesterday, weeklyDoneThreeDaysAgo];
  expect(all.filter((t) => matchesStatus(t, "active", NOW))).toEqual([oneOffOpen, dailyDoneYesterday]);
  expect(all.filter((t) => matchesStatus(t, "completed", NOW))).toEqual([oneOffDone, dailyDoneToday, weeklyDoneThreeDaysAgo]);
  expect(all.filter((t) => matchesStatus(t, "all", NOW))).toEqual(all);
  expect(all.filter((t) => matchesStatus(t, "active", NOW))).toHaveLength(todoCounts(all, NOW).open);
});

test("the page counts, shows progress and filters with these, and deletes only ticked-off rows", () => {
  const page = codeOnly(readFileSync(join(process.cwd(), "src/app/todos/page.tsx"), "utf8"));
  expect(page).toContain("const counts = todoCounts(todos || []);");
  expect(page).toContain("if (!matchesStatus(task, filterStatus)) return false;");
  expect(page).toContain('t("progressDoneCount", { completed: doneCount, total: totalCount })');
  expect(page).toContain('subtitle={t("subtitle", { active: activeCount, recurring: recurringCount, completed: doneCount })}');
  expect(page).toContain('t("deleteCompletedButton", { count: completedCount })');
  expect(page).not.toMatch(/filter\(\(t\) => !t\.completed\)\.length/);
});
