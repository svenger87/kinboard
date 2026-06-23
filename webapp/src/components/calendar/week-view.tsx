"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isToday,
  getHours,
  getMinutes,
  differenceInMinutes,
  differenceInDays,
  startOfDay,
  endOfDay,
  isWithinInterval,
} from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { personStrongTint, personText } from "@/lib/person-color";
import { ScrollArea } from "@/components/ui/scroll-area";
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
}

interface WeekViewProps {
  currentDate: Date;
  selectedDate: Date | null;
  events: CalendarEvent[];
  onSelectDate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6:00 - 22:00
const HOUR_HEIGHT = 60; // pixels per hour

export function WeekView({
  currentDate,
  selectedDate,
  events,
  onSelectDate,
  onSelectEvent,
}: WeekViewProps) {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  // Get days of the week
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Check if event is multi-day
  const isMultiDayEvent = (event: CalendarEvent) => {
    return differenceInDays(endOfDay(event.end), startOfDay(event.start)) >= 1;
  };

  // Check if an event occurs on a specific day (handles multi-day events)
  const eventOccursOnDay = (event: CalendarEvent, day: Date) => {
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    const eventStart = startOfDay(event.start);
    const eventEnd = endOfDay(event.end);

    return isWithinInterval(dayStart, { start: eventStart, end: eventEnd }) ||
           isWithinInterval(dayEnd, { start: eventStart, end: eventEnd }) ||
           (eventStart <= dayStart && eventEnd >= dayEnd);
  };

  // Get all-day and multi-day events for the week
  const allDayAndMultiDayEvents = useMemo(() => {
    return events.filter((e) => e.allDay || isMultiDayEvent(e));
  }, [events]);

  // Get timed events for a specific day (single-day events only)
  const getTimedEventsForDay = (day: Date) => {
    return events.filter(
      (event) => !event.allDay && !isMultiDayEvent(event) && isSameDay(event.start, day)
    );
  };

  // Get all-day/multi-day events for a specific day
  const getAllDayEventsForDay = (day: Date) => {
    return allDayAndMultiDayEvents.filter((event) => eventOccursOnDay(event, day));
  };

  // Calculate event position and height
  const getEventStyle = (event: CalendarEvent) => {
    const startHour = getHours(event.start);
    const startMinute = getMinutes(event.start);
    const duration = differenceInMinutes(event.end, event.start);

    const top = (startHour - 6) * HOUR_HEIGHT + (startMinute / 60) * HOUR_HEIGHT;
    const height = Math.max((duration / 60) * HOUR_HEIGHT, 24); // Minimum 24px height

    return { top, height };
  };

  // Current time indicator position (computed once per render, no deps needed)
  const now = new Date();
  const currentTimeTop = (() => {
    const hour = getHours(now);
    const minute = getMinutes(now);
    if (hour < 6 || hour >= 22) return null;
    return (hour - 6) * HOUR_HEIGHT + (minute / 60) * HOUR_HEIGHT;
  })();

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
      {/* Week Header */}
      <div className="grid grid-cols-[2.5rem_repeat(7,1fr)] sm:grid-cols-[4rem_repeat(7,1fr)] border-b border-border/30 pb-2 mb-2">
        <div /> {/* Time column spacer */}
        {weekDays.map((day) => {
          const isDayToday = isToday(day);
          const isSelected = selectedDate && isSameDay(day, selectedDate);

          return (
            <button
              key={day.toISOString()}
              onClick={() => onSelectDate(day)}
              className={`text-center py-2 rounded-lg transition-all ${
                isSelected ? "bg-primary/10" : "hover:bg-accent/50"
              }`}
            >
              <div className={`text-xs ${isDayToday ? "text-primary font-medium" : "text-muted-foreground"}`}>
                {format(day, "EEE", { locale: dateLocale })}
              </div>
              <div
                className={`text-lg font-medium tabular-nums ${
                  isDayToday
                    ? "size-8 mx-auto flex items-center justify-center rounded-full bg-primary text-primary-foreground"
                    : ""
                }`}
              >
                {format(day, "d")}
              </div>
            </button>
          );
        })}
      </div>

      {/* All-day and multi-day events row */}
      {allDayAndMultiDayEvents.length > 0 && (
        <div className="grid grid-cols-[2.5rem_repeat(7,1fr)] sm:grid-cols-[4rem_repeat(7,1fr)] border-b border-border/30 pb-2 mb-2">
          <div className="text-[10px] sm:text-xs text-muted-foreground py-1">
            {t("weekView.allDayLabel")}
          </div>
          {weekDays.map((day, dayIndex) => {
            const dayEvents = getAllDayEventsForDay(day);
            return (
              <div key={day.toISOString()} className="px-0.5 flex flex-col gap-0.5">
                {dayEvents.slice(0, 3).map((event) => {
                  const isStart = isSameDay(event.start, day);
                  const isEnd = isSameDay(event.end, day);
                  const isMultiDay = isMultiDayEvent(event);

                  return (
                    <Tooltip key={event.id}>
                      <TooltipTrigger asChild>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={`${event.title}, ${format(event.start, "d. MMM", { locale: dateLocale })}${isMultiDay ? ` - ${format(event.end, "d. MMM", { locale: dateLocale })}` : ""}`}
                          onClick={() => onSelectEvent(event)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectEvent(event);
                            }
                          }}
                          className={`text-xs px-1.5 py-1 sm:py-0.5 truncate cursor-pointer hover:opacity-90 font-semibold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none ${
                            isStart && isEnd ? "rounded" :
                            isStart ? "rounded-l -mr-1" :
                            isEnd ? "rounded-r -ml-1" :
                            "-mx-1"
                          }`}
                          style={{
                            backgroundColor: personStrongTint(event.color),
                            color: personText(event.color),
                          }}
                        >
                          {isStart ? event.title : "\u00A0"}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">{event.title}</p>
                        <p className="text-xs opacity-70">
                          {format(event.start, "d. MMM", { locale: dateLocale })}
                          {isMultiDay && ` - ${format(event.end, "d. MMM", { locale: dateLocale })}`}
                        </p>
                        {event.location && (
                          <p className="text-xs opacity-70">{event.location}</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="text-xs text-muted-foreground text-center">
                    +{dayEvents.length - 3}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Time Grid */}
      <ScrollArea className="h-[calc(100vh-400px)]">
        <div className="grid grid-cols-[2.5rem_repeat(7,1fr)] sm:grid-cols-[4rem_repeat(7,1fr)] relative">
          {/* Time Labels */}
          <div>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="text-xs text-muted-foreground text-right pr-2 relative"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="absolute -top-2 right-1 sm:right-2 text-[9px] sm:text-xs">
                  {hour.toString().padStart(2, "0")}
                  <span className="hidden sm:inline">:00</span>
                </span>
              </div>
            ))}
          </div>

          {/* Day Columns */}
          {weekDays.map((day) => {
            const dayEvents = getTimedEventsForDay(day);
            const isDayToday = isToday(day);

            return (
              <div
                key={day.toISOString()}
                className="relative border-l border-border/20"
                style={{ height: HOURS.length * HOUR_HEIGHT }}
              >
                {/* Hour lines */}
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute w-full border-t border-border/10"
                    style={{ top: (hour - 6) * HOUR_HEIGHT }}
                  />
                ))}

                {/* Current time indicator */}
                {isDayToday && currentTimeTop !== null && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute w-full z-20 flex items-center"
                    style={{ top: currentTimeTop }}
                  >
                    <div className="size-2 rounded-full bg-red-500 -ml-1" />
                    <div className="flex-1 h-0.5 bg-red-500" />
                  </motion.div>
                )}

                {/* Events */}
                {dayEvents.map((event) => {
                  const { top, height } = getEventStyle(event);

                  return (
                    <Tooltip key={event.id}>
                      <TooltipTrigger asChild>
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${event.title}, ${format(event.start, "HH:mm")} - ${format(event.end, "HH:mm")}${event.location ? `, ${event.location}` : ""}`}
                          onClick={() => onSelectEvent(event)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectEvent(event);
                            }
                          }}
                          className="absolute left-1 right-1 p-1 sm:p-1.5 rounded cursor-pointer hover:opacity-90 transition-opacity overflow-hidden z-10 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          style={{
                            top,
                            height,
                            backgroundColor: personStrongTint(event.color),
                            borderLeft: `3px solid ${event.color}`,
                            color: personText(event.color),
                          }}
                        >
                          <p className="text-xs font-semibold truncate">
                            {event.title}
                          </p>
                          {height > 40 && (
                            <p className="text-[10px] font-mono tabular-nums opacity-80">
                              {format(event.start, "HH:mm")} -{" "}
                              {format(event.end, "HH:mm")}
                            </p>
                          )}
                          {height > 60 && event.location && (
                            <p className="text-[10px] opacity-70 truncate">
                              {event.location}
                            </p>
                          )}
                        </motion.div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">{event.title}</p>
                        <p className="text-xs opacity-70">
                          {format(event.start, "HH:mm")} -{" "}
                          {format(event.end, "HH:mm")}
                        </p>
                        {event.location && (
                          <p className="text-xs opacity-70">{event.location}</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>
      </CardContent>
    </Card>
  );
}
