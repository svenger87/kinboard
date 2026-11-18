import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { lessonsForScreensaver } from "../src/lib/screensaver-lessons";
import { DEFAULT_PACK_ITEMS } from "../src/lib/schedule-pack-items";

/**
 * #282 (comment 19703223): the children's lessons on the screensaver, so a
 * family sees at a glance that today is a PE day and the sports kit has to go
 * in the bag. Which day it shows follows the schedule widget: today, and from
 * the widget's "next school day from" time in the evening the next school day.
 */

const people = [
  { id: "mia", name: "Mia", is_child: true, color: "#a855f7" },
  { id: "ben", name: "Ben", is_child: true, color: "#22c55e" },
  { id: "mum", name: "Mum", is_child: false, color: null },
];
const slot = (period: number, subject: string) => ({ period, start: "08:00", end: "08:45", subject });
// 2026-11-18 is a Wednesday (day_of_week 3).
const schedules = [
  { person_id: "mia", day_of_week: 3, time_slots: [slot(1, "Deutsch"), slot(2, "Sport"), slot(3, "Sport"), slot(4, "Mathe")] },
  { person_id: "mia", day_of_week: 4, time_slots: [slot(1, "Schwimmen (Halle)")] },
  { person_id: "ben", day_of_week: 4, time_slots: [slot(1, "Kunst")] },
  { person_id: "ben", day_of_week: 3, time_slots: [] },
];
const base = { people, schedules, breaks: [], packItems: DEFAULT_PACK_ITEMS, todayKey: "2026-11-18", tomorrowFrom: "off" as const };

test("today: each child with lessons, subjects once each in order, and what to bring", () => {
  const r = lessonsForScreensaver({ ...base, nowTime: "07:00" })!;
  expect(r.day).toBe("2026-11-18");
  expect(r.when).toBe("today");
  expect(r.rows).toEqual([
    { personId: "mia", name: "Mia", color: "#a855f7", subjects: ["Deutsch", "Sport", "Mathe"], bring: ["Sportkleidung", "Turnschuhe", "Trinkflasche"] },
  ]);
});

test("a child whose day was emptied, and grown-ups, are left out", () => {
  const r = lessonsForScreensaver({ ...base, nowTime: "07:00" })!;
  expect(r.rows.map((x) => x.personId)).toEqual(["mia"]);
});

test("from the evening time on, the next school day, labelled tomorrow", () => {
  const r = lessonsForScreensaver({ ...base, tomorrowFrom: "17:00", nowTime: "18:30" })!;
  expect(r.day).toBe("2026-11-19");
  expect(r.when).toBe("tomorrow");
  expect(r.rows.map((x) => [x.personId, x.subjects, x.bring])).toEqual([
    ["mia", ["Schwimmen (Halle)"], ["Badeanzug/Badehose", "Handtuch", "Schwimmbrille", "Badekappe"]],
    ["ben", ["Kunst"], ["Malkittel", "Pinsel & Farben"]],
  ]);
});

test("a day off with no evening preview shows nothing", () => {
  // Saturday.
  expect(lessonsForScreensaver({ ...base, todayKey: "2026-11-21", nowTime: "09:00" })).toBeNull();
});

test("Friday evening looks past the weekend, and says which day", () => {
  const friday = [{ person_id: "mia", day_of_week: 1, time_slots: [slot(1, "Sport")] }];
  const r = lessonsForScreensaver({ ...base, schedules: friday, todayKey: "2026-11-20", tomorrowFrom: "17:00", nowTime: "19:00" })!;
  expect(r.day).toBe("2026-11-23");
  expect(r.when).toBe("later");
});

test("a holiday is no school, even with a timetable for the weekday", () => {
  const breaks = [{ name: "Buß- und Bettag", startsOn: "2026-11-18", endsOn: "2026-11-18" }];
  expect(lessonsForScreensaver({ ...base, breaks: breaks as never, nowTime: "07:00" })).toBeNull();
});

test("the screensaver shows it only when switched on, in the stack with the events", () => {
  const src = readFileSync("src/components/screensaver.tsx", "utf8");
  expect(src).toContain("{showLessons && <ScreensaverLessons large={largeDetails} />}");
  const types = readFileSync("src/types/screensaver.ts", "utf8");
  expect(types).toMatch(/showLessons: false/);
});
