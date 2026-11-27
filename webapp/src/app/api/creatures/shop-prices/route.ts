import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/db/server";
import { requireSession } from "@/lib/require-session";
import { requireSettingsUnlock } from "@/lib/settings-pin";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { isPrice, shopItem } from "@/lib/pocket-money/creatures/shop";

export const dynamic = "force-dynamic";

/**
 * PUT /api/creatures/shop-prices  body: { prices: { <item id>: <points> } }
 *
 * The family's own prices for the creature shop (Settings -> Creatures), in
 * place of the whole list. Behind the settings PIN: the shop is the child's,
 * its prices are the parents'. Every id must be an item still for sale and
 * every price a whole number from 1 to 10,000 (what a purchase row accepts),
 * or nothing is written: 400 unknown_item / bad_price. A price equal to the
 * standard one is not kept, and an empty list removes the setting, so the
 * shop is back to the standard prices. The stored prices are returned.
 *
 * What was bought before keeps the price it was bought for: each purchase
 * row holds its own cost.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const locked = await requireSettingsUnlock(auth.session);
  if (locked) return locked;

  const body = (await request.json().catch(() => null)) as { prices?: unknown } | null;
  const given = body?.prices;
  if (!given || typeof given !== "object" || Array.isArray(given)) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const prices: Record<string, number> = {};
  for (const [id, price] of Object.entries(given as Record<string, unknown>)) {
    const item = shopItem(id);
    if (!item || item.retired) return NextResponse.json({ error: "unknown_item", item: id }, { status: 400 });
    if (!isPrice(price)) return NextResponse.json({ error: "bad_price", item: id }, { status: 400 });
    if (price !== item.cost) prices[id] = price;
  }

  const familyId = auth.session.familyId;
  const db = createAdminClient() as any;
  const { error } =
    Object.keys(prices).length === 0
      ? await db.from("settings").delete().eq("family_id", familyId).eq("key", SETTINGS_KEYS.shopPrices)
      : await db
          .from("settings")
          .upsert(
            { family_id: familyId, key: SETTINGS_KEYS.shopPrices, value: prices, updated_at: new Date().toISOString() },
            { onConflict: "family_id,key" },
          );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prices });
}
