"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { endOfDay, isAfter } from "date-fns";
import { useTranslations } from "next-intl";
import { AlertCircle, ChevronRight } from "lucide-react";
import { TodayStripPill } from "@/components/today-strip-pill";
import { useTimeFormat } from "@/hooks/use-time-format";
import { eventsOverlapping } from "@/lib/home-data";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { withClock, type ClockNow } from "@/components/widgets/clock";
import type { HomeWidgetProps } from "./shared";
import { pillsThatFit } from "./pills-fit";

/** A pill drawn in em of the box's text size, so S to XL apply. */
const PILL = "max-w-full gap-[0.5em] rounded-[0.6em] px-[0.8em] py-[0.45em] [&>span]:text-[0.8em]";
/** The "+n" link: a 48px target at least, whatever the text size. */
const MORE = "inline-flex min-h-[48px] shrink-0 items-center gap-[0.2em] rounded-[0.6em] px-[0.6em] text-[0.8em] font-medium text-primary/80 transition-colors hover:bg-accent/50 hover:text-primary";

function HomeTodayStripFace({ editing, now }: HomeWidgetProps & { now: ClockNow }) {
  const t = useTranslations("todayStrip");
  const tEvents = useTranslations("upcomingEvents");
  const { formatTime } = useTimeFormat();
  const { events, eventsLoading, eventsError, people, today } = useHomeDataContext();

  // Today's timed events that have not ended, as the built-in strip lists
  // them, cut from Home's shared window. "Not ended" follows the shared
  // clock's minute: no timer of its own.
  const minute = Math.floor(now.date.getTime() / 60_000) * 60_000;
  const pills = useMemo(() => {
    const start = new Date(today);
    return eventsOverlapping(events, start, endOfDay(start))
      .filter((e) => !e.calendar?.is_waste_collection)
      .filter((e) => isAfter(new Date(e.end_at ?? e.start_at), minute))
      .filter((e) => !e.all_day)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
      .map((e) => {
        const personId = e.person_id || e.calendar?.person_id;
        const person = personId ? people?.find((p) => p.id === personId) : undefined;
        return {
          id: e.id,
          time: formatTime(new Date(e.start_at)),
          title: e.title,
          color: person?.color || e.calendar?.color || "hsl(var(--primary))",
        };
      });
  }, [events, people, today, formatTime, minute]);

  const root = useRef<HTMLDivElement>(null);
  const measuring = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    const m = measuring.current;
    if (!el || !m || pills.length === 0) return;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      const gap = parseFloat(getComputedStyle(m).columnGap) || 0;
      const nodes = Array.from(m.children) as HTMLElement[];
      const widths = nodes.map((n) => n.offsetWidth);
      const moreW = moreRef.current?.offsetWidth ?? 0;
      const rowH = Math.max(moreRef.current?.offsetHeight ?? 0, ...nodes.map((n) => n.offsetHeight));
      const rows = Math.floor((height + gap) / (rowH + gap));
      // A box too flat for a row of pills shows only "+n" (48px, always room for it at the minimum).
      const n = rows > 0 ? pillsThatFit(widths, moreW, width, rows, gap) : 0;
      setShown((prev) => (prev === n ? prev : n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(m);
    return () => ro.disconnect();
  }, [pills]);

  const n = Math.min(shown ?? 0, pills.length);
  const more = pills.length - n;
  const moreLabel = (count: number) => tEvents("moreCount", { count });

  return (
    <div
      ref={root}
      data-testid="home-widget-todayStrip"
      data-list-shown={pills.length === 0 ? 0 : n}
      data-list-more={pills.length === 0 ? 0 : more}
      inert={editing || undefined}
      // Not role="status", as on the built-in strip: standing content.
      aria-label={t("ariaLabel")}
      className="relative flex size-full flex-wrap content-center items-center [justify-content:safe_center] gap-[0.6em] overflow-hidden text-foreground"
      style={shown === null && pills.length > 0 ? { visibility: "hidden" } : undefined}
    >
      {eventsError ? (
        <span className="flex items-center gap-[0.4em] text-[0.8em] font-medium text-destructive">
          <AlertCircle className="size-[1em] shrink-0" aria-hidden="true" />
          {t("loadFailed")}
        </span>
      ) : eventsLoading ? (
        <span className="text-[0.8em] italic text-muted-foreground/70">{t("loading")}</span>
      ) : pills.length === 0 ? (
        <span className="text-[0.8em] italic text-muted-foreground/70">{t("emptyState")}</span>
      ) : (
        <>
          {pills.slice(0, n).map((p) => (
            <TodayStripPill key={p.id} time={p.time} title={p.title} color={p.color} className={PILL} />
          ))}
          {more > 0 && (
            <Link href="/calendar" data-testid="list-more" data-home-list-more className={MORE}>
              <span>{moreLabel(more)}</span>
              <ChevronRight className="size-[1em]" aria-hidden="true" />
            </Link>
          )}
          {/* Hidden pass: every pill at its natural width, and the widest "+n". */}
          <div
            ref={measuring}
            aria-hidden
            className="pointer-events-none invisible absolute inset-x-0 top-0 flex gap-[0.6em]"
          >
            {pills.map((p) => (
              <TodayStripPill key={p.id} time={p.time} title={p.title} color={p.color} className={PILL} />
            ))}
          </div>
          <span ref={moreRef} aria-hidden className={`${MORE} pointer-events-none invisible absolute left-0 top-0`}>
            <span>{moreLabel(pills.length)}</span>
            <ChevronRight className="size-[1em]" aria-hidden="true" />
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Today's strip in a box (RFC-022 §3.2): today's timed events as pills, as
 * many whole ones as fit the box's rows, then "+n" linking to the calendar.
 * Reads Home's shared events window; no request or timer of its own.
 */
export const HomeTodayStripWidget = withClock<HomeWidgetProps>(HomeTodayStripFace);
