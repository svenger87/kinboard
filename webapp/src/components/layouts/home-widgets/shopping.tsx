"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ShoppingCart } from "lucide-react";
import { ChecklistItem } from "@/components/checklist-item";
import { useShoppingItems } from "@/hooks";
import { openShoppingItems, useTickShoppingItem } from "@/components/widgets/shopping-widget";
import { CountBadge, HomeEmptyLine, HomeList, HomeListFrame, HomeRowGap, TARGET_H } from "./list-shared";
import type { HomeWidgetProps } from "./shared";
import type { ShoppingItem } from "@/types/database";

type Item = ShoppingItem;

const keyOf = (i: Item) => i.id;

/**
 * What is still to buy, as many items as fit, each ticked off in one tap
 * with the Home card's own mutation. "+n" and the title open /shopping.
 */
export function ShoppingHomeWidget({ editing }: HomeWidgetProps) {
  const t = useTranslations("shoppingWidget");
  const { data: items } = useShoppingItems();
  const tick = useTickShoppingItem();
  const open = useMemo(() => openShoppingItems(items), [items]);

  const renderItem = (it: Item) => (
    <HomeRowGap>
      <ChecklistItem
        checked={false}
        onCheckedChange={() => void tick(it.id)}
        compact
        className={`${TARGET_H} gap-[0.5em] px-[0.6em] [&_label]:text-[0.9em] [&>span:last-child]:text-[0.8em]`}
        label={<span className="break-words leading-snug">{it.name}</span>}
        meta={it.quantity ? <span className="tabular-nums">{it.quantity}{it.unit ? ` ${it.unit}` : ""}</span> : undefined}
      />
    </HomeRowGap>
  );

  return (
    <HomeListFrame
      testId="home-widget-shopping"
      icon={ShoppingCart}
      title={t("title")}
      href="/shopping"
      badge={<CountBadge count={open.length} />}
      editing={editing}
    >
      <HomeList items={open} keyOf={keyOf} renderItem={renderItem} empty={<HomeEmptyLine text={t("emptyState")} />} href="/shopping" />
    </HomeListFrame>
  );
}
