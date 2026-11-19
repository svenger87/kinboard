/**
 * The creature shop's catalogue (RFC-017 §5): what a child can buy for their
 * creature with task points, in four slots of the look -- something on the
 * head, on the face, round the neck, and a background behind.
 *
 * The ids are stable: they are stored in point_purchases.item_id and in the
 * creature's look, and a backup carries both. Never rename one; retire an
 * item by leaving it out of the shop (`retired`), so it stays owned and worn.
 * The price is the server's: POST /api/creatures/[personId]/purchases passes
 * it to purchase_person_point_item(), and the row keeps what it cost on the
 * day. Each item's `cost` here is the standard price; a family can set its
 * own for any item (setting `shop_prices`, Settings -> Creatures, behind the
 * settings PIN), and priceOf() is what the shop shows and the server charges.
 *
 * No React here: the API route and the look validation import it. The
 * drawings are in ./items.tsx.
 */

export const SHOP_SLOTS = ["head", "face", "neck", "background"] as const;
export type ShopSlot = (typeof SHOP_SLOTS)[number];

export interface ShopItem {
  id: string;
  slot: ShopSlot;
  /** In task points. */
  cost: number;
  /** Still owned and worn, but no longer for sale. */
  retired?: boolean;
}

export const SHOP_ITEMS: ReadonlyArray<ShopItem> = [
  { id: "cap", slot: "head", cost: 25 },
  { id: "wizard_hat", slot: "head", cost: 40 },
  { id: "pirate_hat", slot: "head", cost: 40 },
  { id: "headphones", slot: "head", cost: 30 },
  { id: "flower_crown", slot: "head", cost: 35 },
  { id: "space_helmet", slot: "head", cost: 60 },

  { id: "heart_glasses", slot: "face", cost: 20 },
  { id: "monocle", slot: "face", cost: 25 },
  { id: "star_glasses", slot: "face", cost: 30 },

  { id: "scarf", slot: "neck", cost: 20 },
  { id: "cape", slot: "neck", cost: 45 },
  { id: "medal", slot: "neck", cost: 35 },
  { id: "bow_tie", slot: "neck", cost: 20 },

  { id: "starry_sky", slot: "background", cost: 60 },
  { id: "rainbow", slot: "background", cost: 80 },
  { id: "beach", slot: "background", cost: 80 },
  { id: "outer_space", slot: "background", cost: 120 },
  { id: "forest", slot: "background", cost: 70 },
  { id: "snow", slot: "background", cost: 70 },
];

const BY_ID: ReadonlyMap<string, ShopItem> = new Map(SHOP_ITEMS.map((i) => [i.id, i]));

export function shopItem(id: unknown): ShopItem | undefined {
  return typeof id === "string" ? BY_ID.get(id) : undefined;
}

/** The items of one slot, in the shop's order. */
export function itemsIn(slot: ShopSlot): ReadonlyArray<ShopItem> {
  return SHOP_ITEMS.filter((i) => i.slot === slot);
}

/** Whether an id is a catalogue item that goes in this slot. */
export function isItemFor(slot: ShopSlot, id: unknown): boolean {
  return shopItem(id)?.slot === slot;
}

/** The ids a child owns, from their purchase rows. */
export function ownedSet(purchases: ReadonlyArray<{ item_id: string }> | null | undefined): ReadonlySet<string> {
  return new Set((purchases ?? []).map((p) => p.item_id));
}

/**
 * A family's own prices (setting `shop_prices`): item id -> task points, only
 * for items whose price differs from the standard one.
 */
export type ShopPrices = Readonly<Record<string, number>>;

/** What point_purchases.cost accepts (migrations/078_point_purchases.sql). */
export const MIN_PRICE = 1;
export const MAX_PRICE = 10_000;

export function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_PRICE && value <= MAX_PRICE;
}

/**
 * The stored setting, keeping only prices for items in the catalogue that are
 * valid and differ from the standard price; anything else reads as standard.
 */
export function readShopPrices(value: unknown): ShopPrices {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const prices: Record<string, number> = {};
  for (const [id, price] of Object.entries(value as Record<string, unknown>)) {
    const item = shopItem(id);
    if (item && isPrice(price) && price !== item.cost) prices[id] = price;
  }
  return prices;
}

/** What an item costs this family: its own price, or the standard one. */
export function priceOf(item: ShopItem, prices?: ShopPrices | null): number {
  const own = prices?.[item.id];
  return isPrice(own) ? own : item.cost;
}
