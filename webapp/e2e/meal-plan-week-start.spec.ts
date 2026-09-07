import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getWeekStart, getWeekDates } from "../src/hooks/use-meal-planner";

/**
 * The Meals page drew a Monday-to-Sunday grid however the "week starts on"
 * setting was set (issue #228).
 *
 * `getWeekStart` hardcoded Monday, and it is not only a display helper: its
 * return value is the key of the `meal_plans` row, unique on
 * (family_id, week_start). So the week the household sees and the week the
 * database stores were the same decision, made in one place that never asked
 * the setting.
 *
 * It now takes the setting, and the parameter is required rather than
 * defaulted — a default would let a call site keep Monday by saying nothing,
 * which is how all three call sites came to be wrong at once. Making it
 * required turned the bug into four compiler errors.
 *
 * The rows already written are re-partitioned by
 * docker/migration_zzzz_meal_plan_week_start.sql.
 */

const SUNDAY = 0 as const;
const MONDAY = 1 as const;

/** Local noon, so nothing here depends on the runner's timezone. */
const at = (iso: string) => new Date(`${iso}T12:00:00`);

test.describe("getWeekStart", () => {
  test("a Monday start behaves as it always did", () => {
    // Wed 2026-09-02 -> Mon 2026-08-31
    expect(getWeekStart(at("2026-09-02"), MONDAY)).toBe("2026-08-31");
    // A Monday is its own week start.
    expect(getWeekStart(at("2026-08-31"), MONDAY)).toBe("2026-08-31");
    // Sunday belongs to the week that began six days earlier — the case the
    // old `day === 0 ? -6 : 1` arithmetic existed for.
    expect(getWeekStart(at("2026-09-06"), MONDAY)).toBe("2026-08-31");
  });

  test("a Sunday start begins the week on Sunday", () => {
    expect(getWeekStart(at("2026-09-02"), SUNDAY)).toBe("2026-08-30");
    expect(getWeekStart(at("2026-08-30"), SUNDAY)).toBe("2026-08-30");
    // The reporter's example: Sunday 6 September starts its own week.
    expect(getWeekStart(at("2026-09-06"), SUNDAY)).toBe("2026-09-06");
    expect(getWeekStart(at("2026-09-12"), SUNDAY)).toBe("2026-09-06");
  });

  test("it crosses a month and a year boundary", () => {
    expect(getWeekStart(at("2026-03-01"), MONDAY)).toBe("2026-02-23");
    expect(getWeekStart(at("2026-01-01"), SUNDAY)).toBe("2025-12-28");
    // A leap day, on both settings.
    expect(getWeekStart(at("2028-02-29"), MONDAY)).toBe("2028-02-28");
    expect(getWeekStart(at("2028-02-29"), SUNDAY)).toBe("2028-02-27");
  });

  test("every day of a week maps to the same start, on both settings", () => {
    for (const start of [SUNDAY, MONDAY] as const) {
      const anchor = getWeekStart(at("2026-09-09"), start);
      for (const date of getWeekDates(anchor)) {
        expect(getWeekStart(at(date), start), `${date} on start=${start}`).toBe(anchor);
      }
    }
  });

  test("the seven dates it yields begin on the requested day", () => {
    const sunday = getWeekDates(getWeekStart(at("2026-09-09"), SUNDAY));
    expect(sunday).toHaveLength(7);
    expect(new Date(`${sunday[0]}T12:00:00`).getDay()).toBe(0);
    expect(new Date(`${sunday[6]}T12:00:00`).getDay()).toBe(6);

    const monday = getWeekDates(getWeekStart(at("2026-09-09"), MONDAY));
    expect(new Date(`${monday[0]}T12:00:00`).getDay()).toBe(1);
    expect(new Date(`${monday[6]}T12:00:00`).getDay()).toBe(0);
  });
});

test.describe("nothing can be stranded by the key", () => {
  const hook = readFileSync("src/hooks/use-meal-planner.ts", "utf8");

  test("a week's entries are fetched by date, not by plan row", () => {
    /*
      This is the guard that makes the setting safe to change twice.

      `week_start` follows the setting, so flipping it moves the week
      boundaries. Fetching a week's entries by `meal_plan_id` would then return
      part of a week: the visible Sunday-to-Saturday span covers two
      Monday-keyed plans. Six days of a family's meals would disappear from the
      grid while sitting untouched in the table — the failure mode that reads
      as data loss and is not.
    */
    expect(
      hook,
      "useMealPlan fetches a week's entries by meal_plan_id again, so changing " +
        "the week-start setting hides entries that are still in the table",
    ).not.toMatch(/\.eq\("meal_plan_id", mealPlan\.id\)/);
    expect(hook, "entries should be bounded by the week's dates").toMatch(
      /\.gte\("date", weekDates\[0\]\)[\s\S]*\.lte\("date", weekDates\[6\]\)/,
    );
    // meal_plan_entries has no family_id, so the join is what scopes the query.
    expect(hook, "the date-range query must stay scoped to this family").toMatch(
      /meal_plans!inner\(family_id\)/,
    );
  });

  test("no caller can fall back to Monday by omission", () => {
    expect(
      hook,
      "getWeekStart must not default weekStartsOn — a default is how three call " +
        "sites silently kept Monday",
    ).toMatch(/getWeekStart\(date: Date, weekStartsOn: WeekStartsOn\)/);
  });
});

test.describe("the migration", () => {
  const sql = readFileSync("docker/migration_zzzz_meal_plan_week_start.sql", "utf8");
  /*
    The statements alone, with `--` comments dropped.

    Most of this file is the reasoning behind it, and that prose necessarily
    names the things it is explaining it no longer does. Asserting against the
    whole file makes the explanation fail the test — which already happened once
    to the #198 guard in time-format.spec.ts.
  */
  const statements = sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

  test("it re-partitions by each entry's own date", () => {
    // Not a rename: one Monday week's entries can land in two Sunday weeks.
    expect(sql).toMatch(/EXTRACT\(DOW FROM e\.date\)/);
    expect(sql).toMatch(/ON CONFLICT \(family_id, week_start\) DO NOTHING/);
  });

  test("it is safe to run twice", () => {
    // start.sh migrate is run twice here by design, and the webapp entrypoint
    // runs the same files again on boot.
    expect(sql, "the move must be a no-op once an entry is already in place").toMatch(
      /AND e\.meal_plan_id <> mp\.id/,
    );
  });

  test("it only touches families that have explicitly chosen Sunday", () => {
    /*
      It must not infer the week start from the locale.

      `useWeekStart` reads next-intl's `useLocale()`, which comes from the
      locale cookie or Accept-Language — per device, never the settings table.
      The settings locale row is written only on an explicit language choice and
      read only by the notification routes. An earlier version resolved
      "locale" here and defaulted to 'en', which put a German household with no
      rows — the shape of the production box, 1 family and 34 plans — fully in
      scope for a re-key it never asked for.

      It is safe to skip them because entries are fetched by date, so a week
      renders correctly however its rows are keyed. Tidying, not repair.
    */
    expect(
      statements,
      "the migration infers a week start from the locale again; the app does not " +
        "take its locale from the settings table, so this guesses",
    ).not.toMatch(/'locale'/);
    expect(statements).toMatch(/ws\.key = 'week_start' AND \(ws\.value #>> '\{\}'\) = 'sunday'/);
  });

  test("it does not throw away a household's notes", () => {
    expect(sql).toMatch(/COALESCE\(mp\.notes, ''\) = ''/);
  });
});
