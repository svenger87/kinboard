import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";
import { getGoogleOAuth2Client } from "@/lib/google-calendar-auth";
import { getCaldavCredentials } from "@/lib/caldav-credentials";
import { createCaldavClient, createCaldavEvent } from "@/lib/caldav-client";
import { buildCaldavCalendarObject, caldavExternalId, newCaldavUid } from "@/lib/caldav-serialize";

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
}

/** Write a newly-created local row through to its configured provider. */
export async function syncCreatedCalendarEvent(
  familyId: string,
  calendar: WritableCalendar,
  event: CreatedCalendarEvent,
  allDayDates?: { start: string; endExclusive: string },
  timeZone = process.env.TZ ?? "Europe/Berlin",
): Promise<{ provider: "local" | "google" | "caldav"; synced: boolean; reason?: string }> {
  const mode = calendarWriteMode(calendar);
  if (mode === "read_only") return { provider: "local", synced: false, reason: "calendar_read_only" };
  if (mode === "local") return { provider: "local", synced: true };
  if (mode === "google" && event.all_day && !allDayDates) {
    return { provider: "google", synced: false, reason: "all_day_dates_missing" };
  }

  const supabase = createAdminClient();
  try {
    if (mode === "google") {
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

    const credentials = await getCaldavCredentials(familyId, calendar.id);
    if (!credentials) return { provider: "caldav", synced: false, reason: "caldav_not_connected" };
    const client = await createCaldavClient({
      serverUrl: calendar.caldav_server_url ?? calendar.caldav_url!,
      username: credentials.username,
      password: credentials.password,
    });
    const uid = newCaldavUid();
    const iCalString = buildCaldavCalendarObject(event, uid, timeZone);
    const { href, etag } = await createCaldavEvent(client, calendar.caldav_url!, uid, iCalString);
    const { error } = await (supabase as any)
      .from("events")
      .update({ google_event_id: caldavExternalId(uid), caldav_href: href, caldav_etag: etag })
      .eq("id", event.id)
      .eq("calendar_id", calendar.id);
    if (error) throw error;
    return { provider: "caldav", synced: true };
  } catch (error) {
    // The local event already exists. Report the unsynced state rather than
    // claim success or retry a provider create that might have succeeded.
    console.error("[integration-calendar] provider create failed", error);
    return { provider: mode, synced: false, reason: "provider_write_failed" };
  }
}
