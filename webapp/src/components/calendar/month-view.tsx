"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  eachWeekOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  startOfDay,
  endOfDay,
  differenceInDays,
  getISOWeek,
} from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2 } from "lucide-react";
import { EventPill } from "@/components/event-pill";
import { useTimeFormat } from "@/hooks/use-time-format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  location?: string;
  description?: string;
  person_id?: string;
  is_holiday?: boolean;
  is_waste_collection?: boolean;
}

interface MonthViewProps {
  currentDate: Date;
  selectedDate: Date | null;
  events: CalendarEvent[];
  onSelectDate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}

const MAX_EVENTS_PER_CELL = 3;

const isMultiDayOrAllDay = (event: CalendarEvent) => {
  return event.allDay || differenceInDays(endOfDay(event.end), startOfDay(event.start)) >= 1;
};

const eventOccursOnDay = (event: CalendarEvent, day: Date) => {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  return dayStart <= endOfDay(event.end) && dayEnd >= startOfDay(event.start);
};

export function MonthView({
  currentDate,
  selectedDate,
  events,
  onSelectDate,
  onSelectEvent,
}: MonthViewProps) {
  const { formatTime } = useTimeFormat();
  const t = useTranslations("calendar");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  // Localized weekday abbreviations (Mo, Tu, …) starting from Monday
  const weekdayLabels = useMemo(() => {
    const monday = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      return format(day, "EEEEEE", { locale: dateLocale });
    });
  }, [currentDate, dateLocale]);

  const weeks = eachWeekOfInterval(
    { start: calendarStart, end: calendarEnd },
    { weekStartsOn: 1 }
  );

  // Get all events for a specific day, sorted by type then time
  const getEventsForDay = useMemo(() => {
    return (day: Date) => {
      const dayEvents = events.filter((event) => eventOccursOnDay(event, day));

      // Sort: all-day/multi-day first, then by start time
      dayEvents.sort((a, b) => {
        const aMulti = isMultiDayOrAllDay(a);
        const bMulti = isMultiDayOrAllDay(b);
        if (aMulti && !bMulti) return -1;
        if (!aMulti && bMulti) return 1;
        return a.start.getTime() - b.start.getTime();
      });

      return dayEvents;
    };
  }, [events]);

  return (
    <Card>
      <CardContent className="p-2 sm:p-4">
      {/* Weekday Headers */}
      <div className="grid grid-cols-[1.5rem_repeat(7,1fr)] sm:grid-cols-[2rem_repeat(7,1fr)]">
        <div className="text-center text-[9px] sm:text-[10px] font-medium py-2 text-muted-foreground/40">
          {t("monthView.weekHeader")}
        </div>
        {weekdayLabels.map((day, idx) => (
          <div
            key={idx}
            className={`text-center text-xs sm:text-sm font-medium py-2 ${
              idx >= 5 ? "text-muted-foreground/60" : "text-muted-foreground"
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Weeks */}
      <div className="border-t border-border/30">
        {weeks.map((weekStart, weekIndex) => {
          const weekDays = eachDayOfInterval({
            start: weekStart,
            end: endOfWeek(weekStart, { weekStartsOn: 1 }),
          });

          return (
            <div
              key={weekStart.toISOString()}
              className="grid grid-cols-[1.5rem_repeat(7,1fr)] sm:grid-cols-[2rem_repeat(7,1fr)] border-b border-border/20"
            >
              {/* Week number */}
              <div className="flex items-start justify-center pt-1 sm:pt-1.5 text-[9px] sm:text-[10px] font-medium text-muted-foreground/40 border-r border-border/20">
                {getISOWeek(weekStart)}
              </div>

              {/* Day cells */}
              {weekDays.map((day, dayIndex) => {
                const dayEvents = getEventsForDay(day);
                const isCurrentMonth = isSameMonth(day, currentDate);
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const isDayToday = isToday(day);
                const holidayEvent = events.find(
                  (e) => e.is_holiday && isSameDay(e.start, day)
                );
                const visibleEvents = dayEvents.slice(0, MAX_EVENTS_PER_CELL);
                const overflowCount = dayEvents.length - MAX_EVENTS_PER_CELL;

                return (
                  <motion.button
                    key={day.toISOString()}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: (weekIndex * 7 + dayIndex) * 0.003 }}
                    onClick={() => onSelectDate(day)}
                    className={`
                      relative min-h-[3.5rem] sm:min-h-[5rem] p-0.5 sm:p-1 text-left transition-all overflow-hidden
                      ${dayIndex > 0 ? "border-l border-border/20" : ""}
                      ${isCurrentMonth ? "" : "opacity-40 [&_span]:border-dashed"}
                      ${isDayToday ? "ring-2 ring-inset ring-primary bg-primary/[0.06]" : ""}
                      ${isSelected && !isDayToday ? "ring-2 ring-inset ring-primary/50 bg-primary/5" : ""}
                      ${!isSelected && !isDayToday ? "hover:bg-accent/50" : ""}
                      ${dayIndex >= 5 && !isDayToday && !isSelected ? "bg-muted/30" : ""}
                    `}
                  >
                    {/* Day Number */}
                    <div className="flex items-center gap-0.5 mb-0.5">
                      <span
                        className={`
                          inline-flex items-center justify-center size-5 sm:size-6 rounded-full text-[10px] sm:text-xs font-medium tabular-nums shrink-0
                          ${isDayToday ? "bg-primary text-primary-foreground font-bold" : ""}
                        `}
                      >
                        {format(day, "d")}
                      </span>
                      {holidayEvent && (
                        <span className="hidden sm:inline text-[8px] text-muted-foreground truncate leading-none">
                          {holidayEvent.title}
                        </span>
                      )}
                    </div>

                    {/* Events - inline in cell */}
                    <div className="flex flex-col gap-px">
                      {/* Desktop: show event chips */}
                      <div className="hidden sm:flex sm:flex-col sm:gap-px">
                        {visibleEvents.map((event) => {
                          const isMulti = isMultiDayOrAllDay(event);
                          return (
                            <Tooltip key={event.id}>
                              <TooltipTrigger asChild>
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectEvent(event);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      onSelectEvent(event);
                                    }
                                  }}
                                  className="cursor-pointer transition-opacity hover:opacity-80"
                                >
                                  <EventPill
                                    title={event.title}
                                    color={event.color}
                                    icon={event.is_waste_collection ? Trash2 : undefined}
                                  />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="font-medium">{event.title}</p>
                                <p className="text-xs opacity-70">
                                  {isMulti
                                    ? `${format(event.start, "d. MMM", { locale: dateLocale })} - ${format(event.end, "d. MMM", { locale: dateLocale })}`
                                    : `${formatTime(event.start)} - ${formatTime(event.end)}`}
                                </p>
                                {event.location && (
                                  <p className="text-xs opacity-70">{event.location}</p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                        {overflowCount > 0 && (
                          <div className="text-[11px] text-muted-foreground/70 pl-1.5 font-medium">
                            {t("monthView.moreCount", { count: overflowCount })}
                          </div>
                        )}
                      </div>

                      {/* Mobile: event dots */}
                      {dayEvents.length > 0 && (
                        <div className="sm:hidden flex flex-wrap justify-center gap-0.5 mt-0.5">
                          {dayEvents.slice(0, 4).map((event) => (
                            <div
                              key={event.id}
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: event.color }}
                            />
                          ))}
                          {dayEvents.length > 4 && (
                            <span className="text-[7px] text-muted-foreground">
                              +{dayEvents.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          );
        })}
      </div>
      </CardContent>
    </Card>
  );
}
