import { test, expect } from "@playwright/test";
import { toLocalDateKey, todayKey } from "../src/lib/local-date";

/**
 * `toISOString().split("T")[0]` reads as "today" and returns the UTC day.
 * East of Greenwich that is wrong every night between local midnight and
 * the offset — and it was being used for whether a task is overdue, which
 * day the meal planner highlights, and what date "move to tomorrow"
 * writes.
 *
 * These construct Dates with local components on purpose: the whole point
 * is that the local calendar day and the UTC one disagree.
 */

test.describe("toLocalDateKey", () => {
  test("names the local day, not the UTC one", () => {
    // 00:30 local. In any zone east of UTC this instant is still the
    // previous day in UTC, which is exactly the window that was broken.
    const justAfterMidnight = new Date(2026, 7, 5, 0, 30);
    expect(toLocalDateKey(justAfterMidnight)).toBe("2026-08-05");
  });

  test("late evening stays on its own day", () => {
    // The mirror case: west of UTC, 23:30 local is already tomorrow in UTC.
    expect(toLocalDateKey(new Date(2026, 7, 4, 23, 30))).toBe("2026-08-04");
  });

  test("pads month and day", () => {
    expect(toLocalDateKey(new Date(2026, 0, 3))).toBe("2026-01-03");
    expect(toLocalDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  test("handles a leap day", () => {
    expect(toLocalDateKey(new Date(2028, 1, 29))).toBe("2028-02-29");
  });

  test("todayKey agrees with formatting the current date", () => {
    expect(todayKey()).toBe(toLocalDateKey(new Date()));
  });
});

test.describe("the bugs this fixes", () => {
  test('"move to tomorrow" advances by exactly one day', () => {
    // The old code did `tomorrow.toISOString().split("T")[0]`, which for a
    // local-midnight Date in a positive offset returned the SAME day — so
    // the meal never moved.
    const current = new Date(2026, 7, 4); // local midnight
    const tomorrow = new Date(current);
    tomorrow.setDate(tomorrow.getDate() + 1);

    expect(toLocalDateKey(tomorrow)).toBe("2026-08-05");
    expect(toLocalDateKey(tomorrow)).not.toBe(toLocalDateKey(current));
  });

  test("a task due today is due today, just after midnight", () => {
    const now = new Date(2026, 7, 5, 0, 30);
    const dueDate = "2026-08-05";
    expect(dueDate === toLocalDateKey(now)).toBe(true);
    // And yesterday's task is overdue rather than looking current.
    expect("2026-08-04" < toLocalDateKey(now)).toBe(true);
  });

  test("month and year boundaries", () => {
    expect(toLocalDateKey(new Date(2027, 0, 1, 0, 15))).toBe("2027-01-01");
    expect(toLocalDateKey(new Date(2026, 8, 1, 0, 5))).toBe("2026-09-01");
  });
});
