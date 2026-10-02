"use client";

import { motion } from "framer-motion";
import { CalendarHeart, ChevronRight, TreePalm } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { WidgetCard } from "@/components/widget-card";
import { useHolidayRegion, useToday } from "@/hooks";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { daysUntilHoliday, nextHolidays } from "@/lib/holidays";
import { holidayLabel } from "@/lib/holidays/label";

interface HolidayWidgetProps {
  maxItems?: number;
  className?: string;
}

/**
 * The next holidays for the family's country (Settings -> Holidays), each with
 * the days left. A palm tree marks the ones that are a day off -- and, for one
 * that falls on a weekend and is taken on a weekday instead, which weekday.
 */
export function HolidayWidget({ maxItems = 3, className = "" }: HolidayWidgetProps) {
  const t = useTranslations("holidayWidget");
  const tHolidays = useTranslations("holidays");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  // Re-render at midnight so the countdown moves on without a reload.
  const today = useToday();
  const { region, isLoading, isError } = useHolidayRegion();

  // No region yet (a new family that skipped the wizard step): no holidays,
  // rather than a country's that may not be theirs (RFC-014 §4.2).
  const holidays = useMemo(
    () => (region ? nextHolidays(region, new Date(today), maxItems, locale) : []),
    [region, today, maxItems, locale],
  );

  const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const item = { hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0 } };
  // Non-breaking spaces keep a date in one piece: when "Chômé le lun., 27. déc."
  // has to wrap on a narrow card, it breaks before the date, not inside it.
  const day = (date: Date) => format(date, "EEE, d. MMM", { locale: dateLocale }).replace(/ /g, "\u00a0");

  const headerRight = (
    <Link
      href="/calendar"
      className="p-1 rounded-lg hover:bg-accent/50 transition-colors"
      aria-label={t("viewCalendarAria")}
    >
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className={className}
    >
      <WidgetCard icon={CalendarHeart} title={t("title")} headerRight={headerRight}>
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-3">
          {holidays.map((holiday) => {
            // To the holiday or its day off, whichever comes first: on the
            // Friday a Saturday holiday is taken, the day off is today.
            const daysUntil = daysUntilHoliday(holiday, new Date(today));
            const isToday = daysUntil === 0;
            const isSoon = daysUntil > 0 && daysUntil <= 7;
            return (
              <motion.div
                key={`${holiday.nameKey || holiday.name}-${holiday.date.getTime()}`}
                variants={item}
                // Wraps on a narrow card -- four columns on a 1024px landscape
                // panel make it ~220px -- so the countdown drops below the name
                // rather than cutting it short.
                className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-card px-3 py-2 elev-sm${isToday ? " border-l-4 border-l-primary" : ""}`}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base leading-none" aria-hidden="true">
                  {holiday.emoji}
                </span>
                <div className="min-w-[6.5rem] flex-1">
                  <p className="line-clamp-2 hyphens-auto break-words text-sm font-medium leading-snug">{holidayLabel(holiday, tHolidays)}</p>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
                    <span className="whitespace-nowrap">{day(holiday.date)}</span>
                    {holiday.dayOff && (
                      <span className="inline-flex min-w-0 items-start gap-1 text-success">
                        <TreePalm className="mt-px size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        <span className="min-w-0">
                          {holiday.observed ? t("dayOffOn", { date: day(holiday.observed) }) : t("dayOff")}
                        </span>
                      </span>
                    )}
                  </p>
                </div>
                {isToday ? (
                  <Badge variant="default" className="ml-auto shrink-0 tabular-nums">{t("todayBadge")}</Badge>
                ) : (
                  <Badge variant={isSoon ? "warning" : "neutral"} className="ml-auto shrink-0 tabular-nums">{t("daysSuffix", { count: daysUntil })}</Badge>
                )}
              </motion.div>
            );
          })}
          {holidays.length === 0 && region !== null && (
            <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
              <CalendarHeart className="size-8 mb-2 opacity-20" />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
          {/* Only when the region is known to be unset: a read that failed says
              nothing about it, and must not ask a family that chose one to choose. */}
          {region === null && !isLoading && !isError && (
            <Link
              href="/settings/holidays"
              className="flex flex-col items-center justify-center gap-1 py-4 text-center text-muted-foreground hover:text-foreground"
            >
              <CalendarHeart className="size-8 mb-1 opacity-20" />
              <p className="text-sm">{t("noRegion")}</p>
            </Link>
          )}
        </motion.div>
      </WidgetCard>
    </motion.div>
  );
}
