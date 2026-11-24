"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { addDays, format, isSameDay } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { Calendar, ChevronRight, type LucideIcon } from "lucide-react";
import { ListBox } from "@/components/layouts/list-box";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { useHolidayEntries } from "@/hooks";
import { useTimeFormat } from "@/hooks/use-time-format";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { eventTaskOccurrences } from "@/lib/task-events";
import { entryListDay, HOLIDAY_COLOR, holidayEndPattern, keyToDate } from "@/lib/holiday-entries";
import { toLocalDateKey } from "@/lib/local-date";
import { personText } from "@/lib/person-color";
import type { HomeWidgetProps } from "./shared";
import { HomeCard } from "./frame";

import { HOME_TARGET_H } from "./frame";

interface Row {
  id: string;
  title: string;
  start: Date;
  color: string;
  allDay: boolean;
  holiday: boolean;
  /** A calendar event: tapping it opens it on the calendar. Holidays and tasks have no event to open. */
  event: boolean;
  /** The day heading above this row, when it starts a new day. */
  dayLabel: string | null;
}

/**
 * The upcoming events in a box (RFC-022 §3.1): the Events card's list -- the
 * events of Home's shared fortnight, the holidays among them and the tasks
 * flagged for it -- with as many whole rows as fit, then "+n" linking to the
 * calendar. Each event is a 48px target that opens it on the calendar
 * (`/calendar?event=`), its detail dialog over the calendar page.
 */
export function HomeUpcomingEventsWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("upcomingEvents");
  const tCalendar = useTranslations("calendar");
  const tLayouts = useTranslations("components.layouts");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const { formatTime } = useTimeFormat();
  const { today, eventWindow, events, eventsLoading, eventsError, todos, people } = useHomeDataContext();
  const { startDate, endDate } = eventWindow;

  // The same holidays the Events card lists, from the same window.
  const todayKey = toLocalDateKey(new Date(today));
  const { entries: holidays } = useHolidayEntries(todayKey, toLocalDateKey(new Date(endDate)), events, { eventList: true });

  const rows = useMemo<Row[]>(() => {
    const calendarRows = (events || [])
      .filter((event) => !event.calendar?.is_waste_collection)
      .map((event) => {
        const personId = event.person_id || event.calendar?.person_id;
        const person = personId ? people?.find((p) => p.id === personId) : undefined;
        return {
          id: event.id,
          title: event.title,
          start: new Date(event.start_at),
          color: person?.color || event.calendar?.color || "#3b82f6",
          allDay: event.all_day,
          holiday: false,
          event: true,
        };
      });
    const holidayRows = holidays.map((h) => ({
      id: h.id,
      title: [
        h.emoji ? `${h.emoji} ${h.title}` : h.title,
        h.endKey > h.startKey
          ? t("holidayUntil", { date: format(keyToDate(h.endKey), holidayEndPattern(locale), { locale: dateLocale }) })
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      start: entryListDay(h, todayKey),
      color: HOLIDAY_COLOR,
      allDay: true,
      holiday: true,
      event: false,
    }));
    const taskRows = eventTaskOccurrences(
      todos ?? [],
      people ?? [],
      new Date(startDate),
      new Date(endDate),
      "hsl(var(--muted-foreground))",
    ).map((o) => ({
      id: o.id,
      title: o.personName
        ? tCalendar("markers.taskTitleWithPerson", { title: o.title, person: o.personName })
        : tCalendar("markers.taskTitle", { title: o.title }),
      start: o.date,
      color: o.color,
      allDay: true,
      holiday: false,
      event: false,
    }));
    // Holidays first: on a tie the stable sort keeps them ahead of the day's events.
    const sorted = [...holidayRows, ...calendarRows, ...taskRows].sort((a, b) => a.start.getTime() - b.start.getTime());
    let last = "";
    return sorted.map((r) => {
      const label = isSameDay(r.start, today)
        ? t("today")
        : isSameDay(r.start, addDays(today, 1))
          ? t("tomorrow")
          : format(r.start, "EEEE, d. MMM", { locale: dateLocale });
      const dayLabel = label !== last ? label : null;
      last = label;
      return { ...r, dayLabel };
    });
  }, [events, people, holidays, todos, startDate, endDate, todayKey, t, tCalendar, locale, dateLocale, today]);

  const moreLabel = useCallback((count: number) => tLayouts("more", { count }), [tLayouts]);
  const renderMore = useCallback(
    (_n: number, label: string) => (
      <Link
        href="/calendar"
        data-home-list-more
        className={`${HOME_TARGET_H} flex items-center justify-center gap-[0.25em] rounded-[0.5em] home-body font-medium text-primary/80 transition-colors hover:bg-accent/50 hover:text-primary`}
      >
        <span>{label}</span>
        <ChevronRight className="size-[1em]" aria-hidden="true" />
      </Link>
    ),
    [],
  );

  const renderRow = (r: Row) => {
    const body = (
      <>
        {!r.allDay && (
          <span className="shrink-0 home-body font-bold tabular-nums" style={{ color: personText(r.color) }}>
            {formatTime(r.start)}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate home-body font-medium">{r.title}</span>
      </>
    );
    const rowClass = `${HOME_TARGET_H} flex w-full items-center gap-[0.6em] rounded-[0.6em] border border-border px-[0.7em] py-[0.2em] text-left leading-tight elev-sm ${r.holiday ? "bg-amber-400/10" : "bg-card"}`;
    return (
      <div className="pb-[0.25em]" data-holiday={r.holiday ? "true" : undefined}>
        {r.dayLabel && (
          <div className="mb-[0.1em] flex items-center gap-[0.5em] leading-tight">
            <span className="text-kiosk-label home-label">{r.dayLabel}</span>
            <div className="h-px flex-1 bg-border/40" />
          </div>
        )}
        {r.event ? (
          <Link
            href={`/calendar?event=${encodeURIComponent(r.id)}`}
            className={`${rowClass} transition-colors hover:bg-accent/50`}
            style={{ borderLeft: `4px solid ${r.color}` }}
          >
            {body}
          </Link>
        ) : (
          <div className={rowClass} style={{ borderLeft: `4px solid ${r.color}` }}>
            {body}
          </div>
        )}
      </div>
    );
  };

  return (
    <HomeCard icon={Calendar} title={t("title")} href="/calendar" openLabel={t("viewAllAria")} editing={editing} testId="home-widget-upcomingEvents">
      {eventsError ? (
        <p className="py-[0.25em] home-body text-muted-foreground">{t("errorMessage")}</p>
      ) : eventsLoading ? (
        <p className="py-[0.25em] home-body text-muted-foreground" aria-busy="true">{t("loadingAria")}</p>
      ) : (
        // When not even one row fits, the "+n" is hidden too (it would be
        // cut): the title still links to the calendar.
        <div className="size-full [&_[data-list-shown='0']_[data-testid=list-more]]:hidden">
          <ListBox
            items={rows}
            keyOf={(r) => r.id}
            renderItem={renderRow}
            empty={<p className="py-[0.25em] home-body text-muted-foreground">{t("emptyState")}</p>}
            moreLabel={moreLabel}
            renderMore={renderMore}
          />
        </div>
      )}
    </HomeCard>
  );
}
