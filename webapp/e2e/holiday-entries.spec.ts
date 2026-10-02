import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getHolidays, getObservances } from "../src/lib/holidays";
import {
  entryCoversDay,
  entryListDay,
  holidayEntries,
  normalizeHolidayName,
  publicHolidayEntries,
  schoolHolidayEntries,
  withoutDuplicateHolidays,
  type HolidayEntryInput,
  type SchoolHolidayRowLike,
} from "../src/lib/holiday-entries";
import { toLocalDateKey } from "../src/lib/local-date";
import { codeOnly } from "./source-helpers";

/**
 * Holidays in the event lists (the Events widget, the week overview, the
 * screensaver): the rules behind useHolidayEntries, on fixed dates. Lower
 * Saxony's autumn 2026 has the cases worth having -- Tag der Deutschen
 * Einheit on a Saturday, Reformationstag, Christmas Eve marked but worked,
 * and Herbstferien from 12 to 24 October.
 */

const label = (h: { nameKey: string; name?: string }) => h.name ?? h.nameKey;

const herbstferien: SchoolHolidayRowLike = {
  id: "row-herbst",
  name: "Herbstferien",
  starts_on: "2026-10-12",
  ends_on: "2026-10-24",
  hidden: false,
};

const base: HolidayEntryInput = {
  showHolidays: true,
  region: "DE-NI",
  schoolRows: [herbstferien],
  fromKey: "2026-10-01",
  toKey: "2026-10-31",
  locale: "de",
  label,
};

test("public holidays in the range, days off only, named in the locale", () => {
  const entries = publicHolidayEntries("DE-NI", "2026-10-01", "2026-12-31", "de", label);
  expect(entries.map((e) => [e.startKey, e.title])).toEqual([
    ["2026-10-03", "Tag der Deutschen Einheit"],
    ["2026-10-31", "Reformationstag"],
    ["2026-12-25", "1. Weihnachtstag"],
    ["2026-12-26", "2. Weihnachtstag"],
  ]);
  // The calendar dots Christmas Eve and New Year's Eve; nobody has them off.
  const marked = getHolidays("DE-NI", 2026, "de").filter((h) => !h.dayOff).map((h) => toLocalDateKey(h.date));
  expect(marked).toContain("2026-12-24");
  for (const key of marked) expect(entries.map((e) => e.startKey)).not.toContain(key);
  for (const e of entries) {
    expect(e.kind).toBe("public");
    expect(e.endKey).toBe(e.startKey);
    expect(e.id).toBe(`holiday:public:${e.startKey}`);
  }
});

test("the same holidays in French for a French family, and none outside the range", () => {
  const fr = publicHolidayEntries("FR", "2026-11-01", "2026-11-30", "fr", label);
  expect(fr.map((e) => [e.startKey, e.title])).toEqual([
    ["2026-11-01", "Toussaint"],
    ["2026-11-11", "Armistice 1918"],
  ]);
  expect(publicHolidayEntries("FR", "2026-11-02", "2026-11-10", "fr", label)).toEqual([]);
});

test("observances are not listed", () => {
  const observances = getObservances("US-CA", 2026, "en");
  // Guard the guard: a region without observances would make this vacuous.
  expect(observances.length).toBeGreaterThan(0);
  const keys = new Set(
    publicHolidayEntries("US-CA", "2026-01-01", "2026-12-31", "en", label).map((e) => `${e.startKey}|${e.title}`),
  );
  for (const o of observances) expect(keys.has(`${toLocalDateKey(o.date)}|${label(o)}`)).toBe(false);
});

test("a range across New Year reads both years", () => {
  const entries = publicHolidayEntries("DE-NI", "2026-12-30", "2027-01-02", "de", label);
  expect(entries.map((e) => e.startKey)).toEqual(["2027-01-01"]);
});

test("a school break is one entry over all its days, overlapping the range at either end", () => {
  // Starts before the range and ends inside it.
  const [inside] = schoolHolidayEntries([herbstferien], "2026-10-20", "2026-10-27");
  expect(inside).toMatchObject({ kind: "school", title: "Herbstferien", startKey: "2026-10-12", endKey: "2026-10-24" });
  expect(inside.id).toBe("holiday:school:row-herbst");
  // Starts inside and runs past it.
  expect(schoolHolidayEntries([herbstferien], "2026-10-05", "2026-10-12")).toHaveLength(1);
  // Covers the whole range.
  expect(schoolHolidayEntries([herbstferien], "2026-10-14", "2026-10-15")).toHaveLength(1);
  // Ends the day before; starts the day after.
  expect(schoolHolidayEntries([herbstferien], "2026-10-25", "2026-10-31")).toEqual([]);
  expect(schoolHolidayEntries([herbstferien], "2026-10-01", "2026-10-11")).toEqual([]);

  expect(entryCoversDay(inside, "2026-10-11")).toBe(false);
  expect(entryCoversDay(inside, "2026-10-12")).toBe(true);
  expect(entryCoversDay(inside, "2026-10-24")).toBe(true);
  expect(entryCoversDay(inside, "2026-10-25")).toBe(false);
  // Under way, it is filed under today; ahead, under its first day.
  expect(toLocalDateKey(entryListDay(inside, "2026-10-20"))).toBe("2026-10-20");
  expect(toLocalDateKey(entryListDay(inside, "2026-10-01"))).toBe("2026-10-12");
});

test("a hidden row is never listed", () => {
  const hidden = { ...herbstferien, id: "row-hidden", name: "Brückentag", starts_on: "2026-10-02", ends_on: "2026-10-02", hidden: true };
  const entries = schoolHolidayEntries([herbstferien, hidden], "2026-10-01", "2026-10-31");
  expect(entries.map((e) => e.title)).toEqual(["Herbstferien"]);
  expect(holidayEntries({ ...base, schoolRows: [hidden] }).filter((e) => e.kind === "school")).toEqual([]);
});

test("the same break typed in and synced is listed once", () => {
  const synced = { ...herbstferien, id: "row-synced", name: "herbstferien " };
  expect(schoolHolidayEntries([herbstferien, synced], "2026-10-01", "2026-10-31")).toHaveLength(1);
  // Same name, other days: two breaks.
  const other = { ...herbstferien, id: "row-other", starts_on: "2027-10-11", ends_on: "2027-10-23" };
  expect(schoolHolidayEntries([herbstferien, other], "2026-10-01", "2027-12-31")).toHaveLength(2);
});

test("with the switch off there is nothing, whatever the region and rows", () => {
  expect(holidayEntries(base).length).toBeGreaterThan(0);
  expect(holidayEntries({ ...base, showHolidays: false })).toEqual([]);
});

test("no region: school breaks only; sorted by first day, public first on a tie", () => {
  expect(holidayEntries({ ...base, region: null }).map((e) => e.kind)).toEqual(["school"]);
  const sameDay = { ...herbstferien, id: "row-3", name: "Brückentag", starts_on: "2026-10-03", ends_on: "2026-10-03" };
  const entries = holidayEntries({ ...base, schoolRows: [herbstferien, sameDay] });
  expect(entries.map((e) => `${e.startKey}:${e.kind}`)).toEqual([
    "2026-10-03:public",
    "2026-10-03:school",
    "2026-10-12:school",
    "2026-10-31:public",
  ]);
});

test("a holiday calendar's event that day wins over the built-in holiday, whatever it is called", () => {
  const entries = holidayEntries(base);
  const events = [
    // Google's name for it differs; the day is what counts.
    { title: "Tag d. Dt. Einheit", start_at: new Date(2026, 9, 3).toISOString(), all_day: true, calendar: { is_holidays: true } },
  ];
  const kept = withoutDuplicateHolidays(entries, events);
  expect(kept.map((e) => e.startKey)).not.toContain("2026-10-03");
  expect(kept.map((e) => e.title)).toEqual(["Herbstferien", "Reformationstag"]);
  // An ordinary calendar's event on that day does not hide it.
  const ordinary = [{ ...events[0], calendar: { is_holidays: false } }];
  expect(withoutDuplicateHolidays(entries, ordinary)).toEqual(entries);
});

test("any event with the same name on the first day drops the entry; a different name does not", () => {
  const entries = holidayEntries(base);
  const feed = [{ title: "HERBSTFERIEN", start_at: new Date(2026, 9, 12).toISOString(), all_day: true, calendar: { is_holidays: false } }];
  expect(withoutDuplicateHolidays(entries, feed).map((e) => e.title)).not.toContain("Herbstferien");
  const other = [{ ...feed[0], title: "Herbstferien Niedersachsen 2026" }];
  expect(withoutDuplicateHolidays(entries, other).map((e) => e.title)).toContain("Herbstferien");
  // A school-holiday calendar marked is_holidays does not hide a public holiday on another day.
  const school = [{ ...feed[0], calendar: { is_holidays: true } }];
  expect(withoutDuplicateHolidays(entries, school).map((e) => e.title)).toContain("Tag der Deutschen Einheit");
  expect(withoutDuplicateHolidays(entries, null)).toEqual(entries);
});

test("names compare without case, accents or punctuation", () => {
  expect(normalizeHolidayName("Fête nationale")).toBe(normalizeHolidayName("fete-nationale"));
  expect(normalizeHolidayName("Tag der Deutschen Einheit")).toBe(normalizeHolidayName("tag der deutschen einheit."));
  expect(normalizeHolidayName("1. Weihnachtstag")).not.toBe(normalizeHolidayName("Erster Weihnachtstag"));
});

// ---------------------------------------------------------------------------
// The wiring, read from source: what a lib spec cannot see.

const read = (p: string) => codeOnly(readFileSync(join(__dirname, "..", p), "utf8"));

test("the hook is behind calendar_display.showHolidays and fetches school rows only when it is on", () => {
  const hook = read("src/hooks/use-holiday-entries.ts");
  expect(hook).toContain("SETTINGS_KEYS.calendarDisplay");
  expect(hook).toMatch(/const showHolidays = calendarDisplay\?\.showHolidays \?\? false;/);
  expect(hook).toMatch(/useSchoolHolidays\(\{\s*enabled: showHolidays,/);
  expect(hook).toMatch(/holidayEntries\(\{\s*showHolidays,/);
  expect(hook).toContain("useHolidayRegion()");
  expect(hook).toContain("withoutDuplicateHolidays(");
});

test("the Events widget, the week overview and the screensaver use the hook with their events", () => {
  for (const file of [
    "src/components/widgets/upcoming-events.tsx",
    "src/components/widgets/week-overview-widget.tsx",
    "src/components/screensaver.tsx",
  ]) {
    expect(read(file), file).toMatch(/useHolidayEntries\([^;]*, events\);/);
  }
});

test("a settings change for the sync or the region refetches the school holidays on open screens", () => {
  const realtime = read("src/hooks/use-realtime.ts");
  const settingsCase = /case "settings": \{([\s\S]*?)break;\s*\}/.exec(realtime);
  expect(settingsCase).not.toBeNull();
  expect(settingsCase![1]).toContain("queryKeys.schoolHolidays(family.id)");
  expect(settingsCase![1]).toContain("SETTINGS_KEYS.schoolHolidaySync");
  expect(settingsCase![1]).toContain("SETTINGS_KEYS.holidayRegion");
});
