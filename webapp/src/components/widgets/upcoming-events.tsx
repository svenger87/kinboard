"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Calendar, ChevronRight } from "lucide-react";
import { format, isToday, isTomorrow, addDays, endOfDay } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { useEvents, usePeople, useSetting, useTodos, useToday } from "@/hooks";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import {
  DEFAULT_CALENDAR_DISPLAY,
  nextTaskOccurrences,
  taskOccurrences,
  type CalendarDisplaySettings,
} from "@/lib/calendar-markers";
import { WidgetCard } from "@/components/widget-card";
import { EventPill } from "@/components/event-pill";
import { useTimeFormat } from "@/hooks/use-time-format";

interface UpcomingEventsProps {
  maxEvents?: number;
  className?: string;
}

function EventSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function UpcomingEventsSkeleton() {
  const t = useTranslations("upcomingEvents");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-24" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <EventSkeleton />
        <EventSkeleton />
        <EventSkeleton />
      </CardContent>
    </Card>
  );
}

export function UpcomingEvents({
  maxEvents = 5,
  className = "",
}: UpcomingEventsProps) {
  const { formatTime } = useTimeFormat();
  const t = useTranslations("upcomingEvents");
  const tCalendar = useTranslations("calendar");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  // Re-render at midnight so the query window follows the day.
  const today = useToday();

  // Get events for today and the next 14 days - memoized to prevent infinite
  // refetches, but keyed on the day: on a kiosk that runs for days an empty
  // dependency list would keep asking for the window it was mounted with,
  // which eventually lies entirely in the past.
  const { startDate, endDate } = useMemo(() => {
    const start = new Date(today); // useToday() is already start-of-day
    return {
      startDate: start.toISOString(),
      endDate: endOfDay(addDays(start, 14)).toISOString(),
    };
  }, [today]);

  const { data: events, isLoading, isError } = useEvents(startDate, endDate);
  const { data: people } = usePeople();
  const { data: calendarDisplay } = useSetting<CalendarDisplaySettings>(
    SETTINGS_KEYS.calendarDisplay,
    DEFAULT_CALENDAR_DISPLAY,
  );
  const tasksAsEvents = calendarDisplay?.tasksAsEvents ?? false;
  const { data: todos } = useTodos({ enabled: tasksAsEvents });

  // Transform events to display format
  const calendarEvents = useMemo(() => (events || []).filter((event) => !event.calendar?.is_waste_collection).map((event) => {
    // Use event's person_id first, then fall back to calendar's person_id
    const personId = event.person_id || event.calendar?.person_id;
    const person = personId ? people?.find((p) => p.id === personId) : undefined;
    return {
      id: event.id,
      title: event.title,
      start: new Date(event.start_at),
      color: person?.color || event.calendar?.color || "#3b82f6",
      allDay: event.all_day,
    };
  }), [events, people]);

  // With tasks treated as events, each task joins the list once, at its next
  // occurrence in the window, as an all-day item. Listing every repeat would
  // let one daily chore fill all the slots and push the real events out.
  const displayEvents = useMemo(() => {
    if (!tasksAsEvents) return calendarEvents;
    const tasks = nextTaskOccurrences(
      taskOccurrences(todos ?? [], people ?? [], new Date(startDate), new Date(endDate), "hsl(var(--muted-foreground))"),
    ).map((o) => ({
      id: o.id,
      title: o.personName
        ? tCalendar("markers.taskTitleWithPerson", { title: o.title, person: o.personName })
        : tCalendar("markers.taskTitle", { title: o.title }),
      start: o.date,
      color: o.color,
      allDay: true,
    }));
    return [...calendarEvents, ...tasks].sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [calendarEvents, tasksAsEvents, todos, people, startDate, endDate, tCalendar]);

  if (isLoading) {
    return <UpcomingEventsSkeleton />;
  }

  if (isError) {
    return (
      <Card className={`accent-border-top h-full ${className}`}>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-3">
            <span className="icon-badge">
              <Calendar className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <h3 className="flex-1 font-display text-lg font-semibold leading-tight">{t("title")}</h3>
          </div>
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <Calendar className="size-8 mb-2 text-destructive/40" />
            <p className="text-sm">{t("errorMessage")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 6 },
    show: { opacity: 1, y: 0, transition: { duration: 0.22 } },
  };

  return (
    <WidgetCard
      icon={Calendar}
      title={t("title")}
      headerRight={
        <Link
          href="/calendar"
          className="rounded-lg p-1 transition-colors hover:bg-accent/50"
          aria-label={t("viewAllAria")}
        >
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      }
      className={`h-full ${className}`}
    >
      <ScrollArea className="max-h-[160px] pr-2 sm:max-h-[220px]">
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-1.5">
          {(() => {
            const sliced = displayEvents.slice(0, maxEvents);
            let lastDayLabel = "";
            return sliced.map((event) => {
              const dayLabel = isToday(event.start)
                ? t("today")
                : isTomorrow(event.start)
                  ? t("tomorrow")
                  : format(event.start, "EEEE, d. MMM", { locale: dateLocale });
              const showSeparator = dayLabel !== lastDayLabel;
              lastDayLabel = dayLabel;
              return (
                <motion.div key={event.id} variants={item}>
                  {showSeparator && (
                    <div className="mb-1.5 mt-2 flex items-center gap-2 first:mt-0">
                      <span className="text-kiosk-label text-2xs">{dayLabel}</span>
                      <div className="h-px flex-1 bg-border/40" />
                    </div>
                  )}
                  <EventPill
                    variant="agenda"
                    title={event.title}
                    color={event.color}
                    time={event.allDay ? undefined : formatTime(event.start)}
                  />
                </motion.div>
              );
            });
          })()}
          {displayEvents.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Calendar className="mb-2 size-10 text-primary/20" strokeWidth={1.75} />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
        </motion.div>
      </ScrollArea>
      {displayEvents.length > maxEvents && (
        <Link
          href="/calendar"
          className="mt-3 flex items-center justify-center gap-1 border-t border-border/40 pt-3 text-sm text-primary/70 transition-colors hover:text-primary"
        >
          <span>{t("moreCount", { count: displayEvents.length - maxEvents })}</span>
          <ChevronRight className="size-4" />
        </Link>
      )}
    </WidgetCard>
  );
}
