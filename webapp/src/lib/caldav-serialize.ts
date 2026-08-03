import { buildVEventLines, icsDtstamp, wrapVCalendar, type ExportEvent } from "@/lib/ics-export";

/**
 * Serialize a Kinboard event into the calendar object a CalDAV PUT
 * expects: a complete VCALENDAR document containing exactly one VEVENT.
 *
 * The VEVENT body itself comes from lib/ics-export.ts, unchanged, so the
 * outbound ICS feed and CalDAV writes agree on the awkward parts (all-day
 * DTEND exclusivity, RFC 5545 escaping, 75-octet folding).
 */

/** Marker on the external-id column identifying a CalDAV-backed event. */
export const CALDAV_ID_PREFIX = "caldav:";

/**
 * Separator ics-fetcher.ts uses when expanding a recurring master into
 * instances (`<uid>__<instance start ISO>`). An event whose UID carries
 * it is a *projection* of a series, not a resource of its own — writing
 * it back would rewrite every occurrence.
 */
const RECURRENCE_INSTANCE_SEPARATOR = "__";

/** The iCalendar UID behind a stored `caldav:<uid>` external id. */
export function caldavUidFromExternalId(externalId: string | null): string | null {
  if (!externalId?.startsWith(CALDAV_ID_PREFIX)) return null;
  const uid = externalId.slice(CALDAV_ID_PREFIX.length);
  return uid.length > 0 ? uid : null;
}

export function caldavExternalId(uid: string): string {
  return `${CALDAV_ID_PREFIX}${uid}`;
}

/**
 * True for events that are one occurrence of a recurring series.
 *
 * Kinboard's event editor edits a single event; a series lives in one
 * calendar object with an RRULE, so "move this Tuesday's swimming" would
 * either move all of them or need a RECURRENCE-ID override the local
 * schema has nowhere to put. Both are worse than declining the edit and
 * saying so — the same line the wiki already draws for the local event
 * editor ("add recurring events in your calendar app").
 */
export function isRecurrenceInstance(externalId: string | null): boolean {
  const uid = caldavUidFromExternalId(externalId);
  return uid !== null && uid.includes(RECURRENCE_INSTANCE_SEPARATOR);
}

/** A fresh, globally-unique UID for an event Kinboard is creating. */
export function newCaldavUid(): string {
  return `${crypto.randomUUID()}@kinboard`;
}

/**
 * No SEQUENCE property is emitted. RFC 5545 uses it to order revisions of
 * an event among *attendees*, and Kinboard writes no ATTENDEE lines —
 * these are a household's own events, not invitations. Change detection
 * between Kinboard and the server rides on ETags instead, which is both
 * finer-grained and doesn't need a revision counter in the schema.
 */
export function buildCaldavCalendarObject(
  event: ExportEvent,
  uid: string,
  timeZone: string,
): string {
  return wrapVCalendar(buildVEventLines(event, uid, icsDtstamp(timeZone), timeZone));
}
