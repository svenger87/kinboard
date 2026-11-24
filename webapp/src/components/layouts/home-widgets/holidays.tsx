"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CalendarHeart, TreePalm } from "lucide-react";
import { useHolidayDay, useNextHolidays } from "@/components/widgets/holiday-widget";
import { daysUntilHoliday } from "@/lib/holidays";
import { holidayLabel } from "@/lib/holidays/label";
import { HOME_ROW, HomeEmptyLine, HomeList, TARGET_H } from "./list-shared";
import type { HomeWidgetProps } from "./shared";
import { HomeCard } from "./frame";

/** How far ahead the box looks: a year, so "+n" counts the holidays still to come this coming year. */
const DAYS_AHEAD = 365;

type Entry = ReturnType<typeof useNextHolidays>["holidays"][number] & { daysUntil: number; key: string };

const keyOf = (h: Entry) => h.key;

/**
 * The family's next holidays, as many as fit, each with the days left; a
 * palm tree marks a day off. "+n" and the title open /calendar, as the
 * card's chevron does.
 */
export function HolidaysHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("holidayWidget");
  const tHolidays = useTranslations("holidays");
  const { today, region, isLoading, isError, holidays } = useNextHolidays(Infinity);
  const day = useHolidayDay();

  const entries = useMemo<Entry[]>(
    () =>
      holidays
        .map((h) => ({ ...h, daysUntil: daysUntilHoliday(h, new Date(today)), key: `${h.nameKey || h.name}-${h.date.getTime()}` }))
        .filter((h) => h.daysUntil <= DAYS_AHEAD),
    [holidays, today],
  );

  const renderItem = (h: Entry) => {
    const isToday = h.daysUntil === 0;
    const isSoon = h.daysUntil > 0 && h.daysUntil <= 7;
    return (
      <>
        <div className={`${HOME_ROW}${isToday ? " border-l-4 border-l-primary" : ""}`}>
          <span className="flex size-[1.6em] shrink-0 items-center justify-center rounded-[0.4em] bg-muted home-body leading-none" aria-hidden="true">
            {h.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="hyphens-auto break-words home-body font-medium leading-snug">{holidayLabel(h, tHolidays)}</p>
            <p className="flex flex-wrap items-center gap-x-[0.4em] home-meta tabular-nums text-muted-foreground">
              <span className="whitespace-nowrap">{day(h.date)}</span>
              {h.dayOff && (
                <span className="inline-flex min-w-0 items-start gap-[0.25em] text-success">
                  <TreePalm className="mt-[0.1em] size-[1em] shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  <span className="min-w-0">{h.observed ? t("dayOffOn", { date: day(h.observed) }) : t("dayOff")}</span>
                </span>
              )}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-[0.6em] py-[0.15em] home-meta font-semibold tabular-nums ${
              isToday ? "bg-primary text-primary-foreground" : isSoon ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"
            }`}
          >
            {isToday ? t("todayBadge") : t("daysSuffix", { count: h.daysUntil })}
          </span>
        </div>
      </>
    );
  };

  // Only when the region is known to be unset: a read that failed says
  // nothing about it, and must not ask a family that chose one to choose.
  const noRegion = region === null && !isLoading && !isError;
  const empty = noRegion ? (
    <Link href="/settings/holidays" className={`${TARGET_H} flex items-center home-body text-muted-foreground hover:text-foreground`}>
      {t("noRegion")}
    </Link>
  ) : (
    <HomeEmptyLine text={t("emptyState")} />
  );

  return (
    <HomeCard list testId="home-widget-holidays" icon={CalendarHeart} title={t("title")} href="/calendar" editing={editing}>
      <HomeList items={entries} keyOf={keyOf} renderItem={renderItem} empty={empty} href="/calendar" />
    </HomeCard>
  );
}
