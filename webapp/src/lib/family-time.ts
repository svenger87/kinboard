import { createAdminClient } from "@/lib/supabase/server";
import { isValidTimeZone, zonedWallTimeToUtc } from "@/lib/integration-event-input";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { parseRegionSetting, type HolidayRegionSetting } from "@/lib/holidays/region";

/**
 * The zone that turns an all-day date into instants, and that answers "what
 * day is it for this family right now": the family's `timezone` setting, as
 * the summary uses, else the container's `TZ` as the rest of the server does.
 *
 * Moved here from calendar/events/route.ts (RFC-011 task 0) because
 * `complete_task` and `get_meal_plan` need the same answer outside the
 * calendar route — "today" has to mean the family's today, not the server
 * container's, or a recurring task completed at 11pm Berlin time marks the
 * wrong day done.
 */
export async function familyTimeZone(
  familyId: string,
  db: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<string> {
  const { data } = await (db as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", "timezone")
    .maybeSingle();
  if (isValidTimeZone(data?.value)) return data.value;
  return isValidTimeZone(process.env.TZ) ? process.env.TZ : "Europe/Berlin";
}

/**
 * `now` as a calendar date (`YYYY-MM-DD`) in `timeZone`.
 *
 * `Intl.DateTimeFormat("en-CA", …)` rather than hand-rolled arithmetic: en-CA
 * is the locale whose default date format already is ISO's `YYYY-MM-DD`, so
 * this inherits the host's time zone database instead of reimplementing it.
 */
export function familyDateKey(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

/**
 * The instant the family's today began: local midnight of `now`'s date in
 * `timeZone` (01:00 on a day whose midnight a DST change skips). For a Berlin
 * family at 2026-10-01T10:00Z that is 2026-09-30T22:00Z, not 00:00Z — what
 * "energy today" is counted from.
 */
export function familyMidnight(now: Date, timeZone: string): Date {
  const day = Date.parse(`${familyDateKey(now, timeZone)}T00:00:00Z`) / 86_400_000;
  return zonedWallTimeToUtc(day, 0, timeZone);
}

/** A calendar date `n` days from `day` (`YYYY-MM-DD`). Date arithmetic only — no zone, no DST. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The family's today and tomorrow at `now`, as `YYYY-MM-DD`. The family
 * summary dates everything from this one pair, so school_tomorrow and
 * meal_tomorrow can never be about different days.
 */
export function familyDays(now: Date, timeZone: string): { today: string; tomorrow: string } {
  const today = familyDateKey(now, timeZone);
  return { today, tomorrow: addDays(today, 1) };
}

/**
 * The family's `holiday_region` (RFC-014 §4.2), validated: null when the
 * family has no row, `{ code: null }` when the row names no offered region.
 * Throws on a failed read, as fetchSchoolBreaks does, so a caller can tell
 * "no region" from "could not look". Filtered by family: the admin client
 * bypasses RLS.
 */
export async function familyHolidayRegion(
  familyId: string,
  db: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<HolidayRegionSetting | null> {
  const { data, error } = await (db as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.holidayRegion)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return parseRegionSetting(data.value) ?? { code: null, chosen: false };
}
