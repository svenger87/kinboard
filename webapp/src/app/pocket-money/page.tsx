"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Clock, PiggyBank, Plus, ShoppingBag } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarDisplay } from "@/components/pocket-money/avatar-display";
import { BalanceDisplay } from "@/components/pocket-money/balance-display";
import { GoalCard } from "@/components/pocket-money/goal-card";
import { GoalAddDialog } from "@/components/pocket-money/goal-add-dialog";
import { CelebrationOverlay } from "@/components/pocket-money/celebration-overlay";
import { StagesSheet } from "@/components/pocket-money/stages-sheet";
import {
  usePocketMoneyAccounts,
  usePocketMoneyGoals,
  usePocketMoneyAccountTransactions,
  useCreateWithdrawalRequest,
  useUpdatePocketMoneyAccount,
  useWithdrawalRequests,
  usePeople,
} from "@/hooks";
import { AmountDialog } from "@/components/pocket-money/amount-dialog";
import { tierFromLifetimeSaved, nextTierThreshold } from "@/lib/pocket-money/interest";
import { formatCents } from "@/lib/pocket-money/format";

type CelebrationKind = "evolution" | "goal-reached" | "interest-pay";

export default function PocketMoneyPage() {
  const t = useTranslations("pocketMoney");
  const router = useRouter();
  const { data: accounts = [], isPending } = usePocketMoneyAccounts();
  const { data: people = [] } = usePeople();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [stagesSheetOpen, setStagesSheetOpen] = useState(false);
  const [spendDialogOpen, setSpendDialogOpen] = useState(false);
  const [celebration, setCelebration] = useState<CelebrationKind | null>(null);

  useEffect(() => {
    if (!activeId && accounts.length > 0) setActiveId(accounts[0].id);
  }, [accounts, activeId]);

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  const { data: goals = [] } = usePocketMoneyGoals(active?.id);
  const { data: transactions = [] } = usePocketMoneyAccountTransactions(active?.id);
  const createWithdrawalRequest = useCreateWithdrawalRequest();
  const updateAccount = useUpdatePocketMoneyAccount();
  // Pending spend requests for the active account — drives the
  // "waiting for parent approval" hint above the goal/balance area.
  const { data: pendingRequests = [] } = useWithdrawalRequests(
    active?.id,
    "pending",
  );

  // Fire the avatar-evolution celebration once per tier promotion.
  useEffect(() => {
    if (!active) return;
    const currentTier = tierFromLifetimeSaved(active.lifetime_saved_cents);
    if (currentTier > active.last_seen_tier) {
      setCelebration("evolution");
      updateAccount
        .mutateAsync({ id: active.id, update: { last_seen_tier: currentTier } })
        .catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.lifetime_saved_cents]);

  // Stable callback so re-renders don't reset CelebrationOverlay's
  // dismissal timer mid-animation.
  const handleCelebrationDone = useCallback(() => setCelebration(null), []);

  // Sum today's interest transactions for the "+ N today" tag.
  const todayInterestCents = (() => {
    if (!transactions.length) return 0;
    const today = new Date().toISOString().slice(0, 10);
    return transactions
      .filter((tx) => tx.type === "interest" && tx.created_at.startsWith(today))
      .reduce((sum, tx) => sum + tx.amount_cents, 0);
  })();

  const primaryGoal = goals.find((g) => g.is_primary && g.status === "active");
  const secondaryGoals = goals.filter((g) => !g.is_primary && g.status === "active");

  if (isPending) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-6">
        <PageHeader title={t("title")} icon={PiggyBank} />
        <EmptyState
          icon={PiggyBank}
          title={t("noAccountsYet")}
          action={{ label: t("goToSettings"), onClick: () => router.push("/settings/pocket-money") }}
        />
      </div>
    );
  }

  if (!active) return null;

  const activePerson = people.find((p) => p.id === active.person_id);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 safe-area-inset">
      <PageHeader
        title={t("title")}
        icon={PiggyBank}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/pocket-money">{t("manage")}</Link>
          </Button>
        }
      />

      {accounts.length > 1 && (
        <Tabs value={active.id} onValueChange={setActiveId}>
          <TabsList className="overflow-x-auto">
            {accounts.map((a) => {
              const p = people.find((pp) => pp.id === a.person_id);
              return (
                <TabsTrigger key={a.id} value={a.id}>
                  {p?.name ?? a.person_id.slice(0, 6)}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      )}

      <div className="flex flex-col items-center text-center space-y-3">
        <AvatarDisplay
          species={active.avatar_species}
          lifetimeSavedCents={active.lifetime_saved_cents}
          size={220}
        />
        <div className="flex flex-col items-center gap-0.5">
          {activePerson?.name && (
            <p className="text-lg font-semibold text-muted-foreground">{activePerson.name}</p>
          )}
          {/* Stage caption + next-stage hint — explains what the avatar means
              and what saving more will do. Without this the avatar evolution
              isn't legible to a kid (or parent) on first glance. The whole
              caption is tappable; opens the stages sheet so the kid can see
              the full evolution journey + thresholds. */}
          <button
            type="button"
            onClick={() => setStagesSheetOpen(true)}
            className="flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 hover:bg-white/[0.04] active:scale-[0.98] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50"
            aria-label={t("stagesSheetOpenAria")}
          >
            <p className="text-xl font-bold">
              {t(`species.${active.avatar_species}.tier${tierFromLifetimeSaved(active.lifetime_saved_cents)}` as never)}
            </p>
            {(() => {
              const nextCents = nextTierThreshold(active.lifetime_saved_cents);
              if (nextCents === null) {
                return <p className="text-xs text-muted-foreground">{t("maxStageHint")}</p>;
              }
              const nextTier = tierFromLifetimeSaved(nextCents);
              return (
                <p className="text-xs text-muted-foreground">
                  {t("nextStageHint", {
                    stage: t(`species.${active.avatar_species}.tier${nextTier}` as never),
                    amount: formatCents(nextCents, active.currency),
                  })}
                </p>
              );
            })()}
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">{t("stagesSheetOpenHint")}</p>
          </button>
        </div>
        <BalanceDisplay
          cents={active.balance_cents}
          currency={active.currency}
          todayInterestCents={todayInterestCents}
        />
      </div>

      {pendingRequests.length > 0 && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 flex items-center gap-2 text-sm">
          <Clock className="size-4 text-amber-400 shrink-0" />
          <p className="text-amber-100/90">
            {pendingRequests.length === 1
              ? t("pendingRequestHintOne", {
                  amount: formatCents(
                    pendingRequests[0].amount_cents,
                    active.currency,
                  ),
                })
              : t("pendingRequestHintMany", {
                  count: pendingRequests.length,
                })}
          </p>
        </div>
      )}

      {primaryGoal && (
        <GoalCard
          goal={primaryGoal}
          currentBalanceCents={active.balance_cents}
          currency={active.currency}
          variant="primary"
          onReadyToBuy={() => {
            createWithdrawalRequest
              .mutateAsync({
                accountId: active.id,
                input: {
                  amount_cents: primaryGoal.target_amount_cents,
                  reason: primaryGoal.name,
                  related_goal_id: primaryGoal.id,
                },
              })
              .catch(console.error);
          }}
        />
      )}

      {secondaryGoals.length > 0 && (
        <div className="overflow-x-auto flex gap-3 -mx-6 px-6 pb-2">
          {secondaryGoals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              currentBalanceCents={active.balance_cents}
              currency={active.currency}
            />
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={() => setGoalDialogOpen(true)}>
          <Plus className="size-4 mr-2" />
          {t("addGoal")}
        </Button>
        <Button
          variant="outline"
          onClick={() => setSpendDialogOpen(true)}
        >
          <ShoppingBag className="size-4 mr-2" />
          {t("spend")}
        </Button>
      </div>

      <GoalAddDialog accountId={active.id} open={goalDialogOpen} onOpenChange={setGoalDialogOpen} />

      <AmountDialog
        open={spendDialogOpen}
        onOpenChange={setSpendDialogOpen}
        title={t("spend")}
        description={t("spendDialogDescription")}
        amountLabel={t("spendAmountLabel")}
        withReason
        reasonLabel={t("spendReasonLabel")}
        confirmLabel={t("requestSpend")}
        currency={active.currency}
        onConfirm={async (cents, reason) => {
          await createWithdrawalRequest.mutateAsync({
            accountId: active.id,
            input: { amount_cents: cents, reason: reason ?? "" },
          });
        }}
        isSubmitting={createWithdrawalRequest.isPending}
      />

      <CelebrationOverlay kind={celebration} onDone={handleCelebrationDone} />

      <StagesSheet
        open={stagesSheetOpen}
        onOpenChange={setStagesSheetOpen}
        species={active.avatar_species}
        lifetimeSavedCents={active.lifetime_saved_cents}
        currency={active.currency}
      />
    </div>
  );
}
