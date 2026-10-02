"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useEvents, useSchoolHolidays } from "./use-supabase-queries";
import { useHolidayRegion } from "./use-holiday-region";
import { holidayLabel } from "@/lib/holidays/label";
import { addDays } from "@/lib/local-date";
import { holidayCalendarBreaks, schoolBreaks } from "@/lib/school-day-rule";
import type { SignalSchoolBreak } from "@/lib/attention/types";

/** Same cadence as the event lists' school holidays (use-holiday-entries). */
const SCHOOL_HOLIDAY_REFRESH_MS = 30 * 60 * 1000;

export interface SchoolBreaksState {
  /** Every break between the two days, in the order that names a day. */
  breaks: SignalSchoolBreak[];
  /** True until the region, the school holidays and the holiday calendars have all been read once. */
  isLoading: boolean;
}

/**
 * The breaks that close school between `fromKey` and `toKey` (the device's
 * local `YYYY-MM-DD`, inclusive), for lib/school-day-rule.ts in the browser:
 * the same rule, fed the same rows, as the server's "school tomorrow" and
 * `/schedule` (lib/school-days.ts).
 *
 * Not behind Settings → Calendar → Holidays (`calendar_display.showHolidays`).
 * That switch decides whether holidays are drawn on the calendar and listed
 * beside events; whether there is school is a fact, and the server answers it
 * whatever the switch says. Following the switch here would put lessons on
 * the wall on a day the Home Assistant sensor says has none.
 *
 * Public holidays are named in the UI language, as everything else on the
 * screen is. Which days are off does not depend on the language.
 */
export function useSchoolBreaks(fromKey: string, toKey: string): SchoolBreaksState {
  const locale = useLocale();
  const tHolidays = useTranslations("holidays");
  const { region, isLoading: loadingRegion } = useHolidayRegion();
  const { data: schoolRows, isLoading: loadingRows } = useSchoolHolidays({
    refetchInterval: SCHOOL_HOLIDAY_REFRESH_MS,
  });
  // A day either side, as the server pads its window: the bounds are UTC
  // instants, and a holiday-calendar event can start on the neighbouring UTC
  // date. The local day each event covers is what decides.
  const { data: calendarEvents, isLoading: loadingEvents } = useEvents(
    `${addDays(fromKey, -1)}T00:00:00Z`,
    `${addDays(toKey, 1)}T23:59:59Z`,
    { holidayCalendarsOnly: true },
  );

  const breaks = useMemo(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return schoolBreaks(
      {
        region,
        schoolHolidays: schoolRows,
        holidayCalendarDays: holidayCalendarBreaks(calendarEvents, timeZone),
        locale,
        label: (holiday) => holidayLabel(holiday, tHolidays),
      },
      fromKey,
      toKey,
    );
  }, [region, schoolRows, calendarEvents, locale, tHolidays, fromKey, toKey]);

  return { breaks, isLoading: loadingRegion || loadingRows || loadingEvents };
}
