import { test, expect } from "@playwright/test";
import { eventPushTarget, isLocalCalendar } from "../src/lib/local-calendars";
import { settingsBackHref } from "../src/lib/constants";

/**
 * Every event needs a calendar, and a household could only get one by
 * connecting Google, CalDAV or an ICS feed. Without any of them the calendar
 * page said "No calendars yet" and the event editor would not save. A local
 * calendar is a row with no source at all; this is the line between the two.
 */
test("a calendar with no source is local, and any source makes it not", () => {
  const none = { google_calendar_id: null, ics_url: null, caldav_url: null };
  expect(isLocalCalendar(none)).toBe(true);

  expect(isLocalCalendar({ ...none, google_calendar_id: "family@group.calendar.google.com" })).toBe(false);
  expect(isLocalCalendar({ ...none, ics_url: "https://example.com/school.ics" })).toBe(false);
  expect(isLocalCalendar({ ...none, caldav_url: "https://dav.example.com/calendars/family/" })).toBe(false);
});

test("an empty URL still counts as a source, as the syncs read it", () => {
  // The ICS and CalDAV syncs select `.not(<url>, "is", null)`, so they would
  // still pick up a calendar with an empty URL. Calling it local would put it
  // on the local calendars page while a sync kept trying to fetch it.
  const none = { google_calendar_id: null, ics_url: null, caldav_url: null };
  expect(isLocalCalendar({ ...none, ics_url: "" })).toBe(false);
  expect(isLocalCalendar({ ...none, caldav_url: "" })).toBe(false);
});

/**
 * useCreateEvent and useDeleteEvent sent every calendar that was not CalDAV to
 * /api/google/events, and that route turns away a calendar with no Google id
 * before it looks at it. In a household without Google, every event created
 * in a local calendar warned "not sent to Google Calendar", and deleting one
 * failed with two error toasts and left it in place. Both hooks now take the
 * target from eventPushTarget; the specs have no browser to render a hook in,
 * so this is where the decision is pinned.
 */
test("an event in a local calendar is pushed nowhere, on create and on delete", () => {
  // Create then saves without a warning, and delete -- which keeps the row
  // when its push fails -- has no push left to fail.
  expect(eventPushTarget({ google_calendar_id: null, caldav_url: null })).toBe("none");
});

test("Google and CalDAV calendars keep their pushes", () => {
  expect(eventPushTarget({ google_calendar_id: "family@group.calendar.google.com", caldav_url: null })).toBe("google");
  expect(eventPushTarget({ google_calendar_id: null, caldav_url: "https://dav.example.com/calendars/family/" })).toBe("caldav");
});

test("an ICS feed's calendar has nowhere to push to either", () => {
  // The picker offers every calendar. The route answers an ICS calendar the
  // same way it answers a local one, so it gets the same "none".
  const icsCalendar = { google_calendar_id: null, caldav_url: null, ics_url: "https://example.com/school.ics" };
  expect(eventPushTarget(icsCalendar)).toBe("none");
});

test("a calendar missing from the cache still tries Google, which decides", () => {
  // Guessing "none" here would drop a real Google event's push without a word.
  expect(eventPushTarget(undefined)).toBe("google");
});

test("the local calendars page goes back to Settings -> Calendar", () => {
  // It is reached from there, like the Google, ICS and CalDAV pages.
  expect(settingsBackHref("/settings/local-calendars")).toBe("/settings/calendar");
});
