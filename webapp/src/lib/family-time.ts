import { createAdminClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/integration-event-input";

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
export async function familyTimeZone(familyId: string): Promise<string> {
  const { data } = await (createAdminClient() as any)
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
