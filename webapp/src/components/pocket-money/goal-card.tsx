"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
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
}

export function GoalCard({
  goal,
  currentBalanceCents,
  currency,
  variant = "secondary",
  onReadyToBuy,
  allowanceCents = 0,
  allowanceIntervalDays = 7,
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
