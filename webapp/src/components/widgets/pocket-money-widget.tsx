"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AvatarDisplay } from "@/components/pocket-money/avatar-display";
import { usePocketMoneyAccounts, usePocketMoneyGoals, usePeople } from "@/hooks";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { formatCents } from "@/lib/pocket-money/format";
import type { PocketMoneyAccount } from "@/types/database";

export function PocketMoneyWidget() {
  const enabled = useIsPluginEnabled("pocket-money");
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeId && accounts.length > 0) setActiveId(accounts[0].id);
  }, [accounts, activeId]);

  if (!enabled) return null;
  if (accounts.length === 0) return null;

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0];

  return (
    <Link href="/pocket-money" className="block h-full">
      <GlassCard className="p-4 space-y-3 h-full">
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
      </GlassCard>
    </Link>
  );
}

function PersonName({ accountPersonId }: { accountPersonId: string }) {
  const { data: people = [] } = usePeople();
  const p = people.find((pp) => pp.id === accountPersonId);
  return <span>{p?.name ?? accountPersonId.slice(0, 6)}</span>;
}

function PocketMoneyWidgetTab({ account }: { account: PocketMoneyAccount }) {
  const { data: goals = [] } = usePocketMoneyGoals(account.id);
  const primary = goals.find((g) => g.is_primary && g.status === "active");
  const progress = primary
    ? Math.min(100, Math.floor((account.balance_cents * 100) / primary.target_amount_cents))
    : 0;

  return (
    <div className="flex items-center gap-3">
      <AvatarDisplay
        species={account.avatar_species}
        lifetimeSavedCents={account.lifetime_saved_cents}
        size={56}
        className="shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-bold">
          {formatCents(account.balance_cents, account.currency)}
        </p>
        {primary && (
          <>
            <p className="text-[10px] text-muted-foreground truncate">{primary.name}</p>
            <Progress value={progress} className="h-1.5 mt-1" />
          </>
        )}
      </div>
    </div>
  );
}
