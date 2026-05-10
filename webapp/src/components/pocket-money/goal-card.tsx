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
}

export function GoalCard({ goal, currentBalanceCents, currency, variant = "secondary", onReadyToBuy }: Props) {
  const t = useTranslations("pocketMoney");
  const pct = Math.min(100, Math.floor((currentBalanceCents * 100) / goal.target_amount_cents));
  const reached = currentBalanceCents >= goal.target_amount_cents;

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
        </div>
      </div>
      <Progress value={pct} />
      {reached && variant === "primary" && (
        <button
          type="button"
          onClick={onReadyToBuy}
          className="w-full py-2 rounded-lg bg-month-primary text-month-primary-foreground font-semibold"
        >
          {t("readyToBuy")}
        </button>
      )}
    </div>
  );
}
