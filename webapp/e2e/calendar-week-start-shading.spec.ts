import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Which columns are the weekend moves with the week start; their position does
 * not.
 *
 * The month grid tinted its last two columns by index — `dayIndex >= 5` — which
 * is Saturday and Sunday only while the week starts on Monday. Since the week
 * start became a setting, a household on a Sunday start got Friday and Saturday
 * shaded instead, in the grid and again in the header row above it (issue #230).
 *
 * The rule is that weekend styling is derived from the date, never from where
 * the date landed in the row. These assertions are on the source rather than a
 * rendered page so the fast suite keeps running without a stack; the shape they
 * are protecting is small and the index form is easy to reintroduce.
 */

const monthView = readFileSync("src/components/calendar/month-view.tsx", "utf8");
const weekView = readFileSync("src/components/calendar/week-view.tsx", "utf8");

test("the month grid does not decide the weekend by column index", () => {
  const byIndex = monthView.match(/\b(dayIndex|idx)\s*>=\s*5\b/g);
  expect(
    byIndex,
    `month-view.tsx still styles a column by its position (${byIndex?.join(", ")}), ` +
      `which is the weekend only on a Monday start`,
  ).toBeNull();
  expect(monthView, "month-view.tsx should derive the weekend from the date").toMatch(
    /isWeekend\(day\)/,
  );
});

test("the weekday header shades the same days the grid does", () => {
  // The labels are built from the week's first day, so each one carries its
  // own `isWeekend` rather than being shaded by its place in the row.
  expect(monthView).toMatch(/weekend:\s*isWeekend\(day\)/);
  expect(monthView).toMatch(/weekend\s*\?\s*"text-muted-foreground\/60"/);
});

test("the weekday labels recompute when the week start changes", () => {
  // `weekStartsOn` arrives from a setting, so it is not its initial value on
  // first render. Left out of the dependency list, the header kept Monday-first
  // labels over Sunday-first columns until `currentDate` happened to change.
  const deps = monthView.match(/const weekdayLabels = useMemo\([\s\S]*?\}, \[([^\]]*)\]\)/);
  expect(deps, "could not find weekdayLabels' dependency list — did it move?").toBeTruthy();
  expect(
    deps![1],
    "weekdayLabels does not depend on weekStartsOn, so the header row can lag " +
      "a whole month behind the columns underneath it",
  ).toContain("weekStartsOn");
});

test("the week view shades its weekend too, and by date", () => {
  // It had no shading at all, so the same week looked like two different
  // calendars depending on which tab you were on.
  expect(
    weekView,
    "week-view.tsx should tint the weekend columns the way the month grid does",
  ).toMatch(/isWeekend\(day\)[^\n]*bg-muted\/30/);
});
