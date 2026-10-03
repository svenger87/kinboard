"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";
import { format } from "date-fns";
import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { getDateFnsLocale } from "@/lib/date-fns-locale";
import type { DayStatus } from "@/lib/todo-turns";

interface Person {
  id: string;
  name: string;
  color: string;
}

/**
 * The two options a repeating task has (#341), both off by default: the
 * people who take turns, in order, and whether every due day is written down
 * as done or not done. Shown under "Assign to"; with turns on, the rotation
 * takes that field's place.
 */
export function TodoTurnFields({
  people,
  turns,
  onTurnsChange,
  track,
  onTrackChange,
}: {
  people: readonly Person[];
  /** The people in order, or null when the task does not rotate. */
  turns: string[] | null;
  onTurnsChange: (turns: string[] | null) => void;
  track: boolean;
  onTrackChange: (track: boolean) => void;
}) {
  const t = useTranslations("todos");
  const turnsId = useId();
  const trackId = useId();
  const byId = new Map(people.map((p) => [p.id, p]));
  const order = (turns ?? []).filter((id) => byId.has(id));

  const move = (index: number, by: number) => {
    const next = [...order];
    const [id] = next.splice(index, 1);
    next.splice(index + by, 0, id);
    onTurnsChange(next);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/40 p-3">
      <div className="flex items-start gap-2">
        <Checkbox id={turnsId} checked={turns !== null} onCheckedChange={(on) => onTurnsChange(on ? [] : null)} />
        <label htmlFor={turnsId} className="flex flex-col gap-0.5 cursor-pointer">
          <span className="text-sm font-medium">{t("turnsLabel")}</span>
          <span className="text-xs text-muted-foreground">{t("turnsHint")}</span>
        </label>
      </div>

      {turns !== null && (
        <div className="flex flex-col gap-2 pl-7">
          {order.length > 0 && (
            <ol className="flex flex-col gap-1" aria-label={t("turnsOrder")}>
              {order.map((id, index) => {
                const person = byId.get(id)!;
                return (
                  <li key={id} className="flex items-center gap-2 rounded-lg bg-muted/30 px-2 py-1">
                    <span className="w-5 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                    <span className="size-3 rounded-full shrink-0" style={{ backgroundColor: person.color }} />
                    <span className="flex-1 text-sm truncate">{person.name}</span>
                    <button
                      type="button"
                      className="p-2 -my-1 rounded-md disabled:opacity-30"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      aria-label={t("turnsMoveUp", { name: person.name })}
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="p-2 -my-1 rounded-md disabled:opacity-30"
                      onClick={() => move(index, 1)}
                      disabled={index === order.length - 1}
                      aria-label={t("turnsMoveDown", { name: person.name })}
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="p-2 -my-1 rounded-md"
                      onClick={() => onTurnsChange(order.filter((other) => other !== id))}
                      aria-label={t("turnsRemove", { name: person.name })}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {people.some((p) => !order.includes(p.id)) && (
            <div className="flex flex-wrap gap-1" role="group" aria-label={t("turnsAdd")}>
              {people
                .filter((p) => !order.includes(p.id))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onTurnsChange([...order, p.id])}
                    className="flex min-h-[36px] items-center gap-1.5 rounded-full border border-border/60 px-3 text-sm hover:bg-accent/50"
                  >
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                    + {p.name}
                  </button>
                ))}
            </div>
          )}
          {order.length === 0 && <p className="text-xs text-muted-foreground">{t("turnsEmpty")}</p>}
        </div>
      )}

      <div className="flex items-start gap-2">
        <Checkbox id={trackId} checked={track} onCheckedChange={onTrackChange} />
        <label htmlFor={trackId} className="flex flex-col gap-0.5 cursor-pointer">
          <span className="text-sm font-medium">{t("trackLabel")}</span>
          <span className="text-xs text-muted-foreground">{t("trackHint")}</span>
        </label>
      </div>
    </div>
  );
}

/**
 * The last due days of a tracked task, oldest first: ✓ done, ✗ not done, ○
 * still open -- a shortcut to what the calendar shows. Each mark takes the
 * colour of whoever's turn it was.
 */
export function TurnStrip({
  days,
  people,
}: {
  days: readonly { day: string; status: DayStatus; personId: string | null }[];
  people: readonly Person[];
}) {
  const t = useTranslations("todos");
  const dateLocale = getDateFnsLocale(useLocale());
  if (days.length === 0) return null;
  const byId = new Map(people.map((p) => [p.id, p]));
  const statusLabel = (s: DayStatus) =>
    s === "done" ? t("dayDone") : s === "missed" ? t("dayMissed") : t("dayOpen");

  return (
    <span className="flex items-center gap-0.5" role="list" aria-label={t("recentDays")}>
      {days.map(({ day, status, personId }) => {
        const person = personId ? byId.get(personId) : undefined;
        const [y, m, d] = day.split("-").map(Number);
        const label = [format(new Date(y, m - 1, d), "EEE d. MMM", { locale: dateLocale }), statusLabel(status), person?.name]
          .filter(Boolean)
          .join(" · ");
        return (
          <span
            key={day}
            role="listitem"
            title={label}
            aria-label={label}
            className={`flex size-4 items-center justify-center rounded-full border text-[10px] leading-none ${
              status === "done" ? "border-transparent text-white" : status === "missed" ? "bg-transparent" : "border-dashed"
            }`}
            style={{
              borderColor: status === "done" ? undefined : person?.color ?? "hsl(var(--muted-foreground))",
              backgroundColor: status === "done" ? person?.color ?? "hsl(var(--success))" : undefined,
              color: status === "missed" ? person?.color ?? "hsl(var(--destructive))" : undefined,
            }}
          >
            {status === "done" ? <Check className="size-2.5" strokeWidth={3} /> : status === "missed" ? <X className="size-2.5" strokeWidth={3} /> : null}
          </span>
        );
      })}
    </span>
  );
}
