"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { MoreVertical, Pencil, Star, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { formatCents } from "@/lib/pocket-money/format";
import type { PocketMoneyGoal } from "@/types/database";

interface Props {
  goal: PocketMoneyGoal;
  currentBalanceCents: number;
  currency: string;
  variant?: "primary" | "secondary";
  onReadyToBuy?: () => void;
  /** Allowance amount + cadence, used for the "N more allowances" hint. */
  allowanceCents?: number;
  allowanceIntervalDays?: number;
  onEdit?: () => void;
  onDelete?: () => void;
  onMakePrimary?: () => void;
}

export function GoalCard({
  goal,
  currentBalanceCents,
  currency,
  variant = "secondary",
  onReadyToBuy,
  allowanceCents = 0,
  allowanceIntervalDays = 7,
  onEdit,
  onDelete,
  onMakePrimary,
}: Props) {
  const t = useTranslations("pocketMoney");
  // A zero or negative target would divide by zero and render Infinity%.
  const target = Math.max(1, goal.target_amount_cents);
  const pct = Math.min(100, Math.floor((currentBalanceCents * 100) / target));
  const reached = currentBalanceCents >= goal.target_amount_cents;
  const remainingCents = Math.max(0, goal.target_amount_cents - currentBalanceCents);

  // How many more allowances until it's affordable. This is the question
  // a child actually asks ("how long until I can buy it?") and the
  // percentage alone doesn't answer it. Interest is ignored: it would
  // shorten the estimate slightly, and promising sooner than reality
  // delivers is the wrong direction to be wrong in.
  const allowancesToGo =
    !reached && allowanceCents > 0 ? Math.ceil(remainingCents / allowanceCents) : null;

  return (
    <div className={variant === "primary" ? "rounded-2xl border-2 border-month-primary p-4 space-y-3" : "rounded-xl border border-border p-3 space-y-2 min-w-[160px]"}>
      <div className="flex items-center gap-3">
        {goal.image_url && (
          <Image
            src={goal.image_url}
            alt=""
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
          {!reached && (
            <p className="text-xs font-medium text-month-primary">
              {t("goalRemaining", { amount: formatCents(remainingCents, currency) })}
              {allowancesToGo !== null && (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  {t("goalAllowancesToGo", {
                    count: allowancesToGo,
                    days: allowancesToGo * allowanceIntervalDays,
                  })}
                </span>
              )}
            </p>
          )}
        </div>
        {/* Goals previously had no edit or delete anywhere in the app —
            a mistyped target or an abandoned goal was permanent. */}
        {(onEdit || onDelete || onMakePrimary) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("goalActionsAria", { name: goal.name })}
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onMakePrimary && !goal.is_primary && (
                <DropdownMenuItem onClick={onMakePrimary}>
                  <Star className="size-4 mr-2" />
                  {t("goalMakePrimary")}
                </DropdownMenuItem>
              )}
              {onEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-4 mr-2" />
                  {t("goalEdit")}
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4 mr-2" />
                  {t("goalDelete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Progress value={pct} />
      {reached && (
        <button
          type="button"
          onClick={onReadyToBuy}
          className={`w-full rounded-lg bg-month-primary text-month-primary-foreground font-semibold ${
            variant === "primary" ? "py-2" : "py-1.5 text-xs"
          }`}
        >
          {t("readyToBuy")}
        </button>
      )}
    </div>
  );
}
