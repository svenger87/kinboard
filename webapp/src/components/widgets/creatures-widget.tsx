"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PawPrint } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WidgetCard } from "@/components/widget-card";
import { ReactingCreature } from "@/components/pocket-money/creature-reaction";
import { useCreatureMood } from "@/hooks/use-creature-mood";
import { useCreatures } from "@/hooks/use-creatures";
import { usePointTotals } from "@/hooks/use-point-rewards";
import { usePocketMoneyAccounts } from "@/hooks/use-pocket-money-accounts";
import { usePeople } from "@/hooks";
import { creatureStage } from "@/lib/creatures/stage";
import { creatureChildren } from "@/lib/creatures/surfaces";
import { rewardsHref } from "@/lib/device-owner";
import { readLook } from "@/lib/pocket-money/creatures/look";
import { formatCents } from "@/lib/pocket-money/format";
import { cn } from "@/lib/utils";
import type { Creature, PocketMoneyAccount, Person } from "@/types/database";

/**
 * Every child's creature side by side (RFC-017 §4): the wall display's main
 * place for them. Each shows the child's name, the stage it has reached and
 * what the child has to spend -- their points, or the money in their account
 * for a creature that grows with money, since that is what it grows with --
 * and opens the child's Rewards page when tapped.
 *
 * Static, like the pocket-money widget: a wall display's Pi does not redraw
 * six breathing creatures for nobody. A creature moves only while it cheers
 * for a task ticked off (stores/creature-reactions.ts), a second and a half,
 * and a new stage reached that way hatches right here. Sleepy at night and
 * happy once the day's tasks are done (useCreatureMood), still either way.
 *
 * Up to two children share one grid cell; from three on the card takes two
 * columns on anything wider than a phone, so four creatures on a wall are
 * not squeezed into a quarter of it.
 */
export function CreaturesWidget() {
  const t = useTranslations("creaturesWidget");
  const { data: people, isPending: peoplePending } = usePeople();
  const { data: creatures, isPending: creaturesPending, isError } = useCreatures();
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const { totalsFor } = usePointTotals();

  if ((peoplePending || creaturesPending) && !isError) {
    return (
      <Card className="p-4 accent-border-top" data-testid="creatures-widget-loading" aria-busy="true">
        <Skeleton className="h-6 w-32" />
        <div className="mt-4 flex gap-4">
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="size-20 rounded-full" />
        </div>
      </Card>
    );
  }

  const children = creatureChildren(people, creatures);

  if (children.length === 0) {
    return (
      <Card
        className="p-4 h-full flex items-start gap-3 border-dashed border-month-primary/30 bg-month-primary/5"
        data-testid="creatures-widget-empty"
      >
        <div className="p-2 rounded-lg bg-month-primary/10 shrink-0">
          <PawPrint className="size-5 text-month-primary" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{t("title")}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t("empty")}</p>
          <Link
            href="/settings/creatures"
            className="mt-2 inline-block text-xs font-medium text-month-primary underline-offset-2 hover:underline"
          >
            {t("emptyCta")}
          </Link>
        </div>
      </Card>
    );
  }

  const many = children.length >= 3;
  return (
    <WidgetCard
      icon={PawPrint}
      title={t("title")}
      className={cn("h-full", many && "sm:col-span-2")}
    >
      <ul
        className="grid gap-x-2 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(5.5rem,1fr))]"
        data-testid="creatures-widget"
        data-count={children.length}
      >
        {children.map(({ person, creature }) => (
          <CreatureCell
            key={person.id}
            person={person}
            creature={creature}
            account={accounts.find((a) => a.person_id === person.id)}
            earned={totalsFor(person.id).earned}
            balance={totalsFor(person.id).balance}
            size={many ? 72 : 88}
          />
        ))}
      </ul>
    </WidgetCard>
  );
}

function CreatureCell({
  person,
  creature,
  account,
  earned,
  balance,
  size,
}: {
  person: Person;
  creature: Creature;
  account: PocketMoneyAccount | undefined;
  earned: number;
  balance: number;
  size: number;
}) {
  const t = useTranslations("creaturesWidget");
  const tPM = useTranslations("pocketMoney");
  const mood = useCreatureMood(person.id);
  const stage = creatureStage({ creature, account, earnedPoints: earned });
  const look = readLook(creature.look);
  const stageName = tPM(`species.${creature.species}.tier${stage.tier}` as never);
  const money = stage.mode === "money" && account;

  return (
    <li className="min-w-0">
      <Link
        href={rewardsHref(person.id)}
        className="flex flex-col items-center gap-1 rounded-xl p-1 text-center transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50"
        aria-label={t("openAria", { name: person.name })}
        data-testid="creature-cell"
        data-person={person.id}
      >
        <ReactingCreature
          personId={person.id}
          compactStageUp
          species={creature.species}
          tier={stage.tier}
          style={creature.style}
          look={look}
          mood={mood}
          size={size}
          animated={false}
          label={stageName}
          className="shrink-0"
        />
        <span className="w-full truncate text-sm font-semibold" style={{ color: person.color }}>
          {person.name}
        </span>
        <span className="w-full truncate text-2xs text-muted-foreground" data-testid="creature-stage">
          {look.name ? `${look.name} · ${stageName}` : stageName}
        </span>
        <span className="text-sm font-bold tabular-nums" data-testid="creature-balance">
          {money ? (
            formatCents(account.balance_cents, account.currency)
          ) : (
            <>
              <span aria-hidden="true">⭐ </span>
              {balance}
            </>
          )}
        </span>
      </Link>
    </li>
  );
}
