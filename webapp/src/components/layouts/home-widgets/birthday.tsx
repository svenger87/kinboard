"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { Cake, Gift, PartyPopper } from "lucide-react";
import { PersonAvatar } from "@/components/person-avatar";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { birthdaysAhead, calculateUpcomingAge } from "@/components/widgets/birthday-widget";
import { hasBirthYear } from "@/lib/birthday";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import { HOME_ROW, HomeEmptyLine, HomeList } from "./list-shared";
import type { HomeWidgetProps } from "./shared";
import { HomeCard } from "./frame";

type Entry = ReturnType<typeof birthdaysAhead>[number];

const keyOf = (b: Entry) => b.id;

/** Every birthday, the next one first, as many as fit. "+n" and the title open /birthdays. */
export function BirthdayHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("birthdayWidget");
  const dateLocale = getDateFnsLocale(useLocale());
  const { birthdays, people, today } = useHomeDataContext();
  const entries = useMemo(() => birthdaysAhead(birthdays, people, today), [birthdays, people, today]);

  const renderItem = (b: Entry) => {
    const isToday = b.daysUntil === 0;
    const isSoon = b.daysUntil <= 7 && b.daysUntil > 0;
    return (
      <>
        <div className={`${HOME_ROW}${isToday ? " border-l-4 border-l-primary" : ""}`}>
          {b.imageUrl ? (
            <PersonAvatar name={b.name} color={b.personColor ?? "hsl(var(--primary))"} avatarUrl={b.imageUrl} size="1.8em" />
          ) : (
            <span className={`shrink-0 rounded-[0.4em] p-[0.35em] ${isToday ? "bg-primary text-primary-foreground" : isSoon ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}`}>
              {isToday ? <PartyPopper className="size-[0.9em]" strokeWidth={1.75} /> : isSoon ? <Gift className="size-[0.9em]" strokeWidth={1.75} /> : <Cake className="size-[0.9em]" strokeWidth={1.75} />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {/* No birth year stored means no age to announce - see hasBirthYear. */}
            <p className="break-words home-body font-medium leading-snug">
              {hasBirthYear(b.date) ? t("turnsAge", { name: b.name, age: calculateUpcomingAge(b.date) }) : b.name}
            </p>
            <p className="home-meta tabular-nums text-muted-foreground">{format(b.date, "d. MMM", { locale: dateLocale })}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-[0.6em] py-[0.15em] home-meta font-semibold tabular-nums ${
              isToday ? "bg-primary text-primary-foreground" : isSoon ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"
            }`}
          >
            {isToday ? t("todayBadge") : t("daysSuffix", { count: b.daysUntil })}
          </span>
        </div>
      </>
    );
  };

  return (
    <HomeCard list testId="home-widget-birthday" icon={Cake} title={t("title")} href="/birthdays" editing={editing}>
      <HomeList items={entries} keyOf={keyOf} renderItem={renderItem} empty={<HomeEmptyLine text={t("emptyState")} />} href="/birthdays" />
    </HomeCard>
  );
}
