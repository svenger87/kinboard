import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";
import { matchPersonForEvent, PersonMappingRule } from "@/lib/calendar-person-matcher";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

interface GoogleCalendarSettings {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  email?: string;
  enabled_calendars?: string[];
  mapping_rules?: PersonMappingRule[];
  last_sync?: string;
  auto_sync?: boolean;
  last_auto_sync?: string;
  auto_sync_error?: string | null;
}

interface CalendarInfo {
  id: string;
  person_id?: string;
}

interface SyncResult {
  familyId: string;
  success: boolean;
  synced?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  error?: string;
}

// Sync a single family's Google Calendar
async function syncFamilyCalendar(familyId: string): Promise<SyncResult> {
  const supabase = createAdminClient();

  // Get settings for this family
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settingsRow } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "google_calendar")
    .single();

  if (!settingsRow?.value) {
    return { familyId, success: false, error: "No Google Calendar settings" };
  }

  const settings = settingsRow.value as GoogleCalendarSettings;
  if (!settings?.access_token) {
    return { familyId, success: false, error: "No access token" };
  }

  const enabledCalendars = settings.enabled_calendars || [];
  const mappingRules = settings.mapping_rules || [];

  if (enabledCalendars.length === 0) {
    return { familyId, success: true, synced: 0, created: 0, updated: 0, deleted: 0 };
  }

  // Create OAuth client
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: settings.access_token,
    refresh_token: settings.refresh_token,
    expiry_date: settings.expiry_date,
  });

  // Token refresh if needed
  if (settings.expiry_date && Date.now() >= settings.expiry_date - 60000) {
    try {
      const { credentials: newTokens } = await oauth2Client.refreshAccessToken();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("settings")
        .update({
          value: {
            ...settings,
            access_token: newTokens.access_token,
            expiry_date: newTokens.expiry_date,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("family_id", familyId)
        .eq("key", "google_calendar");

      oauth2Client.setCredentials(newTokens);
    } catch (refreshError) {
      console.error(`[google-sync-cron] Token refresh failed for family ${familyId}:`, refreshError);
      return { familyId, success: false, error: "Token refresh failed" };
    }
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    // Get calendars from database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dbCalendars } = await (supabase as any)
      .from("calendars")
      .select("id, google_calendar_id, person_id")
      .eq("family_id", familyId);

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

        const { data: calInfo } = await calendar.calendarList.get({
          calendarId: googleCalendarId,
        });

        let localCalendar = calendarPersonMap.get(googleCalendarId);

        if (!localCalendar) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: newCal, error: createError } = await (supabase as any)
            .from("calendars")
            .insert({
              family_id: familyId,
              name: calInfo.summary || "Google Calendar",
              google_calendar_id: googleCalendarId,
              color: calInfo.backgroundColor || "#3b82f6",
            })
            .select()
            .single();

          if (createError) {
            console.error(`[google-sync-cron] Error creating calendar for family ${familyId}:`, createError);
            continue;
          }

          localCalendar = { id: newCal.id, person_id: undefined };
          calendarPersonMap.set(googleCalendarId, localCalendar);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("calendars")
            .update({
              name: calInfo.summary || "Google Calendar",
              color: calInfo.backgroundColor || "#3b82f6",
              updated_at: new Date().toISOString(),
            })
            .eq("id", localCalendar.id);
        }

        for (const event of data.items || []) {
          if (!event.id) continue;

          // Handle cancelled/deleted events
          if (event.status === "cancelled") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: existingToDelete } = await (supabase as any)
              .from("events")
              .select("id")
              .eq("google_event_id", event.id)
              .single();

            if (existingToDelete) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

          let personId = event.extendedProperties?.private?.person_id || undefined;
          if (!personId) {
            personId = localCalendar.person_id;
          }
          if (!personId && mappingRules.length > 0) {
            personId = matchPersonForEvent(event.summary, mappingRules) || undefined;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any)
              .from("events")
              .update(eventData)
              .eq("id", existing.id);
            updated++;
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (supabase as any).from("events").insert(eventData);
            created++;
          }
        }
      } catch (calError) {
        console.error(`[google-sync-cron] Error syncing calendar ${googleCalendarId} for family ${familyId}:`, calError);
      }
    }

    // Update timestamps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("settings")
      .update({
        value: {
          ...settings,
          last_sync: new Date().toISOString(),
          last_auto_sync: new Date().toISOString(),
          auto_sync_error: null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("family_id", familyId)
      .eq("key", "google_calendar");

    return {
      familyId,
      success: true,
      synced: googleEventIds.size,
      created,
      updated,
      deleted,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[google-sync-cron] Sync error for family ${familyId}:`, err);

    // Store error in settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("settings")
      .update({
        value: {
          ...settings,
          last_auto_sync: new Date().toISOString(),
          auto_sync_error: errorMessage,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("family_id", familyId)
      .eq("key", "google_calendar");

    return { familyId, success: false, error: errorMessage };
  }
}

// POST: Batch sync all families with auto_sync enabled
export async function POST(request: NextRequest) {
  // Validate cron secret
  if (!CRON_SECRET) {
    console.error("[google-sync-cron] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    console.warn("[google-sync-cron] Unauthorized access attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[google-sync-cron] Starting batch sync");

  const supabase = createAdminClient();

  // Get all families with auto_sync enabled
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settingsRows, error } = await (supabase as any)
    .from("settings")
    .select("family_id, value")
    .eq("key", "google_calendar");

  if (error) {
    console.error("[google-sync-cron] Error fetching settings:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  // Filter to only families with auto_sync enabled and valid tokens
  const familiesToSync = (settingsRows || []).filter((row: { value: GoogleCalendarSettings }) => {
    const settings = row.value as GoogleCalendarSettings;
    return settings?.auto_sync === true && settings?.access_token;
  });

  console.log(`[google-sync-cron] Found ${familiesToSync.length} families with auto_sync enabled`);

  if (familiesToSync.length === 0) {
    return NextResponse.json({
      processed: 0,
      succeeded: 0,
      failed: 0,
      message: "No families with auto_sync enabled",
      timestamp: new Date().toISOString(),
    });
  }

  // Process each family independently
  const results = await Promise.allSettled(
    familiesToSync.map((row: { family_id: string }) => syncFamilyCalendar(row.family_id))
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.success
  ).length;
  const failed = results.filter(
    (r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.success)
  ).length;

  // Log individual results
  results.forEach((result, index) => {
    const familyId = familiesToSync[index].family_id;
    if (result.status === "fulfilled") {
      if (result.value.success) {
        console.log(`[google-sync-cron] Family ${familyId}: synced=${result.value.synced}, created=${result.value.created}, updated=${result.value.updated}, deleted=${result.value.deleted}`);
      } else {
        console.error(`[google-sync-cron] Family ${familyId}: failed - ${result.value.error}`);
      }
    } else {
      console.error(`[google-sync-cron] Family ${familyId}: rejected - ${result.reason}`);
    }
  });

  console.log(`[google-sync-cron] Batch sync complete: ${succeeded} succeeded, ${failed} failed`);

  return NextResponse.json({
    processed: familiesToSync.length,
    succeeded,
    failed,
    timestamp: new Date().toISOString(),
  });
}
