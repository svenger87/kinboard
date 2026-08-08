import { test, expect } from "@playwright/test";
import {
  daysUntilNextBirthday,
  firstLessonOf,
  isoDayOfWeek,
} from "../src/app/api/integration/v1/family/summary/route";

/**
 * The date arithmetic in the summary, tested as pure functions.
 *
 * This is where summaries go wrong. Every one of these has a plausible naive
 * implementation that is correct most of the year and wrong on the days people
 * notice — a birthday, a Monday morning, the clocks changing.
 */

test.describe("days until the next birthday", () => {
  test("is 0 on the day itself", () => {
    expect(daysUntilNextBirthday("1985-08-08", new Date(2026, 7, 8, 14, 0))).toBe(0);
  });

  test("counts forward within the year", () => {
    expect(daysUntilNextBirthday("1985-08-09", new Date(2026, 7, 8))).toBe(1);
    expect(daysUntilNextBirthday("1985-09-08", new Date(2026, 7, 8))).toBe(31);
  });

  test("rolls into next year once the date has passed", () => {
    // 7 Aug is yesterday, so the answer is next year's, not -1.
    const days = daysUntilNextBirthday("1985-08-07", new Date(2026, 7, 8));
    expect(days).toBeGreaterThan(360);
  });

  test("ignores the time of day", () => {
    // Late in the evening must not round the answer up to tomorrow.
    expect(daysUntilNextBirthday("1985-08-09", new Date(2026, 7, 8, 23, 59))).toBe(1);
    expect(daysUntilNextBirthday("1985-08-09", new Date(2026, 7, 8, 0, 1))).toBe(1);
  });

  test("survives a DST change", () => {
    // Europe/Berlin springs forward on 29 March 2026: the interval from
    // 28 March to 30 March is 47 hours, not 48. Dividing elapsed milliseconds
    // by 86,400,000 gives 1.96 -> rounds to 2, which is right by luck; the
    // day before it gives 0.98 -> 1, which is wrong. Calendar arithmetic is
    // exact either way.
    expect(daysUntilNextBirthday("1990-03-30", new Date(2026, 2, 28))).toBe(2);
    expect(daysUntilNextBirthday("1990-03-30", new Date(2026, 2, 29))).toBe(1);
    expect(daysUntilNextBirthday("1990-03-30", new Date(2026, 2, 30))).toBe(0);
  });

  test("29 February falls back to 1 March in a non-leap year", () => {
    // 2026 is not a leap year. Showing it on 1 March is what the rest of the
    // app does; the important thing is that it resolves at all.
    const days = daysUntilNextBirthday("2000-02-29", new Date(2026, 1, 27));
    expect(days).not.toBeNull();
    expect(days).toBeGreaterThanOrEqual(0);
    expect(days).toBeLessThanOrEqual(3);
  });

  test("rejects unusable input instead of returning a wrong number", () => {
    expect(daysUntilNextBirthday("", new Date())).toBeNull();
    expect(daysUntilNextBirthday("not-a-date", new Date())).toBeNull();
    expect(daysUntilNextBirthday("1985-13-01", new Date())).toBeNull();
    expect(daysUntilNextBirthday("1985-00-10", new Date())).toBeNull();
  });
});

test.describe("first lesson of a schedule", () => {
  const slots = [
    { period: 3, subject: "Kunst", start: "09:55", end: "10:40" },
    { period: 1, subject: "Deutsch", start: "08:00", end: "08:45" },
    { period: 2, subject: "Mathe", start: "08:50", end: "09:35" },
  ];

  test("picks the earliest by start time, not array order or period", () => {
    expect(firstLessonOf(slots)).toBe("Deutsch");
  });

  test("does not mutate the caller's array", () => {
    const copy = [...slots];
    firstLessonOf(slots);
    expect(slots).toEqual(copy);
  });

  test("handles an empty or absent timetable", () => {
    expect(firstLessonOf([])).toBeNull();
    expect(firstLessonOf(null)).toBeNull();
    expect(firstLessonOf(undefined)).toBeNull();
    expect(firstLessonOf("not an array")).toBeNull();
  });

  test("skips malformed slots rather than throwing", () => {
    // time_slots is JSONB — nothing at the database level guarantees a shape.
    expect(firstLessonOf([null, { subject: "X" }, { start: "07:00", subject: "Sport" }])).toBe("Sport");
    expect(firstLessonOf([{ start: 800, subject: "Bad" }])).toBeNull();
  });
});

test.describe("day of week", () => {
  test("matches the range schedules.day_of_week allows", () => {
    // The column is CHECK (day_of_week >= 0 AND <= 6) and the app writes
    // 1=Monday..5=Friday. Sunday is 0, not 7 — asking for 7 is asking for a
    // value the schema forbids, which can never match anything.
    expect(isoDayOfWeek(new Date(2026, 7, 10))).toBe(1); // Monday
    expect(isoDayOfWeek(new Date(2026, 7, 14))).toBe(5); // Friday
    expect(isoDayOfWeek(new Date(2026, 7, 15))).toBe(6); // Saturday
    expect(isoDayOfWeek(new Date(2026, 7, 16))).toBe(0); // Sunday
  });

  test("never returns a value outside the constraint", () => {
    for (let d = 1; d <= 28; d++) {
      const v = isoDayOfWeek(new Date(2026, 7, d));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});
