"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdjustPoints, usePointAdjustments, usePointTotals, useRemoveAdjustment } from "@/hooks";
import { MAX_ADJUSTMENT, MAX_NOTE } from "@/lib/creatures/adjustments";
import type { Person } from "@/types/database";

/** How many of a child's adjustments the list shows; the rest stay counted. */
const SHOWN = 10;

/**
 * A parent adds or removes a child's points by hand (discussion #349): a
 * bonus for something that was no task, or a correction for a task that was
 * given the wrong points. Shown for every child on Settings -> Creatures &
 * rewards, with or without a creature, behind the settings PIN like the rest
 * of the page; the routes check the PIN again on the server.
 */
export function PointAdjustments({ kid }: { kid: Person }) {
  const t = useTranslations("settings.creatures");
  const tPMS = useTranslations("settings.pocketMoney");
  const locale = useLocale();
  const amountId = useId();
  const noteId = useId();
  const { totalsFor } = usePointTotals();
  const { data: all = [] } = usePointAdjustments();
  const adjustments = all.filter((a) => a.person_id === kid.id);
  const adjust = useAdjustPoints();
  const remove = useRemoveAdjustment();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const points = Number(amount);
  const valid = Number.isInteger(points) && points >= 1 && points <= MAX_ADJUSTMENT;
  const busy = adjust.isPending || remove.isPending;
  const totals = totalsFor(kid.id);

  const fail = (err: unknown) => {
    const code = err instanceof Error ? err.message : "";
    toast.error(code === "pin_required" ? t("errorPinRequired") : code === "invalid_points" ? t("adjustInvalid") : t("errorGeneric"));
  };

  const submit = (sign: 1 | -1) => {
    if (!valid) return;
    adjust
      .mutateAsync({ personId: kid.id, points: sign * points, note: note.trim() || undefined })
      .then(() => {
        toast.success(sign > 0 ? t("adjustAdded", { name: kid.name, count: points }) : t("adjustRemoved", { name: kid.name, count: points }));
        setAmount("");
        setNote("");
      })
      .catch(fail);
  };

  return (
    <div className="pt-3 border-t border-border space-y-3" data-testid={`points-${kid.id}`}>
      <div>
        <p className="text-sm font-medium">{t("pointsLabel")}</p>
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="points-summary">
          {tPMS("pointsSummary", { balance: totals.balance, earned: totals.earned })}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{t("pointsHint")}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
        <div className="space-y-1">
          <Label htmlFor={amountId}>{t("adjustAmountLabel")}</Label>
          <Input
            id={amountId}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ADJUSTMENT}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="adjust-amount"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={noteId}>{t("adjustNoteLabel")}</Label>
          <Input
            id={noteId}
            maxLength={MAX_NOTE}
            placeholder={t("adjustNotePlaceholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="adjust-note"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!valid || busy}
          onClick={() => submit(1)}
          aria-label={t("adjustAddAria", { name: kid.name })}
          data-testid="adjust-add"
          className="[@media(pointer:coarse)]:h-11"
        >
          <Plus className="size-4" />
          {t("adjustAdd")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!valid || busy}
          onClick={() => submit(-1)}
          aria-label={t("adjustRemoveAria", { name: kid.name })}
          data-testid="adjust-remove"
          className="[@media(pointer:coarse)]:h-11"
        >
          <Minus className="size-4" />
          {t("adjustRemove")}
        </Button>
      </div>

      {/* What a parent changed by hand, newest first, each one reversible. */}
      <div className="space-y-1" data-testid={`adjustments-${kid.id}`}>
        <p className="text-xs font-semibold text-muted-foreground">{t("adjustmentsLabel")}</p>
        {adjustments.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("adjustmentsEmpty")}</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {adjustments.slice(0, SHOWN).map((a) => (
              <li key={a.id} className="flex items-center gap-2" data-testid="adjustment-row">
                <span className={`tabular-nums font-medium ${a.points > 0 ? "text-success" : "text-destructive"}`}>
                  {a.points > 0 ? `+${a.points}` : `−${Math.abs(a.points)}`}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{a.note ?? ""}</span>
                <time dateTime={a.created_at} className="tabular-nums text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}
                </time>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs [@media(pointer:coarse)]:h-11"
                  disabled={busy}
                  onClick={() => remove.mutateAsync(a.id).then(() => toast.success(t("adjustTakenBack"))).catch(fail)}
                  aria-label={t("adjustTakeBackAria", { count: a.points })}
                  data-testid="adjustment-take-back"
                >
                  {t("adjustTakeBack")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
