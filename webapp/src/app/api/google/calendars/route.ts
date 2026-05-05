import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";

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
  const supabase = createAdminClient();

  // Get stored credentials - use type assertion to bypass Supabase's strict typing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settingsRow } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "google_calendar")
    .single();

  if (!settingsRow?.value) {
    return null;
  }

  const credentials = settingsRow.value as GoogleCalendarSettings;
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

  // Check if token needs refresh
  if (credentials.expiry_date && Date.now() >= credentials.expiry_date - 60000) {
    try {
      const { credentials: newTokens } = await oauth2Client.refreshAccessToken();

      // Update stored credentials
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("settings")
        .update({
          value: {
            ...credentials,
            access_token: newTokens.access_token,
            expiry_date: newTokens.expiry_date,
          },
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

  return oauth2Client;
}

// GET: Fetch list of calendars
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const familyId = searchParams.get("family_id");

  if (!familyId) {
    return NextResponse.json(
      { error: "family_id is required" },
      { status: 400 }
    );
  }

  const oauth2Client = await getOAuth2Client(familyId);

  if (!oauth2Client) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 401 }
    );
  }

  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const { data } = await calendar.calendarList.list();

    const calendars = (data.items || []).map((cal) => ({
      id: cal.id,
      name: cal.summary,
      color: cal.backgroundColor,
      primary: cal.primary || false,
      accessRole: cal.accessRole,
    }));

    return NextResponse.json({ calendars });
  } catch (err) {
    console.error("Error fetching calendars:", err);
    return NextResponse.json(
      { error: "Failed to fetch calendars" },
      { status: 500 }
    );
  }
}

// POST: Update enabled calendars
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { family_id, enabled_calendars } = body;

  if (!family_id || !Array.isArray(enabled_calendars)) {
    return NextResponse.json(
      { error: "family_id and enabled_calendars are required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Get current settings - use type assertion to bypass Supabase's strict typing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: settings } = await (supabase as any)
    .from("settings")
    .select("value")
    .eq("family_id", family_id)
    .eq("key", "google_calendar")
    .single();

  if (!settings?.value) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 401 }
    );
  }

  // Update enabled calendars
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("settings")
    .update({
      value: {
        ...(settings.value as object),
        enabled_calendars,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("family_id", family_id)
    .eq("key", "google_calendar");

  if (error) {
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
