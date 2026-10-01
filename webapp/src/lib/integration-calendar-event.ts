import { calendarWriteMode, type StoredCalendarEvent, type WritableCalendar } from "@/lib/calendar-write-through";

export const EVENT_COLUMNS =
  "id, calendar_id, title, description, location, start_at, end_at, all_day, google_event_id, caldav_href, caldav_etag";

/** The chain this uses: `from().select().eq()….maybeSingle()`. Fakeable in tests. */
interface Query {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<{ data: unknown; error?: unknown }>;
}
export interface EventQueryClient {
  from(table: string): Query;
}

/**
 * An event the Integration API may edit or delete for `familyId`, with its
 * calendar — or null.
 *
 * `events` has no `family_id`: an event belongs to a family only through its
 * calendar. So the event is read by id, then its calendar by id **and**
 * `family_id`. An event in another family's calendar, a missing one, and one
 * in a read-only calendar (ICS subscription, read-only CalDAV — a mirror the
 * next sync would overwrite) are all the same null, so a caller cannot tell
 * another family's event from no event.
 */
export async function loadFamilyEvent(
  db: EventQueryClient,
  familyId: string,
  id: string,
): Promise<{ event: StoredCalendarEvent; calendar: WritableCalendar } | null> {
  if (!familyId || !id) return null;
  const { data: event, error } = await db.from("events").select(EVENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!event) return null;
  const stored = event as StoredCalendarEvent;
  const { data: calendar, error: calendarError } = await db
    .from("calendars")
    .select("id, google_calendar_id, ics_url, caldav_url, caldav_server_url, caldav_read_only")
    .eq("id", stored.calendar_id)
    .eq("family_id", familyId)
    .maybeSingle();
  if (calendarError) throw calendarError;
  if (!calendar || calendarWriteMode(calendar as WritableCalendar) === "read_only") return null;
  return { event: stored, calendar: calendar as WritableCalendar };
}
