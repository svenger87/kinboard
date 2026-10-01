import type { Calendar } from "@/types/database";

/**
 * A calendar that lives only in Kinboard: no Google, CalDAV or ICS behind it.
 *
 * Every event needs a calendar (`events.calendar_id` is NOT NULL), and until
 * this page existed the only way to get one was to connect an outside source.
 * A household with no Google account, no CalDAV server and no feed URL could
 * not add a single event.
 *
 * "No source" means null, as the syncs read it: the ICS and CalDAV syncs take
 * every calendar whose URL is not null, an empty string included, so a
 * calendar with `ics_url: ""` is the ICS sync's, not a local one.
 */
export function isLocalCalendar(
  cal: Pick<Calendar, "google_calendar_id" | "ics_url" | "caldav_url">,
): boolean {
  return cal.google_calendar_id == null && cal.ics_url == null && cal.caldav_url == null;
}

/** Where an event change goes besides Kinboard's own database. */
export type EventPushTarget = "caldav" | "google" | "none";

/**
 * Where a new or deleted event has to be pushed, decided by its calendar:
 * a CalDAV or Google calendar has a server to keep in step, and a calendar
 * with neither -- a local one, or an ICS feed, which is read-only -- has
 * nowhere to push to.
 *
 * Google gets only calendars with a Google id. /api/google/events turns
 * anything else away before it looks at the calendar -- 401 "not connected"
 * in a household without Google, 400 "not linked" in one with it -- so
 * pushing a local calendar's events there made every new event warn "not
 * sent to Google Calendar" and every delete fail.
 *
 * A calendar missing from the cache still goes to Google, as before, and the
 * route decides: guessing "nowhere" would drop a real Google push silently.
 */
export function eventPushTarget(
  cal: Pick<Calendar, "google_calendar_id" | "caldav_url"> | undefined,
): EventPushTarget {
  if (!cal) return "google";
  if (cal.caldav_url) return "caldav";
  if (cal.google_calendar_id) return "google";
  return "none";
}
