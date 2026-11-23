import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { DEFAULT_WIDGET_VISIBILITY } from "../src/types/widgets";
import {
  HOME_EVENT_DAYS,
  NO_HOME_DATA,
  eventsOverlapping,
  homeDataNeeds,
  homeEventWindow,
} from "../src/lib/home-data";

/**
 * One data source for Home (RFC-022 step 2): every Home widget that lists
 * events reads one window under one query key, so a Home with the Events
 * widget, the bins and the week overview makes one events request on load and
 * one refetch per change, not one per widget.
 */

test("the window is today and the next fourteen days, the Events widget's own", () => {
  const today = startOfDay(new Date(2026, 10, 23)).getTime();
  // What upcoming-events.tsx computed before it read the shared window: the
  // strings are the query key, so they must not move by a character.
  expect(homeEventWindow(today)).toEqual({
    startDate: new Date(today).toISOString(),
    endDate: endOfDay(addDays(new Date(today), 14)).toISOString(),
  });
  expect(HOME_EVENT_DAYS).toBe(14);
});

test("any moment of a day gives the same window, so the key holds all day", () => {
  const morning = new Date(2026, 10, 23, 0, 0, 0, 0);
  const window = homeEventWindow(morning.getTime());
  for (const at of [new Date(2026, 10, 23, 7, 30), new Date(2026, 10, 23, 23, 59, 59, 999)]) {
    expect(homeEventWindow(at)).toEqual(window);
  }
  // …and the next day a new one.
  expect(homeEventWindow(new Date(2026, 10, 24, 0, 0, 0, 1)).startDate).not.toBe(window.startDate);
});

test("a shorter view cut from the fortnight keeps exactly the events that overlap it", () => {
  const day = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
  const events = [
    { id: "ended-yesterday", start_at: day(22, 9), end_at: day(22, 10) },
    { id: "overnight-into-today", start_at: day(22, 22), end_at: day(23, 1) },
    { id: "today", start_at: day(23, 9), end_at: day(23, 10) },
    { id: "no-end-today", start_at: day(23, 12), end_at: null },
    { id: "last-day-of-week", start_at: day(30, 20), end_at: day(30, 21) },
    { id: "next-week", start_at: day(31, 9), end_at: day(31, 10) },
  ];
  const from = startOfDay(new Date(2026, 10, 23));
  // Same rule as the server's (start <= to, end >= from), boundaries included.
  expect(eventsOverlapping(events, from, endOfDay(from)).map((e) => e.id)).toEqual(["overnight-into-today", "today", "no-end-today"]);
  expect(eventsOverlapping(events, from, endOfDay(addDays(from, 7))).map((e) => e.id)).toEqual([
    "overnight-into-today", "today", "no-end-today", "last-day-of-week",
  ]);
  const touching = [{ id: "ends-at-from", start_at: day(22, 23), end_at: from.toISOString() }];
  expect(eventsOverlapping(touching, from, endOfDay(from))).toHaveLength(1);
  expect(eventsOverlapping(null, from, endOfDay(from))).toEqual([]);
});

test("the built-in Home needs every shared query; a hidden widget's query stays off", () => {
  const clock = ["todayStrip", "familyMembers"];
  const visible = Object.entries(DEFAULT_WIDGET_VISIBILITY).filter(([, on]) => on).map(([key]) => key);
  expect(homeDataNeeds([...clock, ...visible])).toEqual({ events: true, todos: true, people: true, birthdays: true });
  // Birthdays are read by the birthday card and the week overview only.
  expect(homeDataNeeds([...clock, "upcomingEvents", "tasks"]).birthdays).toBe(false);
  expect(homeDataNeeds(["weekOverview"]).birthdays).toBe(true);
  // A widget whose data is its own reads none of the shared queries.
  expect(homeDataNeeds(["weather", "shopping", "notes", "mealPlan", "timers", "unknown"])).toEqual(NO_HOME_DATA);
  expect(homeDataNeeds([])).toEqual(NO_HOME_DATA);
});

test("no Home widget asks for an events window of its own", () => {
  // Waiting for step 3/4 of RFC-022, which takes the clock block apart: the
  // today strip and the family members still ask for their own day and week.
  // Each is one more events request on load and on every change; when they
  // move to useHomeEvents, take them off this list.
  const notYet = new Set(["today-strip.tsx", "family-members.tsx"]);
  const dir = "src/components/widgets";
  const ownWindow = readdirSync(dir)
    .filter((f) => f.endsWith(".tsx") && !notYet.has(f))
    .filter((f) => /\buseEvents\(/.test(readFileSync(`${dir}/${f}`, "utf8")));
  expect(ownWindow).toEqual([]);
  for (const f of ["upcoming-events.tsx", "waste-collection-widget.tsx", "week-overview-widget.tsx"]) {
    expect(readFileSync(`${dir}/${f}`, "utf8"), f).toContain("useHomeEvents()");
  }
});

test("useHomeData reads the widgets' own queries, so it adds no request", () => {
  const hook = readFileSync("src/hooks/use-home-data.ts", "utf8");
  // The same hooks (and so the same query keys) the widgets call, each behind its need.
  expect(hook).toContain('useTodos({ enabled: want("todos") })');
  expect(hook).toContain('usePeople({ enabled: want("people") })');
  expect(hook).toContain('useBirthdays({ enabled: want("birthdays") })');
  expect(hook).toContain('useHomeEvents({ enabled: want("events") })');
  // No timers or polling of its own (RFC-022 §6, the Pi).
  expect(hook).not.toMatch(/refetchInterval|setInterval|setTimeout/);
});
