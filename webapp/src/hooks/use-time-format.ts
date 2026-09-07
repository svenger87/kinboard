"use client";

import { useCallback } from "react";
import { format, type Locale } from "date-fns";
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
/**
 * A wall clock that arrived as text, re-rendered for a 12- or 24-hour setting.
 *
 * Sunrise, sunset and the hourly forecast are worked out on the server, in the
 * weather location's zone — which OpenWeatherMap gives as an offset in seconds
 * and never as an IANA name, so the only way to read that clock is to shift the
 * instant and read its UTC fields (see lib/weather-time.ts). That has to happen
 * server-side, and the server does not know whether this household wants
 * 12-hour times, so those routes send "HH:mm" and this renders it (issue #227).
 *
 * `formatTime` is not usable for these: it builds a Date and reads the
 * *browser's* fields, which would put the sun up in the viewer's zone rather
 * than the forecast's — the exact bug lib/weather-time.ts exists to prevent.
 * Here the hours and minutes are already the right ones and only their
 * presentation is in question, so they are placed on an arbitrary date and
 * never read back as an instant.
 *
 * Anything that is not "HH:mm" is passed through untouched rather than becoming
 * "Invalid Date" on the dashboard: a time that looks wrong beats a widget that
 * looks broken.
 */
export function renderWallClock(
  hhmm: string,
  use24Hour: boolean,
  dateLocale?: Locale,
): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return hhmm;
  if (use24Hour) return `${String(hours).padStart(2, "0")}:${m[2]}`;
  return format(new Date(2000, 0, 1, hours, minutes, 0, 0), "h:mm a", { locale: dateLocale });
}

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

  /**
   * An hour-of-day label for a timeline gutter: "14:00" or "2 PM".
   *
   * The calendar's day timeline and week gutter printed `${hour}:00` directly,
   * so they stayed 24-hour however the switch was set (issue #198). Minutes are
   * always zero here, so the 12-hour form drops them — a gutter reading
   * "2:00 PM" every row is noise.
   */
  const formatHourLabel = useCallback(
    (hour: number) => {
      const at = new Date();
      at.setHours(hour, 0, 0, 0);
      return use24Hour
        ? `${hour.toString().padStart(2, "0")}:00`
        : format(at, "h a", { locale: getDateFnsLocale(locale) });
    },
    [use24Hour, locale],
  );

  const formatWallClock = useCallback(
    (hhmm: string) => renderWallClock(hhmm, use24Hour, getDateFnsLocale(locale)),
    [use24Hour, locale],
  );

  return { use24Hour, timePattern, formatTime, formatHourLabel, formatWallClock };
}
