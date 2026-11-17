"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ReactingCreature } from "@/components/pocket-money/creature-reaction";
import { useCreatureMood } from "@/hooks/use-creature-mood";
import { nextAllowanceDate, daysUntil } from "@/lib/pocket-money/allowance";
import { usePocketMoneyAccounts, usePocketMoneyAccountTransactions, usePocketMoneyGoals, usePeople, usePointTotals, useOwnedItems, useCreatures, activeCreatureOf, useSetting } from "@/hooks";
import { creatureStage } from "@/lib/creatures/stage";
import { readLook } from "@/lib/pocket-money/creatures/look";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { PluginDiscoverCard } from "./plugin-discover-card";
import { formatCents } from "@/lib/pocket-money/format";
import type { PocketMoneyAccount, PocketMoneyTransaction } from "@/types/database";
import { useFestivalLook } from "@/hooks/use-festival";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { DEFAULT_POCKET_MONEY_WIDGET_SETTINGS, type PocketMoneyWidgetSettings } from "@/types/widgets";

// Local patch (2026-11-17, for Lei; v2): the layout is a widget setting
// (Settings → Widgets → Pocket Money). "toggle" is the stock one-child
// switcher, "all" stacks every child in one card, and "perChild" renders
// one card per child — the dashboard passes personId, the same pattern as
// the schedule widget's perChild. Each child can also list its last N
// transactions (setting, default 3). Source of truth:
// github.com/leigao84/kinboard, branch patch/pocket-money-all-kids.
export function PocketMoneyWidget({ personId }: { personId?: string }) {
  const t = useTranslations("dashboard.pluginDiscover");
  const enabled = useIsPluginEnabled("pocket-money");
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const { data: pmSettings } = useSetting<PocketMoneyWidgetSettings>(
    SETTINGS_KEYS.pocketMoneyWidget,
    DEFAULT_POCKET_MONEY_WIDGET_SETTINGS,
  );
  const mode = pmSettings?.displayMode ?? DEFAULT_POCKET_MONEY_WIDGET_SETTINGS.displayMode;
  const recentCount =
    pmSettings?.recentTransactions ?? DEFAULT_POCKET_MONEY_WIDGET_SETTINGS.recentTransactions;
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId && accounts.length > 0) setActiveId(accounts[0].id);
  }, [accounts, activeId]);

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

  const own = personId ? accounts.filter((a) => a.person_id === personId) : accounts;
  if (own.length === 0) {
    // A per-child card for a child without an account renders nothing; the
    // standalone widget keeps the stock "no accounts yet" discover card.
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
    const a = own[0];
    return (
      <Link href="/pocket-money" className="block h-full">
        <Card className="p-4 space-y-2 h-full accent-border-top">
          <p className="text-xs font-medium text-muted-foreground">
            <PersonName accountPersonId={a.person_id} />
          </p>
          <PocketMoneyWidgetTab account={a} />
          <RecentTransactions account={a} count={recentCount} />
        </Card>
      </Link>
    );
  }

  if (mode === "toggle") {
    const active = accounts.find((a) => a.id === activeId) ?? accounts[0];
    return (
      <Link href="/pocket-money" className="block h-full">
        <Card className="p-4 space-y-3 h-full accent-border-top">
          {accounts.length > 1 && (
            <SegmentedControl value={active.id} onValueChange={(v) => setActiveId(v)}>
              {accounts.map((a) => (
                <SegmentedControlItem
                  key={a.id}
                  value={a.id}
                  onClick={(e) => {
                    // Prevent the wrapping <Link> from firing when the user
                    // taps a tab; they want to switch tabs, not navigate.
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  <PersonName accountPersonId={a.person_id} />
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          )}
          <PocketMoneyWidgetTab account={active} />
          <RecentTransactions account={active} count={recentCount} />
        </Card>
      </Link>
    );
  }

  // "all" — also the standalone fallback when "perChild" is set: the
  // dashboard renders personId cards instead in that mode.
  return (
    <Link href="/pocket-money" className="block h-full">
      <Card className="p-4 space-y-3 h-full accent-border-top">
        <div className="space-y-3" data-all-kids="true">
          {accounts.map((a) => (
            <div key={a.id} className="space-y-1">
              {accounts.length > 1 && (
                <p className="text-xs font-medium text-muted-foreground">
                  <PersonName accountPersonId={a.person_id} />
                </p>
              )}
              <PocketMoneyWidgetTab account={a} />
              <RecentTransactions account={a} count={recentCount} />
            </div>
          ))}
        </div>
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

function RecentTransactions({ account, count }: { account: PocketMoneyAccount; count: number }) {
  const t = useTranslations("pocketMoney");
  const { data: txs = [] } = usePocketMoneyAccountTransactions(count > 0 ? account.id : undefined);
  if (count <= 0 || txs.length === 0) return null;
  const recent = [...txs]
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .slice(0, count);
  const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return (
    <ul className="space-y-0.5 pt-1">
      {recent.map((tx) => (
        <li key={tx.id} className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="flex-1 min-w-0 truncate">
            {tx.note?.trim() ? tx.note : t(TX_TYPE_KEYS[tx.type] as never)}
          </span>
          <span className="shrink-0">{dayFmt.format(new Date(tx.created_at))}</span>
          <span
            className={`shrink-0 tabular-nums font-medium ${
              tx.amount_cents >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {tx.amount_cents >= 0 ? "+" : "−"}
            {formatCents(Math.abs(tx.amount_cents), account.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PersonName({ accountPersonId }: { accountPersonId: string }) {
  const { data: people = [] } = usePeople();
  const p = people.find((pp) => pp.id === accountPersonId);
  return <span>{p?.name ?? accountPersonId.slice(0, 6)}</span>;
}

function PocketMoneyWidgetTab({ account }: { account: PocketMoneyAccount }) {
  const t = useTranslations("pocketMoney");
  const { data: goals = [] } = usePocketMoneyGoals(account.id);
  // The child's creature (RFC-017), when one is switched on: growing with
  // the task points earned -- and then the widget shows the points to spend
  // instead of the money -- or with the money in this account.
  const { data: creatures } = useCreatures();
  const creature = activeCreatureOf(creatures, account.person_id);
  const { totalsFor } = usePointTotals();
  const { ownedFor } = useOwnedItems();
  // During a festival, its outfit instead of the child's own item (RFC-020 §2.3).
  const festive = useFestivalLook();
  // Sleepy at night, happy once today's tasks are done; still, either way.
  const mood = useCreatureMood(account.person_id);
  const points = totalsFor(account.person_id);
  const stage = creatureStage({
    creature: creature ?? { grows_with: "money", best_tier: 1 },
    account,
    earnedPoints: points.earned,
  });
  const pointsMode = Boolean(creature) && stage.mode === "points";
  const primary = goals.find((g) => g.is_primary && g.status === "active");
  const nextAllowance =
    account.weekly_allowance_cents > 0
      ? nextAllowanceDate({
          lastAllowanceAt: account.last_allowance_at,
          intervalDays: account.allowance_interval_days ?? 7,
          dayOfWeek: account.allowance_day_of_week,
        })
      : null;
  const progress = primary
    ? Math.min(100, Math.floor((account.balance_cents * 100) / primary.target_amount_cents))
    : 0;

  return (
    <div className="flex items-center gap-3">
      {/* Small and on the dashboard all day: static, so a wall display's
          Pi does not redraw a breathing dragon for nobody. It moves only
          while it cheers for a task ticked off, a second and a half, and a
          new stage reached that way hatches right here. */}
      {creature ? (
        <ReactingCreature
          personId={account.person_id}
          compactStageUp
          species={creature.species}
          tier={stage.tier}
          style={creature.style}
          look={festive(readLook(creature.look, ownedFor(account.person_id)))}
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
          {pointsMode ? (
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
  );
}
