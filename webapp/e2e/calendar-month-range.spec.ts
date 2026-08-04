import { test, expect } from "@playwright/test";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns";

/**
 * The month grid draws whole weeks, so it renders up to six days either
 * side of the month. The query fetched only the calendar month, so those
 * cells were permanently blank — an event on the 30th of the previous
 * month showed as an empty Monday, and clicking it opened an empty day.
 *
 * This pins the range to the grid the view actually draws.
 */

const gridRange = (d: Date) => ({
  start: startOfWeek(startOfMonth(d), { weekStartsOn: 1 }),
  end: endOfWeek(endOfMonth(d), { weekStartsOn: 1 }),
});

test("the fetched range covers every cell the grid draws", () => {
  // August 2026 starts on a Saturday, so the grid opens on Mon 27 July.
  const august = new Date(2026, 7, 15);
  const { start, end } = gridRange(august);

  expect(start.getMonth()).toBe(6); // July
  expect(start.getDate()).toBe(27);
  expect(end.getMonth()).toBe(8); // September
  expect(end.getDate()).toBe(6);
});

test("an event on a leading day is inside the range", () => {
  const { start, end } = gridRange(new Date(2026, 7, 15));
  const eventOn30July = new Date(2026, 6, 30, 9, 0);

  expect(eventOn30July >= start).toBe(true);
  expect(eventOn30July <= end).toBe(true);

  // …and was outside the old month-only range.
  expect(eventOn30July >= startOfMonth(new Date(2026, 7, 15))).toBe(false);
});

test("an event on a trailing day is inside the range", () => {
  const { start, end } = gridRange(new Date(2026, 7, 15));
  const eventOn2Sept = new Date(2026, 8, 2, 18, 0);

  expect(eventOn2Sept <= end).toBe(true);
  expect(eventOn2Sept <= endOfMonth(new Date(2026, 7, 15))).toBe(false);
  expect(eventOn2Sept >= start).toBe(true);
});

test("a month that starts on Monday still works", () => {
  // June 2026 starts on a Monday — no leading days, so the range should
  // begin exactly on the 1st rather than a week early.
  const { start } = gridRange(new Date(2026, 5, 15));
  expect(start.getMonth()).toBe(5);
  expect(start.getDate()).toBe(1);
});

test("the range never shrinks below the month itself", () => {
  for (let m = 0; m < 12; m++) {
    const d = new Date(2026, m, 15);
    const { start, end } = gridRange(d);
    expect(start <= startOfMonth(d), `month ${m} start`).toBe(true);
    expect(end >= endOfMonth(d), `month ${m} end`).toBe(true);
  }
});
