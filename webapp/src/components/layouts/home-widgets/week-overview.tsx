"use client";

import { useRef } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { useWeekOverview } from "@/components/widgets/week-overview-widget";
import type { HomeWidgetProps } from "./shared";
import { HomeCard, HomeCardHeader, homePadPx, useHeadEm } from "./frame";
import { useEm, useShrinkStep } from "./rest-shared";

/**
 * The arrangements, richest first: everything; without the legend; without
 * the holidays' names; without the dots; without the weekday names; and
 * only at the very last without the title row, which is the screen's size
 * in every box (frame.tsx). Each step drops one line, so the seven days
 * stay as large as the box allows.
 */
const STEPS = [
  { header: true, holidays: true, legend: true, name: true, dots: true },
  { header: true, holidays: true, legend: false, name: true, dots: true },
  { header: true, holidays: false, legend: false, name: true, dots: true },
  { header: true, holidays: false, legend: false, name: true, dots: false },
  { header: true, holidays: false, legend: false, name: false, dots: false },
  { header: false, holidays: false, legend: false, name: false, dots: false },
] as const;

const GAP_EM = 0.2;
const MAX_HOLIDAY_LINES = 3;

/**
 * The week overview in a box (RFC-022 §3.1, fixed): seven columns, today
 * first, each opening that day in the calendar. Reads the events, tasks and
 * birthdays from Home's shared data; the day logic is the card's
 * (useWeekOverview). Its minimum is 24 steps wide, so seven columns always
 * have room for a 48px target each.
 */
export function WeekOverviewHomeWidget({ box }: HomeWidgetProps) {
  const t = useTranslations("weekOverviewWidget");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const home = useHomeDataContext();
  const { isLoading, weekDays, holidays, totalWeekEvents, weekHasHoliday, holidayDayLabel, maxItems } = useWeekOverview({
    events: home.events,
    todos: home.todos,
    birthdays: home.birthdays,
    isLoading: home.eventsLoading || home.todosLoading || home.birthdaysLoading,
  });

  const ref = useRef<HTMLDivElement>(null);
  const em = useEm(ref);
  const signature = weekDays.map((d) => `${d.totalItems}${d.publicHoliday ? "h" : ""}`).join() + `|${holidays.length}`;
  const step = useShrinkStep(ref, STEPS.length, [box.width, box.height, signature, isLoading, em]);
  const s = STEPS[step];

  // Each column's width, and the date's circle: as large as the column and
  // the box allow, never smaller than the card's.
  const pad = homePadPx(useHeadEm(ref));
  const colW = (box.width - 2 * pad - 6 * GAP_EM * em) / 7;
  const circle = Math.max(16, Math.floor(Math.min(colW - 4, Math.max(1.9 * em, Math.min(colW * 0.7, box.height * 0.2)))));

  if (isLoading) {
    return (
      <HomeCard ref={ref} testId="home-week-overview" icon={CalendarDays} title={t("title")} href="/calendar" bodyClassName="animate-pulse">
        <span />
      </HomeCard>
    );
  }

  return (
    <HomeCard ref={ref} testId="home-week-overview" step={step} className="gap-[0.4em]">
      {s.header && (
        <HomeCardHeader
          icon={CalendarDays}
          title={t("title")}
          href="/calendar"
          right={<span className="home-meta text-muted-foreground">{t("weekEvents", { count: totalWeekEvents })}</span>}
        />
      )}
      <div className="grid flex-1 grid-cols-7" style={{ gap: `${GAP_EM}em` }}>
        {weekDays.map((day) => (
          <Link
            key={day.date.toISOString()}
            href={`/calendar?date=${format(day.date, "yyyy-MM-dd")}`}
            className={`flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-[0.2em] rounded-lg px-[0.1em] py-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              day.isToday ? "bg-primary/15 ring-1 ring-primary/30" : "hover:bg-accent/50"
            }`}
            aria-label={[
              t("dayAria", { date: format(day.date, "EEEE, d. MMMM", { locale: dateLocale }), count: day.totalItems }),
              ...day.holidayNames,
            ].join(" – ")}
            title={day.holidayNames.length > 0 ? day.holidayNames.join(" · ") : undefined}
            data-testid="week-day"
          >
            {s.name && (
              <span
                className={`max-w-full truncate home-label font-medium uppercase tracking-wider ${day.isToday ? "text-primary" : "text-muted-foreground"}`}
              >
                {/* The weekday even for today, whose column is marked already: "Today" does not fit a seventh of a small box. */}
                {format(day.date, "EE", { locale: dateLocale })}
              </span>
            )}
            <span
              data-holiday={day.publicHoliday ? "public" : undefined}
              className={`relative flex shrink-0 items-center justify-center rounded-full font-semibold ${
                day.isToday
                  ? "bg-primary text-primary-foreground"
                  : day.hasBirthday
                    ? "bg-pink-500/20 text-pink-600 dark:text-pink-400"
                    : day.publicHoliday
                      ? "bg-amber-400/15 text-amber-600 dark:text-amber-400"
                      : "text-foreground"
              } ${day.publicHoliday ? "ring-1 ring-amber-400/70" : ""}`}
              style={{ width: circle, height: circle, fontSize: Math.min(em * 0.85, circle * 0.5) }}
            >
              {day.dayNumber}
              {day.publicHoliday?.emoji && (
                <span className="absolute -left-[0.15em] -top-[0.15em] home-label" aria-hidden="true">
                  {day.publicHoliday.emoji}
                </span>
              )}
              {day.hasBirthday && (
                <span className="absolute -right-[0.15em] -top-[0.15em] home-label" aria-hidden="true">
                  🎂
                </span>
              )}
            </span>
            {s.dots && (
              <span className="flex h-[0.5em] items-center gap-[0.1em]">
                {day.totalItems > 0 ? (
                  <>
                    {day.eventCount > 0 && (
                      <span
                        className="rounded-full bg-primary"
                        style={{ width: `${Math.max(0.2, Math.min(0.45, (day.eventCount / maxItems) * 0.45))}em`, height: "0.2em" }}
                      />
                    )}
                    {day.todoCount > 0 && (
                      <span
                        className="rounded-full bg-amber-400"
                        style={{ width: `${Math.max(0.2, Math.min(0.45, (day.todoCount / maxItems) * 0.45))}em`, height: "0.2em" }}
                      />
                    )}
                    {day.birthdayCount > 0 && <span className="size-[0.2em] rounded-full bg-pink-400" />}
                  </>
                ) : (
                  <span className="home-label text-muted-foreground/40">—</span>
                )}
              </span>
            )}
            {s.dots && weekHasHoliday && (
              <span
                data-holiday={day.schoolBreak ? "school" : undefined}
                className={`h-[0.2em] w-full rounded-full ${day.schoolBreak ? "bg-amber-400/60" : ""}`}
              />
            )}
          </Link>
        ))}
      </div>
      {s.holidays && holidays.length > 0 && (
        <ul className="flex shrink-0 flex-col gap-[0.15em]" aria-label={t("holidaysAria")}>
          {holidays.slice(0, MAX_HOLIDAY_LINES).map((h) => (
            <li key={h.id} data-holiday={h.kind} className="flex min-w-0 items-baseline gap-[0.4em] home-meta text-amber-600 dark:text-amber-400">
              <span className="shrink-0 tabular-nums opacity-80">{holidayDayLabel(h)}</span>
              <span className="min-w-0 truncate font-medium">{h.emoji ? `${h.emoji} ${h.title}` : h.title}</span>
            </li>
          ))}
        </ul>
      )}
      {s.legend && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-[1em] home-label text-muted-foreground">
          <span className="flex items-center gap-[0.3em]">
            <span className="size-[0.5em] rounded-full bg-primary" />
            {t("legendEvents")}
          </span>
          <span className="flex items-center gap-[0.3em]">
            <span className="size-[0.5em] rounded-full bg-amber-400" />
            {t("legendTodos")}
          </span>
          <span className="flex items-center gap-[0.3em]">
            <span className="size-[0.5em] rounded-full bg-pink-400" />
            {t("legendBirthdays")}
          </span>
        </div>
      )}
    </HomeCard>
  );
}
