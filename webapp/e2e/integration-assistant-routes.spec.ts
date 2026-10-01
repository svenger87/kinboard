import { test, expect } from "@playwright/test";
import { hasScope, type IntegrationScope } from "../src/lib/integration-auth";
import { parseEventInput, zonedWallTimeToUtc, isValidTimeZone } from "../src/lib/integration-event-input";
import { calendarWriteMode } from "../src/lib/calendar-write-mode";
import { homeAssistantBase, solarSensorIds } from "../src/lib/integration-energy";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Integration API routes added for assistant clients (the MCP server):
 * calendars, calendar event creation, notes and energy. Pure logic, no stack.
 */

const CAL = "f1563352-af89-41e6-9173-cf9f616fbeb2";
const BERLIN = "Europe/Berlin";

test.describe("an all-day event takes dates and lands on exactly its days", () => {
  test("one day in Berlin runs from local midnight to the last local millisecond", () => {
    const r = parseEventInput({ calendar_id: CAL, title: "Sports day", all_day: true, start_date: "2026-10-03" }, BERLIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // CEST is UTC+2: local midnight is 22:00Z the evening before.
    expect(r.value.startAt).toBe("2026-10-02T22:00:00.000Z");
    expect(r.value.endAt).toBe("2026-10-03T21:59:59.999Z");
    // Google and iCalendar want the exclusive next day.
    expect(r.value.allDayDates).toEqual({ start: "2026-10-03", endExclusive: "2026-10-04" });
  });

  test("the stored range matches what the calendar page writes for the same day", () => {
    // calendar/page.tsx stores startOfDay(date) .. endOfDay(endDate) in the
    // browser's zone. Computed here in Berlin by hand rather than with
    // date-fns, which would use the test runner's zone.
    const r = parseEventInput({ calendar_id: CAL, title: "x", all_day: true, start_date: "2026-01-15", end_date: "2026-01-16" }, BERLIN);
    expect(r.ok && r.value.startAt).toBe("2026-01-14T23:00:00.000Z");
    expect(r.ok && r.value.endAt).toBe("2026-01-16T22:59:59.999Z");
  });

  test("a DST changeover day is 25 hours long, not 24", () => {
    const r = parseEventInput({ calendar_id: CAL, title: "Clocks back", all_day: true, start_date: "2026-10-25" }, BERLIN);
    expect(r.ok && r.value.startAt).toBe("2026-10-24T22:00:00.000Z");
    expect(r.ok && r.value.endAt).toBe("2026-10-25T22:59:59.999Z");
  });

  test("a day whose midnight never happens starts at its first real instant", () => {
    // Santiago springs forward at 00:00 on 2026-09-06: the day begins 01:00 -03.
    const r = parseEventInput({ calendar_id: CAL, title: "x", all_day: true, start_date: "2026-09-06" }, "America/Santiago");
    expect(r.ok && r.value.startAt).toBe("2026-09-06T04:00:00.000Z");
    expect(r.ok && r.value.endAt).toBe("2026-09-07T02:59:59.999Z");
  });

  test("the same holds east of UTC, where a one-pass conversion lands on the day before", () => {
    // Beirut springs forward at 00:00 on 2026-03-29 (22:00Z the evening before).
    const r = parseEventInput({ calendar_id: CAL, title: "x", all_day: true, start_date: "2026-03-29" }, "Asia/Beirut");
    expect(r.ok && r.value.startAt).toBe("2026-03-28T22:00:00.000Z");
    expect(r.ok && r.value.endAt).toBe("2026-03-29T20:59:59.999Z");
  });

  test("a last hour that happens twice ends at its first occurrence, as the browser's endOfDay does", () => {
    // Beirut falls back at 24:00 on 2026-10-24, so 23:00-24:00 repeats.
    const r = parseEventInput({ calendar_id: CAL, title: "x", all_day: true, start_date: "2026-10-24" }, "Asia/Beirut");
    expect(r.ok && r.value.endAt).toBe("2026-10-24T20:59:59.999Z");
  });

  test("the zone is the family's, not the server's", () => {
    const r = parseEventInput({ calendar_id: CAL, title: "x", all_day: true, start_date: "2026-07-04" }, "America/New_York");
    expect(r.ok && r.value.startAt).toBe("2026-07-04T04:00:00.000Z");
  });

  test("timestamps are refused for an all-day event, so a UTC midnight cannot shift a day", () => {
    const r = parseEventInput({
      calendar_id: CAL, title: "x", all_day: true,
      start_at: "2026-10-03T00:00:00Z", end_at: "2026-10-04T00:00:00Z",
    }, BERLIN);
    expect(r.ok).toBe(false);
  });

  test("impossible and reversed dates are refused", () => {
    expect(parseEventInput({ calendar_id: CAL, title: "x", all_day: true, start_date: "2026-02-30" }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ calendar_id: CAL, title: "x", all_day: true, start_date: "2026-10-05", end_date: "2026-10-04" }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ calendar_id: CAL, title: "x", all_day: true }, BERLIN).ok).toBe(false);
  });
});

test.describe("a timed event", () => {
  test("is stored as the instant it names", () => {
    const r = parseEventInput({
      calendar_id: CAL, title: " Dentist ", start_at: "2026-10-03T09:00:00+02:00", end_at: "2026-10-03T10:00:00+02:00",
      description: " bring card ",
    }, BERLIN);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      title: "Dentist", allDay: false, description: "bring card",
      startAt: "2026-10-03T07:00:00.000Z", endAt: "2026-10-03T08:00:00.000Z",
    });
    expect(r.value.allDayDates).toBeUndefined();
  });

  test("needs an explicit offset, in the form the spec documents", () => {
    const base = { calendar_id: CAL, title: "x", end_at: "2026-10-03T10:00:00Z" };
    expect(parseEventInput({ ...base, start_at: "2026-10-03T09:00:00" }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ ...base, start_at: "2026-10-03T09:00:00+0200" }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ ...base, start_at: "2026-10-03T09:00:00Z" }, BERLIN).ok).toBe(true);
  });

  test("refuses dates, reversed ranges, and absurd lengths", () => {
    const ok = { calendar_id: CAL, title: "x", start_at: "2026-10-03T09:00:00Z", end_at: "2026-10-03T10:00:00Z" };
    expect(parseEventInput({ ...ok, start_date: "2026-10-03" }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ ...ok, end_at: "2026-10-03T09:00:00Z" }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ ...ok, end_at: "2028-10-03T09:00:00Z" }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ ...ok, calendar_id: "not-a-uuid" }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ ...ok, title: "   " }, BERLIN).ok).toBe(false);
    expect(parseEventInput({ ...ok, all_day: "yes" }, BERLIN).ok).toBe(false);
  });
});

test("zone helpers", () => {
  expect(isValidTimeZone("Europe/Berlin")).toBe(true);
  expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  expect(isValidTimeZone(undefined)).toBe(false);
  // Clocks forward: 02:30 does not exist on 2026-03-29 in Berlin; the
  // conversion still returns a real instant instead of throwing.
  const day = Date.UTC(2026, 2, 29) / 86_400_000;
  expect(Number.isNaN(zonedWallTimeToUtc(day, 2.5 * 3_600_000, BERLIN).getTime())).toBe(false);
});

test.describe("which calendars take new events", () => {
  const cal = { id: CAL, google_calendar_id: null, ics_url: null, caldav_url: null, caldav_server_url: null, caldav_read_only: null };
  test("subscriptions and read-only CalDAV take nothing", () => {
    expect(calendarWriteMode({ ...cal, ics_url: "https://example.com/a.ics" })).toBe("read_only");
    expect(calendarWriteMode({ ...cal, caldav_url: "https://dav.example.com/c/", caldav_read_only: true })).toBe("read_only");
  });
  test("the rest write locally or through to their provider", () => {
    expect(calendarWriteMode(cal)).toBe("local");
    expect(calendarWriteMode({ ...cal, google_calendar_id: "abc@group.calendar.google.com" })).toBe("google");
    expect(calendarWriteMode({ ...cal, caldav_url: "https://dav.example.com/c/" })).toBe("caldav");
  });
});

test.describe("energy reads only configured sensors", () => {
  test("anything that is not a plain sensor ID is dropped", () => {
    expect(solarSensorIds({ solar_power: "sensor.pv_power", solar_energy_today: "sensor.pv_today" }))
      .toEqual({ power: "sensor.pv_power", energyToday: "sensor.pv_today" });
    expect(solarSensorIds({ solar_power: "lock.front_door", solar_energy_today: "sensor.x/../../config" }))
      .toEqual({ power: null, energyToday: null });
    expect(solarSensorIds({})).toEqual({ power: null, energyToday: null });
  });
  test("the token is only sent to a plain http(s) base", () => {
    expect(homeAssistantBase("http://homeassistant.local:8123")?.host).toBe("homeassistant.local:8123");
    expect(homeAssistantBase("https://user:pw@ha.example.com")).toBeNull();
    expect(homeAssistantBase("file:///etc/passwd")).toBeNull();
    expect(homeAssistantBase("not a url")).toBeNull();
  });
});

/**
 * RFC-001 §10: the negative case must be proved. Each route names one scope;
 * the source is read so that a route quietly switched to a broader scope fails
 * here, and `hasScope` shows the neighbouring scopes do not stand in for it.
 */
test.describe("each assistant route demands its own scope", () => {
  const ROUTES: [string, IntegrationScope][] = [
    ["notes/route.ts", "notes:read"],
    ["notes/[id]/route.ts", "notes:write"],
    ["energy/current/route.ts", "energy:read"],
    ["calendars/route.ts", "family:read"],
    ["people/route.ts", "family:read"],
  ];
  const dir = join(__dirname, "../src/app/api/integration/v1");

  for (const [file, scope] of ROUTES) {
    test(`${file} requires ${scope}`, () => {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src).toContain(`withIntegrationAuth(request, "${scope}"`);
    });
  }

  test("creating an event requires calendar:write, reading needs only family:read", () => {
    const src = readFileSync(join(dir, "calendar/events/route.ts"), "utf8");
    expect(src.match(/withIntegrationAuth\(request, "([a-z:]+)"/g)).toEqual([
      'withIntegrationAuth(request, "family:read"',
      'withIntegrationAuth(request, "calendar:write"',
    ]);
  });

  test("editing and deleting an event both require calendar:write", () => {
    const src = readFileSync(join(dir, "calendar/events/[id]/route.ts"), "utf8");
    expect(src.match(/withIntegrationAuth\(request, "([a-z:]+)"/g)).toEqual([
      'withIntegrationAuth(request, "calendar:write"',
      'withIntegrationAuth(request, "calendar:write"',
    ]);
  });

  test("a Home Assistant token cannot read notes, create events or read energy", () => {
    const ha = ["family:read", "events:read", "shopping:write", "tasks:write", "notes:write"];
    expect(hasScope(ha, "notes:read")).toBe(false);
    expect(hasScope(ha, "calendar:write")).toBe(false);
    expect(hasScope(ha, "energy:read")).toBe(false);
  });

  test("energy:read and calendar:write grant nothing else", () => {
    expect(hasScope(["energy:read"], "family:read")).toBe(false);
    expect(hasScope(["calendar:write"], "family:read")).toBe(false);
    expect(hasScope(["notes:read"], "notes:write")).toBe(false);
  });
});
