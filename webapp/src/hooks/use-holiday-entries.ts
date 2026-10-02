"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSchoolHolidays, useSetting } from "./use-supabase-queries";
import { useHolidayRegion } from "./use-holiday-region";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { DEFAULT_CALENDAR_DISPLAY, type CalendarDisplaySettings } from "@/lib/calendar-markers";
import { holidayLabel } from "@/lib/holidays/label";
import {
  holidayEntries,
  withoutDuplicateHolidays,
  type EventLike,
  type HolidayEntry,
} from "@/lib/holiday-entries";

/**
 * A device other than the one that edited a school holiday learns of it this
 * often. The sync's own writes arrive sooner: they update the
 * `school_holiday_sync` setting in the same transaction, and that setting's
 * realtime change refetches the rows (use-realtime).
 */
const SCHOOL_HOLIDAY_REFRESH_MS = 30 * 60 * 1000;

export interface HolidayEntriesState {
  /** The family's `calendar_display.showHolidays`; off, `entries` is always empty. */
  enabled: boolean;
  entries: HolidayEntry[];
}

/**
 * Public holidays of the family's region and its school holidays between two
 * local `YYYY-MM-DD` keys, inclusive, for the lists that sit beside events:
 * the Events widget, the week overview and the screensaver.
 *
 * Behind the switch the calendar's holiday markers use
 * (Settings → Calendar → Holidays), so one switch shows holidays everywhere
 * or nowhere. Off, the school holidays are not even fetched.
 *
 * Pass the events shown beside them and an entry a calendar already lists is
 * dropped (withoutDuplicateHolidays).
 */
export function useHolidayEntries(
  fromKey: string,
  toKey: string,
  events?: readonly EventLike[] | null,
): HolidayEntriesState {
  const locale = useLocale();
  const tHolidays = useTranslations("holidays");
  const { data: calendarDisplay } = useSetting<CalendarDisplaySettings>(
    SETTINGS_KEYS.calendarDisplay,
    DEFAULT_CALENDAR_DISPLAY,
  );
  const showHolidays = calendarDisplay?.showHolidays ?? false;
  const { region } = useHolidayRegion();
  const { data: schoolRows } = useSchoolHolidays({
    enabled: showHolidays,
    refetchInterval: showHolidays ? SCHOOL_HOLIDAY_REFRESH_MS : false,
  });

  const all = useMemo(
    () =>
      holidayEntries({
        showHolidays,
        region,
        schoolRows,
        fromKey,
        toKey,
        locale,
        label: (holiday) => holidayLabel(holiday, tHolidays),
      }),
    [showHolidays, region, schoolRows, fromKey, toKey, locale, tHolidays],
  );
  const entries = useMemo(() => withoutDuplicateHolidays(all, events), [all, events]);

  return { enabled: showHolidays, entries };
}
