import { test, expect } from "@playwright/test";
import {
  atLocation,
  localDateKey,
  localHour,
  minutesOfDayAt,
} from "../src/lib/weather-time";

/**
 * The forecast fetched the location's UTC offset, echoed it in the
 * response, and never applied it — so days were bucketed by UTC calendar
 * date and hours were formatted in the container's zone (Europe/Berlin
 * by default). Every assertion here is a case that was wrong.
 *
 * Fixed offsets on purpose: these tests must not depend on the machine's
 * own zone, which is precisely the bug being guarded against.
 */

const BERLIN_SUMMER = 2 * 3600; // UTC+2
const NEW_YORK_SUMMER = -4 * 3600; // UTC-4
const KIRITIMATI = 14 * 3600; // UTC+14, the far end
const CHATHAM = 12 * 3600 + 45 * 60; // UTC+12:45, a non-hour offset

test.describe("bucketing by the location's day", () => {
  test("a late-evening slot stays on its own day in a positive offset", () => {
    // 2026-08-04 23:30 UTC is already the 5th in Berlin. Bucketed by UTC
    // it landed on the 4th, so the 5th's low could come from the wrong day.
    const dt = Date.UTC(2026, 7, 4, 23, 30) / 1000;
    expect(localDateKey(dt, BERLIN_SUMMER)).toBe("2026-08-05");
    expect(localDateKey(dt, 0)).toBe("2026-08-04"); // what it used to do
  });

  test("an early-morning slot stays on its own day in a negative offset", () => {
    // 2026-08-05 02:00 UTC is still the 4th in New York.
    const dt = Date.UTC(2026, 7, 5, 2, 0) / 1000;
    expect(localDateKey(dt, NEW_YORK_SUMMER)).toBe("2026-08-04");
  });

  test("extreme and non-hour offsets", () => {
    const dt = Date.UTC(2026, 7, 4, 12, 0) / 1000;
    expect(localDateKey(dt, KIRITIMATI)).toBe("2026-08-05");
    expect(localHour(dt, CHATHAM)).toBe(0); // 12:00 UTC + 12:45
  });
});

test.describe("picking the midday slot", () => {
  test("midday is midday where the weather is", () => {
    // 10:00 UTC is noon in Berlin and 6am in New York. The old code read
    // the container's clock, so a US city's 'midday' icon came from a
    // slot in the middle of its night.
    const dt = Date.UTC(2026, 7, 4, 10, 0) / 1000;
    expect(localHour(dt, BERLIN_SUMMER)).toBe(12);
    expect(localHour(dt, NEW_YORK_SUMMER)).toBe(6);
  });

  test("wraps across midnight rather than going negative", () => {
    const dt = Date.UTC(2026, 7, 4, 1, 0) / 1000;
    expect(localHour(dt, NEW_YORK_SUMMER)).toBe(21); // previous evening
  });
});

test.describe("comparing 'now' against sunrise and sunset", () => {
  test("uses the location's clock, not the viewer's", () => {
    // Sunrise/sunset arrive already converted to the location's zone, so
    // 'now' has to be too — otherwise the sun sits at the wrong point of
    // its arc, or the arc shows night at noon.
    const now = new Date(Date.UTC(2026, 7, 4, 10, 30));
    expect(minutesOfDayAt(now, BERLIN_SUMMER)).toBe(12 * 60 + 30);
    expect(minutesOfDayAt(now, NEW_YORK_SUMMER)).toBe(6 * 60 + 30);
  });

  test("falls back to the viewer's clock when no offset is known", () => {
    const now = new Date(2026, 7, 4, 9, 15); // local construction on purpose
    expect(minutesOfDayAt(now, undefined)).toBe(9 * 60 + 15);
  });

  test("atLocation is the shared primitive underneath", () => {
    const dt = Date.UTC(2026, 7, 4, 10, 0) / 1000;
    expect(atLocation(dt, BERLIN_SUMMER).getUTCHours()).toBe(12);
  });
});
