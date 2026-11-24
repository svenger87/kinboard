"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useClock } from "@/hooks/use-clock";
import { motion } from "framer-motion";
import { format, getWeek, getDayOfYear, differenceInDays, startOfYear, endOfYear } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useTimeFormat } from "@/hooks/use-time-format";

/**
 * The time of day as Home's clock widgets read it: one tick shared by the
 * clock, the date and the greeting, so a screen that shows all three runs one
 * timer and the three can never disagree across a minute boundary.
 */
export interface ClockNow {
  hours: string;
  minutes: string;
  seconds: string;
  date: Date;
  use24Hour: boolean;
}

const ClockContext = createContext<ClockNow | null>(null);

interface ClockProviderProps {
  /** Tick every second instead of every minute. */
  showSeconds?: boolean;
  children: ReactNode;
}

/**
 * One clock for everything below it. Home's clock block wraps its widgets in
 * this; a widget placed on its own without one starts its own (see
 * `withClock`), so each still renders given nothing but its props.
 */
export function ClockProvider({ showSeconds = false, children }: ClockProviderProps) {
  const { use24Hour } = useTimeFormat();
  // Only update every second if showing seconds, otherwise every minute
  const { hours, minutes, seconds, date } = useClock(showSeconds ? 1000 : 60000, use24Hour);
  const now = useMemo(
    () => ({ hours, minutes, seconds, date, use24Hour }),
    [hours, minutes, seconds, date, use24Hour],
  );
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

/**
 * Render `Face` with the shared clock, or, outside a `ClockProvider`, with a
 * clock of its own. `seconds` decides only the own clock's tick; under a
 * provider the provider's tick applies.
 */
export function withClock<P extends object>(
  Face: (props: P & { now: ClockNow }) => ReactNode,
  seconds: (props: P) => boolean = () => false,
) {
  function WithClock(props: P) {
    const shared = useContext(ClockContext);
    if (shared) return <Face {...props} now={shared} />;
    return (
      <ClockProvider showSeconds={seconds(props)}>
        <WithClock {...props} />
      </ClockProvider>
    );
  }
  return WithClock;
}

/**
 * The built-in Home's fixed sizes, or "box": the digits at 1em, for a widget
 * that sets the font size itself to fit its box (RFC-022 step 4).
 */
export type ClockSize = "sm" | "md" | "lg" | "xl" | "box";

export interface ClockTimeProps {
  /** Show the seconds after the minutes (the family's clock setting). */
  showSeconds?: boolean;
  size?: ClockSize;
}

const sizeClasses = {
  sm: "text-4xl",
  md: "text-6xl",
  lg: "text-8xl",
  xl: "text-kiosk-hero",
  box: "text-[1em] leading-none",
};

const secondsSizeClasses = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
  xl: "text-5xl",
  box: "text-[0.45em]",
};

function ClockTimeFace({ showSeconds = false, size = "xl", now }: ClockTimeProps & { now: ClockNow }) {
  const t = useTranslations("clock");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const { hours, minutes, seconds, date, use24Hour } = now;
  // Locale-aware: a French install shouldn't be handed an English "PM".
  const meridiem = use24Hour ? null : format(date, "a", { locale: dateLocale });

  const weekNumber = getWeek(date, { locale: dateLocale });
  const dayOfYear = getDayOfYear(date);
  const daysInYear = differenceInDays(endOfYear(date), startOfYear(date)) + 1;
  const daysRemaining = daysInYear - dayOfYear;
  const yearProgress = Math.round((dayOfYear / daysInYear) * 100);

  return (
    /* Time Display — wrapped in a Popover so the date/week/year-
       progress detail is reachable on touch devices via tap. The
       previous Tooltip implementation only opened on hover, which
       kiosks and phones can't trigger. Popover preserves the same
       content and adds a click-outside-to-dismiss flow that's
       familiar on every platform. */
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-transparent border-0 p-0 m-0 cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50 focus-visible:ring-offset-4 focus-visible:ring-offset-background rounded-lg"
          aria-label={t("tooltipDateAria", {
            date: format(date, "PPPP", { locale: dateLocale }),
          })}
        >
          <time
            dateTime={date.toISOString()}
            className="flex items-baseline clock-glow"
          >
            <span
              className={`${size === "xl" ? "" : "font-display font-extralight"} ${sizeClasses[size]} clock-display tabular-nums tracking-tight`}
            >
              {hours}
            </span>
            <span
              className={`${size === "xl" ? "" : "font-display font-extralight"} ${sizeClasses[size]} text-muted-foreground/40 mx-1 clock-colon`}
            >
              :
            </span>
            <span
              className={`${size === "xl" ? "" : "font-display font-extralight"} ${sizeClasses[size]} clock-display tabular-nums tracking-tight`}
            >
              {minutes}
            </span>
            {showSeconds && (
              <>
                <span className={`font-display font-extralight text-muted-foreground/40 mx-1 clock-colon${size === "box" ? ` ${secondsSizeClasses.box}` : ""}`}>
                  :
                </span>
                <span
                  className={`font-display font-light ${secondsSizeClasses[size]} clock-display text-muted-foreground/60`}
                >
                  {seconds}
                </span>
              </>
            )}
            {meridiem && (
              // Sized down and set alongside rather than inline with
              // the digits: on the xl wall-display clock a full-height
              // "PM" would compete with the time itself.
              <span
                className={`font-display font-light ${secondsSizeClasses[size]} clock-display text-muted-foreground/60 ml-2 self-center uppercase`}
              >
                {meridiem}
              </span>
            )}
          </time>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={12}
        className="w-72 p-3"
      >
        <div className="flex flex-col gap-2">
          <p className="font-medium">{format(date, "PPPP", { locale: dateLocale })}</p>
          <Separator />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">{t("tooltipWeekLabel")}</span>
            <span className="font-medium">{t("tooltipWeekValue", { number: weekNumber })}</span>
            <span className="text-muted-foreground">{t("tooltipDayOfYear")}</span>
            <span className="font-medium">{dayOfYear} / {daysInYear}</span>
            <span className="text-muted-foreground">{t("tooltipRemaining")}</span>
            <span className="font-medium">{t("tooltipDaysSuffix", { count: daysRemaining })}</span>
          </div>
          <div className="pt-2">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{t("tooltipYearLabel", { year: date.getFullYear() })}</span>
              <span>{yearProgress}%</span>
            </div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-month-primary rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${yearProgress}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Home's clock widget: the time, with seconds when the family has them on.
 * Tapping it opens the date, week and year-progress detail.
 */
export const ClockTime = withClock<ClockTimeProps>(ClockTimeFace, (p) => !!p.showSeconds);
