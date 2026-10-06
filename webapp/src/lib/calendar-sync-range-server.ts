import { createAdminClient } from "@/lib/supabase/server";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { normalizeCalendarSyncRangeDays, type CalendarSyncRangeDays } from "@/lib/calendar-sync-range";

// Server-only half of lib/calendar-sync-range.ts: it reads the database, so
// the settings card (a client component) must not import it.

/**
 * The family's configured future-days value, read server-side. Every ICS and
 * CalDAV sync path — cron and user-triggered, and the initial sync a CalDAV
 * calendar gets on creation — calls this, so a family that picked 365 gets
 * the same window no matter which path ran it. Mirrors the shape of
 * `familyTimeZone` in lib/family-time.ts.
 */
export async function familyCalendarSyncFutureDays(
  familyId: string,
  db: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<CalendarSyncRangeDays> {
  const { data } = await (db as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.calendarSyncRange)
    .maybeSingle();
  return normalizeCalendarSyncRangeDays(data?.value);
}
