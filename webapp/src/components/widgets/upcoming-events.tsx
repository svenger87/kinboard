"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Calendar, Clock, MapPin, ChevronRight } from "lucide-react";
import { format, isToday, isTomorrow, addDays, startOfDay, endOfDay, isWithinInterval, differenceInMinutes } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import { useEvents, usePeople } from "@/hooks";

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
  const t = useTranslations("upcomingEvents");
  const locale = useLocale();
  const dateLocale = locale === "de" ? de : enUS;

  // Get events for today and the next 14 days - memoized to prevent infinite refetches
  const { startDate, endDate } = useMemo(() => {
    const today = new Date();
    return {
      startDate: startOfDay(today).toISOString(),
      endDate: endOfDay(addDays(today, 14)).toISOString(),
    };
  }, []);

  const { data: events, isLoading, isError, error } = useEvents(startDate, endDate);
  const { data: people } = usePeople();

  // Transform events to display format
  const displayEvents = useMemo(() => (events || []).filter((event) => !event.calendar?.is_waste_collection).map((event) => {
    // Use event's person_id first, then fall back to calendar's person_id
    const personId = event.person_id || event.calendar?.person_id;
    const person = personId ? people?.find((p) => p.id === personId) : undefined;
    return {
      id: event.id,
      title: event.title,
      start: new Date(event.start_at),
      end: new Date(event.end_at),
      color: person?.color || event.calendar?.color || "#3b82f6",
      allDay: event.all_day,
      location: event.location,
      person: person?.name,
    };
  }), [events, people]);

  if (isLoading) {
    return <UpcomingEventsSkeleton />;
  }

  if (isError) {
    return (
      <Card className={`accent-border-top h-full ${className}`}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl font-medium">
            <span className="p-1.5 rounded-lg bg-month-primary/10">
              <Calendar className="size-5 text-month-primary" strokeWidth={1.5} />
            </span>
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
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
    hidden: { opacity: 0, x: -20 },
    show: { opacity: 1, x: 0 },
  };

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <Card className={`accent-border-top h-full ${className}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-xl font-medium">
                <span className="p-1.5 rounded-lg bg-month-primary/10">
                  <Calendar className="size-5 text-month-primary" strokeWidth={1.5} />
                </span>
                {t("title")}
                {displayEvents.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-medium">
                    {displayEvents.length}
                  </Badge>
                )}
              </CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/calendar"
                    className="p-1 rounded-lg hover:bg-accent/50 transition-colors"
                    aria-label={t("viewAllAria")}
                  >
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("viewAllTooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[160px] sm:max-h-[220px] pr-4">
              <motion.div
                variants={container}
                initial="hidden"
                animate="show"
                className="flex flex-col gap-1"
              >
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
                          <div className="flex items-center gap-2 mt-1 mb-1.5 first:mt-0">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                              {dayLabel}
                            </span>
                            <div className="flex-1 h-px bg-border/30" />
                          </div>
                        )}
                        <div className="flex items-start gap-3 group rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-accent/50">
                          {/* Color Indicator */}
                          <div
                            className="w-1.5 h-10 rounded-full transition-all group-hover:h-12 shrink-0 mt-0.5"
                            style={{
                              backgroundColor: event.color,
                              boxShadow: `0 0 8px ${event.color}40`,
                            }}
                          />

                          {/* Event Details */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-base font-medium truncate group-hover:text-month-primary transition-colors">
                                {event.title}
                              </p>
                              {event.person && (
                                <span
                                  className="shrink-0 text-xs px-1.5 py-0.5 rounded-full"
                                  style={{ backgroundColor: `${event.color}20`, color: event.color }}
                                >
                                  {event.person}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              {!event.allDay && (() => {
                                const now = new Date();
                                const isHappening = isWithinInterval(now, { start: event.start, end: event.end });
                                const minutesUntil = differenceInMinutes(event.start, now);
                                const isUpcomingSoon = minutesUntil > 0 && minutesUntil <= 60 && isToday(event.start);
                                return (
                                  <>
                                    {isHappening ? (
                                      <span className="flex items-center gap-1 shrink-0 text-month-primary font-medium text-xs">
                                        <span className="size-1.5 rounded-full bg-month-primary animate-pulse" />
                                        {t("nowBadge")}
                                      </span>
                                    ) : isUpcomingSoon ? (
                                      <span className="flex items-center gap-1 shrink-0 text-xs">
                                        <Clock className="size-3" />
                                        {format(event.start, "HH:mm")}
                                        <span className="text-month-primary/70">
                                          {t("inMinutes", { minutes: minutesUntil })}
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="flex items-center gap-1 shrink-0">
                                        <Clock className="size-3" />
                                        {format(event.start, "HH:mm")}
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                              {event.allDay && (
                                <span className="text-xs text-month-primary/60">{t("allDayBadge")}</span>
                              )}
                              {event.location && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="flex items-center gap-1 truncate">
                                      <MapPin className="size-3 shrink-0" />
                                      <span className="truncate">{event.location}</span>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{event.location}</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  });
                })()}

                {displayEvents.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                    <Calendar className="size-10 mb-2 text-month-primary/20" />
                    <p className="text-sm">{t("emptyState")}</p>
                  </div>
                )}
              </motion.div>
            </ScrollArea>

            {displayEvents.length > maxEvents && (
              <Link
                href="/calendar"
                className="flex items-center justify-center gap-1 mt-3 pt-3 border-t border-border/30 text-sm text-month-primary/60 hover:text-month-primary transition-colors"
              >
                <span>{t("moreCount", { count: displayEvents.length - maxEvents })}</span>
                <ChevronRight className="size-4" />
              </Link>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </TooltipProvider>
  );
}
