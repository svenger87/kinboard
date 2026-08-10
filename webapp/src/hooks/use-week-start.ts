"use client";

import { useLocale } from "next-intl";
import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";

/**
 * Which day the week starts on, for every calendar view.
 *
 * `weekStartsOn: 1` was written into fifteen places — the month grid, the week
 * grid, the range each query asks the database for, the little date pickers.
 * Monday is right for Germany and France and wrong for a household in the US,
 * where a calendar whose first column is Monday reads as broken every single
 * day.
 *
 * The default follows the interface language rather than being Monday for
 * everyone: an English install gets Sunday, German and French get Monday. That
 * is a change for existing English families, and it is the point — they have
 * been looking at a German calendar. Anybody who disagrees with the guess can
 * say so explicitly, which is what the setting is for.
 *
 * Deliberately not derived from the browser: the wall display and the phones
 * in the house must agree on where the week starts, and the browser locale of
 * whichever device opened the page is not a household decision.
 */
export type WeekStartPreference = "locale" | "monday" | "sunday";

export const DEFAULT_WEEK_START: WeekStartPreference = "locale";

/** date-fns' `weekStartsOn`: 0 is Sunday, 1 is Monday. */
export type WeekStartsOn = 0 | 1;

/** What a language implies when nobody has chosen. */
export function weekStartForLocale(locale: string): WeekStartsOn {
  // `en` is the only interface language whose common convention is Sunday.
  // (en-GB starts on Monday, but Kinboard's `en` is not region-qualified, and
  // guessing a region from a language is how this class of bug starts.)
  return locale.startsWith("en") ? 0 : 1;
}

export function useWeekStart(): {
  weekStartsOn: WeekStartsOn;
  preference: WeekStartPreference;
} {
  const locale = useLocale();
  const { data } = useSetting<WeekStartPreference>(
    SETTINGS_KEYS.weekStart,
    DEFAULT_WEEK_START,
  );

  const preference = data ?? DEFAULT_WEEK_START;
  const weekStartsOn =
    preference === "monday" ? 1 : preference === "sunday" ? 0 : weekStartForLocale(locale);

  return { weekStartsOn, preference };
}
