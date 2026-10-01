/**
 * Which `meal_plans` row a date belongs to, on the server.
 *
 * The client computes this from the household's `week_start` setting
 * (`getWeekStart` in `hooks/use-meal-planner.ts`), which accepts `monday`,
 * `sunday`, or `locale` — and resolves `locale` from `next-intl`'s
 * `useLocale()`, a per-device value (the cookie or `Accept-Language` header
 * of whichever browser opened the page). The server has no device and no
 * request-scoped locale to ask: an assistant token is not "a browser", so
 * there is no per-device signal to resolve against. `locale` is therefore
 * read here as `monday` — the same default `weekStartForLocale` gives every
 * non-`en` interface language, and the common case; a household that wants
 * Sunday explicitly says so in Settings.
 *
 * This only decides which container row a *new* entry is written into.
 * Reading (`GET /meals`) is unaffected: like the client's `useMealPlan`, it
 * selects by the entry's own `date` through `meal_plans!inner`, never by
 * `meal_plan_id`, so entries render correctly regardless of how their row
 * happens to be keyed (see `migration_zzzz_meal_plan_week_start.sql`).
 */

import { createAdminClient } from "@/lib/supabase/server";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/** date-fns' `weekStartsOn` convention: 0 is Sunday, 1 is Monday. */
export type WeekStartsOn = 0 | 1;

/**
 * What the `week_start` setting's stored value means on the server.
 *
 * Only an explicit `"sunday"` picks Sunday. `"monday"`, `"locale"`, an
 * absent row, and any other stored value all resolve to Monday — see the
 * file header for why `"locale"` cannot mean anything else here.
 */
export function resolveServerWeekStartsOn(preference: unknown): WeekStartsOn {
  return preference === "sunday" ? 0 : 1;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `dateKey` as a UTC day number. Throws on a value already validated elsewhere. */
function dayNumber(dateKey: string): number {
  const m = DATE_ONLY.exec(dateKey);
  if (!m) throw new Error(`not a YYYY-MM-DD date: ${dateKey}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000;
}

function dateFromDayNumber(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The first day of the week containing `dateKey`, as `YYYY-MM-DD`.
 *
 * Pure UTC day arithmetic on the date string itself — `dateKey` already is a
 * plain calendar date with no time zone of its own (a meal plan entry's
 * `date` column, same as the client's `getWeekStart`), so there is no wall
 * time to resolve and no DST edge to fall into. This can and does step back
 * across a month or year boundary, which is the case the test suite checks
 * for both settings.
 */
export function weekStartForDate(dateKey: string, weekStartsOn: WeekStartsOn): string {
  const day = dayNumber(dateKey);
  const dow = new Date(day * 86_400_000).getUTCDay(); // 0 Sun .. 6 Sat
  const offset = (dow - weekStartsOn + 7) % 7;
  return dateFromDayNumber(day - offset);
}

/** The family's effective server-side week start, read from `settings`. */
export async function familyWeekStartsOn(familyId: string): Promise<WeekStartsOn> {
  const { data } = await (createAdminClient() as any)
    .from("settings")
    .select("value")
    .eq("family_id", familyId)
    .eq("key", SETTINGS_KEYS.weekStart)
    .maybeSingle();
  // `value` is jsonb; a bare JSON string unwraps with #>>'{}' in SQL, and
  // comes back already unwrapped through supabase-js.
  return resolveServerWeekStartsOn(data?.value);
}
