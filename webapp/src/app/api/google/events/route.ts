import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { getMergedSetting, splitSecrets, upsertSecrets } from "@/lib/integration-secrets";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

interface GoogleCalendarSettings {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  email?: string;
  enabled_calendars?: string[];
}

async function getOAuth2Client(familyId: string) {
  const credentials = await getMergedSetting<GoogleCalendarSettings>(familyId, "google_calendar");

  if (!credentials?.access_token) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    expiry_date: credentials.expiry_date,
  });

  // Token refresh
  if (credentials.expiry_date && Date.now() >= credentials.expiry_date - 60000) {
    try {
      const { credentials: newTokens } = await oauth2Client.refreshAccessToken();

      await upsertSecrets(familyId, "google_calendar", {
        access_token: newTokens.access_token,
        ...(newTokens.refresh_token ? { refresh_token: newTokens.refresh_token } : {}),
      });

      const { publicValue } = splitSecrets("google_calendar", {
        ...credentials,
        expiry_date: newTokens.expiry_date,
      });

      const supabase = createAdminClient();

      await (supabase as any)
        .from("settings")
        .update({
          value: publicValue,
          updated_at: new Date().toISOString(),
        })
        .eq("family_id", familyId)
        .eq("key", "google_calendar");

      oauth2Client.setCredentials(newTokens);
    } catch (refreshError) {
      console.error("Token refresh failed:", refreshError);
      return null;
    }
  }

  return { oauth2Client, settings: credentials };
}

// Every verb here reaches a family's connected Google account with the
// refresh token stored for it, so the family named in the request decides
// whose calendar gets read, written or deleted. It was decided by the caller.

// GET: Fetch events from enabled calendars
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");
  const timeMin = searchParams.get("time_min") || new Date().toISOString();
  const timeMax = searchParams.get("time_max") || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const result = await getOAuth2Client(familyId);

  if (!result) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 401 }
    );
  }

  const { oauth2Client, settings } = result;
  const enabledCalendars = settings.enabled_calendars || [];

  if (enabledCalendars.length === 0) {
    return NextResponse.json({ events: [] });
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const allEvents: Array<{
      id: string;
      calendarId: string;
      title: string;
      description?: string;
      location?: string;
      start: string;
      end: string;
      allDay: boolean;
      color?: string;
      person_id?: string;
    }> = [];

    // Fetch events from each enabled calendar
    for (const calendarId of enabledCalendars) {
      try {
        const { data } = await calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
        });

        for (const event of data.items || []) {
          if (!event.id || !event.summary) continue;

          const start = event.start?.dateTime || event.start?.date;
          const end = event.end?.dateTime || event.end?.date;

          if (!start || !end) continue;

          // Extract person_id from extended properties if available
          const personId = event.extendedProperties?.private?.person_id;

          allEvents.push({
            id: event.id,
            calendarId,
            title: event.summary,
            description: event.description || undefined,
            location: event.location || undefined,
            start,
            end,
            allDay: !event.start?.dateTime,
            color: event.colorId || undefined,
            person_id: personId || undefined,
          });
        }
      } catch (calError) {
        console.error(`Error fetching events from calendar ${calendarId}:`, calError);
      }
    }

    // Sort by start time
    allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    return NextResponse.json({ events: allEvents });
  } catch (err) {
    console.error("Error fetching events:", err);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}

// POST: Create event on Google Calendar
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { family_id, event_id, calendar_id, title, description, location, start_at, end_at, all_day, person_id } = body;

  if (!family_id || !calendar_id) {
    return NextResponse.json(
      { error: "family_id and calendar_id are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const result = await getOAuth2Client(family_id);
  if (!result) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 401 }
    );
  }

  const supabase = createAdminClient();

  // Get calendar's google_calendar_id
   
  const { data: calendarData } = await (supabase as any)
    .from("calendars")
    .select("google_calendar_id")
    .eq("id", calendar_id)
    .single();

  if (!calendarData?.google_calendar_id) {
    return NextResponse.json(
      { error: "Calendar not linked to Google" },
      { status: 400 }
    );
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: result.oauth2Client });

    // Build event object for Google
    const googleEvent: {
      summary: string;
      description?: string;
      location?: string;
      start: { dateTime?: string; date?: string; timeZone?: string };
      end: { dateTime?: string; date?: string; timeZone?: string };
      extendedProperties?: { private: Record<string, string> };
    } = {
      summary: title,
      description: description || undefined,
      location: location || undefined,
      start: all_day
        ? { date: start_at.split("T")[0] }
        : { dateTime: start_at, timeZone: "Europe/Berlin" },
      end: all_day
        ? { date: end_at.split("T")[0] }
        : { dateTime: end_at, timeZone: "Europe/Berlin" },
    };

    // Store person_id in extended properties if provided
    if (person_id) {
      googleEvent.extendedProperties = {
        private: { person_id },
      };
    }

    const { data: createdEvent } = await calendar.events.insert({
      calendarId: calendarData.google_calendar_id,
      requestBody: googleEvent,
    });

    // Update local event with google_event_id if event_id provided
    if (event_id && createdEvent.id) {
       
      await (supabase as any)
        .from("events")
        .update({ google_event_id: createdEvent.id })
        .eq("id", event_id);
    }

    return NextResponse.json({
      success: true,
      google_event_id: createdEvent.id,
    });
  } catch (err) {
    console.error("Error creating Google event:", err);
    return NextResponse.json(
      { error: "Failed to create event on Google Calendar" },
      { status: 500 }
    );
  }
}

// PATCH: Update event on Google Calendar
export async function PATCH(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { family_id, event_id, title, description, location, start_at, end_at, all_day, person_id } = body;

  if (!family_id || !event_id) {
    return NextResponse.json(
      { error: "family_id and event_id are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const result = await getOAuth2Client(family_id);
  if (!result) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 401 }
    );
  }

  const supabase = createAdminClient();

  // Get event with its calendar's google_calendar_id
   
  const { data: eventData } = await (supabase as any)
    .from("events")
    .select("google_event_id, calendar:calendars(google_calendar_id)")
    .eq("id", event_id)
    .single();

  if (!eventData?.google_event_id) {
    return NextResponse.json(
      { error: "Event not linked to Google" },
      { status: 400 }
    );
  }

  const googleCalendarId = eventData.calendar?.google_calendar_id;
  if (!googleCalendarId) {
    return NextResponse.json(
      { error: "Calendar not linked to Google" },
      { status: 400 }
    );
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: result.oauth2Client });

    // Build update object
    const googleEvent: {
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime?: string; date?: string; timeZone?: string };
      end?: { dateTime?: string; date?: string; timeZone?: string };
      extendedProperties?: { private: Record<string, string> };
    } = {};

    if (title !== undefined) googleEvent.summary = title;
    if (description !== undefined) googleEvent.description = description;
    if (location !== undefined) googleEvent.location = location;
    if (start_at !== undefined) {
      googleEvent.start = all_day
        ? { date: start_at.split("T")[0] }
        : { dateTime: start_at, timeZone: "Europe/Berlin" };
    }
    if (end_at !== undefined) {
      googleEvent.end = all_day
        ? { date: end_at.split("T")[0] }
        : { dateTime: end_at, timeZone: "Europe/Berlin" };
    }
    if (person_id !== undefined) {
      googleEvent.extendedProperties = {
        private: { person_id: person_id || "" },
      };
    }

    await calendar.events.patch({
      calendarId: googleCalendarId,
      eventId: eventData.google_event_id,
      requestBody: googleEvent,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error updating Google event:", err);
    return NextResponse.json(
      { error: "Failed to update event on Google Calendar" },
      { status: 500 }
    );
  }
}

// DELETE: Delete event from Google Calendar
export async function DELETE(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const { family_id, event_id } = body;

  if (!family_id || !event_id) {
    return NextResponse.json(
      { error: "family_id and event_id are required" },
      { status: 400 }
    );
  }

  if (!familyMatchesSession(auth.session, family_id)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const result = await getOAuth2Client(family_id);
  if (!result) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 401 }
    );
  }

  const supabase = createAdminClient();

  // Get event with its calendar's google_calendar_id
   
  const { data: eventData } = await (supabase as any)
    .from("events")
    .select("google_event_id, calendar:calendars(google_calendar_id)")
    .eq("id", event_id)
    .single();

  if (!eventData?.google_event_id) {
    // Event not linked to Google, nothing to delete
    return NextResponse.json({ success: true, skipped: true });
  }

  const googleCalendarId = eventData.calendar?.google_calendar_id;
  if (!googleCalendarId) {
    return NextResponse.json({ success: true, skipped: true });
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: result.oauth2Client });

    await calendar.events.delete({
      calendarId: googleCalendarId,
      eventId: eventData.google_event_id,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Error deleting Google event:", err);
    return NextResponse.json(
      { error: "Failed to delete event from Google Calendar" },
      { status: 500 }
    );
  }
}
