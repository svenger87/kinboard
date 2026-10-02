import { test, expect } from "@playwright/test";
import { publicHolidayBreaks } from "../src/lib/holidays/school";
import type { Holiday } from "../src/lib/holidays";

/** RFC-014 §6.3: a day off, a substitute day or a date-holidays `school` day means no school -- except in the US. */

const name = (h: Holiday) => h.name ?? h.nameKey;
const days = (region: string, from: string, to: string) =>
  publicHolidayBreaks(region, from, to, "en", name).map((b) => `${b.startsOn} ${b.name}`);

test("a day off in the family's region is a one-day break", () => {
  expect(publicHolidayBreaks("DE-NI", "2026-12-24", "2026-12-27", "en", name)).toEqual([
    { name: "Christmas Day", startsOn: "2026-12-25", endsOn: "2026-12-25", source: "public_holiday" },
    { name: "Boxing Day", startsOn: "2026-12-26", endsOn: "2026-12-26", source: "public_holiday" },
  ]);
});

test("a marked day that is worked is a school day", () => {
  // Christmas Eve is `bank` in Germany: marked, not off, school as usual.
  expect(days("DE-NI", "2026-12-24", "2026-12-24")).toEqual([]);
});

test("the weekday a day off is taken is no school either", () => {
  // Christmas 2027 is a Saturday and Boxing Day a Sunday: off on Monday 27th and Tuesday 28th.
  expect(days("GB-ENG", "2027-12-27", "2027-12-28")).toEqual(["2027-12-27 Christmas Day", "2027-12-28 Boxing Day"]);
});

test("a date-holidays school day closes school even when it is not a day off", () => {
  expect(days("NL", "2026-04-03", "2026-04-03")).toEqual(["2026-04-03 Good Friday"]);
  expect(days("NL", "2026-05-05", "2026-05-05")).toEqual(["2026-05-05 Liberation Day"]);
  expect(days("DE-BY", "2026-11-18", "2026-11-18")).toEqual(["2026-11-18 Day of Prayer and Repentance"]);
  expect(days("DE-NI", "2026-11-18", "2026-11-18")).toEqual([]);
});

test("one break per day, even when a day is both off and a school day", () => {
  // Liberation Day 2030: a lustrum, so a day off by override, and `school` upstream.
  expect(days("NL", "2030-05-05", "2030-05-05")).toEqual(["2030-05-05 Liberation Day"]);
});

test("not in the US, where districts set their own school calendars", () => {
  expect(days("US", "2026-10-01", "2026-12-31")).toEqual([]);
  expect(days("US-CA", "2026-10-01", "2026-12-31")).toEqual([]);
});

test("no region, no breaks", () => {
  expect(days("XX", "2026-01-01", "2026-12-31")).toEqual([]);
});
