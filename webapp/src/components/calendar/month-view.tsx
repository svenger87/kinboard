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
  isWeekend,
} from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { toLocalDateKey } from "@/lib/local-date";
import type { Holiday } from "@/lib/holidays";
import { holidayLabel } from "@/lib/holidays/label";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2 } from "lucide-react";
import { EventPill } from "@/components/event-pill";
import { useTimeFormat } from "@/hooks/use-time-format";
import { useWeekStart } from "@/hooks/use-week-start";
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
  /** Built-in public holidays by local day key; absent when the option is off. */
  holidayMarkers?: Map<string, Holiday>;
  /** Person colours with a task due, by local day key; absent when the option is off. */
  taskMarkers?: Map<string, string[]>;
}

const MAX_EVENTS_PER_CELL = 3;
const MAX_TASK_DOTS = 4;

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
  holidayMarkers,
  taskMarkers,
}: MonthViewProps) {
  const { formatTime } = useTimeFormat();
  const { weekStartsOn } = useWeekStart();
  const t = useTranslations("calendar");
  const tHolidays = useTranslations("holidays");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn });

  /*
    Localized weekday abbreviations for the header row.

    Each label carries its own `isWeekend`, because which *columns* are the
    weekend moves with the week start and their position does not: on a Sunday
    start, columns 5 and 6 are Friday and Saturday.

    `weekStartsOn` belongs in the dependency list. It arrives from a setting,
    so it changes after the first render — without it the labels kept the order
    they were built with until `currentDate` happened to change, and the header
    read Monday-first over Sunday-first columns.
  */
  const weekdayLabels = useMemo(() => {
    const firstDay = startOfWeek(currentDate, { weekStartsOn });
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(firstDay);
      day.setDate(firstDay.getDate() + i);
      return { label: format(day, "EEEEEE", { locale: dateLocale }), weekend: isWeekend(day) };
    });
  }, [currentDate, dateLocale, weekStartsOn]);

  const weeks = eachWeekOfInterval(
    { start: calendarStart, end: calendarEnd },
    { weekStartsOn }
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
        <div className="text-center text-3xs sm:text-3xs font-medium py-2 text-muted-foreground/40">
          {t("monthView.weekHeader")}
        </div>
        {weekdayLabels.map(({ label, weekend }, idx) => (
          <div
            key={idx}
            className={`text-center text-xs sm:text-sm font-medium py-2 ${
              weekend ? "text-muted-foreground/60" : "text-muted-foreground"
            }`}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar Weeks */}
      <div className="border-t border-border/30">
        {weeks.map((weekStart, weekIndex) => {
          const weekDays = eachDayOfInterval({
            start: weekStart,
            end: endOfWeek(weekStart, { weekStartsOn }),
          });

          return (
            <div
              key={weekStart.toISOString()}
              className="grid grid-cols-[1.5rem_repeat(7,1fr)] sm:grid-cols-[2rem_repeat(7,1fr)] border-b border-border/20"
            >
              {/* Week number */}
              <div className="flex items-start justify-center pt-1 sm:pt-1.5 text-3xs sm:text-3xs font-medium text-muted-foreground/40 border-r border-border/20">
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
                const dayKey = toLocalDateKey(day);
                const holiday = holidayMarkers?.get(dayKey);
                const taskColors = taskMarkers?.get(dayKey) ?? [];
                const visibleEvents = dayEvents.slice(0, MAX_EVENTS_PER_CELL);
                const overflowCount = dayEvents.length - MAX_EVENTS_PER_CELL;

                // The day-selection button covers the whole cell and the
                // content above it is pointer-events-none, so hover and
                // screen-reader users only get information that lives on
                // this button's accessible name -- the date, any holiday
                // name(s), and the tasks-due count the corner badge shows
                // from sm up. Dedup in case a calendar-sourced holiday
                // event and a built-in holiday marker name the same day
                // the same thing.
                const holidayNames = Array.from(
                  new Set(
                    [holidayEvent?.title, holiday ? holidayLabel(holiday, tHolidays) : undefined].filter(
                      (name): name is string => Boolean(name)
                    )
                  )
                );
                const dayButtonLabel = [
                  format(day, "PPPP", { locale: dateLocale }),
                  holidayNames.join(", "),
                  taskColors.length > 0
                    ? t("markers.tasksDueCount", { count: taskColors.length })
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  // The cell is a plain container, not a button. It used to be
                  // a <button> with the event chips (role="button") rendered
                  // inside it — nested interactive controls, which axe flags as
                  // serious and which makes a tap's target ambiguous (audit
                  // KB-08). Day selection now lives in a sibling button layered
                  // behind the content, so chips and the day control are peers.
                  // Taller at lg/xl so the bigger chips have somewhere to go —
                  // the portrait wall had ~770px of unused height below the grid.
                  <motion.div
                    key={day.toISOString()}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: (weekIndex * 7 + dayIndex) * 0.003 }}
                    className={`
                      relative min-h-[3.5rem] sm:min-h-[5rem] lg:min-h-[6.5rem] xl:min-h-[8rem] p-0.5 sm:p-1 text-left transition-all overflow-hidden
                      ${dayIndex > 0 ? "border-l border-border/20" : ""}
                      ${isCurrentMonth ? "" : "opacity-40 [&_span]:border-dashed"}
                      ${isDayToday ? "ring-2 ring-inset ring-primary bg-primary/[0.06]" : ""}
                      ${isSelected && !isDayToday ? "ring-2 ring-inset ring-primary/50 bg-primary/5" : ""}
                      ${!isSelected && !isDayToday ? "hover:bg-accent/50" : ""}
                      ${isWeekend(day) && !isDayToday && !isSelected ? "bg-muted/30" : ""}
                    `}
                  >
                    {/* Day-selection target, behind the content. Chips sit above
                        it in the stacking order and stop propagation already. */}
                    <button
                      type="button"
                      onClick={() => onSelectDate(day)}
                      aria-label={dayButtonLabel}
                      title={dayButtonLabel}
                      aria-pressed={isSelected ? true : undefined}
                      className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />

                    {/* Day Number. Like everything drawn over the day-selection
                        button except the event chips, it lets taps through
                        (pointer-events-none): a tap on the date number -- the
                        obvious place -- used to land here and do nothing. */}
                    <div className="pointer-events-none relative z-10 flex items-center gap-0.5 mb-0.5 min-w-0">
                      <span
                        className={`
                          inline-flex items-center justify-center size-5 sm:size-6 rounded-full text-3xs sm:text-xs font-medium tabular-nums shrink-0
                          ${isDayToday ? "bg-primary text-primary-foreground font-bold" : ""}
                        `}
                      >
                        {format(day, "d")}
                      </span>
                      {holidayEvent && (
                        <span className="hidden sm:inline flex-1 min-w-0 text-3xs text-muted-foreground truncate leading-none">
                          {holidayEvent.title}
                        </span>
                      )}
                      {/* Built-in holiday: an amber dot, the colour holidays
                          already have in the day panel, and the name where
                          there is room -- unless a holiday calendar already
                          labelled the day. */}
                      {holiday && (
                        <>
                          <span
                            className="size-1.5 sm:size-2 rounded-full bg-amber-400 shrink-0"
                            role="img"
                            aria-label={holidayLabel(holiday, tHolidays)}
                            title={holidayLabel(holiday, tHolidays)}
                          />
                          {!holidayEvent && (
                            <span className="hidden sm:inline flex-1 min-w-0 text-3xs text-amber-400 truncate leading-none">
                              {holidayLabel(holiday, tHolidays)}
                            </span>
                          )}
                        </>
                      )}
                      {/* Tasks: one dot per person with something due, in
                          the corner from sm up. A phone cell is ~45px: the
                          number, a holiday dot and four task dots do not fit
                          on one line, so there they get a row of their own.
                          Up to ~850px a cell can still be too narrow for a
                          holiday plus five people's dots and "+N", so the
                          corner wraps onto a second line rather than cut the
                          last ones off; the holiday name gives way first. */}
                      {taskColors.length > 0 && (
                        <span
                          className="hidden sm:flex ml-auto min-w-0 flex-wrap items-center justify-end gap-0.5 pr-0.5"
                          role="img"
                          aria-label={t("markers.tasksDue")}
                          title={t("markers.tasksDue")}
                        >
                          {taskColors.slice(0, MAX_TASK_DOTS).map((color, i) => (
                            <span
                              key={`${color}-${i}`}
                              className="size-2 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                          {taskColors.length > MAX_TASK_DOTS && (
                            <span className="text-3xs text-muted-foreground leading-none">
                              +{taskColors.length - MAX_TASK_DOTS}
                            </span>
                          )}
                        </span>
                      )}
                    </div>

                    {/* Phone: the task dots on their own row, wrapping like
                        the event dots below rather than running off the cell. */}
                    {taskColors.length > 0 && (
                      <div
                        className="pointer-events-none sm:hidden relative z-10 flex flex-wrap justify-center gap-0.5 mb-0.5"
                        role="img"
                        aria-label={t("markers.tasksDue")}
                      >
                        {taskColors.slice(0, MAX_TASK_DOTS).map((color, i) => (
                          <span
                            key={`${color}-${i}`}
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                        {taskColors.length > MAX_TASK_DOTS && (
                          <span className="text-3xs text-muted-foreground leading-none">
                            +{taskColors.length - MAX_TASK_DOTS}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Events - inline in cell. z-10 keeps chips above the
                        day-selection button that now sits behind the content. */}
                    <div className="pointer-events-none relative z-10 flex flex-col gap-px">
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
                                  className="pointer-events-auto cursor-pointer transition-opacity hover:opacity-80"
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
                          <div className="pl-1.5 font-medium text-muted-foreground" style={{ fontSize: "var(--event-pill-size)" }}>
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
                            <span className="text-3xs text-muted-foreground">
                              +{dayEvents.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
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
