"use client";

import { motion } from "framer-motion";
import { Cake, Gift, PartyPopper, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/widget-card";
import { PersonAvatar } from "@/components/person-avatar";
import Link from "next/link";
import { format } from "date-fns";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { useTranslations, useLocale } from "next-intl";
import { useMemo } from "react";
import { useBirthdays, usePeople, useToday } from "@/hooks";
import {
  parseBirthdayDate,
  getNextBirthday,
  getDaysUntilBirthday,
} from "@/lib/birthday";

interface BirthdayWidgetProps {
  maxItems?: number;
  className?: string;
}

function calculateUpcomingAge(birthDate: Date): number {
  const nextBirthday = getNextBirthday(birthDate);
  return nextBirthday.getFullYear() - birthDate.getFullYear();
}

function BirthdayWidgetSkeleton() {
  const t = useTranslations("birthdayWidget");
  return (
    <Card aria-label={t("loadingAria")} aria-busy="true">
      <CardContent className="flex flex-col gap-4 p-[18px]">
        <div className="flex items-center gap-3">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-5 w-24" />
        </div>
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
  const dateLocale = getDateFnsLocale(locale);
  const { data: birthdays, isLoading: loadingBirthdays, isError } = useBirthdays();
  const { data: people } = usePeople();
  // Re-render at midnight so daysUntil / "today" recompute without a reload.
  const today = useToday();

  // Transform birthdays to display format with cached daysUntil
  const displayBirthdays = useMemo(() => (birthdays || []).map((birthday) => {
    const person = people?.find((p) => p.id === birthday.person_id);
    const date = parseBirthdayDate(birthday.date);
    return {
      id: birthday.id,
      name: birthday.name,
      date,
      daysUntil: getDaysUntilBirthday(date, new Date(today)),
      personColor: person?.color,
      imageUrl: birthday.image_url,
    };
  }), [birthdays, people, today]);

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
      <Card className={`h-full ${className}`}>
        <CardContent className="flex flex-col gap-4 p-[18px]">
          <div className="flex items-center gap-3">
            <span className="p-1.5 rounded-lg bg-primary/10">
              <Cake className="size-5 text-primary" strokeWidth={1.5} />
            </span>
            <h3 className="font-display text-lg font-semibold leading-tight">{t("title")}</h3>
          </div>
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

  const headerRight = (
    <Link
      href="/birthdays"
      className="p-1 rounded-lg hover:bg-accent/50 transition-colors"
      aria-label={t("viewAllAria")}
    >
      <ChevronRight className="size-4 text-muted-foreground" />
    </Link>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className={className}
    >
      <WidgetCard icon={Cake} title={t("title")} headerRight={headerRight}>
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
                className={`flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 elev-sm${isToday ? " border-l-4 border-l-primary" : ""}`}
              >
                {birthday.imageUrl ? (
                  <PersonAvatar name={birthday.name} color={birthday.personColor ?? "hsl(var(--primary))"} avatarUrl={birthday.imageUrl} size={40} />
                ) : (
                  <span className={`rounded-lg p-2 ${isToday ? "bg-primary text-primary-foreground" : isSoon ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
                    {isToday ? <PartyPopper className="size-4" strokeWidth={1.75} /> : isSoon ? <Gift className="size-4" strokeWidth={1.75} /> : <Cake className="size-4" strokeWidth={1.75} />}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t("turnsAge", { name: birthday.name, age: calculateUpcomingAge(birthday.date) })}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{format(birthday.date, "d. MMM", { locale: dateLocale })}</p>
                </div>
                {isToday ? (
                  <Badge variant="default" className="tabular-nums">{t("todayBadge")}</Badge>
                ) : (
                  <Badge variant={isSoon ? "warning" : "neutral"} className="tabular-nums">{t("daysSuffix", { count: daysUntil })}</Badge>
                )}
              </motion.div>
            );
          })}

          {displayBirthdays.length === 0 && (
            <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
              <Cake className="size-8 mb-2 opacity-20" />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
        </motion.div>

        {displayBirthdays.length > maxItems && (
          <Link
            href="/birthdays"
            className="flex items-center justify-center gap-1 mt-3 pt-3 border-t border-border/30 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{t("moreCount", { count: displayBirthdays.length - maxItems })}</span>
            <ChevronRight className="size-3" />
          </Link>
        )}
      </WidgetCard>
    </motion.div>
  );
}

export { BirthdayWidgetSkeleton };
