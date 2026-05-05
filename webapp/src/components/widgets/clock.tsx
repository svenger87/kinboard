"use client";

import { useClock } from "@/hooks/use-clock";
import { motion } from "framer-motion";
import { format, getWeek, getDayOfYear, differenceInDays, startOfYear, endOfYear } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useTranslations, useLocale } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const dateLocale = locale === "de" ? de : enUS;
  const intlLocale = locale === "de" ? "de-DE" : "en-US";

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
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        role="timer"
        aria-live="polite"
        aria-atomic="true"
        className={`flex flex-col items-center justify-center ${className}`}
      >
        {/* Time Display */}
        <Tooltip>
          <TooltipTrigger asChild>
            <time
              dateTime={date.toISOString()}
              className="flex items-baseline cursor-help clock-glow"
              aria-label={`${hours}:${minutes}${showSeconds ? `:${seconds}` : ""}`}
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
          </TooltipTrigger>
          <TooltipContent side="bottom" className="p-0">
            <div className="p-3 flex flex-col gap-2">
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
          </TooltipContent>
        </Tooltip>

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
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="text-xs cursor-help hover:bg-white/5"
                >
                  {t("weekShort", { number: weekNumber })}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("tooltipWeekFull", { number: weekNumber })}</p>
              </TooltipContent>
            </Tooltip>
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
    </TooltipProvider>
  );
}
