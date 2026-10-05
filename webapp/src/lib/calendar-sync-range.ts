import { createAdminClient } from "@/lib/supabase/server";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/**
 * How far ahead ICS and CalDAV calendars sync, per family (discussion #349).
 *
 * The past side of the window is fixed at `ICS_WINDOW_PAST_DAYS` (30 days,
 * lib/ics-fetcher.ts) and not configurable — only the future side is, because
 * that's the one that truncates a school year's fixture list or a shared
 * iCloud calendar at a fixed two months. Three choices only, so "invalid"
 * means "anything else, including no setting at all" and always falls back
 * to the pre-existing default rather than becoming an error a family sees.
 */
export const CALENDAR_SYNC_RANGE_DAYS = [60, 180, 365] as const;
export type CalendarSyncRangeDays = (typeof CALENDAR_SYNC_RANGE_DAYS)[number];
export const DEFAULT_CALENDAR_SYNC_RANGE_DAYS: CalendarSyncRangeDays = 60;

export function isCalendarSyncRangeDays(value: unknown): value is CalendarSyncRangeDays {
  return (
    typeof value === "number" &&
    (CALENDAR_SYNC_RANGE_DAYS as readonly number[]).includes(value)
  );
}

/** A missing or invalid stored value means 60 — never a wider sync than asked for. */
export function normalizeCalendarSyncRangeDays(value: unknown): CalendarSyncRangeDays {
  return isCalendarSyncRangeDays(value) ? value : DEFAULT_CALENDAR_SYNC_RANGE_DAYS;
}

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
