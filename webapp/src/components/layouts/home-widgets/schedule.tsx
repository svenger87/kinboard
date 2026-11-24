"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { BookOpen, Clock, GraduationCap, PartyPopper, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import {
  getPeriodProgress,
  getRemainingMinutes,
  getSubjectColor,
  getSubjectIcon,
  useScheduleDay,
  type TimeSlot,
} from "@/components/widgets/schedule-widget";
import { useTimeFormat } from "@/hooks/use-time-format";
import { personText, personTint } from "@/lib/person-color";
import type { HomeWidgetProps } from "./shared";
import { HomeCard, HomeCardHeader, HomeSetUp } from "./frame";
import { MoreLink, personIdOf, TOUCH, useShrinkStep } from "./rest-shared";

type Detail = "full" | "medium" | "compact";
interface Step {
  /** The heading: with the child switcher, with the child's name, or none. */
  header: "switch" | "name" | "none";
  /** "Next school day" over the lessons, in the evening. */
  label: boolean;
  detail: Detail;
  /** Lessons listed, when the day is shown as a list. */
  rows: number;
}

/**
 * The school schedule in a box (RFC-022 §3.1, fixed). One widget per child:
 * `options.personId` pins it, as the dashboard's per-child cards do; without
 * one it is today's single card, the first child's, with a switcher between
 * the children while the box has room for it. The day itself is the card's
 * (useScheduleDay): the lesson now, the next one, the day's list, or why
 * there is no school. As the box shrinks it drops the switcher, then detail,
 * then lessons (with "+n" to the schedule page), then the heading.
 */
export function ScheduleHomeWidget({ item, box }: HomeWidgetProps) {
  const t = useTranslations("scheduleWidget");
  const { formatWallClock } = useTimeFormat();
  const home = useHomeDataContext();
  const pinned = personIdOf(item);
  const day = useScheduleDay(pinned, { people: home.people, isLoading: home.peopleLoading });
  const {
    loading,
    personId,
    children,
    setSelectedChildId,
    person,
    personName,
    personColor,
    equalSize,
    next,
    nextLabel,
    todaySchedule,
    currentSlot,
    nextPeriod,
    schoolOver,
    dayOff,
    isWeekend,
    noScheduleToday,
  } = day;

  const asList = !dayOff && !isWeekend && !noScheduleToday && (equalSize || !!next);
  const lessons = todaySchedule.length;
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    if (!pinned && children.length > 1) out.push({ header: "switch", label: true, detail: "full", rows: lessons });
    out.push({ header: "name", label: true, detail: "full", rows: lessons });
    if (asList) {
      for (let r = lessons - 1; r >= 1; r--) out.push({ header: "name", label: true, detail: "full", rows: r });
      out.push({ header: "none", label: false, detail: "compact", rows: 1 });
    } else {
      out.push({ header: "name", label: true, detail: "medium", rows: 0 });
      out.push({ header: "name", label: false, detail: "compact", rows: 0 });
      out.push({ header: "none", label: false, detail: "compact", rows: 0 });
    }
    return out;
  }, [pinned, children.length, asList, lessons]);

  const ref = useRef<HTMLDivElement>(null);
  const shape = `${personId}|${asList}|${lessons}|${currentSlot?.period}|${nextPeriod?.period}|${schoolOver}|${dayOff?.reason}|${nextLabel}`;
  const index = useShrinkStep(ref, steps.length, [box.width, box.height, shape, loading]);
  const step = steps[Math.min(index, steps.length - 1)];

  if (loading) {
    return <HomeCard ref={ref} testId="home-schedule" className="animate-pulse"><span /></HomeCard>;
  }
  if (!personId) {
    return (
      <HomeSetUp icon={GraduationCap} title={t("title")} description={t("noChildDescription")} href="/settings/people" testId="home-schedule" />
    );
  }

  const nameBadge = person ? (
    <span
      className="max-w-[8em] truncate rounded-full border px-[0.5em] py-[0.1em] home-meta font-medium"
      style={{ borderColor: personColor, color: personText(personColor) }}
    >
      {personName}
    </span>
  ) : null;
  const switcher = (
    <div className="flex gap-[0.25em]">
      {children.map((child) => {
        const color = child.color || personColor;
        return (
          <button
            key={child.id}
            type="button"
            onClick={() => setSelectedChildId(child.id)}
            className={`${TOUCH} rounded-full border px-[0.6em] home-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
              child.id === personId ? "font-medium" : "opacity-50 hover:opacity-80"
            }`}
            style={{
              borderColor: color,
              color: personText(color),
              backgroundColor: child.id === personId ? personTint(color) : "transparent",
            }}
            aria-label={t("childSelectAria", { name: child.name })}
            aria-pressed={child.id === personId}
          >
            {child.name}
          </button>
        );
      })}
    </div>
  );

  const message = (Icon: LucideIcon, text: string, sub?: string, attrs?: Record<string, string>) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-[0.2em] text-center" {...attrs}>
      {step.detail !== "compact" && <Icon className="size-[1.6em] text-primary/60" strokeWidth={1.75} aria-hidden="true" />}
      <p className="line-clamp-2 break-words font-medium">{text}</p>
      {sub && step.detail === "full" && <p className="home-meta text-muted-foreground">{sub}</p>}
    </div>
  );

  const slotRow = (slot: TimeSlot) => {
    const Icon = getSubjectIcon(slot.subject);
    return (
      <div key={slot.period} className="flex shrink-0 items-center gap-[0.5em] rounded-lg bg-muted/30 px-[0.5em] py-[0.3em]">
        <Icon className="size-[1em] shrink-0" style={{ color: getSubjectColor(slot.subject) }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{slot.subject}</span>
        <span className="shrink-0 home-meta text-muted-foreground tabular-nums">
          {formatWallClock(slot.start)}–{formatWallClock(slot.end)}
        </span>
      </div>
    );
  };

  const slotCard = (slot: TimeSlot, now: boolean) => {
    const color = getSubjectColor(slot.subject);
    const Icon = getSubjectIcon(slot.subject);
    return (
      <div
        className="shrink-0 rounded-xl px-[0.6em] py-[0.4em]"
        style={{ backgroundColor: `${color}15`, borderLeft: `0.2em solid ${color}` }}
        data-testid={now ? "schedule-now" : "schedule-next"}
      >
        {now && step.detail === "full" && (
          <div className="mb-[0.2em] flex items-center gap-[0.4em]">
            <span className="rounded-full px-[0.5em] home-meta font-semibold text-white" style={{ backgroundColor: color }}>
              {t("nowBadge")}
            </span>
            <span className="home-meta text-muted-foreground">{t("periodNumber", { period: slot.period })}</span>
          </div>
        )}
        <div className="flex min-w-0 items-center gap-[0.4em]">
          <Icon className="size-[1em] shrink-0" style={{ color }} aria-hidden="true" />
          <p className={`min-w-0 truncate font-medium ${step.detail === "compact" ? "shrink-0 max-w-full" : "flex-1 home-value"}`}>{slot.subject}</p>
          {step.detail === "compact" && (
            // The subject first: the time gives way to it in a narrow box.
            <span className="ml-auto min-w-0 truncate home-meta tabular-nums text-muted-foreground">
              {now ? t("remainingMinutes", { minutes: getRemainingMinutes(slot) }) : formatWallClock(slot.start)}
            </span>
          )}
        </div>
        {step.detail !== "compact" && (
          <div className="mt-[0.1em] flex items-center gap-[0.6em] home-meta text-muted-foreground">
            <span className="flex items-center gap-[0.25em] tabular-nums">
              <Clock className="size-[0.9em]" aria-hidden="true" />
              {now ? `${formatWallClock(slot.start)} - ${formatWallClock(slot.end)}` : formatWallClock(slot.start)}
            </span>
            {slot.room && step.detail === "full" && <span className="truncate">{t("roomLabel", { room: slot.room })}</span>}
            {now && <span className="ml-auto shrink-0 tabular-nums">{t("remainingMinutes", { minutes: getRemainingMinutes(slot) })}</span>}
          </div>
        )}
        {now && step.detail !== "compact" && (
          <div className="mt-[0.3em] h-[0.2em] overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div className="h-full rounded-full" style={{ backgroundColor: color, width: `${getPeriodProgress(slot)}%` }} />
          </div>
        )}
      </div>
    );
  };

  let body: ReactNode;
  if (dayOff?.reason === "holiday") {
    body = message(PartyPopper, dayOff.holiday || t("noSchoolToday"), dayOff.holiday ? t("noSchoolToday") : undefined, { "data-day-off": dayOff.date });
  } else if (isWeekend) {
    body = message(PartyPopper, t("weekend"));
  } else if (noScheduleToday) {
    body = message(GraduationCap, t("noScheduleToday"));
  } else if (asList) {
    const shown = todaySchedule.slice(0, step.rows || 1);
    body = (
      <div className="flex flex-col gap-[0.3em]" data-testid="schedule-list" data-shown={shown.length}>
        {shown.map(slotRow)}
        <MoreLink count={lessons - shown.length} href="/schedule" />
      </div>
    );
  } else if (schoolOver) {
    body = message(PartyPopper, t("schoolOver"));
  } else if (currentSlot) {
    body = (
      <div className="flex flex-col gap-[0.4em]" aria-live="polite" aria-atomic="true">
        {slotCard(currentSlot, true)}
        {nextPeriod && step.detail === "full" && (
          <div className="flex min-w-0 items-center gap-[0.4em] home-meta">
            <span className="shrink-0 text-muted-foreground">{t("afterCurrent")}</span>
            <span className="min-w-0 truncate font-medium">{nextPeriod.subject}</span>
            <span className="shrink-0 text-muted-foreground">{t("atTime", { time: formatWallClock(nextPeriod.start) })}</span>
          </div>
        )}
      </div>
    );
  } else if (nextPeriod) {
    const later = todaySchedule.filter((s) => s.start > nextPeriod.start).slice(0, 4);
    body = (
      <div className="flex flex-col gap-[0.4em]">
        {step.detail === "full" && <p className="home-meta text-muted-foreground">{t("nextPeriodHeading")}</p>}
        {slotCard(nextPeriod, false)}
        {step.detail === "full" && later.length > 0 && (
          <div className="flex flex-wrap gap-[0.25em]">
            {later.map((slot) => (
              <span
                key={slot.period}
                className="rounded-full border px-[0.5em] home-meta"
                style={{ borderColor: getSubjectColor(slot.subject), color: getSubjectColor(slot.subject) }}
              >
                {slot.subject}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    body = message(BookOpen, t("noLessonsToday"));
  }

  return (
    <HomeCard ref={ref} testId="home-schedule" step={index} className="gap-[0.4em]">
      {step.header !== "none" && (
        <HomeCardHeader
          icon={GraduationCap}
          title={t("title")}
          href="/schedule"
          openLabel={t("viewAllAria")}
          right={step.header === "switch" ? switcher : nameBadge}
        />
      )}
      {step.label && nextLabel && !noScheduleToday && (
        <p className="shrink-0 home-meta font-medium text-primary" data-next-school-day={next?.date}>
          {nextLabel}
        </p>
      )}
      {body}
    </HomeCard>
  );
}
