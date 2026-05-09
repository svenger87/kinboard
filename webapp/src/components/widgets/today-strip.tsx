"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, CheckSquare, Clock, ArrowRight, Cake, Trash2, Star } from "lucide-react";
import { format, startOfDay, endOfDay, isAfter, parseISO, setYear, differenceInDays, addYears } from "date-fns";
import { useTranslations } from "next-intl";
import { useEvents, useTodos, useBirthdays, useSetting } from "@/hooks";
import { getUpcomingHolidays, type CountryCode } from "@/lib/holidays";

function getDaysUntilBirthday(dateStr: string): number {
  const date = parseISO(dateStr + "T12:00:00");
  const today = startOfDay(new Date());
  const thisYear = startOfDay(setYear(date, today.getFullYear()));
  const diff = differenceInDays(thisYear, today);
  if (diff < 0) return differenceInDays(addYears(thisYear, 1), today);
  return diff;
}

export function TodayStrip() {
  const t = useTranslations("todayStrip");
  const tHolidays = useTranslations("holidays");

  // Recompute "today" every minute so a kiosk display stays correct past midnight
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = now;
  const startISO = useMemo(() => startOfDay(today).toISOString(), [today]);
  const endISO = useMemo(() => endOfDay(today).toISOString(), [today]);

  const { data: events } = useEvents(startISO, endISO);
  const { data: todos } = useTodos();
  const { data: birthdays } = useBirthdays();
  const { data: holidayCountry } = useSetting<CountryCode>("holiday_country", "de");
  const country: CountryCode = holidayCountry ?? "de";

  // Filter to only today's non-waste events that haven't ended
  const todayEvents = useMemo(() =>
    (events || [])
      .filter((e) => !e.calendar?.is_waste_collection)
      .filter((e) => {
        const end = e.end_at ? new Date(e.end_at) : new Date(e.start_at);
        return isAfter(end, new Date());
      }),
    [events]
  );

  // Waste collection events for today/tomorrow
  const wasteToday = useMemo(() =>
    (events || []).filter((e) => e.calendar?.is_waste_collection),
    [events]
  );

  // Next upcoming timed event (not all-day)
  const nextEvent = useMemo(() =>
    todayEvents
      .filter((e) => !e.all_day && isAfter(new Date(e.start_at), new Date()))
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())[0],
    [todayEvents]
  );

  const pendingTodos = useMemo(() =>
    (todos || []).filter((t) => !t.completed).length,
    [todos]
  );

  // Birthdays today
  const birthdaysToday = useMemo(() =>
    (birthdays || []).filter((b) => getDaysUntilBirthday(b.date) === 0),
    [birthdays]
  );

  // Upcoming holidays (within 14 days)
  const upcomingHolidays = useMemo(() => getUpcomingHolidays(country, 14), [country]);
  const nextHoliday = upcomingHolidays[0];
  const holidayIsToday = nextHoliday && differenceInDays(nextHoliday.date, startOfDay(new Date())) === 0;
  const holidayDaysAway = nextHoliday ? differenceInDays(nextHoliday.date, startOfDay(new Date())) : 0;

  const hasContent = todayEvents.length > 0 || pendingTodos > 0 || birthdaysToday.length > 0 || wasteToday.length > 0 || !!nextHoliday;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.6 }}
      className="flex items-center justify-center gap-4 sm:gap-6 flex-wrap text-sm text-muted-foreground/80 bg-white/[0.04] border border-white/[0.06] rounded-2xl px-6 py-2"
      role="status"
      aria-label={t("ariaLabel")}
    >
      {birthdaysToday.length > 0 && (
        <span className="flex items-center gap-1.5 text-month-primary">
          <Cake className="size-3.5" />
          <span className="font-medium">
            {birthdaysToday.map((b) => b.name).join(", ")}
          </span>
        </span>
      )}

      {todayEvents.length > 0 && (
        <span className="flex items-center gap-1.5">
          <Calendar className="size-3.5 text-month-primary/60" />
          <span className="font-medium text-foreground/70">{todayEvents.length}</span>
          {t("events", { count: todayEvents.length })}
        </span>
      )}

      {pendingTodos > 0 && (
        <span className="flex items-center gap-1.5">
          <CheckSquare className="size-3.5 text-month-primary/60" />
          <span className="font-medium text-foreground/70">{pendingTodos}</span>
          {t("pendingTodos")}
        </span>
      )}

      {wasteToday.length > 0 && (
        <span className="flex items-center gap-1.5 text-amber-400/90">
          <Trash2 className="size-3.5 animate-pulse motion-reduce:animate-none" />
          <span className="font-medium">{wasteToday.length}</span>
          {t("wasteToday", { count: wasteToday.length })}
        </span>
      )}

      {nextHoliday && (
        <span className="flex items-center gap-1.5">
          <Star className="size-3.5 text-amber-400/80" />
          <span className={holidayIsToday ? "font-medium text-amber-400" : ""}>
            {nextHoliday.emoji} {tHolidays(nextHoliday.nameKey)}
          </span>
          {!holidayIsToday && (
            <span className="text-foreground/50">
              {t("daysUntil", { count: holidayDaysAway })}
            </span>
          )}
        </span>
      )}

      {nextEvent && (
        <span className="flex items-center gap-1.5">
          <ArrowRight className="size-3 text-month-primary/40" />
          <Clock className="size-3.5 text-month-primary/60" />
          <span className="font-medium text-foreground/70">
            {format(new Date(nextEvent.start_at), "HH:mm")}
          </span>
          <span className="truncate max-w-[120px] sm:max-w-[200px]">{nextEvent.title}</span>
        </span>
      )}

      {!hasContent && (
        <span className="text-muted-foreground/50 italic">
          {t("emptyState")}
        </span>
      )}
    </motion.div>
  );
}
