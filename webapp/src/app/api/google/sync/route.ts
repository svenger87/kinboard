import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";
import { matchPersonForEvent, PersonMappingRule } from "@/lib/calendar-person-matcher";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

interface GoogleCalendarSettings {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  email?: string;
  enabled_calendars?: string[];
  mapping_rules?: PersonMappingRule[];
  last_sync?: string;
  auto_sync_error?: string | null;
  needs_reauth?: boolean;
}

// invalid_grant = dead refresh token (revoked / expired consent) → the user
// must reconnect. Distinct from a transient refresh blip.
function isInvalidGrant(e: unknown): boolean {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err?.response?.data?.error === "invalid_grant" || (err?.message?.includes("invalid_grant") ?? false);
}

interface CalendarInfo {
  id: string;
  person_id?: string;
}

async function getOAuth2Client(familyId: string) {
  const supabase = createAdminClient();

   
  const { data: settings } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "google_calendar")
    .single();

  if (!settings?.value) {
    return null;
  }

  const credentials = settings.value as GoogleCalendarSettings;
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

       
      await (supabase as any)
        .from("settings")
        .update({
          value: {
            ...credentials,
            access_token: newTokens.access_token,
            expiry_date: newTokens.expiry_date,
            needs_reauth: false,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("family_id", familyId)
        .eq("key", "google_calendar");

      oauth2Client.setCredentials(newTokens);
    } catch (refreshError) {
      console.error("Token refresh failed:", refreshError);
      if (isInvalidGrant(refreshError)) {
        await (supabase as any)
          .from("settings")
          .update({
            value: { ...credentials, needs_reauth: true },
            updated_at: new Date().toISOString(),
          })
          .eq("family_id", familyId)
          .eq("key", "google_calendar");
      }
      return null;
    }
  }

  return { oauth2Client, settings: credentials, supabase };
}

// POST: Sync events from Google Calendar to local database
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { family_id } = body;

  if (!family_id) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  const result = await getOAuth2Client(family_id);

  if (!result) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 401 }
    );
  }

  const { oauth2Client, settings, supabase } = result;
  const enabledCalendars = settings.enabled_calendars || [];
  const mappingRules = settings.mapping_rules || [];

  if (enabledCalendars.length === 0) {
    return NextResponse.json({
      synced: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      message: "No calendars enabled",
    });
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Get calendars from database to find person associations
     
    const { data: dbCalendars } = await (supabase as any)
      .from("calendars")
      .select("id, google_calendar_id, person_id")
      .eq("family_id", family_id);

    const calendarPersonMap = new Map<string, CalendarInfo>();
    for (const cal of dbCalendars || []) {
      if (cal.google_calendar_id) {
        calendarPersonMap.set(cal.google_calendar_id, {
          id: cal.id,
          person_id: cal.person_id || undefined,
        });
      }
    }

    // Fetch events for sync window: 1 year past to 1 year future
    const timeMin = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const googleEventIds = new Set<string>();
    let created = 0;
    let updated = 0;
    let deleted = 0;

    for (const googleCalendarId of enabledCalendars) {
      try {
        // Fetch events including deleted ones to detect removals
        const { data } = await calendar.events.list({
          calendarId: googleCalendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          showDeleted: true,
        });

        // Get Google calendar info from CalendarList (which has backgroundColor)
        const { data: calInfo } = await calendar.calendarList.get({
          calendarId: googleCalendarId,
        });

        console.log(`Calendar ${googleCalendarId}: backgroundColor=${calInfo.backgroundColor}, foregroundColor=${calInfo.foregroundColor}, colorId=${calInfo.colorId}`);

        // Find or create local calendar for this Google calendar
        let localCalendar = calendarPersonMap.get(googleCalendarId);

        if (!localCalendar) {
          // Create local calendar with proper color
           
          const { data: newCal, error: createError } = await (supabase as any)
            .from("calendars")
            .insert({
              family_id,
              name: calInfo.summary || "Google Calendar",
              google_calendar_id: googleCalendarId,
              color: calInfo.backgroundColor || "#3b82f6",
            })
            .select()
            .single();

          if (createError) {
            console.error("Error creating calendar:", createError);
            continue;
          }

          localCalendar = { id: newCal.id, person_id: undefined };
          calendarPersonMap.set(googleCalendarId, localCalendar);
        } else {
          // Update existing calendar's name and color from Google
          const colorToUse = calInfo.backgroundColor || "#3b82f6";
          console.log(`Updating calendar ${localCalendar.id} with color ${colorToUse}`);
           
          const { error: updateError } = await (supabase as any)
            .from("calendars")
            .update({
              name: calInfo.summary || "Google Calendar",
              color: colorToUse,
              updated_at: new Date().toISOString(),
            })
            .eq("id", localCalendar.id);

          if (updateError) {
            console.error(`Error updating calendar ${localCalendar.id}:`, updateError);
          }
        }

        // Process events
        for (const event of data.items || []) {
          if (!event.id) continue;

          // Handle cancelled/deleted events
          if (event.status === "cancelled") {
             
            const { data: existingToDelete } = await (supabase as any)
              .from("events")
              .select("id")
              .eq("google_event_id", event.id)
              .single();

            if (existingToDelete) {
               
              await (supabase as any).from("events").delete().eq("id", existingToDelete.id);
              deleted++;
            }
            continue;
          }

          // Skip events without required fields
          if (!event.summary) continue;

          const isAllDay = !event.start?.dateTime;
          let startAt: string;
          let endAt: string;

          if (isAllDay) {
            // All-day events: Google returns date strings like "2024-01-01"
            // The end date is EXCLUSIVE (a 1-day event on Jan 1 has end "2024-01-02")
            const startDate = event.start?.date;
            const endDate = event.end?.date;

            if (!startDate || !endDate) continue;

            // Subtract 1 day from end since Google uses exclusive end dates
            const endDateObj = new Date(`${endDate}T12:00:00Z`);
            endDateObj.setDate(endDateObj.getDate() - 1);
            const actualEndDate = `${endDateObj.getFullYear()}-${String(endDateObj.getMonth() + 1).padStart(2, '0')}-${String(endDateObj.getDate()).padStart(2, '0')}`;

            // Store as noon UTC - this avoids timezone issues where midnight UTC
            // becomes previous/next day in local timezones
            startAt = `${startDate}T12:00:00Z`;
            endAt = `${actualEndDate}T12:00:00Z`;
          } else {
            // Timed events: use the dateTime directly (includes timezone info)
            const start = event.start?.dateTime;
            const end = event.end?.dateTime;

            if (!start || !end) continue;

            startAt = new Date(start).toISOString();
            endAt = new Date(end).toISOString();
          }

          googleEventIds.add(event.id);

          // Get person_id from extended properties first (stored by our app)
          // Then fall back to calendar's default person, then mapping rules
          let personId = event.extendedProperties?.private?.person_id || undefined;
          if (!personId) {
            personId = localCalendar.person_id;
          }
          if (!personId && mappingRules.length > 0) {
            personId = matchPersonForEvent(event.summary, mappingRules) || undefined;
          }

          // Check if event exists
           
          const { data: existing } = await (supabase as any)
            .from("events")
            .select("id, updated_at")
            .eq("google_event_id", event.id)
            .single();

          const eventData = {
            calendar_id: localCalendar.id,
            google_event_id: event.id,
            title: event.summary,
            description: event.description || null,
            location: event.location || null,
            start_at: startAt,
            end_at: endAt,
            all_day: isAllDay,
            person_id: personId || null,
            updated_at: new Date().toISOString(),
          };

          if (existing) {
            // Update existing event
             
            await (supabase as any)
              .from("events")
              .update(eventData)
              .eq("id", existing.id);
            updated++;
          } else {
            // Create new event
             
            await (supabase as any).from("events").insert(eventData);
            created++;
          }
        }
      } catch (calError) {
        console.error(`Error syncing calendar ${googleCalendarId}:`, calError);
      }
    }

    // Update last sync time
     
    await (supabase as any)
      .from("settings")
      .update({
        value: {
          ...settings,
          last_sync: new Date().toISOString(),
          needs_reauth: false,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("family_id", family_id)
      .eq("key", "google_calendar");

    return NextResponse.json({
      synced: googleEventIds.size,
      created,
      updated,
      deleted,
      message: "Sync completed successfully",
    });
  } catch (err) {
    console.error("Sync error:", err);
    return NextResponse.json(
      { error: "Sync failed" },
      { status: 500 }
    );
  }
}
