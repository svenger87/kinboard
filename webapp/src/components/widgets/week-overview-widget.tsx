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
import { useEvents, useTodos, useBirthdays } from "@/hooks";

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

      // Count todos due this day
      const dayTodos = (todos || []).filter((t) => {
        if (t.completed) return false;
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return isSameDay(startOfDay(dueDate), day);
      });

      // Check birthdays on this day
      const dayBirthdays = (birthdays || []).filter((b) => {
        if (!b.date) return false;
        const nextBday = getNextBirthday(parseBirthdayDate(b.date));
        return isSameDay(nextBday, day);
      });

      const totalItems = dayEvents.length + dayTodos.length + dayBirthdays.length;

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
      });
    }
    return days;
  }, [events, todos, birthdays, today, t, dateLocale]);

  if (isLoading) {
    return <WeekOverviewSkeleton />;
  }

  const totalWeekEvents = weekDays.reduce((acc, d) => acc + d.totalItems, 0);
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
              aria-label={t("dayAria", { date: format(day.date, "EEEE, d. MMMM", { locale: dateLocale }), count: day.totalItems })}
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

              {/* Day number circle */}
              <div
                className={`relative size-8 flex items-center justify-center rounded-full text-sm font-semibold ${
                  day.isToday
                    ? "bg-primary text-primary-foreground"
                    : day.hasBirthday
                    ? "bg-pink-500/20 text-pink-400"
                    : "text-foreground"
                }`}
              >
                {day.dayNumber}
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
            </motion.div>
            </Link>
          ))}
        </div>

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
