/**
 * The festival kits (RFC-020): every festival that has its art, from
 * ./all.ts, and what the rest of the app asks of them. A festival without a
 * kit can't be ticked in Settings or come on by the date: a festival ticked
 * by default but not drawn yet would win its days over Christmas and show
 * nothing at all.
 */

import { FESTIVALS, type FestivalId } from "@/lib/festivals";
import { kitCss, type FestivalItem, type FestivalKit } from "@/lib/festivals/kit";
import * as ALL from "./all";

const BY_ID = new Map<FestivalId, FestivalKit>(Object.values(ALL).map((kit) => [kit.id, kit]));

/** Every kit, drafts included, by id. */
export const FESTIVAL_KITS: Readonly<Partial<Record<FestivalId, FestivalKit>>> = Object.fromEntries(BY_ID);

/** A festival's kit, or undefined while it isn't drawn. */
export function festivalKit(id: FestivalId | null | undefined): FestivalKit | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** The festivals that have a kit, in FESTIVALS' order. */
export const DRAWN_FESTIVALS: readonly FestivalId[] = FESTIVALS.filter((id) => BY_ID.has(id));

/** The festivals that can be ticked and come on by the date: drawn, and not a draft. */
export const BUILT_FESTIVALS: readonly FestivalId[] = DRAWN_FESTIVALS.filter((id) => !BY_ID.get(id)?.draft);

/** The festivals' own items (not the shop's they borrow), by item id. */
const ITEMS = new Map<string, FestivalItem>(
  [...BY_ID.values()].flatMap((kit) => kit.outfit.filter((item) => item.draw).map((item) => [item.item, item] as const)),
);

/** A festival's own drawn item, for items.tsx. */
export function festivalItem(id: string): FestivalItem | undefined {
  return ITEMS.get(id);
}

/**
 * Every kit's wash and dressing as one stylesheet, put in the page by the
 * root layout ahead of the app: present from the first paint, keyed off
 * `<html data-festival>`, and inert for a festival that isn't on.
 */
export const FESTIVAL_CSS: string = DRAWN_FESTIVALS.map((id) => kitCss(BY_ID.get(id)!)).join("\n");
