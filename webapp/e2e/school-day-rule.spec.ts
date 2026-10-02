import { test, expect } from "@playwright/test";
import {
  holidayCalendarBreaks,
  isSchoolDay,
  nextSchoolDay,
  schoolBreaks,
  schoolDayStatusOn,
  type SchoolBreakInputs,
} from "../src/lib/school-day-rule";
import { schoolDayStatus, type SchoolDb } from "../src/lib/school-days";
import { addDays } from "../src/lib/local-date";
import type { Holiday } from "../src/lib/holidays";
import { holidayLabel } from "../src/lib/holidays/label";
import en from "../messages/en.json";

/**
 * #330: "is there school on day X" as one pure rule, run by the server
 * (school tomorrow, /schedule, MCP) and by the timetable widget in the
 * browser. The widget used to decide by weekday alone, so it showed lessons
 * on a public holiday and previewed them for the first day of a break.
 */

const TZ = "Europe/Berlin";
const name = (h: Holiday) => h.name ?? h.nameKey;

function inputs(over: Partial<SchoolBreakInputs> = {}): SchoolBreakInputs {
  return { region: "DE-NI", schoolHolidays: [], holidayCalendarDays: [], locale: "en", label: name, ...over };
}
const status = (day: string, over: Partial<SchoolBreakInputs> = {}) =>
  schoolDayStatusOn(day, schoolBreaks(inputs(over), addDays(day, -1), addDays(day, 1)));

test.describe("one day", () => {
  test("a weekday public holiday in the family's region is no school day, and named", () => {
    // Friday 1 May 2026, Labour Day.
    expect(status("2026-05-01")).toEqual({
      date: "2026-05-01", weekday: "friday", school_day: false, reason: "holiday", holiday: "Labour Day",
    });
    expect(status("2026-04-30").school_day).toBe(true);
  });

  test("a day in a school break is no school day, and named after the break", () => {
    const rows = [{ name: "Herbstferien", starts_on: "2026-10-12", ends_on: "2026-10-23", source: "manual" }];
    expect(status("2026-10-14", { schoolHolidays: rows })).toMatchObject({ school_day: false, reason: "holiday", holiday: "Herbstferien" });
    expect(status("2026-10-26", { schoolHolidays: rows }).school_day).toBe(true);
  });

  test("the school break names a day that is a public holiday too", () => {
    const rows = [{ name: "Weihnachtsferien", starts_on: "2026-12-23", ends_on: "2027-01-09", source: "openholidays" }];
    expect(status("2026-12-25", { schoolHolidays: rows }).holiday).toBe("Weihnachtsferien");
  });

  test("a hidden synced break is no break", () => {
    const rows = [{ name: "Versteckt", starts_on: "2026-10-14", ends_on: "2026-10-14", source: "openholidays", hidden: true }];
    expect(status("2026-10-14", { schoolHolidays: rows }).school_day).toBe(true);
  });

  test("an event on a holiday calendar closes school on the local days it covers", () => {
    // Stored the way Google sync stores an all-day event: 12:00 UTC of the
    // first and the (inclusive) last day.
    const google = holidayCalendarBreaks(
      [{ title: "Brückentag", start_at: "2026-11-02T12:00:00Z", end_at: "2026-11-02T12:00:00Z" }],
      TZ,
    );
    expect(google).toEqual([{ name: "Brückentag", startsOn: "2026-11-02", endsOn: "2026-11-02", source: "calendar" }]);
    expect(status("2026-11-02", { holidayCalendarDays: google })).toMatchObject({ school_day: false, holiday: "Brückentag" });
    expect(status("2026-11-03", { holidayCalendarDays: google }).school_day).toBe(true);

    // Local midnight in Berlin is the day before in UTC: still Monday 2 November here.
    const local = holidayCalendarBreaks(
      [{ title: "Studientag", start_at: "2026-11-01T23:00:00Z", end_at: "2026-11-02T22:59:59.999Z" }],
      TZ,
    );
    expect(local[0]).toMatchObject({ startsOn: "2026-11-02", endsOn: "2026-11-02" });
  });

  test("a weekend is no school day, and a break says which break it is", () => {
    expect(status("2026-10-10")).toMatchObject({ school_day: false, reason: "weekend", holiday: null });
    const rows = [{ name: "Herbstferien", starts_on: "2026-10-05", ends_on: "2026-10-16" }];
    expect(status("2026-10-10", { schoolHolidays: rows })).toMatchObject({ reason: "holiday", holiday: "Herbstferien" });
  });

  test("a US family keeps school on federal holidays, but not in its own breaks", () => {
    // Thursday 26 November 2026, Thanksgiving.
    expect(status("2026-11-26", { region: "US-CA" }).school_day).toBe(true);
    const rows = [{ name: "Thanksgiving break", starts_on: "2026-11-25", ends_on: "2026-11-27" }];
    expect(status("2026-11-26", { region: "US-CA", schoolHolidays: rows }).holiday).toBe("Thanksgiving break");
  });

  test("no region: no public holidays, school breaks still count", () => {
    expect(status("2026-05-01", { region: null }).school_day).toBe(true);
    const rows = [{ name: "Pfingstferien", starts_on: "2026-05-26", ends_on: "2026-05-26" }];
    expect(status("2026-05-26", { region: null, schoolHolidays: rows }).school_day).toBe(false);
  });

  test("a break across a month end covers every day of it, and only those", () => {
    const rows = [{ name: "Herbstferien", starts_on: "2026-10-29", ends_on: "2026-11-03" }];
    const breaks = schoolBreaks(inputs({ region: null, schoolHolidays: rows }), "2026-10-26", "2026-11-06");
    const days = ["2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"];
    expect(days.map((d) => isSchoolDay(d, breaks))).toEqual([true, false, false, false, false, true]);
  });
});

test.describe("nextSchoolDay", () => {
  const window = (from: string, over: Partial<SchoolBreakInputs> = {}) => schoolBreaks(inputs(over), from, addDays(from, 120));

  test("Friday evening: Monday, as before", () => {
    expect(nextSchoolDay("2026-10-30", window("2026-10-30"))?.date).toBe("2026-11-02");
  });

  test("skips a public holiday and the weekend after it", () => {
    // Thursday 30 April: Friday is Labour Day.
    expect(nextSchoolDay("2026-04-30", window("2026-04-30"))?.date).toBe("2026-05-04");
  });

  test("skips a break across a month end", () => {
    const rows = [{ name: "Herbstferien", starts_on: "2026-10-29", ends_on: "2026-11-03" }];
    expect(nextSchoolDay("2026-10-28", window("2026-10-28", { schoolHolidays: rows }))?.date).toBe("2026-11-04");
  });

  test("skips a holiday-calendar day", () => {
    const cal = holidayCalendarBreaks([{ title: "Brückentag", start_at: "2026-11-02T12:00:00Z", end_at: "2026-11-02T12:00:00Z" }], TZ);
    expect(nextSchoolDay("2026-10-30", window("2026-10-30", { holidayCalendarDays: cal }))?.date).toBe("2026-11-03");
  });

  test("across the whole summer break, to the first day back", () => {
    // Lower Saxony 2026: 2 July to 12 August. Back on Thursday 13 August.
    const rows = [{ name: "Sommerferien", starts_on: "2026-07-02", ends_on: "2026-08-12", source: "openholidays" }];
    const breaks = window("2026-07-01", { schoolHolidays: rows });
    expect(nextSchoolDay("2026-07-01", breaks)?.date).toBe("2026-08-13");
    // A child with lessons only on Mondays: the Monday after.
    expect(nextSchoolDay("2026-07-01", breaks, { hasLessons: (dow) => dow === 1 })?.date).toBe("2026-08-17");
    // Nothing within the window it is asked to look at.
    expect(nextSchoolDay("2026-07-01", breaks, { within: 30 })).toBeNull();
  });
});

/**
 * The server and the widget must never disagree. The server's path is
 * fetchSchoolBreaks (rows from the database) into schoolDayStatus; the
 * widget's is useSchoolBreaks (the same rows from the hooks) into
 * schoolDayStatusOn. Fed the same rows, they give the same answer every day
 * of a season.
 */
test("server and widget agree on every day of an autumn", async () => {
  const FAMILY = "11111111-1111-1111-1111-111111111111";
  const schoolHolidays = [
    { family_id: FAMILY, name: "Herbstferien", starts_on: "2026-10-12", ends_on: "2026-10-24", source: "manual", hidden: false },
    { family_id: FAMILY, name: "Synced", starts_on: "2026-11-16", ends_on: "2026-11-17", source: "openholidays", hidden: false },
    { family_id: FAMILY, name: "Hidden", starts_on: "2026-11-23", ends_on: "2026-11-23", source: "openholidays", hidden: true },
  ];
  const events = [{ title: "Brückentag", start_at: "2026-11-02T12:00:00Z", end_at: "2026-11-02T12:00:00Z", all_day: true }];
  const settings = [
    { key: "holiday_region", value: { code: "DE-NI", chosen: true } },
    { key: "locale", value: "en" },
  ];
  // Returns every row: the real filters only narrow to the window, and the
  // rule looks at exact days, so a superset answers the same.
  const rows: Record<string, unknown[]> = { school_holidays: schoolHolidays, events, settings };
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "lte", "gte", "or", "in", "order", "is"]) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null });
      return chain;
    },
  } as unknown as SchoolDb;

  // Named as the widget names them, from the `holidays` messages.
  const messages = en.holidays as Record<string, string>;
  const t = Object.assign((key: string) => messages[key], { has: (key: string) => key in messages });
  const from = "2026-09-28";
  const to = "2026-12-31";
  const widget = schoolBreaks(
    {
      region: "DE-NI",
      schoolHolidays,
      holidayCalendarDays: holidayCalendarBreaks(events, TZ),
      locale: "en",
      label: (h) => holidayLabel(h, t),
    },
    from,
    to,
  );
  const disagreements: string[] = [];
  let off = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const server = await schoolDayStatus(FAMILY, day, TZ, db);
    const client = schoolDayStatusOn(day, widget);
    if (JSON.stringify(server) !== JSON.stringify(client)) disagreements.push(`${day}: ${JSON.stringify(server)} vs ${JSON.stringify(client)}`);
    if (client.reason === "holiday") off++;
  }
  expect(disagreements).toEqual([]);
  // Not vacuous: the season has holidays of every kind in it.
  expect(off).toBeGreaterThan(15);
});
