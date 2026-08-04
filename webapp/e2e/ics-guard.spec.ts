import { test, expect } from "@playwright/test";
import { parseIcsEvents } from "../src/lib/ics-fetcher";

/**
 * A provider that answers 200 with something that isn't a calendar — an
 * expired share page, a captive portal, a Cloudflare interstitial — used
 * to parse to zero events, and the sync read that as "this calendar is
 * now empty" and deleted everything it had.
 *
 * The guard lives in the fetch path (it needs the response headers), so
 * what's covered here is the property it depends on: the parser really
 * does return nothing for those bodies, which is why the check has to
 * happen before parsing rather than after.
 */

const REAL = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:evt-1@example.com
DTSTAMP:20260801T090000Z
DTSTART:20260805T090000Z
DTEND:20260805T100000Z
SUMMARY:Dentist
END:VEVENT
END:VCALENDAR`;

const EMPTY_BUT_VALID = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
END:VCALENDAR`;

test("a real calendar parses", () => {
  const events = parseIcsEvents(REAL, {
    start: new Date("2026-08-01"),
    end: new Date("2026-09-01"),
  });
  expect(events).toHaveLength(1);
  expect(events[0].title).toBe("Dentist");
});

test("an empty but valid calendar is genuinely empty", () => {
  // This case must keep working: a calendar whose events were all
  // deleted upstream should still clear them locally.
  expect(
    parseIcsEvents(EMPTY_BUT_VALID, {
      start: new Date("2026-08-01"),
      end: new Date("2026-09-01"),
    }),
  ).toHaveLength(0);
});

test("non-calendar bodies parse to nothing — which is why they must be caught earlier", () => {
  const notCalendars = [
    "<!doctype html><html><body>Sign in to continue</body></html>",
    '{"error":"share link expired"}',
    "Attention Required! | Cloudflare",
    "",
  ];
  for (const body of notCalendars) {
    expect(
      parseIcsEvents(body, { start: new Date("2026-08-01"), end: new Date("2026-09-01") }),
      body.slice(0, 30),
    ).toHaveLength(0);
  }
});

test("the envelope check distinguishes the two", () => {
  // The same predicate the fetcher applies, over the head of the body.
  const looksLikeCalendar = (s: string) => /BEGIN:VCALENDAR/i.test(s.slice(0, 2048));
  expect(looksLikeCalendar(REAL)).toBe(true);
  expect(looksLikeCalendar(EMPTY_BUT_VALID)).toBe(true);
  expect(looksLikeCalendar("<html>Sign in</html>")).toBe(false);
  expect(looksLikeCalendar("")).toBe(false);
  // A large HTML page that merely mentions the marker far down must not
  // sneak through — hence checking only the head.
  expect(looksLikeCalendar("x".repeat(5000) + "BEGIN:VCALENDAR")).toBe(false);
});
