"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AvatarDisplay } from "@/components/pocket-money/avatar-display";
import { nextAllowanceDate, daysUntil } from "@/lib/pocket-money/allowance";
import { usePocketMoneyAccounts, usePocketMoneyGoals, usePeople } from "@/hooks";
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
          <Tabs value={active.id} onValueChange={(v) => setActiveId(v)}>
            <TabsList>
              {accounts.map((a) => (
                <TabsTrigger
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
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
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
      <AvatarDisplay
        species={account.avatar_species}
        balanceCents={account.balance_cents}
        size={56}
        className="shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-bold">
          {formatCents(account.balance_cents, account.currency)}
        </p>
        {primary ? (
          <>
            <p className="text-[10px] text-muted-foreground truncate">{primary.name}</p>
            <Progress value={progress} className="h-1.5 mt-1" />
          </>
        ) : (
          nextAllowance && (
            // Only shown when no goal is competing for the line, so the
            // widget keeps its height on the dashboard grid.
            <p className="text-[10px] text-muted-foreground truncate">
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
