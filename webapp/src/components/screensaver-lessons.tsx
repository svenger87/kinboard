"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { Backpack, GraduationCap } from "lucide-react";
import { usePeople, useSchedules, useSetting } from "@/hooks";
import { useSchoolBreaks } from "@/hooks/use-school-days";
import { addDays, toLocalDateKey } from "@/lib/local-date";
import { keyToDate } from "@/lib/holiday-entries";
import { NEXT_SCHOOL_DAY_HORIZON } from "@/lib/school-day-rule";
import { DEFAULT_PACK_ITEMS, type PackItemConfig } from "@/lib/schedule-pack-items";
import { lessonsForScreensaver } from "@/lib/screensaver-lessons";
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
 * The children's lessons on the screensaver (#282): for each child with
 * lessons, the day's subjects and what to bring, so a family sees from across
 * the kitchen that the sports kit goes in the bag today. Settings ->
 * Screensaver -> Children's lessons. Which day: lib/screensaver-lessons.ts.
 *
 * Mounted only while the option is on, so a family without it fetches no
 * timetables or holidays for the screensaver.
 */
export function ScreensaverLessons({ large }: { large: boolean }) {
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
    tomorrowFrom: widget?.tomorrowFrom ?? DEFAULT_SCHEDULE_WIDGET_SETTINGS.tomorrowFrom ?? "off",
  });
  if (!lessons) return null;

  const label =
    lessons.when === "today"
      ? t("lessonsToday")
      : lessons.when === "tomorrow"
        ? t("lessonsTomorrow")
        : t("lessonsOn", { day: format(keyToDate(lessons.day), "EEEE", { locale: getDateFnsLocale(locale) }) });

  return (
    <div className="flex flex-col gap-2 landscape:lg:gap-3" data-testid="screensaver-lessons" data-day={lessons.day}>
      <div className="flex items-center gap-2 text-white/60">
        <GraduationCap className="size-4" />
        <span className={`${large ? "text-lg" : "text-xs landscape:lg:text-sm"} font-medium uppercase tracking-wider`}>{label}</span>
      </div>
      <div className="flex flex-col gap-1.5 landscape:lg:gap-2">
        {lessons.rows.map((row) => (
          <div
            key={row.personId}
            className="flex items-start gap-2 landscape:lg:gap-3 bg-black/40 rounded-lg px-3 py-1.5 landscape:lg:px-4 landscape:lg:py-2 gpu-blur"
            data-person={row.personId}
          >
            <span
              className="mt-1.5 size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color ?? "rgba(255,255,255,0.5)" }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className={`text-white ${large ? "text-xl" : "text-sm"}`}>
                <span className="font-medium">{row.name}</span>
                <span className="text-white/50"> · </span>
                <span className="text-white/80">{row.subjects.join(" · ")}</span>
              </p>
              {row.bring.length > 0 && (
                <p className={`mt-0.5 flex items-start gap-1.5 text-amber-200 ${large ? "text-base" : "text-xs"}`} data-testid="screensaver-lessons-bring">
                  <Backpack className={`${large ? "size-4" : "size-3.5"} mt-px shrink-0`} aria-hidden="true" />
                  <span>{t("lessonsBring", { items: row.bring.join(", ") })}</span>
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
