"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Check, Pencil, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatCents } from "@/lib/pocket-money/format";
import type { PocketMoneyGoal } from "@/types/database";

interface Props {
  goal: PocketMoneyGoal;
  currentBalanceCents: number;
  currency: string;
  variant?: "primary" | "secondary";
  onReadyToBuy?: () => void;
  // Spam guard: when a withdrawal request for this goal is already awaiting
  // approval, the "ready to buy" button is shown as a disabled "pending" state.
  readyToBuyPending?: boolean;
  // When provided, an edit (pencil) affordance is rendered.
  onEdit?: () => void;
  // When provided, a remove/dismiss (×) affordance is rendered. For a bought
  // goal this acts as "dismiss"; for an active goal it acts as "remove".
  onRemove?: () => void;
}

export function GoalCard({
  goal,
  currentBalanceCents,
  currency,
  variant = "secondary",
  onReadyToBuy,
  readyToBuyPending = false,
  onEdit,
  onRemove,
}: Props) {
  const t = useTranslations("pocketMoney");
  const pct = Math.min(100, Math.floor((currentBalanceCents * 100) / goal.target_amount_cents));
  const reached = currentBalanceCents >= goal.target_amount_cents;
  const isBought = goal.status === "bought";

  return (
    <div
      className={
        "relative " +
        (variant === "primary"
          ? "rounded-2xl border-2 border-month-primary p-4 space-y-3"
          : "rounded-xl border border-border p-3 space-y-2 min-w-[160px]")
      }
    >
      {(onEdit || onRemove) && (
        <div className="absolute top-2 right-2 flex gap-1">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label={t("editGoalAria")}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={isBought ? t("dismissGoalAria") : t("removeGoalAria")}
              className="rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-white/[0.06] transition"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 pr-12">
        {goal.image_url && (
          <Image
            src={goal.image_url}
            alt={goal.name}
            width={variant === "primary" ? 80 : 48}
            height={variant === "primary" ? 80 : 48}
            className="rounded object-cover shrink-0"
            unoptimized
          />
        )}
        <div className="min-w-0 flex-1">
          <p className={variant === "primary" ? "font-semibold text-base truncate" : "font-medium text-sm truncate"}>
            {goal.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatCents(Math.min(currentBalanceCents, goal.target_amount_cents), currency)} {t("ofTotal")}{" "}
            {formatCents(goal.target_amount_cents, currency)} &bull; {pct}%
          </p>
        </div>
      </div>

      {isBought ? (
        <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-500">
          <Check className="size-4" />
          {t("boughtBadge")}
        </div>
      ) : (
        <>
          <Progress value={pct} />
          {reached && variant === "primary" && (
            <button
              type="button"
              onClick={onReadyToBuy}
              disabled={readyToBuyPending}
              className="w-full py-2 rounded-lg bg-month-primary text-month-primary-foreground font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {readyToBuyPending ? t("requestPending") : t("readyToBuy")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
