"use client";

import { useCallback } from "react";
import { format } from "date-fns";
import { useLocale } from "next-intl";
import { useSetting } from "./use-supabase-queries";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { DEFAULT_THEME_SETTINGS, type ThemeSettings } from "./use-theme-settings";

/**
 * Format a time according to the household's 24-hour setting.
 *
 * That setting existed since the theme settings page shipped and was read
 * by nothing that draws a time — every clock and widget formatted with a
 * hardcoded `HH:mm`, so the switch saved a value and changed nothing
 * (issue #38). This is what the switch now drives.
 *
 * Reads the setting directly rather than going through `useThemeSettings`:
 * that hook applies theme and palette classes to `document.documentElement`
 * in effects, and pulling it into a dozen components to ask one boolean
 * would re-run that DOM work in each of them. Same TanStack Query key, so
 * this costs no extra request.
 */
export function useTimeFormat() {
  const { data: settings } = useSetting<ThemeSettings>(
    SETTINGS_KEYS.theme,
    DEFAULT_THEME_SETTINGS,
  );
  const locale = useLocale();

  // Default to 24-hour, matching DEFAULT_THEME_SETTINGS — an install that
  // has never opened the settings page keeps the behaviour it has always
  // had rather than flipping to 12-hour while the setting loads.
  const use24Hour = settings?.use24Hour ?? true;

  // `a` is date-fns' locale-aware meridiem, so a French install reads
  // "3:05 PM" as that locale writes it rather than forcing English.
  const timePattern = use24Hour ? "HH:mm" : "h:mm a";

  const formatTime = useCallback(
    (value: Date | string | number) =>
      format(new Date(value), timePattern, { locale: getDateFnsLocale(locale) }),
    [timePattern, locale],
  );

  return { use24Hour, timePattern, formatTime };
}
