/**
 * Ownership checks for /api/google/events.
 *
 * Events have no family_id column — they're scoped through
 * calendar_id -> calendars.family_id, one hop out (the same shape as
 * pocket_money_goals -> account_id in src/lib/family-scope.ts, and the
 * same hop src/app/api/caldav/events/route.ts's loadCalendar already makes
 * for the CalDAV write-through this route mirrors).
 *
 * The Google route used to look events and calendars up by the id in the
 * request alone, with no check that the calendar belonged to the caller's
 * family. These two helpers are the missing filter: both return null for a
 * foreign row exactly as they do for a row that doesn't exist at all, so a
 * caller can't tell "not yours" from "doesn't exist" and enumerate ids.
 */

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

/** True only when `calendarId` belongs to `familyId`; null otherwise. */
export async function loadOwnedCalendar(
  // The admin client is deliberately untyped in this codebase (see
  // family-scope.ts); keeping the loose type local rather than spreading
  // it through every caller.
  supabase: any,
  familyId: string,
  calendarId: string,
): Promise<OwnedCalendar | null> {
  if (!calendarId || !familyId) return null;

  const { data } = await supabase
    .from("calendars")
    .select("id, google_calendar_id")
    .eq("id", calendarId)
    .eq("family_id", familyId)
    .maybeSingle();

  return (data as OwnedCalendar | null) ?? null;
}

/**
 * Load an event together with its calendar's Google id, but only when the
 * event's calendar belongs to `familyId`. An unknown event_id and a real
 * event belonging to another family both resolve to null.
 */
export async function loadOwnedEvent(
  supabase: any,
  familyId: string,
  eventId: string,
): Promise<OwnedEvent | null> {
  if (!eventId || !familyId) return null;

  const { data: event } = await supabase
    .from("events")
    .select("id, calendar_id, google_event_id")
    .eq("id", eventId)
    .maybeSingle();

  if (!event?.calendar_id) return null;

  const calendar = await loadOwnedCalendar(supabase, familyId, event.calendar_id);
  if (!calendar) return null;

  return {
    id: event.id,
    calendar_id: event.calendar_id,
    google_event_id: event.google_event_id ?? null,
    google_calendar_id: calendar.google_calendar_id,
  };
}
