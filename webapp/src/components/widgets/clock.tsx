"use client";

import { useClock } from "@/hooks/use-clock";
import { motion } from "framer-motion";
import { format, getWeek, getDayOfYear, differenceInDays, startOfYear, endOfYear } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface ClockProps {
  showDate?: boolean;
  showSeconds?: boolean;
  showGreeting?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

type GreetingKey =
  | "greetingNight"
  | "greetingMorning"
  | "greetingForenoon"
  | "greetingMidday"
  | "greetingAfternoon"
  | "greetingEvening";

function getGreetingKey(hour: number): GreetingKey {
  if (hour < 5) return "greetingNight";
  if (hour < 10) return "greetingMorning";
  if (hour < 12) return "greetingForenoon";
  if (hour < 14) return "greetingMidday";
  if (hour < 18) return "greetingAfternoon";
  if (hour < 22) return "greetingEvening";
  return "greetingNight";
}

const sizeClasses = {
  sm: "text-4xl",
  md: "text-6xl",
  lg: "text-8xl",
  xl: "text-7xl sm:text-8xl md:text-[10rem]",
};

const secondsSizeClasses = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
  xl: "text-5xl",
};

export function Clock({
  showDate = true,
  showSeconds = false,
  showGreeting = false,
  size = "xl",
  className = "",
}: ClockProps) {
  const t = useTranslations("clock");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const intlLocale = getIntlLocale(locale);

  // Only update every second if showing seconds, otherwise every minute
  const updateInterval = showSeconds ? 1000 : 60000;
  const { hours, minutes, seconds, date } = useClock(updateInterval);

  const formattedDate = date.toLocaleDateString(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const weekNumber = getWeek(date, { locale: dateLocale });
  const dayOfYear = getDayOfYear(date);
  const daysInYear = differenceInDays(endOfYear(date), startOfYear(date)) + 1;
  const daysRemaining = daysInYear - dayOfYear;
  const yearProgress = Math.round((dayOfYear / daysInYear) * 100);

  return (
    <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        role="timer"
        aria-live="polite"
        aria-atomic="true"
        className={`flex flex-col items-center justify-center ${className}`}
      >
        {/* Time Display — wrapped in a Popover so the date/week/year-
            progress detail is reachable on touch devices via tap. The
            previous Tooltip implementation only opened on hover, which
            kiosks and phones can't trigger. Popover preserves the same
            content and adds a click-outside-to-dismiss flow that's
            familiar on every platform. */}
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
                  className={`font-display font-extralight ${sizeClasses[size]} clock-display tracking-tighter`}
                >
                  {hours}
                </span>
                <span
                  className={`font-display font-extralight ${sizeClasses[size]} text-muted-foreground/40 mx-1 clock-colon`}
                >
                  :
                </span>
                <span
                  className={`font-display font-extralight ${sizeClasses[size]} clock-display tracking-tighter`}
                >
                  {minutes}
                </span>
                {showSeconds && (
                  <>
                    <span className="font-display font-extralight text-muted-foreground/40 mx-1 clock-colon">
                      :
                    </span>
                    <span
                      className={`font-display font-light ${secondsSizeClasses[size]} clock-display text-muted-foreground/60`}
                    >
                      {seconds}
                    </span>
                  </>
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

        {/* Date Display */}
        {showDate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="flex items-center gap-3 mt-4"
          >
            <p className="text-2xl font-normal text-foreground/70 tracking-wide">
              {formattedDate}
            </p>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="bg-transparent border-0 p-0 m-0 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
                  aria-label={t("tooltipWeekFull", { number: weekNumber })}
                >
                  <Badge
                    variant="outline"
                    className="text-xs cursor-pointer hover:bg-white/5"
                  >
                    {t("weekShort", { number: weekNumber })}
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="bottom"
                align="center"
                sideOffset={8}
                className="w-auto p-3 text-sm"
              >
                <p>{t("tooltipWeekFull", { number: weekNumber })}</p>
              </PopoverContent>
            </Popover>
          </motion.div>
        )}

        {/* Time-of-day greeting */}
        {showGreeting && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="text-base text-muted-foreground/70 mt-2 font-light tracking-wide"
          >
            {t(getGreetingKey(date.getHours()))}
          </motion.p>
        )}
    </motion.div>
  );
}
