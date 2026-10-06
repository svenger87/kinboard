"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Clock, Gift, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRequestRedemption } from "@/hooks/use-point-rewards";
import { rewardProgress, type PointTotals } from "@/lib/pocket-money/points";
import type { PointRedemption, PointReward } from "@/types/database";

/** The reward's emoji, or a gift when it has none. */
export function RewardIcon({ icon, className = "" }: { icon: string | null; className?: string }) {
  if (icon) return <span className={`leading-none ${className}`} aria-hidden="true">{icon}</span>;
  return <Gift className={`size-6 text-month-primary ${className}`} aria-hidden="true" />;
}

/**
 * A child's points and what they can buy with them (discussion #349): the
 * balance, every active reward with how far the child is toward it, and
 * "Einlösen", which asks a parent. Nothing is spent until a parent approves.
 */
export function RewardsPanel({
  personId,
  totals,
  rewards,
  redemptions,
}: {
  /** The child (RFC-017: rewards are per child, no pocket-money account needed). */
  personId: string;
  totals: PointTotals;
  rewards: PointReward[];
  /** This child's requests, newest first. */
  redemptions: PointRedemption[];
}) {
  const t = useTranslations("pocketMoney");
  const tCommon = useTranslations("common");
  const request = useRequestRedemption();
  const [confirming, setConfirming] = useState<PointReward | null>(null);

  const active = rewards.filter((r) => r.active);
  const pending = redemptions.filter((r) => r.status === "pending");
  const decided = redemptions.filter((r) => r.status !== "pending").slice(0, 5);

  const redeem = (reward: PointReward) => {
    request
      .mutateAsync({ personId, rewardId: reward.id })
      .then(() => toast.success(t("rewardRequested", { title: reward.title })))
      .catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "";
        toast.error(code === "insufficient_points" ? t("rewardNotEnoughPoints") : t("rewardRequestFailed"));
      });
  };

  return (
    <section className="w-full space-y-3" aria-labelledby="rewards-heading" data-testid="rewards-panel">
      <div className="flex flex-col items-center gap-1">
        <p className="text-5xl font-bold tabular-nums" data-testid="points-balance">
          <span aria-hidden="true">⭐ </span>
          {totals.balance}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("pointsBalanceLabel", { count: totals.balance })}
          {" · "}
          {t("pointsEarnedLabel", { count: totals.earned })}
        </p>
        {totals.owed > 0 && (
          // A task was un-ticked after its points were spent: the next points
          // earned pay that back first.
          <p className="text-xs text-amber-400" data-testid="points-owed">
            {t("pointsOwedLabel", { count: totals.owed })}
          </p>
        )}
      </div>

      {pending.length > 0 && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm" data-testid="redemptions-pending">
          <p className="flex items-center gap-2 font-medium">
            <Clock className="size-4 text-amber-400 shrink-0" />
            {t("rewardsWaiting", { count: pending.length })}
          </p>
          <ul className="mt-1 space-y-0.5 pl-6">
            {pending.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <RewardIcon icon={r.icon} className="text-base" />
                <span className="truncate">{r.title}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">⭐ {r.cost_points}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 id="rewards-heading" className="text-lg font-semibold">{t("rewardsHeading")}</h2>
      {active.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {t("rewardsEmpty")}{" "}
          <Link href="/settings/creatures#rewards" className="underline underline-offset-2">
            {t("rewardsEmptyLink")}
          </Link>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {active.map((reward) => {
            const affordable = totals.available >= reward.cost_points;
            const missing = Math.max(0, reward.cost_points - totals.available);
            return (
              <li key={reward.id}>
                <Card className="flex h-full flex-col gap-3 p-4" data-testid="reward-card">
                  <div className="flex items-center gap-3">
                    <RewardIcon icon={reward.icon} className="text-3xl" />
                    <p className="flex-1 min-w-0 font-semibold break-words">{reward.title}</p>
                    <span className="shrink-0 font-semibold tabular-nums text-month-primary">⭐ {reward.cost_points}</span>
                  </div>
                  <Progress
                    value={rewardProgress(totals.available, reward.cost_points)}
                    className="h-2"
                    aria-label={t("rewardProgressAria", { title: reward.title })}
                  />
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {affordable ? t("rewardAffordable") : t("rewardMissing", { count: missing })}
                    </p>
                    <Button
                      size="sm"
                      disabled={!affordable || request.isPending}
                      onClick={() => setConfirming(reward)}
                    >
                      {t("redeem")}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {decided.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("rewardsHistory")}</h3>
          <ul className="space-y-1 text-sm">
            {decided.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                {r.status === "approved" ? (
                  <Check className="size-4 text-success shrink-0" aria-label={t("rewardApproved")} />
                ) : (
                  <X className="size-4 text-muted-foreground shrink-0" aria-label={t("rewardDenied")} />
                )}
                <RewardIcon icon={r.icon} className="text-base" />
                <span className="truncate">{r.title}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">⭐ {r.cost_points}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("redeemConfirmTitle", { title: confirming?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("redeemConfirmDescription", { count: confirming?.cost_points ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) redeem(confirming);
                setConfirming(null);
              }}
            >
              {t("redeem")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
