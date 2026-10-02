"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CalendarDays, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import {
  format,
  addDays,
  startOfDay,
  isSameDay,
  setYear,
  differenceInDays,
  addYears,
  parseISO,
} from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { useEvents, useTodos, useBirthdays, useSetting, useHolidayEntries } from "@/hooks";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { toLocalDateKey } from "@/lib/local-date";
import {
  DEFAULT_CALENDAR_DISPLAY,
  taskDayKeys,
  type CalendarDisplaySettings,
} from "@/lib/calendar-markers";
import { entryCoversDay, holidayEndPattern, keyToDate, type HolidayEntry } from "@/lib/holiday-entries";

function parseBirthdayDate(dateStr: string): Date {
  return parseISO(dateStr + "T12:00:00");
}

function getNextBirthday(date: Date): Date {
  const today = startOfDay(new Date());
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));
  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

function WeekOverviewSkeleton() {
  const t = useTranslations("weekOverviewWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-32" />
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1 py-2">
              <Skeleton className="h-3 w-5" />
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-2 w-4" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Holidays named under the grid; a week rarely has more. */
const MAX_HOLIDAY_LINES = 3;

interface WeekOverviewWidgetProps {
  className?: string;
}

export function WeekOverviewWidget({ className }: WeekOverviewWidgetProps) {
  const t = useTranslations("weekOverviewWidget");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  const today = startOfDay(new Date());
  const weekEnd = addDays(today, 7);

  const startStr = format(today, "yyyy-MM-dd");
  const endStr = format(weekEnd, "yyyy-MM-dd");

  const { data: events, isLoading: loadingEvents } = useEvents(startStr, endStr);
  const { data: todos, isLoading: loadingTodos } = useTodos();
  const { data: birthdays, isLoading: loadingBirthdays } = useBirthdays();
  const { data: calendarDisplay } = useSetting<CalendarDisplaySettings>(
    SETTINGS_KEYS.calendarDisplay,
    DEFAULT_CALENDAR_DISPLAY,
  );
  const tasksAsEvents = calendarDisplay?.tasksAsEvents ?? false;
  // The seven days shown, today first. One a holiday calendar already marks
  // is not marked twice.
  const { entries: holidays } = useHolidayEntries(startStr, format(addDays(today, 6), "yyyy-MM-dd"), events);

  const isLoading = loadingEvents || loadingTodos || loadingBirthdays;

  // Build data for each of the 7 days
  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(today, i);
      const dayStr = day.toDateString();

      // Count events for this day
      const dayEvents = (events || []).filter((e) => {
        const eventStart = new Date(e.start_at);
        const eventEnd = e.end_at ? new Date(e.end_at) : eventStart;
        // Event spans this day if it starts before end of day and ends after start of day
        return (
          isSameDay(eventStart, day) ||
          isSameDay(eventEnd, day) ||
          (eventStart < day && eventEnd > day)
        );
      });

      // Count todos due this day. A due date is a calendar date and is
      // compared as one: new Date("2026-10-14") is midnight UTC, which west of
      // UTC is the evening of the 13th, so the task was counted a day early.
      // Treated as events, a repeating task also counts on every day it comes
      // round, by the same rule the calendar uses.
      const dayKey = toLocalDateKey(day);
      const dayTodos = (todos || []).filter((t) =>
        tasksAsEvents
          ? taskDayKeys(t, today, weekEnd).includes(dayKey)
          : !t.completed && t.due_date?.slice(0, 10) === dayKey,
      );

      // Check birthdays on this day
      const dayBirthdays = (birthdays || []).filter((b) => {
        if (!b.date) return false;
        const nextBday = getNextBirthday(parseBirthdayDate(b.date));
        return isSameDay(nextBday, day);
      });

      const totalItems = dayEvents.length + dayTodos.length + dayBirthdays.length;
      const dayHolidays = holidays.filter((h) => entryCoversDay(h, dayKey));
      const publicHoliday = dayHolidays.find((h) => h.kind === "public") ?? null;

      days.push({
        date: day,
        isToday: i === 0,
        dayName: i === 0 ? t("today") : format(day, "EE", { locale: dateLocale }),
        dayNumber: format(day, "d"),
        eventCount: dayEvents.length,
        todoCount: dayTodos.length,
        birthdayCount: dayBirthdays.length,
        totalItems,
        hasBirthday: dayBirthdays.length > 0,
        publicHoliday,
        schoolBreak: dayHolidays.some((h) => h.kind === "school"),
        holidayNames: dayHolidays.map((h) => h.title),
      });
    }
    return days;
  }, [events, todos, birthdays, today, weekEnd, t, dateLocale, tasksAsEvents, holidays]);

  if (isLoading) {
    return <WeekOverviewSkeleton />;
  }

  const totalWeekEvents = weekDays.reduce((acc, d) => acc + d.totalItems, 0);
  const weekHasHoliday = holidays.length > 0;
  // "Today", a weekday, or -- for a break -- the span it has left in the week.
  const holidayDayLabel = (h: HolidayEntry) => {
    const first = h.startKey < startStr ? today : keyToDate(h.startKey);
    const firstLabel = isSameDay(first, today) ? t("today") : format(first, "EE", { locale: dateLocale });
    if (h.endKey <= h.startKey) return firstLabel;
    return t("holidaySpan", { from: firstLabel, to: format(keyToDate(h.endKey), holidayEndPattern(locale), { locale: dateLocale }) });
  };
  const maxItems = Math.max(...weekDays.map((d) => d.totalItems), 1);

  return (
    <Card className={`accent-border-top h-full ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 font-display text-lg font-semibold">
            <span className="icon-badge">
              <CalendarDays className="size-5 text-primary" strokeWidth={1.75} />
            </span>
            {t("title")}
          </CardTitle>
          <Link href="/calendar" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <span className="hidden sm:inline">{t("weekEvents", { count: totalWeekEvents })}</span>
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pb-4">
        <div className="grid grid-cols-7 gap-1">
          {weekDays.map((day, i) => (
            <Link
              key={day.date.toISOString()}
              href={`/calendar?date=${format(day.date, "yyyy-MM-dd")}`}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-lg"
              aria-label={[
                t("dayAria", { date: format(day.date, "EEEE, d. MMMM", { locale: dateLocale }), count: day.totalItems }),
                ...day.holidayNames,
              ].join(" – ")}
              title={day.holidayNames.length > 0 ? day.holidayNames.join(" · ") : undefined}
            >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={`flex flex-col items-center gap-1 py-1.5 px-0.5 rounded-lg transition-colors cursor-pointer ${
                day.isToday
                  ? "bg-primary/15 ring-1 ring-primary/30"
                  : day.totalItems > 0
                  ? "hover:bg-accent/50"
                  : "hover:bg-accent/50"
              }`}
            >
              {/* Day name */}
              <span
                className={`text-3xs font-medium uppercase tracking-wider ${
                  day.isToday ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {day.dayName}
              </span>

              {/* Day number circle. A public holiday rings it in amber, the
                  colour the calendar gives holidays, with its emoji. */}
              <div
                data-holiday={day.publicHoliday ? "public" : undefined}
                className={`relative size-8 flex items-center justify-center rounded-full text-sm font-semibold ${
                  day.isToday
                    ? "bg-primary text-primary-foreground"
                    : day.hasBirthday
                    ? "bg-pink-500/20 text-pink-400"
                    : day.publicHoliday
                    ? "bg-amber-400/15 text-amber-400"
                    : "text-foreground"
                } ${day.publicHoliday ? "ring-1 ring-amber-400/70" : ""}`}
              >
                {day.dayNumber}
                {day.publicHoliday?.emoji && (
                  <span className="absolute -top-0.5 -left-0.5 text-3xs" aria-hidden="true">
                    {day.publicHoliday.emoji}
                  </span>
                )}
                {day.hasBirthday && (
                  <span className="absolute -top-0.5 -right-0.5 text-3xs">
                    🎂
                  </span>
                )}
              </div>

              {/* Activity indicator dots */}
              <div className="flex items-center gap-0.5 h-3">
                {day.totalItems > 0 ? (
                  <>
                    {day.eventCount > 0 && (
                      <div
                        className="rounded-full bg-primary"
                        style={{
                          width: `${Math.max(4, Math.min(8, (day.eventCount / maxItems) * 8))}px`,
                          height: "4px",
                        }}
                      />
                    )}
                    {day.todoCount > 0 && (
                      <div
                        className="rounded-full bg-amber-400"
                        style={{
                          width: `${Math.max(4, Math.min(8, (day.todoCount / maxItems) * 8))}px`,
                          height: "4px",
                        }}
                      />
                    )}
                    {day.birthdayCount > 0 && (
                      <div className="size-1 rounded-full bg-pink-400" />
                    )}
                  </>
                ) : (
                  <span className="text-3xs text-muted-foreground/40">—</span>
                )}
              </div>

              {/* A school break: an amber band under each of its days, so a
                  week of holidays reads as one stretch. Room is kept for it
                  whenever the week has a holiday, so the cells stay level. */}
              {weekHasHoliday && (
                <div
                  data-holiday={day.schoolBreak ? "school" : undefined}
                  className={`h-1 w-full rounded-full ${day.schoolBreak ? "bg-amber-400/60" : ""}`}
                />
              )}
            </motion.div>
            </Link>
          ))}
        </div>

        {/* The week's holidays by name: the cells have no room for one. */}
        {holidays.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1" aria-label={t("holidaysAria")}>
            {holidays.slice(0, MAX_HOLIDAY_LINES).map((h) => (
              <li
                key={h.id}
                data-holiday={h.kind}
                className="flex min-w-0 items-baseline gap-1.5 text-xs text-amber-400"
              >
                <span className="shrink-0 tabular-nums text-amber-400/80">{holidayDayLabel(h)}</span>
                <span className="min-w-0 break-words font-medium">
                  {h.emoji ? `${h.emoji} ${h.title}` : h.title}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-3 text-3xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-primary" />
            {t("legendEvents")}
          </span>
          <span className="flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-amber-400" />
            {t("legendTodos")}
          </span>
          <span className="flex items-center gap-1">
            <div className="size-1.5 rounded-full bg-pink-400" />
            {t("legendBirthdays")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
