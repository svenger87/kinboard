"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { Backpack, GraduationCap } from "lucide-react";
import { usePeople, useSchedules, useSetting } from "@/hooks";
import { useSchoolBreaks } from "@/hooks/use-school-days";
import { addDays, toLocalDateKey } from "@/lib/local-date";
import { keyToDate } from "@/lib/holiday-entries";
import { NEXT_SCHOOL_DAY_HORIZON } from "@/lib/school-day-rule";
import { DEFAULT_PACK_ITEMS, type PackItemConfig } from "@/lib/schedule-pack-items";
import { lessonsForScreensaver, type LessonRow as LessonRowData, type ScreensaverLessons as ScreensaverLessonsData } from "@/lib/screensaver-lessons";
import { pick, rowCard, SectionLabel, type RowScale } from "@/components/screensaver-rows";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { DEFAULT_SCHEDULE_WIDGET_SETTINGS, type ScheduleWidgetSettings } from "@/types/widgets";

/** The wall clock, to the minute: which day shows can change at the evening time. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Which lessons the screensaver shows, and the heading over them ("At school
 * today"): null while the timetables and holidays load, and when no child has
 * lessons that day. Fetches the people, timetables and school breaks itself,
 * so only a screen that shows the lessons asks for them.
 */
export function useScreensaverLessons(): (ScreensaverLessonsData & { label: string }) | null {
  const t = useTranslations("components.screensaver");
  const locale = useLocale();
  const now = useMinute();
  const todayKey = toLocalDateKey(now);
  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const { data: people } = usePeople();
  const { data: schedules } = useSchedules();
  const { breaks, isLoading: loadingBreaks } = useSchoolBreaks(todayKey, addDays(todayKey, NEXT_SCHOOL_DAY_HORIZON));
  const { data: widget } = useSetting<ScheduleWidgetSettings>(SETTINGS_KEYS.scheduleWidget, DEFAULT_SCHEDULE_WIDGET_SETTINGS);
  const { data: packItems } = useSetting<PackItemConfig[]>(SETTINGS_KEYS.schedulePackItems, DEFAULT_PACK_ITEMS);

  const tomorrowFrom = widget?.tomorrowFrom ?? DEFAULT_SCHEDULE_WIDGET_SETTINGS.tomorrowFrom ?? "off";
  // Memoised: a widget lists the rows through ListBox, which measures again
  // whenever the list's identity changes, and this re-renders every minute.
  return useMemo(() => {
    // Waiting for the holidays: a timetable first and a day off a moment later
    // would flash lessons nobody has today.
    if (!people || !schedules || loadingBreaks) return null;
    const lessons = lessonsForScreensaver({
      people,
      schedules,
      breaks,
      packItems: packItems ?? DEFAULT_PACK_ITEMS,
      todayKey,
      nowTime,
      tomorrowFrom,
    });
    if (!lessons) return null;
    const label =
      lessons.when === "today"
        ? t("lessonsToday")
        : lessons.when === "tomorrow"
          ? t("lessonsTomorrow")
          : t("lessonsOn", { day: format(keyToDate(lessons.day), "EEEE", { locale: getDateFnsLocale(locale) }) });
    return { ...lessons, label };
  }, [people, schedules, loadingBreaks, breaks, packItems, todayKey, nowTime, tomorrowFrom, t, locale]);
}

/** One child's lessons and, under them, what to bring. Pure: a ListBox draws it twice. */
export function LessonRow({ row, scale }: { row: LessonRowData; scale: RowScale }) {
  const t = useTranslations("components.screensaver");
  const box = scale === "box";
  return (
    <div className={rowCard(scale, "start")} data-person={row.personId}>
      <span
        className={`${box ? "mt-[0.45em] size-[0.5em]" : "mt-1.5 size-2.5"} shrink-0 rounded-full`}
        style={{ backgroundColor: row.color ?? "rgb(var(--screensaver-panel-fg-rgb, 255 255 255) / 0.5)" }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className={`panel-fg ${pick(scale, "text-sm", "text-xl", "text-[1em] leading-[1.4]")}`}>
          <span className="font-medium">{row.name}</span>
          <span className="panel-fg-50"> · </span>
          <span className="panel-fg-80">{row.subjects.join(" · ")}</span>
        </p>
        {row.bring.length > 0 && (
          <p
            className={`${box ? "mt-[0.1em] gap-[0.3em]" : "mt-0.5 gap-1.5"} flex items-start panel-amber ${pick(scale, "text-xs", "text-base", "text-[0.8em] leading-[1.5]")}`}
            data-testid="screensaver-lessons-bring"
          >
            <Backpack className={`${pick(scale, "size-3.5", "size-4", "size-[1.1em]")} ${box ? "mt-[0.15em]" : "mt-px"} shrink-0`} aria-hidden="true" />
            <span>{t("lessonsBring", { items: row.bring.join(", ") })}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The children's lessons on the screensaver (#282): for each child with
 * lessons, the day's subjects and what to bring, so a family sees from across
 * the kitchen that the sports kit goes in the bag today. Settings ->
 * Screensaver -> Children's lessons. Which day: lib/screensaver-lessons.ts.
 *
 * Mounted only while the option is on, so a family without it fetches no
 * timetables or holidays for the screensaver.
 */
export function ScreensaverLessons({ large }: { large: boolean }) {
  const lessons = useScreensaverLessons();
  if (!lessons) return null;
  const scale: RowScale = large ? "large" : "normal";

  return (
    <div className="flex flex-col gap-2 landscape:lg:gap-3" data-testid="screensaver-lessons" data-day={lessons.day}>
      <SectionLabel icon={GraduationCap} label={lessons.label} scale={scale} />
      <div className="flex flex-col gap-1.5 landscape:lg:gap-2">
        {lessons.rows.map((row) => (
          <LessonRow key={row.personId} row={row} scale={scale} />
        ))}
      </div>
    </div>
  );
}
