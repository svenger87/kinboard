"use client";

import { useRef } from "react";
import Link from "next/link";
import { PawPrint } from "lucide-react";
import { useTranslations } from "next-intl";
import { useHomeDataContext } from "@/components/layouts/home-data-context";
import { ReactingCreature } from "@/components/pocket-money/creature-reaction";
import { useCreatureCell } from "@/components/widgets/creatures-widget";
import { useCreatures } from "@/hooks/use-creatures";
import { usePointTotals } from "@/hooks/use-point-rewards";
import { usePocketMoneyAccounts } from "@/hooks/use-pocket-money-accounts";
import { creatureChildren } from "@/lib/creatures/surfaces";
import { rewardsHref } from "@/lib/device-owner";
import { formatCents } from "@/lib/pocket-money/format";
import type { Creature, PocketMoneyAccount, Person } from "@/types/database";
import type { HomeWidgetProps } from "./shared";
import { BoxCard, BoxHeader, boxPadding, SetUpBox, useEm, useShrinkStep } from "./rest-shared";

/** Richest first: the heading, then under each creature its name, stage and balance, one line fewer per step. */
const STEPS = [
  { header: true, lines: 3 },
  { header: false, lines: 3 },
  { header: false, lines: 2 },
  { header: false, lines: 1 },
  { header: false, lines: 0 },
] as const;

/** Each line's height in em of the box: the name 0.8em, the stage 0.6em, the balance 0.8em, at line-height 1.25. */
const LINE_EM = [1, 0.75, 1];
const GAP_EM = 0.4;
/** Below this a creature is not worth its lines: they go first. */
const MIN_CREATURE = 40;

/**
 * The largest creatures `n` cells can hold in `w` x `h`: the columns that
 * give the biggest square, each cell its creature over `textH` of lines.
 */
export function creatureGrid(n: number, w: number, h: number, gap: number, textH: number): { cols: number; size: number } {
  let best = { cols: 1, size: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - (cols - 1) * gap) / cols;
    const cellH = (h - (rows - 1) * gap) / rows;
    const size = Math.floor(Math.min(cellW, cellH - textH));
    if (size > best.size) best = { cols, size };
  }
  return best;
}

function Cell({
  person,
  creature,
  account,
  earned,
  balance,
  size,
  lines,
}: {
  person: Person;
  creature: Creature;
  account: PocketMoneyAccount | undefined;
  earned: number;
  balance: number;
  size: number;
  lines: number;
}) {
  const t = useTranslations("creaturesWidget");
  const { mood, stage, look, stageName, money } = useCreatureCell(person, creature, account, earned);
  return (
    <li className="flex min-w-0 justify-center">
      <Link
        href={rewardsHref(person.id)}
        className="flex min-h-[48px] min-w-[48px] max-w-full flex-col items-center justify-center rounded-xl text-center leading-[1.25] transition hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-month-primary/50"
        aria-label={t("openAria", { name: person.name })}
        data-testid="home-creature-cell"
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
        {lines >= 1 && (
          <span className="w-full truncate text-[0.8em] font-semibold" style={{ color: person.color }}>
            {person.name}
          </span>
        )}
        {lines >= 3 && (
          <span className="w-full truncate text-[0.6em] text-muted-foreground">{look.name ? `${look.name} · ${stageName}` : stageName}</span>
        )}
        {lines >= 2 && (
          <span className="text-[0.8em] font-bold tabular-nums">
            {money ? (
              formatCents(money.balance_cents, money.currency)
            ) : (
              <>
                <span aria-hidden="true">⭐ </span>
                {balance}
              </>
            )}
          </span>
        )}
      </Link>
    </li>
  );
}

/**
 * Every child's creature in a box (RFC-022 §3.1, fixed): as many columns as
 * make them largest, each opening the child's Rewards as on the card. The
 * heading goes first as the box shrinks, then the lines under each creature
 * (stage, balance, name), so the creatures keep the room. Static, like the
 * card. People come from Home's shared data.
 */
export function CreaturesHomeWidget({ box }: HomeWidgetProps) {
  const t = useTranslations("creaturesWidget");
  const { people, peopleLoading } = useHomeDataContext();
  const { data: creatures, isPending: creaturesPending, isError } = useCreatures();
  const { data: accounts = [] } = usePocketMoneyAccounts();
  const { totalsFor } = usePointTotals();
  const children = creatureChildren(people, creatures);

  const ref = useRef<HTMLDivElement>(null);
  const em = useEm(ref);
  const pad = boxPadding(box);
  const gap = GAP_EM * em;
  // A pixel short of the room, so rounding never tips a cell over the edge.
  const gridFor = (st: (typeof STEPS)[number]) =>
    creatureGrid(
      children.length,
      box.width - 2 * pad,
      box.height - 2 * pad - (st.header ? 48 + gap : 0) - 1,
      gap,
      LINE_EM.slice(0, st.lines).reduce((a, b) => a + b, 0) * em,
    );
  // The richest arrangement whose creatures are still a good size; measuring
  // (useShrinkStep) then only has to catch what the arithmetic missed.
  const minSize = Math.max(MIN_CREATURE, 2.4 * em);
  let first = STEPS.findIndex((st) => gridFor(st).size >= minSize);
  if (first < 0) first = STEPS.length - 1;
  const index = useShrinkStep(ref, STEPS.length - first, [box.width, box.height, children.length, em, first]);
  const step = first + index;
  const s = STEPS[step];

  if ((peopleLoading || creaturesPending) && !isError) {
    return <BoxCard box={box} ref={ref} testId="home-creatures" className="animate-pulse"><span /></BoxCard>;
  }
  if (children.length === 0) {
    return <SetUpBox box={box} icon={PawPrint} title={t("title")} description={t("empty")} href="/settings/creatures" testId="home-creatures" />;
  }

  const { cols, size } = gridFor(s);

  return (
    <BoxCard box={box} ref={ref} testId="home-creatures" step={step} className="gap-[0.4em]">
      {s.header && <BoxHeader icon={PawPrint} title={t("title")} href="/rewards" />}
      <ul
        className="grid flex-1 content-center"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}
        data-count={children.length}
      >
        {children.map(({ person, creature }) => (
          <Cell
            key={person.id}
            person={person}
            creature={creature}
            account={accounts.find((a) => a.person_id === person.id)}
            earned={totalsFor(person.id).earned}
            balance={totalsFor(person.id).balance}
            size={Math.max(16, size)}
            lines={s.lines}
          />
        ))}
      </ul>
    </BoxCard>
  );
}
