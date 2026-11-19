"use client";

import { useGrowthPoints } from "@/hooks/use-point-rewards";
import Link from "next/link";
import { useState } from "react";
import { PiggyBank } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ReactingCreature } from "@/components/pocket-money/creature-reaction";
import { useCreatureMood } from "@/hooks/use-creature-mood";
import { nextAllowanceDate, daysUntil } from "@/lib/pocket-money/allowance";
import {
  usePocketMoneyAccounts,
  usePocketMoneyAccountTransactions,
  usePocketMoneyGoals,
  usePeople,
  usePointTotals,
  usePointAwardHistory,
  usePointRedemptions,
  usePointPurchases,
  useOwnedItems,
  useCreatures,
  useTodos,
  activeCreatureOf,
  useSetting,
} from "@/hooks";
import { creatureStage } from "@/lib/creatures/stage";
import { readLook } from "@/lib/pocket-money/creatures/look";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { PluginDiscoverCard } from "./plugin-discover-card";
import { formatCents } from "@/lib/pocket-money/format";
import { pointHistory, type PointHistoryEntry } from "@/lib/pocket-money/point-history";
import { pocketMoneyChildren, type PocketMoneyChild } from "@/lib/pocket-money/widget-children";
import { rewardsHref } from "@/lib/device-owner";
import type { PocketMoneyAccount, PocketMoneyTransaction } from "@/types/database";
import { useFestivalLook } from "@/hooks/use-festival";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { DEFAULT_POCKET_MONEY_WIDGET_SETTINGS, type PocketMoneyWidgetSettings } from "@/types/widgets";

type Child = PocketMoneyChild<PocketMoneyAccount>;

/**
 * The children the widget shows: those with an account, then those whose
 * creature grows with points alone (lib/pocket-money/widget-children.ts).
 * The dashboard uses it too, for one card per child.
 */
export function usePocketMoneyChildren(): Child[] {
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const { data: people } = usePeople();
  const { data: creatures } = useCreatures();
  return pocketMoneyChildren(accounts, people, creatures);
}

/** An account's child opens the pocket-money page, a points-only child their Rewards. */
function childHref(child: Child): string {
  return child.account ? "/pocket-money" : rewardsHref(child.personId);
}

/**
 * The dashboard's pocket-money widget. How it lays out several children is a
 * setting (Settings → Widgets → Pocket Money): "toggle" shows one child at a
 * time behind a switcher, as the widget always did; "all" stacks every child
 * in one card; "perChild" gives each child a card of their own -- the
 * dashboard then passes `personId`, as it does for the schedule widget. Under
 * each child it can list the latest activity: money transactions, or point
 * activity for a child whose creature grows with points.
 */
export function PocketMoneyWidget({ personId }: { personId?: string }) {
  const t = useTranslations("dashboard.pluginDiscover");
  const enabled = useIsPluginEnabled("pocket-money");
  const all = usePocketMoneyChildren();
  const { data: pmSettings } = useSetting<PocketMoneyWidgetSettings>(
    SETTINGS_KEYS.pocketMoneyWidget,
    DEFAULT_POCKET_MONEY_WIDGET_SETTINGS,
  );
  const mode = pmSettings?.displayMode ?? DEFAULT_POCKET_MONEY_WIDGET_SETTINGS.displayMode;
  const recentCount =
    pmSettings?.recentTransactions ?? DEFAULT_POCKET_MONEY_WIDGET_SETTINGS.recentTransactions;
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!enabled) {
    return (
      <PluginDiscoverCard
        pluginId="pocket-money"
        icon={PiggyBank}
        title={t("pocketMoneyName")}
        description={t("pocketMoneyDisabled")}
        ctaLabel={t("enableCta")}
        ctaHref="/settings/plugins"
      />
    );
  }

  const children = personId ? all.filter((c) => c.personId === personId) : all;
  if (children.length === 0) {
    // A per-child card whose child is gone renders nothing; the widget
    // itself keeps the "no accounts yet" discover card.
    if (personId) return null;
    return (
      <PluginDiscoverCard
        pluginId="pocket-money"
        icon={PiggyBank}
        title={t("pocketMoneyName")}
        description={t("pocketMoneyEmpty")}
        ctaLabel={t("addCta")}
        ctaHref="/settings/pocket-money"
      />
    );
  }

  if (personId) {
    const child = children[0];
    return (
      <Link href={childHref(child)} className="block h-full" data-testid="pocket-money-widget" data-mode="perChild">
        <Card className="p-4 space-y-2 h-full accent-border-top">
          <p className="text-xs font-medium text-muted-foreground">
            <PersonName personId={child.personId} />
          </p>
          <PocketMoneyWidgetTab child={child} recentCount={recentCount} />
        </Card>
      </Link>
    );
  }

  if (mode === "toggle") {
    const active = children.find((c) => c.personId === activeId) ?? children[0];
    return (
      <Link href={childHref(active)} className="block h-full" data-testid="pocket-money-widget" data-mode="toggle">
        <Card className="p-4 space-y-3 h-full accent-border-top">
          {children.length > 1 && (
            <SegmentedControl value={active.personId} onValueChange={(v) => setActiveId(v)}>
              {children.map((c) => (
                <SegmentedControlItem
                  key={c.personId}
                  value={c.personId}
                  onClick={(e) => {
                    // Prevent the wrapping <Link> from firing when the user
                    // taps a tab; they want to switch tabs, not navigate.
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <PersonName personId={c.personId} />
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          )}
          <PocketMoneyWidgetTab child={active} recentCount={recentCount} />
        </Card>
      </Link>
    );
  }

  // "all", and the widget's own fallback while "perChild" is set but the
  // dashboard has a single child to show (it renders personId cards from two).
  const href = children.some((c) => c.account) ? "/pocket-money" : "/rewards";
  return (
    <Link href={href} className="block h-full" data-testid="pocket-money-widget" data-mode="all">
      <Card className="p-4 space-y-3 h-full accent-border-top">
        {children.map((c) => (
          <div key={c.personId} className="space-y-1">
            {children.length > 1 && (
              <p className="text-xs font-medium text-muted-foreground">
                <PersonName personId={c.personId} />
              </p>
            )}
            <PocketMoneyWidgetTab child={c} recentCount={recentCount} />
          </div>
        ))}
      </Card>
    </Link>
  );
}

const TX_TYPE_KEYS: Record<PocketMoneyTransaction["type"], string> = {
  allowance: "txTypeAllowance",
  manual_deposit: "txTypeDeposit",
  interest: "txTypeInterest",
  withdrawal: "txTypeWithdrawal",
  adjustment: "txTypeAdjustment",
};

/** One line of the recent list: what, when, and the signed amount. */
function ActivityRow({ label, at, amount, positive }: { label: string; at: string; amount: string; positive: boolean }) {
  const locale = useLocale();
  const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(at));
  return (
    <li className="flex items-baseline gap-2 text-xs text-muted-foreground">
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="shrink-0">{day}</span>
      <span
        className={`shrink-0 tabular-nums font-medium ${
          positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
        }`}
      >
        {positive ? "+" : "−"}
        {amount}
      </span>
    </li>
  );
}

function RecentTransactions({ account, count }: { account: PocketMoneyAccount; count: number }) {
  const t = useTranslations("pocketMoney");
  // Newest first from the server, and only as many as the list shows.
  const { data: txs = [] } = usePocketMoneyAccountTransactions(count > 0 ? account.id : undefined, count);
  if (count <= 0 || txs.length === 0) return null;
  return (
    <ul className="space-y-0.5 pt-1" data-testid="pocket-money-recent" data-kind="money">
      {txs.slice(0, count).map((tx) => (
        <ActivityRow
          key={tx.id}
          label={tx.note?.trim() ? tx.note : t(TX_TYPE_KEYS[tx.type] as never)}
          at={tx.created_at}
          amount={formatCents(Math.abs(tx.amount_cents), account.currency)}
          positive={tx.amount_cents >= 0}
        />
      ))}
    </ul>
  );
}

/** Point activity, for a child whose creature grows with points (lib/pocket-money/point-history.ts). */
function RecentPoints({ personId, count }: { personId: string; count: number }) {
  const t = useTranslations("pocketMoney");
  const tShop = useTranslations("shop");
  const { data: awards = [] } = usePointAwardHistory(count > 0 ? personId : undefined, count);
  const { data: redemptions = [] } = usePointRedemptions();
  const { data: purchases = [] } = usePointPurchases();
  const { data: todos = [] } = useTodos({ enabled: count > 0 });
  const entries = pointHistory({ personId, awards, redemptions, purchases, limit: count });
  if (entries.length === 0) return null;
  const label = (e: PointHistoryEntry): string => {
    switch (e.kind) {
      case "task":
        return todos.find((td) => td.id === e.todoId)?.title ?? t("pointsTask");
      case "adjustment":
        return e.note?.trim() ? e.note : t("txTypeAdjustment");
      case "reward":
        return e.title;
      case "shop":
        return tShop(`items.${e.itemId}` as never);
    }
  };
  return (
    <ul className="space-y-0.5 pt-1" data-testid="pocket-money-recent" data-kind="points">
      {entries.map((e) => (
        <ActivityRow
          key={e.id}
          label={label(e)}
          at={e.at}
          amount={`⭐ ${Math.abs(e.points)}`}
          positive={e.points >= 0}
        />
      ))}
    </ul>
  );
}

function PersonName({ personId }: { personId: string }) {
  const { data: people = [] } = usePeople();
  const p = people.find((pp) => pp.id === personId);
  return <span>{p?.name ?? personId.slice(0, 6)}</span>;
}

function PocketMoneyWidgetTab({ child, recentCount }: { child: Child; recentCount: number }) {
  const t = useTranslations("pocketMoney");
  const { personId, account } = child;
  const { data: goals = [] } = usePocketMoneyGoals(account?.id);
  // The child's creature (RFC-017), when one is switched on: growing with
  // the task points earned -- and then the widget shows the points to spend
  // instead of the money -- or with the money in this account. A child
  // without an account is here only because their creature grows with points.
  const { data: creatures } = useCreatures();
  const creature = activeCreatureOf(creatures, personId);
  const { totalsFor } = usePointTotals();
  const { ownedFor } = useOwnedItems();
  // During a festival, its outfit instead of the child's own item (RFC-020 §2.3).
  const festive = useFestivalLook();
  // Sleepy at night, happy once today's tasks are done; still, either way.
  const mood = useCreatureMood(personId);
  const pointThresholds = useGrowthPoints();
  const points = totalsFor(personId);
  const stage = creatureStage({
    creature: creature ?? { grows_with: "money", best_tier: 1 },
    account,
    earnedPoints: points.earned,
    pointThresholds,
  });
  const pointsMode = !account || (Boolean(creature) && stage.mode === "points");
  const primary = goals.find((g) => g.is_primary && g.status === "active");
  const nextAllowance =
    account && account.weekly_allowance_cents > 0
      ? nextAllowanceDate({
          lastAllowanceAt: account.last_allowance_at,
          intervalDays: account.allowance_interval_days ?? 7,
          dayOfWeek: account.allowance_day_of_week,
        })
      : null;
  const progress =
    account && primary
      ? Math.min(100, Math.floor((account.balance_cents * 100) / primary.target_amount_cents))
      : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        {/* Small and on the dashboard all day: static, so a wall display's
            Pi does not redraw a breathing dragon for nobody. It moves only
            while it cheers for a task ticked off, a second and a half, and a
            new stage reached that way hatches right here. */}
        {creature ? (
          <ReactingCreature
            personId={personId}
            compactStageUp
            species={creature.species}
            tier={stage.tier}
            style={creature.style}
            look={festive(readLook(creature.look, ownedFor(personId)))}
            mood={mood}
            size={56}
            animated={false}
            label={t(`species.${creature.species}.tier${stage.tier}` as never)}
            className="shrink-0"
          />
        ) : (
          <PiggyBank className="size-10 shrink-0 text-month-primary" aria-hidden="true" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-2xl font-bold tabular-nums">
            {pointsMode || !account ? (
              <>
                <span aria-hidden="true">⭐ </span>
                {points.balance}
              </>
            ) : (
              formatCents(account.balance_cents, account.currency)
            )}
          </p>
          {pointsMode ? (
            <p className="text-3xs text-muted-foreground truncate">
              {t("pointsBalanceLabel", { count: points.balance })}
            </p>
          ) : primary ? (
            <>
              <p className="text-3xs text-muted-foreground truncate">{primary.name}</p>
              <Progress value={progress} className="h-1.5 mt-1" />
            </>
          ) : (
            account &&
            nextAllowance && (
              // Only shown when no goal is competing for the line, so the
              // widget keeps its height on the dashboard grid.
              <p className="text-3xs text-muted-foreground truncate">
                {t("nextAllowanceShort", {
                  amount: formatCents(account.weekly_allowance_cents, account.currency),
                  days: daysUntil(nextAllowance),
                })}
              </p>
            )
          )}
        </div>
      </div>
      {pointsMode ? (
        <RecentPoints personId={personId} count={recentCount} />
      ) : (
        account && <RecentTransactions account={account} count={recentCount} />
      )}
    </div>
  );
}
