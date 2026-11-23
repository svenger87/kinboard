"use client";

import { useRef } from "react";
import Link from "next/link";
import { PiggyBank } from "lucide-react";
import { useTranslations } from "next-intl";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { ReactingCreature } from "@/components/pocket-money/creature-reaction";
import { childHref, usePocketMoneyValue, type Child } from "@/components/widgets/pocket-money-widget";
import { useCreatures, usePocketMoneyAccounts } from "@/hooks";
import { useIsPluginEnabled } from "@/hooks/use-enabled-plugins";
import { useFitToBox } from "@/hooks/use-fit-to-box";
import { valueBox } from "@/lib/layouts/grid";
import { readLook } from "@/lib/pocket-money/creatures/look";
import { daysUntil } from "@/lib/pocket-money/allowance";
import { formatCents } from "@/lib/pocket-money/format";
import { pocketMoneyChildren } from "@/lib/pocket-money/widget-children";
import type { HomeWidgetProps } from "./shared";
import { boxPadding, personIdOf, SetUpBox, useEm } from "./rest-shared";

/** The creature beside the figure, in em of the fitted text, so it grows with it. */
const CREATURE_EM = 2.6;

/**
 * One child's figure: their creature (or the piggy bank), the money or the
 * points to spend, and under it their name with the goal they save for or
 * the next allowance -- the card's row, drawn in em so the box can fit it.
 */
function ChildValue({ child, name, fontPx }: { child: Child; name: string; fontPx: number }) {
  const t = useTranslations("pocketMoney");
  const { personId, account, creature, stage, pointsMode, points, primary, progress, nextAllowance, ownedFor, festive, mood } =
    usePocketMoneyValue(child);
  const size = Math.max(16, Math.round(fontPx * CREATURE_EM));
  const sub = pointsMode
    ? t("pointsBalanceLabel", { count: points.balance })
    : primary
      ? primary.name
      : account && nextAllowance
        ? t("nextAllowanceShort", {
            amount: formatCents(account.weekly_allowance_cents, account.currency),
            days: daysUntil(nextAllowance),
          })
        : null;
  return (
    <div className="flex items-center gap-[0.5em]" data-testid="home-pocket-money-child" data-person={personId}>
      {creature ? (
        <ReactingCreature
          personId={personId}
          compactStageUp
          species={creature.species}
          tier={stage.tier}
          style={creature.style}
          look={festive(readLook(creature.look, ownedFor(personId)))}
          mood={mood}
          size={size}
          animated={false}
          label={t(`species.${creature.species}.tier${stage.tier}` as never)}
          className="shrink-0"
        />
      ) : (
        <PiggyBank className="shrink-0 text-month-primary" style={{ width: size * 0.75, height: size * 0.75 }} aria-hidden="true" />
      )}
      <div className="flex flex-col">
        <span className="whitespace-nowrap text-[1.6em] font-bold leading-tight tabular-nums">
          {pointsMode ? (
            <>
              <span aria-hidden="true">⭐ </span>
              {points.balance}
            </>
          ) : (
            account && formatCents(account.balance_cents, account.currency)
          )}
        </span>
        <span className="whitespace-nowrap text-[0.6em] text-muted-foreground">
          {name}
          {sub ? ` · ${sub}` : ""}
        </span>
        {!pointsMode && primary && (
          <span className="mt-[0.2em] block h-[0.2em] overflow-hidden rounded-full bg-primary/20">
            <span className="block h-full bg-primary" style={{ width: `${progress}%` }} />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Pocket money in a box (RFC-022 §3.1, a value): a child's balance -- money,
 * or points for a creature that grows with them -- grown to fill its box.
 * One widget per child (`options.personId`), as the dashboard's per-child
 * cards; without one, every child, stacked (side by side in a wide box). The
 * whole box opens the child's page (pocket money, or their Rewards), so it
 * is one target of any size. People come from Home's shared data.
 */
export function PocketMoneyHomeWidget({ item, box }: HomeWidgetProps) {
  const t = useTranslations("dashboard.pluginDiscover");
  const enabled = useIsPluginEnabled("pocket-money");
  const { people } = useHomeDataContext();
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const { data: creatures } = useCreatures();
  const pinned = personIdOf(item);
  const all = pocketMoneyChildren(accounts, people, creatures);
  const children = pinned ? all.filter((c) => c.personId === pinned) : all;

  const rootRef = useRef<HTMLAnchorElement>(null);
  const em = useEm(rootRef, box);
  const ref = useRef<HTMLDivElement>(null);
  const pad = boxPadding(box);
  const inner = { width: box.width - 2 * pad, height: box.height - 2 * pad };
  const wide = children.length > 1 && inner.width > inner.height * 2.5;
  const key = children.map((c) => `${c.personId}:${c.account?.balance_cents ?? ""}`).join();
  const size = useFitToBox(ref, valueBox(inner, item.text), [key, wide]);

  if (!enabled) {
    return <SetUpBox box={box} icon={PiggyBank} title={t("pocketMoneyName")} description={t("pocketMoneyDisabled")} href="/settings/plugins" testId="home-pocket-money" />;
  }
  if (children.length === 0) {
    if (pinned) return null;
    return <SetUpBox box={box} icon={PiggyBank} title={t("pocketMoneyName")} description={t("pocketMoneyEmpty")} href="/settings/pocket-money" testId="home-pocket-money" />;
  }

  const href = children.length === 1 ? childHref(children[0]) : children.some((c) => c.account) ? "/pocket-money" : "/rewards";
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name ?? "";
  return (
    <Link
      ref={rootRef}
      href={href}
      className="accent-border-top flex size-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-card text-card-foreground elev-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      style={{ padding: pad }}
      data-testid="home-pocket-money"
      data-fills-box
    >
      <div
        ref={ref}
        className={`flex w-fit shrink-0 ${wide ? "flex-row gap-[1.2em]" : "flex-col gap-[0.6em]"}`}
        style={size !== null ? { fontSize: size } : { visibility: "hidden" }}
        data-fitted-content
      >
        {children.map((c) => (
          <ChildValue key={c.personId} child={c} name={nameOf(c.personId)} fontPx={size ?? em} />
        ))}
      </div>
    </Link>
  );
}
