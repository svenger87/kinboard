"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { PiggyBank, Plus, ShoppingBag } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { AvatarDisplay } from "@/components/pocket-money/avatar-display";
import { BalanceDisplay } from "@/components/pocket-money/balance-display";
import { GoalCard } from "@/components/pocket-money/goal-card";
import { GoalAddDialog } from "@/components/pocket-money/goal-add-dialog";
import { CelebrationOverlay } from "@/components/pocket-money/celebration-overlay";
import {
  usePocketMoneyAccounts,
  usePocketMoneyGoals,
  usePocketMoneyAccountTransactions,
  useCreateWithdrawalRequest,
  useUpdatePocketMoneyAccount,
  usePeople,
} from "@/hooks";
import { tierFromLifetimeSaved } from "@/lib/pocket-money/interest";

type CelebrationKind = "evolution" | "goal-reached" | "interest-pay";

export default function PocketMoneyPage() {
  const t = useTranslations("pocketMoney");
  const { data: accounts = [], isPending } = usePocketMoneyAccounts();
  const { data: people = [] } = usePeople();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [celebration, setCelebration] = useState<CelebrationKind | null>(null);

  useEffect(() => {
    if (!activeId && accounts.length > 0) setActiveId(accounts[0].id);
  }, [accounts, activeId]);

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
  const { data: goals = [] } = usePocketMoneyGoals(active?.id);
  const { data: transactions = [] } = usePocketMoneyAccountTransactions(active?.id);
  const createWithdrawalRequest = useCreateWithdrawalRequest();
  const updateAccount = useUpdatePocketMoneyAccount();

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

  if (isPending) return <div className="p-8 text-muted-foreground">{t("loading")}</div>;

  if (accounts.length === 0) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-6">
        <PageHeader title={t("title")} icon={PiggyBank} />
        <GlassCard className="p-8 text-center space-y-4">
          <p className="text-muted-foreground">{t("noAccountsYet")}</p>
          <Button asChild>
            <Link href="/settings/pocket-money">{t("goToSettings")}</Link>
          </Button>
        </GlassCard>
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
        {activePerson?.name && (
          <p className="text-lg font-semibold text-muted-foreground">{activePerson.name}</p>
        )}
        <BalanceDisplay
          cents={active.balance_cents}
          currency={active.currency}
          todayInterestCents={todayInterestCents}
        />
      </div>

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
          onClick={() => {
            const amountStr = prompt(t("spendPromptAmount"));
            if (!amountStr) return;
            const cents = Math.round(Number(amountStr) * 100);
            if (!cents || cents <= 0) return;
            const reason = prompt(t("spendPromptReason")) ?? "";
            createWithdrawalRequest
              .mutateAsync({
                accountId: active.id,
                input: { amount_cents: cents, reason },
              })
              .catch(console.error);
          }}
        >
          <ShoppingBag className="size-4 mr-2" />
          {t("spend")}
        </Button>
      </div>

      <GoalAddDialog accountId={active.id} open={goalDialogOpen} onOpenChange={setGoalDialogOpen} />

      <CelebrationOverlay kind={celebration} onDone={handleCelebrationDone} />
    </div>
  );
}
