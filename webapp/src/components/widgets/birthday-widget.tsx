"use client";

import { motion } from "framer-motion";
import { Cake, Gift, PartyPopper, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import { format, differenceInDays, setYear, isPast, addYears, parseISO, startOfDay } from "date-fns";
import { de, enUS } from "date-fns/locale";
import { useTranslations, useLocale } from "next-intl";
import { useMemo } from "react";
import { useBirthdays, usePeople } from "@/hooks";

// Parse date string safely without timezone issues
// "1990-01-28" should be January 28th, not January 27th due to UTC conversion
function parseBirthdayDate(dateStr: string): Date {
  const date = parseISO(dateStr + "T12:00:00");
  return date;
}

interface BirthdayWidgetProps {
  maxItems?: number;
  className?: string;
}

function getNextBirthday(date: Date): Date {
  const today = startOfDay(new Date());
  const thisYearBirthday = startOfDay(setYear(date, today.getFullYear()));

  // If birthday already passed this year (not today), advance to next year
  if (differenceInDays(today, thisYearBirthday) > 0) {
    return addYears(thisYearBirthday, 1);
  }
  return thisYearBirthday;
}

function getDaysUntilBirthday(date: Date): number {
  const nextBirthday = getNextBirthday(date);
  // Use startOfDay to compare dates without time component
  return differenceInDays(startOfDay(nextBirthday), startOfDay(new Date()));
}

function calculateUpcomingAge(birthDate: Date): number {
  const nextBirthday = getNextBirthday(birthDate);
  return nextBirthday.getFullYear() - birthDate.getFullYear();
}

function BirthdayWidgetSkeleton() {
  const t = useTranslations("birthdayWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-24" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 flex flex-col gap-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-6 w-12" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex-1 flex flex-col gap-1">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </div>
          <Skeleton className="h-6 w-12" />
        </div>
      </CardContent>
    </Card>
  );
}

export function BirthdayWidget({
  maxItems = 3,
  className = "",
}: BirthdayWidgetProps) {
  const t = useTranslations("birthdayWidget");
  const locale = useLocale();
  const dateLocale = locale === "de" ? de : enUS;
  const { data: birthdays, isLoading: loadingBirthdays, isError } = useBirthdays();
  const { data: people } = usePeople();

  // Transform birthdays to display format with cached daysUntil
  const displayBirthdays = useMemo(() => (birthdays || []).map((birthday) => {
    const person = people?.find((p) => p.id === birthday.person_id);
    const date = parseBirthdayDate(birthday.date);
    return {
      id: birthday.id,
      name: birthday.name,
      date,
      daysUntil: getDaysUntilBirthday(date),
      personColor: person?.color,
    };
  }), [birthdays, people]);

  // Sort by days until birthday and take top items
  const upcomingBirthdays = useMemo(() =>
    [...displayBirthdays]
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, maxItems),
    [displayBirthdays, maxItems]);

  if (loadingBirthdays) {
    return <BirthdayWidgetSkeleton />;
  }

  if (isError) {
    return (
      <Card className={`accent-border-top h-full ${className}`}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-xl font-medium">
            <span className="p-1.5 rounded-lg bg-month-primary/10">
              <Cake className="size-5 text-month-primary" strokeWidth={1.5} />
            </span>
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <Cake className="size-8 mb-2 text-destructive/40" />
            <p className="text-sm">{t("errorMessage")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const item = {
    hidden: { opacity: 0, x: -10 },
    show: { opacity: 1, x: 0 },
  };

  return (
    <TooltipProvider>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Card className={`accent-border-top h-full ${className}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-xl font-medium">
                <span className="p-1.5 rounded-lg bg-month-primary/10">
                  <Cake className="size-5 text-month-primary" strokeWidth={1.5} />
                </span>
                {t("title")}
              </CardTitle>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/birthdays"
                    className="p-1 rounded-lg hover:bg-accent/50 transition-colors"
                    aria-label={t("viewAllAria")}
                  >
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("viewAllTooltip")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent>
            <motion.div
              variants={container}
              initial="hidden"
              animate="show"
              className="flex flex-col gap-3"
            >
              {upcomingBirthdays.map((birthday) => {
                const daysUntil = birthday.daysUntil;
                const isToday = daysUntil === 0;
                const isSoon = daysUntil <= 7 && daysUntil > 0;

                return (
                  <motion.div
                    key={birthday.id}
                    variants={item}
                    className={`flex items-center gap-3 rounded-xl px-2 py-1.5 -mx-2 transition-colors ${
                      isToday
                        ? "bg-month-primary/[0.08] birthday-shimmer"
                        : ""
                    }`}
                  >
                    {/* Icon */}
                    <div
                      className={`p-2 rounded-lg ${
                        isToday
                          ? "bg-month-primary text-white"
                          : isSoon
                          ? "bg-warning/10 text-warning"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isToday ? (
                        <PartyPopper className="size-4" />
                      ) : isSoon ? (
                        <Gift className="size-4" />
                      ) : (
                        <Cake className="size-4" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {t("turnsAge", { name: birthday.name, age: calculateUpcomingAge(birthday.date) })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(birthday.date, "d. MMM", { locale: dateLocale })}
                      </p>
                    </div>

                    {/* Countdown */}
                    {isToday ? (
                      <Badge className="bg-month-primary text-xs animate-pulse motion-reduce:animate-none shadow-[0_0_12px_hsl(var(--month-primary)/0.4)]">
                        {t("todayBadge")}
                      </Badge>
                    ) : (
                      <Badge
                        variant={isSoon ? "default" : "outline"}
                        className={`text-xs ${isSoon ? "bg-warning/20 text-warning border-warning/30 hover:bg-warning/20" : ""}`}
                        style={!isSoon && birthday.personColor ? { borderColor: birthday.personColor, color: birthday.personColor } : {}}
                      >
                        {t("daysSuffix", { count: daysUntil })}
                      </Badge>
                    )}
                  </motion.div>
                );
              })}

              {displayBirthdays.length === 0 && (
                <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
                  <Cake className="size-8 mb-2 text-month-primary/20" />
                  <p className="text-sm">{t("emptyState")}</p>
                </div>
              )}
            </motion.div>

            {displayBirthdays.length > maxItems && (
              <Link
                href="/birthdays"
                className="flex items-center justify-center gap-1 mt-3 pt-3 border-t border-border/30 text-sm text-month-primary/60 hover:text-month-primary transition-colors"
              >
                <span>{t("moreCount", { count: displayBirthdays.length - maxItems })}</span>
                <ChevronRight className="size-3" />
              </Link>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </TooltipProvider>
  );
}

export { BirthdayWidgetSkeleton };
