"use client";

import { motion } from "framer-motion";
import { getWeek } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { getIntlLocale } from "@/i18n/intl-locale";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { withClock, type ClockNow } from "@/components/widgets/clock";

export interface DateAndWeekProps {
  /** Placement only (margins, alignment); the widget sets no outer spacing. */
  className?: string;
  /**
   * Drawn at the font size it is given (1em, the week badge to match)
   * instead of Home's fixed size: for a widget fitting it to its box.
   */
  scaled?: boolean;
}

function DateAndWeekFace({ className = "", scaled = false, now }: DateAndWeekProps & { now: ClockNow }) {
  const t = useTranslations("clock");
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const intlLocale = getIntlLocale(locale);
  const { date } = now;

  const formattedDate = date.toLocaleDateString(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const weekNumber = getWeek(date, { locale: dateLocale });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.22 }}
      className={`flex items-center ${scaled ? "gap-[0.6em]" : "gap-3"} ${className}`}
    >
      <p className={`text-kiosk-label ${scaled ? "text-[1em] whitespace-nowrap" : "text-base"} text-primary tabular-nums`}>
        {formattedDate}
      </p>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`bg-transparent border-0 p-0 m-0 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md${scaled ? " inline-flex min-h-[48px] min-w-[48px] items-center justify-center" : ""}`}
            aria-label={t("tooltipWeekFull", { number: weekNumber })}
          >
            <Badge
              variant="outline"
              className={`${scaled ? "text-[0.6em] whitespace-nowrap" : "text-xs"} cursor-pointer hover:bg-white/5`}
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
  );
}

/** Home's date widget: weekday, day and month, and the week number beside it. */
export const DateAndWeek = withClock<DateAndWeekProps>(DateAndWeekFace);
