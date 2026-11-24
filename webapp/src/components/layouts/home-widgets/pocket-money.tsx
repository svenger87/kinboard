"use client";

import { useLayoutEffect, useRef, useState } from "react";
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
import { HomeCard, HomeSetUp, HOME_CARD_CORNER, useElementSize } from "./frame";
import { personIdOf, useEm } from "./rest-shared";

/** The creature beside the figure, in em of the fitted text, so it grows with it. */
const CREATURE_EM = 3;

/**
 * One child's figure: their creature (or the piggy bank), the money or the
 * points to spend, and under it their name with the goal they save for or
 * the next allowance -- the card's row, drawn in em so the box can fit it.
 */
function ChildValue({ child, name, fontPx, lines }: { child: Child; name: string; fontPx: number; lines: boolean }) {
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
        <span className="whitespace-nowrap home-display font-bold leading-tight tabular-nums">
          {pointsMode ? (
            <>
              <span aria-hidden="true">⭐ </span>
              {points.balance}
            </>
          ) : (
            account && formatCents(account.balance_cents, account.currency)
          )}
        </span>
        {lines && (
          <span className="whitespace-nowrap home-label text-muted-foreground">
            {name}
            {sub ? ` · ${sub}` : ""}
          </span>
        )}
        {lines && !pointsMode && primary && (
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
  const em = useEm(rootRef);
  const ref = useRef<HTMLDivElement>(null);
  // The room under the title row, measured: the figures grow into that, never into the title row.
  const roomRef = useRef<HTMLDivElement>(null);
  // `present` follows what is drawn: the room mounts only once there is a child to show.
  const inner = useElementSize(roomRef, enabled && children.length > 0) ?? { width: 0, height: 0 };
  const wide = children.length > 1 && inner.width > inner.height * 2.5;
  const key = children.map((c) => `${c.personId}:${c.account?.balance_cents ?? ""}`).join();
  // The name and the goal or allowance under each figure only where each
  // child has four lines of the box's text: a small box is the figure alone.
  const lines = (wide ? inner.height : inner.height / Math.max(1, children.length)) >= 4 * em;
  const size = useFitToBox(ref, valueBox(inner, item.text), [key, wide, lines, box.width, box.height]);
  // The title row goes when the figures cannot fit under it even at their smallest
  // (a small box, several children): the figures are the widget. Checked again when the box or the money changes.
  const [bare, setBare] = useState(false);
  useLayoutEffect(() => setBare(false), [box.width, box.height, key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const content = ref.current;
    const room = roomRef.current;
    if (bare || size === null || !content || !room) return;
    if (content.offsetHeight > room.clientHeight + 1 || content.offsetWidth > room.clientWidth + 1) setBare(true);
  });

  if (!enabled) {
    return <HomeSetUp icon={PiggyBank} title={t("pocketMoneyName")} description={t("pocketMoneyDisabled")} href="/settings/plugins" testId="home-pocket-money" />;
  }
  if (children.length === 0) {
    if (pinned) return null;
    return <HomeSetUp icon={PiggyBank} title={t("pocketMoneyName")} description={t("pocketMoneyEmpty")} href="/settings/pocket-money" testId="home-pocket-money" />;
  }

  const href = children.length === 1 ? childHref(children[0]) : children.some((c) => c.account) ? "/pocket-money" : "/rewards";
  const nameOf = (id: string) => people?.find((p) => p.id === id)?.name ?? "";
  // The card's title: the child's name for a widget of one child, as the per-child card heads it.
  const title = pinned ? nameOf(children[0].personId) || t("pocketMoneyName") : t("pocketMoneyName");
  return (
    <Link
      ref={rootRef}
      href={href}
      className={`block size-full ${HOME_CARD_CORNER} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
      data-testid="home-pocket-money"
    >
      <HomeCard icon={PiggyBank} title={title} chevron headless={bare}>
        <div ref={roomRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div
            ref={ref}
            className={`flex w-fit shrink-0 ${wide ? "flex-row gap-[1.2em]" : "flex-col gap-[0.6em]"}`}
            style={size !== null ? { fontSize: size } : { visibility: "hidden" }}
            data-fitted-content
          >
            {children.map((c) => (
              <ChildValue key={c.personId} child={c} name={nameOf(c.personId)} fontPx={size ?? em} lines={lines && (size ?? em) >= em} />
            ))}
          </div>
        </div>
      </HomeCard>
    </Link>
  );
}
