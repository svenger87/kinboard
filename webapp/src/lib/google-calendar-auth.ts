import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/server";
import { getMergedSetting, splitSecrets, upsertSecrets } from "@/lib/integration-secrets";

interface GoogleCalendarSettings {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  email?: string;
  enabled_calendars?: string[];
}

/** Shared by the browser route and the Integration API; the sync routes keep their own copies. */
export async function getGoogleOAuth2Client(familyId: string) {
  const credentials = await getMergedSetting<GoogleCalendarSettings>(familyId, "google_calendar");
  if (!credentials?.access_token) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    expiry_date: credentials.expiry_date,
  });

  if (credentials.expiry_date && Date.now() >= credentials.expiry_date - 60_000) {
    try {
      const { credentials: refreshed } = await oauth2Client.refreshAccessToken();
      await upsertSecrets(familyId, "google_calendar", {
        access_token: refreshed.access_token,
        ...(refreshed.refresh_token ? { refresh_token: refreshed.refresh_token } : {}),
      });
      const { publicValue } = splitSecrets("google_calendar", {
        ...credentials,
        expiry_date: refreshed.expiry_date,
      });
      await (createAdminClient() as any)
        .from("settings")
        .update({ value: publicValue, updated_at: new Date().toISOString() })
        .eq("family_id", familyId)
        .eq("key", "google_calendar");
      oauth2Client.setCredentials(refreshed);
    } catch (error) {
      console.error("Token refresh failed:", error);
      return null;
    }
  }
  return { oauth2Client, settings: credentials };
}
