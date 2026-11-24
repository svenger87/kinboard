"use client";

import { useEffect, useRef, useState } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { WidgetCard } from "@/components/widget-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetting, useUpdateSetting } from "@/hooks";
import { useToday } from "@/hooks";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { toLocalDateKey } from "@/lib/local-date";
import { COUNTDOWN_ICONS as ICONS } from "@/lib/countdown-icons";

export interface Countdown {
  id: string;
  title: string;
  date: string;
  icon: string;
}

/**
 * The family's countdowns (one settings row, lib/countdowns.ts): those not
 * yet past, soonest first, with the days left from today. A countdown whose
 * day has passed is dropped from the row once. `save` writes the whole list
 * and says so when it fails. Shared by the Home card and Home's box.
 */
export function useCountdowns() {
  const t = useTranslations("countdownWidget");
  const today = useToday();
  const todayDate = new Date(today);
  const todayDateKey = toLocalDateKey(todayDate);
  const { data: entries = [] } = useSetting<Countdown[]>(SETTINGS_KEYS.countdowns, []);
  const update = useUpdateSetting<Countdown[]>();
  const cleanedExpired = useRef("");
  const visible = entries.filter((entry) => entry.date >= todayDateKey);

  useEffect(() => {
    const expiredIds = entries.filter((entry) => entry.date < todayDateKey).map((entry) => entry.id).join(",");
    if (expiredIds && expiredIds !== cleanedExpired.current && !update.isPending) {
      cleanedExpired.current = expiredIds;
      update.mutate({ key: SETTINGS_KEYS.countdowns, value: visible });
    }
  }, [entries, todayDateKey, update.isPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next: Countdown[]) => {
    try {
      await update.mutateAsync({ key: SETTINGS_KEYS.countdowns, value: next });
      return true;
    } catch {
      toast.error(t("saveFailed"));
      return false;
    }
  };

  const sorted = [...visible].sort((a, b) => a.date.localeCompare(b.date));
  const daysLeft = (entry: Countdown) => differenceInCalendarDays(parseISO(entry.date), todayDate);
  const remove = (entry: Countdown) => save(entries.filter((item) => item.id !== entry.id));

  return { entries, visible, sorted, daysLeft, save, remove, todayDateKey, isPending: update.isPending };
}

/** Adding a countdown: its name, its day and its icon. `onSaved` runs once it is stored. */
export function CountdownForm({ countdowns, onSaved }: { countdowns: ReturnType<typeof useCountdowns>; onSaved: () => void }) {
  const t = useTranslations("countdownWidget");
  const { visible, save, todayDateKey, isPending } = countdowns;
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [icon, setIcon] = useState<string>(ICONS[0]);
  return (
    <form className="space-y-2" onSubmit={async (event) => {
      event.preventDefault();
      if (!title.trim() || !date) return;
      if (await save([...visible, { id: crypto.randomUUID(), title: title.trim(), date, icon }])) {
        setTitle(""); setDate(""); onSaved();
      }
    }}>
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("namePlaceholder")} aria-label={t("namePlaceholder")} required />
      <Input type="date" min={todayDateKey} value={date} onChange={(event) => setDate(event.target.value)} aria-label={t("dateLabel")} required />
      <div className="flex flex-wrap gap-1">{ICONS.map((choice) => <button key={choice} type="button" onClick={() => setIcon(choice)} aria-label={choice} aria-pressed={icon === choice} className={`rounded-md p-2 text-xl ${icon === choice ? "bg-primary/20 ring-1 ring-primary" : "bg-muted/30"}`}>{choice}</button>)}</div>
      <Button type="submit" disabled={isPending}>{t("save")}</Button>
    </form>
  );
}

export function CountdownWidget() {
  const t = useTranslations("countdownWidget");
  const countdowns = useCountdowns();
  const { visible, sorted, daysLeft, remove } = countdowns;
  const [editing, setEditing] = useState(false);

  return (
    <WidgetCard title={t("title")} icon={CalendarClock} headerRight={<Button size="icon" variant="ghost" onClick={() => setEditing(!editing)} aria-label={t("add")}><Plus className="size-4" /></Button>}>
      <div className="space-y-2">
        {visible.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
        {sorted.map((entry) => {
          const days = daysLeft(entry);
          return (
          <div key={entry.id} className="flex items-center gap-2 rounded-lg bg-muted/30 p-2">
            <span className="text-2xl" aria-hidden="true">{entry.icon}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.title}</span>
            <span className="flex flex-col items-center leading-none" aria-label={t("daysRemaining", { count: days })}>
              <span className="font-display text-xl tabular-nums">{days}</span>
              <span className="text-2xs text-muted-foreground" aria-hidden="true">{t("daysUnit", { count: days })}</span>
            </span>
            <Button size="icon" variant="ghost" onClick={() => remove(entry)} aria-label={t("remove", { title: entry.title })}><Trash2 className="size-4" /></Button>
          </div>
          );
        })}
      </div>
      {editing && <CountdownForm countdowns={countdowns} onSaved={() => setEditing(false)} />}
    </WidgetCard>
  );
}
