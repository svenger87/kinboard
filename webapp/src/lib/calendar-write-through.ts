import { google, type calendar_v3 } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";
import { getGoogleOAuth2Client } from "@/lib/google-calendar-auth";
import { getCaldavCredentials } from "@/lib/caldav-credentials";
import {
  CaldavConflictError,
  createCaldavClient,
  createCaldavEvent,
  deleteCaldavEvent,
  updateCaldavEvent,
} from "@/lib/caldav-client";
import {
  buildCaldavCalendarObject,
  caldavExternalId,
  caldavUidFromExternalId,
  isRecurrenceInstance,
  newCaldavUid,
} from "@/lib/caldav-serialize";

import { calendarWriteMode, type WritableCalendar } from "@/lib/calendar-write-mode";

export { calendarWriteMode, type WritableCalendar };

export interface CreatedCalendarEvent {
  id: string;
  calendar_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  /**
   * Who the event is for, as Google should store it. Google sync reads the
   * assignee back from the event's private extended property `person_id`
   * (google/sync/route.ts) and otherwise falls back to the calendar's own
   * person, so an assignment Google does not carry is undone by the next
   * sync. The screens write it there (/api/google/events), and so does this.
   *
   * Present only when it is to be written: a create sends a non-null one,
   * an update sends it whenever the key is present (null clears it, as the
   * screens clear it, with ""), and an absent key leaves Google's alone.
   * CalDAV has no such field; its sync assigns from the calendar.
   */
  person_id?: string | null;
}

/** Google's private extended property carrying the assignee. */
export function googlePersonProperty(personId: string | null): calendar_v3.Schema$Event["extendedProperties"] {
  return { private: { person_id: personId ?? "" } };
}

/** Write a newly-created local row through to its configured provider. */
export async function syncCreatedCalendarEvent(
  familyId: string,
  calendar: WritableCalendar,
  event: CreatedCalendarEvent,
  allDayDates?: { start: string; endExclusive: string },
  timeZone = process.env.TZ ?? "Europe/Berlin",
  deps: WriteThroughDeps = defaultWriteThroughDeps,
): Promise<{ provider: "local" | "google" | "caldav"; synced: boolean; reason?: string }> {
  const mode = calendarWriteMode(calendar);
  if (mode === "read_only") return { provider: "local", synced: false, reason: "calendar_read_only" };
  if (mode === "local") return { provider: "local", synced: true };
  if (mode === "google" && event.all_day && !allDayDates) {
    return { provider: "google", synced: false, reason: "all_day_dates_missing" };
  }

  try {
    if (mode === "google") {
      const supabase = createAdminClient();
      const auth = await getGoogleOAuth2Client(familyId);
      if (!auth) return { provider: "google", synced: false, reason: "google_not_connected" };
      const client = google.calendar({ version: "v3", auth: auth.oauth2Client });
      const { data } = await client.events.insert({
        calendarId: calendar.google_calendar_id!,
        requestBody: {
          summary: event.title,
          description: event.description ?? undefined,
          location: event.location ?? undefined,
          start: event.all_day ? { date: allDayDates?.start } : { dateTime: event.start_at },
          end: event.all_day ? { date: allDayDates?.endExclusive } : { dateTime: event.end_at },
          ...(event.person_id ? { extendedProperties: googlePersonProperty(event.person_id) } : {}),
        },
      });
      if (!data.id) return { provider: "google", synced: false, reason: "provider_no_id" };
      const { error } = await (supabase as any)
        .from("events")
        .update({ google_event_id: data.id })
        .eq("id", event.id)
        .eq("calendar_id", calendar.id);
      if (error) throw error;
      return { provider: "google", synced: true };
    }

    const api = await deps.caldavEvents(familyId, calendar);
    if (!api) return { provider: "caldav", synced: false, reason: "caldav_not_connected" };
    const uid = newCaldavUid();
    const iCalString = buildCaldavCalendarObject(event, uid, timeZone);
    const { href, etag } = await api.create(calendar.caldav_url!, uid, iCalString);
    await deps.saveCaldavLink(
      { id: event.id, calendar_id: calendar.id },
      { google_event_id: caldavExternalId(uid), caldav_href: href, caldav_etag: etag },
    );
    return { provider: "caldav", synced: true };
  } catch (error) {
    // The local event already exists. Report the unsynced state rather than
    // claim success or retry a provider create that might have succeeded.
    console.error("[integration-calendar] provider create failed", error);
    return { provider: mode, synced: false, reason: "provider_write_failed" };
  }
}

// ---------------------------------------------------------------------------
// Edit and delete (RFC-011 task 4)
// ---------------------------------------------------------------------------

export type CalendarSync = { provider: "local" | "google" | "caldav"; synced: boolean; reason?: string };

/** A stored event row with the provider identity an edit or delete needs. */
export interface StoredCalendarEvent extends CreatedCalendarEvent {
  /** Google's event id, or `caldav:<uid>` for a CalDAV event. */
  google_event_id: string | null;
  caldav_href: string | null;
  caldav_etag: string | null;
}

/** The two calls an edit or delete makes on Google — the `events` resource. */
export interface GoogleEventsApi {
  patch(params: { calendarId: string; eventId: string; requestBody: calendar_v3.Schema$Event }): Promise<unknown>;
  delete(params: { calendarId: string; eventId: string }): Promise<unknown>;
}

/** The two calls an edit or delete makes on a CalDAV server. */
export interface CaldavEventsApi {
  update(href: string, iCalString: string, etag: string | null): Promise<{ etag: string | null }>;
  delete(href: string, etag: string | null): Promise<void>;
  create(calendarUrl: string, uid: string, iCalString: string): Promise<{ href: string; etag: string | null }>;
}

/**
 * Where the provider clients come from. Injected so the tests can see what
 * is sent without a Google account or a CalDAV server; production uses
 * `defaultWriteThroughDeps`, which builds them from the family's stored
 * credentials with the same helpers `/api/google/events` and
 * `/api/caldav/events` use.
 */
export interface WriteThroughDeps {
  googleEvents(familyId: string): Promise<GoogleEventsApi | null>;
  caldavEvents(familyId: string, calendar: WritableCalendar): Promise<CaldavEventsApi | null>;
  saveCaldavEtag(event: { id: string; calendar_id: string }, etag: string | null): Promise<void>;
  /** Record the server identity of an event just created on a CalDAV server. */
  saveCaldavLink(
    event: { id: string; calendar_id: string },
    link: { google_event_id: string; caldav_href: string; caldav_etag: string | null },
  ): Promise<void>;
}

export const defaultWriteThroughDeps: WriteThroughDeps = {
  async googleEvents(familyId) {
    const auth = await getGoogleOAuth2Client(familyId);
    if (!auth) return null;
    const events = google.calendar({ version: "v3", auth: auth.oauth2Client }).events;
    return {
      patch: (params) => events.patch(params),
      delete: (params) => events.delete(params),
    };
  },
  async caldavEvents(familyId, calendar) {
    const credentials = await getCaldavCredentials(familyId, calendar.id);
    if (!credentials) return null;
    const client = await createCaldavClient({
      serverUrl: calendar.caldav_server_url ?? calendar.caldav_url!,
      username: credentials.username,
      password: credentials.password,
    });
    return {
      update: (href, iCalString, etag) => updateCaldavEvent(client, href, iCalString, etag),
      delete: (href, etag) => deleteCaldavEvent(client, href, etag),
      create: (calendarUrl, uid, iCalString) => createCaldavEvent(client, calendarUrl, uid, iCalString),
    };
  },
  async saveCaldavEtag(event, etag) {
    const { error } = await (createAdminClient() as any)
      .from("events")
      .update({ caldav_etag: etag })
      .eq("id", event.id)
      .eq("calendar_id", event.calendar_id);
    if (error) throw error;
  },
  async saveCaldavLink(event, link) {
    const { error } = await (createAdminClient() as any)
      .from("events")
      .update(link)
      .eq("id", event.id)
      .eq("calendar_id", event.calendar_id);
    if (error) throw error;
  },
};

/** The HTTP status a googleapis (gaxios) error carries, if any. */
function providerStatus(error: unknown): number | undefined {
  const e = error as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  for (const v of [e?.response?.status, e?.status, e?.code]) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d{3}$/.test(v)) return Number(v);
  }
  return undefined;
}

/**
 * The provider half of an edit. The local row is already updated; this
 * pushes its new state. Never throws — the edit has happened in Kinboard
 * either way, and the caller reports `sync` rather than pretending.
 *
 * Google: `events.patch` on the stored id. A timed event is sent as
 * `dateTime` with the family's zone (and `date: null`, because a patch
 * merges and a stale `date` beside a new `dateTime` is rejected). An
 * all-day event's dates are sent only when `allDayDates` says the edit
 * touched them, as `date` with Google's **exclusive** end.
 *
 * CalDAV: a PUT of the whole resource built from the row — CalDAV has no
 * partial update — guarded by the stored ETag, exactly as
 * `/api/caldav/events` PATCH does. One occurrence of a repeating event is
 * refused: the series is one calendar object, and Kinboard has nowhere to
 * keep an override.
 *
 * A Google event never written there answers `not_linked`. A CalDAV event
 * never written to the server is created there instead, as
 * `/api/caldav/events` PATCH does.
 */
export async function syncUpdatedCalendarEvent(
  familyId: string,
  calendar: WritableCalendar,
  event: StoredCalendarEvent,
  allDayDates: { start: string; endExclusive: string } | undefined,
  timeZone: string,
  deps: WriteThroughDeps = defaultWriteThroughDeps,
): Promise<CalendarSync> {
  const mode = calendarWriteMode(calendar);
  if (mode === "read_only") return { provider: "local", synced: false, reason: "calendar_read_only" };
  if (mode === "local") return { provider: "local", synced: true };

  try {
    if (mode === "google") {
      if (!event.google_event_id) return { provider: "google", synced: false, reason: "not_linked" };
      const api = await deps.googleEvents(familyId);
      if (!api) return { provider: "google", synced: false, reason: "google_not_connected" };
      const requestBody: calendar_v3.Schema$Event = {
        summary: event.title,
        description: event.description,
        location: event.location,
      };
      if (event.person_id !== undefined) requestBody.extendedProperties = googlePersonProperty(event.person_id);
      if (!event.all_day) {
        requestBody.start = { dateTime: event.start_at, timeZone, date: null };
        requestBody.end = { dateTime: event.end_at, timeZone, date: null };
      } else if (allDayDates) {
        requestBody.start = { date: allDayDates.start, dateTime: null, timeZone: null };
        requestBody.end = { date: allDayDates.endExclusive, dateTime: null, timeZone: null };
      }
      await api.patch({ calendarId: calendar.google_calendar_id!, eventId: event.google_event_id, requestBody });
      return { provider: "google", synced: true };
    }

    if (isRecurrenceInstance(event.google_event_id)) return { provider: "caldav", synced: false, reason: "recurring" };
    const uid = caldavUidFromExternalId(event.google_event_id);
    if (!uid || !event.caldav_href) {
      // Never reached the server — usually a create whose PUT failed.
      // Creating it now is the repair /api/caldav/events PATCH makes too,
      // and leaves the caller with a synced event either way.
      return await syncCreatedCalendarEvent(familyId, calendar, event, undefined, timeZone, deps);
    }
    const api = await deps.caldavEvents(familyId, calendar);
    if (!api) return { provider: "caldav", synced: false, reason: "caldav_not_connected" };
    const iCalString = buildCaldavCalendarObject(event, uid, timeZone);
    const { etag } = await api.update(event.caldav_href, iCalString, event.caldav_etag);
    await deps.saveCaldavEtag(event, etag);
    return { provider: "caldav", synced: true };
  } catch (error) {
    if (error instanceof CaldavConflictError) return { provider: mode, synced: false, reason: "conflict" };
    console.error("[integration-calendar] provider update failed", error);
    return { provider: mode, synced: false, reason: "provider_write_failed" };
  }
}

/**
 * The provider half of a delete, run **before** the local delete, as the
 * browser does (`useDeleteEvent`): deleting locally while the event
 * survives on the provider means the next sync pulls it straight back.
 * Never throws; `deleteVerdict` turns the result into go / no-go.
 *
 * An event already gone from the provider (404/410) counts as deleted.
 */
export async function syncDeletedCalendarEvent(
  familyId: string,
  calendar: WritableCalendar,
  event: StoredCalendarEvent,
  deps: WriteThroughDeps = defaultWriteThroughDeps,
): Promise<CalendarSync> {
  const mode = calendarWriteMode(calendar);
  if (mode === "read_only") return { provider: "local", synced: false, reason: "calendar_read_only" };
  if (mode === "local") return { provider: "local", synced: true };

  try {
    if (mode === "google") {
      if (!event.google_event_id) return { provider: "google", synced: false, reason: "not_linked" };
      const api = await deps.googleEvents(familyId);
      if (!api) return { provider: "google", synced: false, reason: "google_not_connected" };
      try {
        await api.delete({ calendarId: calendar.google_calendar_id!, eventId: event.google_event_id });
      } catch (error) {
        const status = providerStatus(error);
        if (status !== 404 && status !== 410) throw error;
      }
      return { provider: "google", synced: true };
    }

    if (isRecurrenceInstance(event.google_event_id)) return { provider: "caldav", synced: false, reason: "recurring" };
    if (!event.caldav_href) return { provider: "caldav", synced: false, reason: "not_linked" };
    const api = await deps.caldavEvents(familyId, calendar);
    if (!api) return { provider: "caldav", synced: false, reason: "caldav_not_connected" };
    // deleteCaldavEvent already treats 404/410 as the desired end state.
    await api.delete(event.caldav_href, event.caldav_etag);
    return { provider: "caldav", synced: true };
  } catch (error) {
    if (error instanceof CaldavConflictError) return { provider: mode, synced: false, reason: "conflict" };
    console.error("[integration-calendar] provider delete failed", error);
    return { provider: mode, synced: false, reason: "provider_write_failed" };
  }
}

export type DeleteVerdict =
  | { proceed: true }
  | { proceed: false; status: 409 | 502; code: "conflict" | "upstream_unavailable"; error: string };

/**
 * Whether the local row may go after the provider half of a delete ran.
 * Synced, or never linked to the provider in the first place → yes.
 * Anything else keeps the row: a delete that silently undoes itself on the
 * next sync is worse than one that says it could not happen.
 */
export function deleteVerdict(sync: CalendarSync): DeleteVerdict {
  if (sync.synced || sync.reason === "not_linked") return { proceed: true };
  if (sync.reason === "recurring") {
    return {
      proceed: false, status: 409, code: "conflict",
      error: "This is one occurrence of a repeating event; delete the series in the calendar app",
    };
  }
  if (sync.reason === "conflict") {
    return {
      proceed: false, status: 409, code: "conflict",
      error: "The event changed on the calendar server since the last sync; try again after it syncs",
    };
  }
  return {
    proceed: false, status: 502, code: "upstream_unavailable",
    error: `The event could not be deleted from ${sync.provider === "caldav" ? "the CalDAV calendar" : "Google Calendar"}, so it was kept`,
  };
}
