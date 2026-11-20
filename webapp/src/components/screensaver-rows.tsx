"use client";

import { useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { Battery, Cake, Calendar, Car, GraduationCap, MapPin, Sun, Zap, type LucideIcon } from "lucide-react";
import type { NewsItem } from "@/hooks";
import type { ScreensaverData } from "@/components/layouts/screensaver-data-context";
import { calculateUpcomingAge, formatEventTime } from "@/hooks/use-screensaver-data";
import { PersonAvatar } from "@/components/person-avatar";
import { hasBirthYear } from "@/lib/birthday";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTimeFormat } from "@/hooks/use-time-format";

/**
 * The rows the screensaver lists, drawn by the built-in screensaver and by the
 * layout widgets alike, so the two cannot drift apart.
 *
 * `scale` picks the sizes: "normal" and "large" are the built-in's (Settings
 * -> Screensaver -> Large details), "box" is a layout widget's, where every
 * size is in em of the box's font size so the text sizes S to XL apply. In a
 * box, 1em reads as the built-in's large details (20px at a 1080px screen).
 *
 * Rows are rendered twice inside a ListBox (once hidden, to measure), so they
 * stay pure: no data fetching, no effects.
 */
export type RowScale = "normal" | "large" | "box";

export type ScreensaverEvent = ScreensaverData["upcomingEvents"][number];
export type ScreensaverBirthday = ScreensaverData["upcomingBirthdays"][number];

export const pick = (scale: RowScale, normal: string, large: string, box: string) =>
  scale === "box" ? box : scale === "large" ? large : normal;

/** The card a row sits on: the screensaver's shared panel fill (.screensaver-panel). */
export const rowCard = (scale: RowScale, align: "center" | "start" = "center") =>
  `flex ${align === "start" ? "items-start" : "items-center"} ${
    scale === "box"
      ? "gap-[0.5em] screensaver-panel rounded-[0.5em] px-[0.75em] py-[0.4em] gpu-blur"
      : "gap-2 landscape:lg:gap-3 screensaver-panel rounded-lg px-3 py-1.5 landscape:lg:px-4 landscape:lg:py-2 gpu-blur"
  }`;

/** "Today, 14:00", "Tomorrow", "Fri, 9:30": when an event in the list starts. */
export function useEventWhen() {
  const t = useTranslations("components.screensaver");
  const locale = useLocale();
  const { formatTime } = useTimeFormat();
  return useCallback(
    (event: Pick<ScreensaverEvent, "start" | "allDay">) =>
      formatEventTime(
        event.start,
        event.allDay,
        { today: t("eventToday"), tomorrow: t("eventTomorrow") },
        getDateFnsLocale(locale),
        formatTime,
      ),
    [t, locale, formatTime],
  );
}

/** "Just now", "5 min ago", "3 hr ago" or the date: how old a news item is. */
export function useNewsTime() {
  const t = useTranslations("components.screensaver");
  const locale = useLocale();
  return useCallback(
    (pubDate: string) => {
      try {
        const date = new Date(pubDate);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);

        if (diffMins < 1) return t("newsJustNow");
        if (diffMins < 60) return t("newsMinutes", { minutes: diffMins });
        if (diffHours < 24) return t("newsHours", { hours: diffHours });
        // `P` is date-fns' localised short date, so French reads as French
        // instead of falling into the English branch of a de/else ternary.
        return format(date, "P", { locale: getDateFnsLocale(locale) });
      } catch {
        return "";
      }
    },
    [t, locale],
  );
}

/** A list's heading: an icon and an upper-case label. */
export function SectionLabel({
  icon: Icon,
  label,
  scale,
  className,
}: {
  icon: LucideIcon;
  label: string;
  scale: RowScale;
  className?: string;
}) {
  return (
    <div className={`flex items-center ${scale === "box" ? "gap-[0.4em]" : "gap-2"} text-white/60${className ? ` ${className}` : ""}`}>
      <Icon className={scale === "box" ? "size-[0.9em] shrink-0" : "size-4"} />
      <span className={`${pick(scale, "text-xs landscape:lg:text-sm", "text-lg", "text-[0.9em] truncate")} font-medium uppercase tracking-wider`}>
        {label}
      </span>
    </div>
  );
}

/** One upcoming event or holiday. `when` comes from useEventWhen. */
export function EventRow({ event, when, scale }: { event: ScreensaverEvent; when: string; scale: RowScale }) {
  const t = useTranslations("components.screensaver");
  const box = scale === "box";
  return (
    <div data-holiday={event.holiday ?? undefined} className={rowCard(scale)}>
      {event.holiday ? (
        // The calendar's holiday amber, with the holiday's emoji
        // or, for a school break, a cap.
        <div
          className={`${box ? "size-[1.6em]" : "size-8"} rounded-full flex items-center justify-center shrink-0 bg-amber-400/25`}
          aria-hidden="true"
        >
          {event.holiday === "school" ? (
            <GraduationCap className={`${box ? "size-[0.8em]" : "size-4"} text-amber-300`} />
          ) : (
            <Calendar className={`${box ? "size-[0.8em]" : "size-4"} text-amber-300`} />
          )}
        </div>
      ) : event.personName ? (
        <PersonAvatar
          name={event.personName}
          color={event.personColor ?? event.color}
          avatarUrl={event.personAvatar}
          size={box ? "1.6em" : 32}
          className="shrink-0"
        />
      ) : (
        <div
          className={`${box ? "w-[0.2em] h-[1.6em]" : "w-1 h-8"} rounded-full shrink-0`}
          style={{ backgroundColor: event.color }}
        />
      )}
      <div className="flex-1 min-w-0">
        {/* A holiday's name wraps, two lines at most, rather
            than being cut: it is the whole of the row. */}
        <p
          className={`text-white font-medium ${event.holiday ? "line-clamp-2 break-words" : "truncate"} ${pick(scale, "text-sm", "text-xl", "text-[1em] leading-[1.4]")}`}
        >
          {event.title}
        </p>
        <div className={`flex items-center ${box ? "gap-[0.4em]" : "gap-2"} text-white/50 ${pick(scale, "text-xs", "text-base", "text-[0.8em] leading-[1.5]")}`}>
          <span>
            {when}
            {event.until && ` · ${t("holidayUntil", { date: event.until })}`}
          </span>
          {event.location && (
            <span className={`flex items-center ${box ? "gap-[0.25em]" : "gap-1"} truncate`}>
              <MapPin className={`${box ? "size-[1em]" : "size-3"} shrink-0`} />
              <span className="truncate">{event.location}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** One upcoming birthday, with the days to go. */
export function BirthdayRow({ birthday, scale }: { birthday: ScreensaverBirthday; scale: RowScale }) {
  const t = useTranslations("components.screensaver");
  const locale = useLocale();
  const box = scale === "box";
  return (
    <div className={rowCard(scale)}>
      <div
        className={`${box ? "size-[1.6em]" : "size-8"} rounded-full flex items-center justify-center shrink-0`}
        style={{
          backgroundColor: birthday.daysUntil === 0
            ? "#ec4899"
            : birthday.personColor
              ? `${birthday.personColor}30`
              : "rgba(255,255,255,0.1)",
        }}
      >
        <Cake
          className={box ? "size-[0.8em]" : "size-4"}
          style={{
            color: birthday.daysUntil === 0
              ? "white"
              : birthday.personColor || "rgba(255,255,255,0.7)"
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-white font-medium truncate ${pick(scale, "text-sm", "text-xl", "text-[1em] leading-[1.4]")}`}>
          {/* No birth year stored means no age to announce - see hasBirthYear. */}
          {hasBirthYear(birthday.date)
            ? t("birthdayTurns", { name: birthday.name, age: calculateUpcomingAge(birthday.date) })
            : birthday.name}
        </p>
        <p className={`text-white/50 ${pick(scale, "text-xs", "text-base", "text-[0.8em] leading-[1.5]")}`}>
          {format(birthday.date, locale === "de" ? "d. MMMM" : "MMMM d", { locale: getDateFnsLocale(locale) })}
        </p>
      </div>
      <div
        className={`${box ? "px-[0.4em] py-[0.2em] rounded-[0.2em] text-[0.7em] shrink-0" : "px-2 py-1 rounded text-xs"} font-medium ${
          birthday.daysUntil === 0
            ? "bg-pink-500 text-white"
            : birthday.daysUntil <= 7
            ? "bg-warning/20 text-warning"
            : "bg-white/10 text-white/70"
        }`}
      >
        {birthday.daysUntil === 0
          ? t("birthdayToday")
          : t("birthdayDays", { count: birthday.daysUntil })}
      </div>
    </div>
  );
}

/**
 * One news item: its picture, headline, category and age. With `onSelect` it
 * is a button that opens the item (the built-in screensaver's modal).
 */
export function NewsCard({
  item,
  time,
  scale,
  onSelect,
}: {
  item: NewsItem;
  /** From useNewsTime. */
  time: string;
  scale: Exclude<RowScale, "large">;
  onSelect?: (item: NewsItem) => void;
}) {
  const box = scale === "box";
  const content = (
    <>
      {item.image && (
        <div className={`${box ? "size-[3.2em] rounded-[0.3em]" : "size-16 rounded-md"} overflow-hidden shrink-0 bg-white/10`}>
          <img
            src={item.image}
            alt=""
            className="size-full object-cover"
            onError={(e) => {
              // Hiding just the <img> left its 64px wrapper behind as
              // a bare grey rectangle (audit KB-20). Collapse the
              // container so the headline takes the full width.
              const wrapper = (e.currentTarget as HTMLImageElement).parentElement;
              if (wrapper) wrapper.style.display = "none";
            }}
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-white ${box ? "text-[1em]" : "text-sm"} font-medium leading-snug line-clamp-2 group-hover:text-white/90`}>
          {item.title}
        </p>
        <div className={`flex items-center ${box ? "gap-[0.4em] mt-[0.2em]" : "gap-2 mt-1"}`}>
          {item.category && (
            <span className={`${box ? "text-[0.8em]" : "text-xs"} text-info/80 font-medium`}>
              {item.category}
            </span>
          )}
          <span className={`${box ? "text-[0.8em]" : "text-xs"} text-white/40`}>
            {time}
          </span>
        </div>
      </div>
    </>
  );
  const card = box
    ? "w-full flex gap-[0.6em] screensaver-panel rounded-[0.5em] p-[0.4em] text-left group gpu-blur"
    : "w-full flex gap-3 screensaver-panel rounded-lg p-2 screensaver-panel-hover transition-colors text-left group gpu-blur";
  if (!onSelect) return <div className={card}>{content}</div>;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item);
      }}
      className={card}
    >
      {content}
    </button>
  );
}

/** One figure of the energy card: an icon on its tint, a label, a value. */
function Stat({
  icon: Icon,
  tint,
  color,
  label,
  scale,
  children,
}: {
  icon: LucideIcon;
  tint: string;
  color: string;
  label: string;
  scale: Exclude<RowScale, "large">;
  children: React.ReactNode;
}) {
  const box = scale === "box";
  return (
    <div className={`flex items-center ${box ? "gap-[0.75em]" : "gap-3"}`}>
      <div className={`${box ? "p-[0.5em] rounded-[0.5em]" : "p-2 rounded-lg"} ${tint}`}>
        <Icon className={`${box ? "size-[1.25em]" : "size-5"} ${color}`} />
      </div>
      <div>
        <p className={`text-white/60 ${box ? "text-[0.75em]" : "text-xs"}`}>{label}</p>
        <p className="text-white font-medium">{children}</p>
      </div>
    </div>
  );
}

const watts = (w: number) => (w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);

/** The house's solar power, battery and grid figures (the screensaver's energy card). */
export function EnergyRows({
  solarPower,
  batterySoc,
  gridPower,
  scale,
}: Pick<ScreensaverData, "solarPower" | "batterySoc" | "gridPower"> & { scale: Exclude<RowScale, "large"> }) {
  const t = useTranslations("components.screensaver");
  return (
    <>
      {/* Solar Power */}
      {solarPower !== null && (
        <Stat icon={Sun} tint="bg-energy-solar/20" color="text-energy-solar" label={t("energySolar")} scale={scale}>
          {watts(solarPower)}
        </Stat>
      )}

      {/* Battery SOC */}
      {batterySoc !== null && (
        <Stat icon={Battery} tint="bg-energy-battery/20" color="text-energy-battery" label={t("energyBattery")} scale={scale}>
          {Math.round(batterySoc)}%
        </Stat>
      )}

      {/* Grid Power */}
      {gridPower !== null && (
        <Stat
          icon={Zap}
          tint={gridPower > 0 ? "bg-destructive/20" : "bg-success/20"}
          color={gridPower > 0 ? "text-destructive" : "text-success"}
          label={gridPower > 0 ? t("energyGridImport") : t("energyGridExport")}
          scale={scale}
        >
          {watts(Math.abs(gridPower))}
        </Stat>
      )}
    </>
  );
}

/** The car's charge, range and charging power (the screensaver's Tesla figures). */
export function TeslaRows({
  teslaBattery,
  teslaRange,
  teslaChargingRate,
  scale,
}: Pick<ScreensaverData, "teslaBattery" | "teslaRange" | "teslaChargingRate"> & { scale: Exclude<RowScale, "large"> }) {
  const t = useTranslations("components.screensaver");
  const box = scale === "box";
  return (
    <>
      {/* Tesla Battery */}
      {teslaBattery !== null && (
        <Stat icon={Car} tint="bg-blue-500/20" color="text-blue-400" label="Tesla" scale={scale}>
          {Math.round(teslaBattery)}%
          {teslaRange !== null && <span className={`text-white/50 ${box ? "text-[0.75em] ml-[0.4em]" : "text-xs ml-1.5"}`}>· {Math.round(teslaRange)} km</span>}
        </Stat>
      )}

      {/* Tesla Charging */}
      {teslaChargingRate !== null && teslaChargingRate > 0 && (
        <Stat icon={Zap} tint="bg-energy-grid/20" color="text-energy-grid" label={t("teslaCharging")} scale={scale}>
          {teslaChargingRate.toFixed(1)} kW
        </Stat>
      )}
    </>
  );
}
