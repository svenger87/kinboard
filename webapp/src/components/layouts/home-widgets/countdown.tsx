"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CountdownForm, useCountdowns, type Countdown } from "@/components/widgets/countdown-widget";
import { HOME_ROW_BUTTON, HomeEmptyLine, HomeList, TARGET_SQ } from "./list-shared";
import type { HomeWidgetProps } from "./shared";
import { HomeCard } from "./frame";

const keyOf = (c: Countdown) => c.id;

/**
 * The family's countdowns, soonest first, as many as fit, each with its 48px
 * remove button. "+" adds one with the card's form, in a dialog over the
 * layout. Countdowns have no page of their own, so the title is not a link
 * and "+n" is a count.
 */
export function CountdownHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("countdownWidget");
  const countdowns = useCountdowns();
  const { sorted, daysLeft, remove } = countdowns;
  const [adding, setAdding] = useState(false);

  const renderItem = (entry: Countdown) => {
    const days = daysLeft(entry);
    return (
      <>
        <div className={HOME_ROW_BUTTON}>
          <span className="home-value leading-none" aria-hidden="true">{entry.icon}</span>
          <span className="min-w-0 flex-1 break-words py-[0.3em] home-body font-medium leading-snug">{entry.title}</span>
          <span className="flex flex-col items-center leading-none" aria-label={t("daysRemaining", { count: days })}>
            <span className="font-display home-value tabular-nums">{days}</span>
            <span className="home-label text-muted-foreground" aria-hidden="true">{t("daysUnit", { count: days })}</span>
          </span>
          <Button size="icon" variant="ghost" className={TARGET_SQ} onClick={() => void remove(entry)} aria-label={t("remove", { title: entry.title })}>
            <Trash2 className="size-[0.9em]" />
          </Button>
        </div>
      </>
    );
  };

  return (
    <>
      <HomeCard list
        testId="home-widget-countdown"
        icon={CalendarClock}
        title={t("title")}
        editing={editing}
        right={
          <Button size="icon" variant="ghost" className={TARGET_SQ} onClick={() => setAdding(true)} aria-label={t("add")}>
            <Plus className="size-[1em] text-muted-foreground" />
          </Button>
        }
      >
        <HomeList items={sorted} keyOf={keyOf} renderItem={renderItem} empty={<HomeEmptyLine text={t("empty")} />} />
      </HomeCard>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
          </DialogHeader>
          <CountdownForm countdowns={countdowns} onSaved={() => setAdding(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
