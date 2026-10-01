import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  ATTENTION_COLUMNS,
  ATTENTION_ITEMS_MAX,
  daysUntilNextBirthday,
  summariseAttention,
} from "../src/app/api/integration/v1/family/summary/route";
import { dayOfWeekOf, normalizeSlots } from "../src/lib/school-days";

/** The sensor's first_lesson: the first of the normalised, time-ordered slots. */
const firstLessonOf = (slots: unknown) => normalizeSlots(slots)[0]?.subject ?? null;

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
    // A slot without a usable start time sorts after the timed ones.
    expect(firstLessonOf([null, { subject: "X" }, { start: "07:00", subject: "Sport" }])).toBe("Sport");
    expect(firstLessonOf([{ start: 800, subject: "Bad" }, { start: "09:00", subject: "Good" }])).toBe("Good");
  });
});

test.describe("day of week", () => {
  test("matches the range schedules.day_of_week allows", () => {
    // The column is CHECK (day_of_week >= 0 AND <= 6) and the app writes
    // 1=Monday..5=Friday. Sunday is 0, not 7 — asking for 7 is asking for a
    // value the schema forbids, which can never match anything.
    expect(dayOfWeekOf("2026-08-10")).toBe(1); // Monday
    expect(dayOfWeekOf("2026-08-14")).toBe(5); // Friday
    expect(dayOfWeekOf("2026-08-15")).toBe(6); // Saturday
    expect(dayOfWeekOf("2026-08-16")).toBe(0); // Sunday
  });

  test("never returns a value outside the constraint", () => {
    for (let d = 1; d <= 28; d++) {
      const v = dayOfWeekOf(`2026-08-${String(d).padStart(2, "0")}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

test.describe("attention says which item to dismiss", () => {
  const rows = [
    { item_key: "lock-up-before-bed:2026-10-01", title: "Lock up", priority: 10 },
    { item_key: "bins-out:2026-10-02", title: "Bins out", priority: 50 },
  ];

  test("top_key is the key of the item top names", () => {
    const summary = summariseAttention(rows);
    expect(summary.top).toBe("Lock up");
    expect(summary.top_key).toBe("lock-up-before-bed:2026-10-01");
    expect(summary.count).toBe(2);
  });

  test("items keep the query's order and carry key, title and priority", () => {
    expect(summariseAttention(rows).items).toEqual([
      { key: "lock-up-before-bed:2026-10-01", title: "Lock up", priority: 10 },
      { key: "bins-out:2026-10-02", title: "Bins out", priority: 50 },
    ]);
  });

  test("the original fields are unchanged and nothing is null-padded", () => {
    expect(summariseAttention([])).toEqual({ count: 0, top: null, top_key: null, items: [] });
  });

  test("items are capped at ten", () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      item_key: `rule:${i}`, title: `Item ${i}`, priority: i,
    }));
    const summary = summariseAttention(many);
    expect(ATTENTION_ITEMS_MAX).toBe(10);
    expect(summary.items).toHaveLength(10);
    expect(summary.items[0].key).toBe(summary.top_key);
  });

  test("the key is read in the same query as the title", () => {
    // No second round trip: the key comes from the one attention_items select.
    expect(ATTENTION_COLUMNS.split(",").map((c) => c.trim())).toEqual(
      expect.arrayContaining(["item_key", "title", "priority"]),
    );
  });

  test("the OpenAPI schema documents top_key and items", () => {
    const spec = yaml.load(
      readFileSync(join(__dirname, "..", "openapi", "integration-v1.yaml"), "utf8"),
    ) as { components: { schemas: Record<string, { properties: Record<string, any> }> } };
    const attention = spec.components.schemas.FamilySummary.properties.attention;
    expect(Object.keys(attention.properties).sort()).toEqual(["count", "items", "top", "top_key"]);
    expect(Object.keys(attention.properties.items.items.properties).sort()).toEqual([
      "key", "priority", "title",
    ]);
  });
});
