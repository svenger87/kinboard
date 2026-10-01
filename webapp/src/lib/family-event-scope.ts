import { calendarWriteMode, type StoredCalendarEvent, type WritableCalendar } from "@/lib/calendar-write-through";
import type { createAdminClient } from "@/lib/supabase/server";

/**
 * Family ownership for calendars and events — one module for every route
 * that takes a calendar or event id from a request: /api/google/events (the
 * browser) and /api/integration/v1/calendar/events/{id} (assistants).
 *
 * `events` has no `family_id`: an event belongs to a family only through its
 * calendar (calendar_id -> calendars.family_id, the same one-hop shape as
 * pocket_money_goals -> account_id in src/lib/family-scope.ts and the
 * CalDAV route's loadCalendar). So an event is read by id, then its calendar
 * by id **and** `family_id`. Every loader here returns null for another
 * family's row exactly as for a row that doesn't exist, so a caller cannot
 * tell "not yours" from "no such id" and enumerate ids.
 */

/**
 * The real admin client, as `SearchDb` is (lib/integration-event-search.ts):
 * a method the client does not have is then a type error here, and the
 * routes pass `createAdminClient()` without a cast. Tests cast their fake to
 * this at the test boundary.
 */
export type FamilyEventDb = ReturnType<typeof createAdminClient>;

export const EVENT_COLUMNS =
  "id, calendar_id, title, description, location, start_at, end_at, all_day, google_event_id, caldav_href, caldav_etag";

const WRITABLE_CALENDAR_COLUMNS = "id, google_calendar_id, ics_url, caldav_url, caldav_server_url, caldav_read_only";

/**
 * The shared core: the event `id` and its calendar, but only when that
 * calendar belongs to `familyId`. `strict` throws on a query error (the
 * Integration API answers 500); otherwise an error reads as not found.
 */
async function loadEventInFamily<E extends { calendar_id: string }, C>(
  db: FamilyEventDb,
  familyId: string,
  id: string,
  columns: { event: string; calendar: string },
  strict: boolean,
): Promise<{ event: E; calendar: C } | null> {
  if (!familyId || !id) return null;
  const { data: event, error } = await db.from("events").select(columns.event).eq("id", id).maybeSingle();
  if (error && strict) throw error;
  const stored = event as E | null;
  if (!stored?.calendar_id) return null;
  const { data: calendar, error: calendarError } = await db
    .from("calendars")
    .select(columns.calendar)
    .eq("id", stored.calendar_id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (calendarError && strict) throw calendarError;
  if (!calendar) return null;
  return { event: stored, calendar: calendar as C };
}

// ---- /api/google/events -------------------------------------------------

export interface OwnedCalendar {
  id: string;
  google_calendar_id: string | null;
}

export interface OwnedEvent {
  id: string;
  calendar_id: string;
  google_event_id: string | null;
  google_calendar_id: string | null;
}

/** `calendarId` when it belongs to `familyId`; null otherwise. */
export async function loadOwnedCalendar(
  // Loose, as in family-scope.ts: the browser route's own client.
  db: any,
  familyId: string,
  calendarId: string,
): Promise<OwnedCalendar | null> {
  if (!calendarId || !familyId) return null;
  const { data } = await db
    .from("calendars")
    .select("id, google_calendar_id")
    .eq("id", calendarId)
    .eq("family_id", familyId)
    .maybeSingle();
  return (data as OwnedCalendar | null) ?? null;
}

/**
 * An event together with its calendar's Google id, but only when the
 * event's calendar belongs to `familyId`.
 */
export async function loadOwnedEvent(
  db: any,
  familyId: string,
  eventId: string,
): Promise<OwnedEvent | null> {
  const found = await loadEventInFamily<
    { id: string; calendar_id: string; google_event_id: string | null },
    OwnedCalendar
  >(db, familyId, eventId, { event: "id, calendar_id, google_event_id", calendar: "id, google_calendar_id" }, false);
  if (!found) return null;
  return {
    id: found.event.id,
    calendar_id: found.event.calendar_id,
    google_event_id: found.event.google_event_id ?? null,
    google_calendar_id: found.calendar.google_calendar_id ?? null,
  };
}

// ---- /api/integration/v1/calendar/events/{id} ---------------------------

/**
 * An event the Integration API may edit or delete for `familyId`, with its
 * calendar — or null. An event in a read-only calendar (ICS subscription,
 * read-only CalDAV — a mirror the next sync would overwrite) is the same
 * null as another family's event or a missing one.
 */
export async function loadFamilyEvent(
  db: FamilyEventDb,
  familyId: string,
  id: string,
): Promise<{ event: StoredCalendarEvent; calendar: WritableCalendar } | null> {
  const found = await loadEventInFamily<StoredCalendarEvent, WritableCalendar>(
    db,
    familyId,
    id,
    { event: EVENT_COLUMNS, calendar: WRITABLE_CALENDAR_COLUMNS },
    true,
  );
  if (!found || calendarWriteMode(found.calendar) === "read_only") return null;
  return found;
}
