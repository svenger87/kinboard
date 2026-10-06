"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ReactingCreature } from "@/components/pocket-money/creature-reaction";
import { nextAllowanceDate, daysUntil } from "@/lib/pocket-money/allowance";
import { usePocketMoneyAccounts, usePocketMoneyGoals, usePeople, usePointTotals } from "@/hooks";
import { avatarStage } from "@/lib/pocket-money/points";
import { readLook } from "@/lib/pocket-money/creatures/look";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { PluginDiscoverCard } from "./plugin-discover-card";
import { formatCents } from "@/lib/pocket-money/format";
import type { PocketMoneyAccount } from "@/types/database";

export function PocketMoneyWidget() {
  const t = useTranslations("dashboard.pluginDiscover");
  const enabled = useIsPluginEnabled("pocket-money");
  const { data: accounts = [] } = usePocketMoneyAccounts();
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
  if (accounts.length === 0) {
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
      </Card>
    </Link>
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
  // Points mode (discussion #349): the stage follows the task points earned,
  // and the widget shows the points to spend instead of the money.
  const { totalsFor } = usePointTotals();
  const pointsMode = account.reward_mode === "points";
  const points = totalsFor(account.person_id, account.id);
  const stage = avatarStage({
    mode: account.reward_mode,
    balanceCents: account.balance_cents,
    earnedPoints: points.earned,
    storedBestTier: account.best_tier,
  });
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
      <ReactingCreature
        personId={account.person_id}
        compactStageUp
        species={account.avatar_species}
        tier={stage.tier}
        style={account.avatar_style}
        look={readLook(account.avatar_look)}
        size={56}
        animated={false}
        label={t(`species.${account.avatar_species}.tier${stage.tier}` as never)}
        className="shrink-0"
      />
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
