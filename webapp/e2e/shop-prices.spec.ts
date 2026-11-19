import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { buyItem } from "../src/lib/creatures/purchases";
import { MAX_PRICE, MIN_PRICE, SHOP_ITEMS, isPrice, priceOf, readShopPrices, shopItem } from "../src/lib/pocket-money/creatures/shop";
import { codeOnly } from "./source-helpers";

/**
 * The family's own shop prices: how the setting is read, what a purchase is
 * charged (buyItem with a stand-in database), and how the routes, the shop and
 * Settings -> Creatures fit together. shop-prices-ui.spec.ts drives a stack.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const cap = shopItem("cap")!;
const KID = "c1a0de00-0047-4000-8000-0000000000a1";

test("the stored prices: kept only for catalogue items, valid, and different from the standard price", () => {
  expect(cap.cost).toBe(25);
  expect(readShopPrices({ cap: 7, scarf: 20, rainbow: 10_000 })).toEqual({ cap: 7, rainbow: 10_000 });
  expect(readShopPrices({ cap: 0, scarf: 10_001, monocle: 2.5, medal: "5", nope: 3 })).toEqual({});
  for (const bad of [null, undefined, "cap", 7, [7], true]) expect(readShopPrices(bad), String(bad)).toEqual({});
  expect([MIN_PRICE, MAX_PRICE]).toEqual([1, 10_000]);
  expect([isPrice(1), isPrice(10_000), isPrice(0), isPrice(10_001), isPrice(1.5), isPrice("1")]).toEqual([true, true, false, false, false, false]);
});

test("an item's price: the family's own, or the standard one", () => {
  expect(priceOf(cap, { cap: 7 })).toBe(7);
  expect(priceOf(cap, {})).toBe(25);
  expect(priceOf(cap, null)).toBe(25);
  expect(priceOf(cap, { cap: 0 } as never)).toBe(25);
  // Every catalogue price is itself a valid price.
  for (const item of SHOP_ITEMS) expect(isPrice(item.cost), item.id).toBe(true);
});

test("a purchase is charged the family's price, never the request's; the standard one without", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const db = {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { data: { ok: true, purchase: { cost: args.p_cost }, balance: 0 }, error: null };
    },
  };
  await buyItem(db, { familyId: "f", personId: KID, itemId: "cap", prices: { cap: 7 } });
  await buyItem(db, { familyId: "f", personId: KID, itemId: "cap", prices: {} });
  await buyItem(db, { familyId: "f", personId: KID, itemId: "cap" });
  expect(calls.map((c) => c.p_cost)).toEqual([7, 25, 25]);
  const unknown = await buyItem(db, { familyId: "f", personId: KID, itemId: "crown", prices: { crown: 1 } });
  expect(unknown.status).toBe(404);
  expect(calls).toHaveLength(3);
});

test("the routes: prices only through their own route, behind the settings PIN, each checked; the purchase reads them", () => {
  const generic = codeOnly(read("src/app/api/settings/route.ts"));
  expect(generic).toContain('[SETTINGS_KEYS.shopPrices]: "/api/creatures/shop-prices",');
  const route = codeOnly(read("src/app/api/creatures/shop-prices/route.ts"));
  // The PIN before the body is even read.
  expect(route.indexOf("requireSettingsUnlock(auth.session)")).toBeGreaterThan(0);
  expect(route.indexOf("requireSettingsUnlock(auth.session)")).toBeLessThan(route.indexOf("request.json()"));
  expect(route).toContain('if (!item || item.retired) return NextResponse.json({ error: "unknown_item", item: id }, { status: 400 });');
  expect(route).toContain('if (!isPrice(price)) return NextResponse.json({ error: "bad_price", item: id }, { status: 400 });');
  expect(route).toContain("if (price !== item.cost) prices[id] = price;");
  expect(route).toContain('db.from("settings").delete().eq("family_id", familyId).eq("key", SETTINGS_KEYS.shopPrices)');
  const purchase = codeOnly(read("src/app/api/creatures/[personId]/purchases/route.ts"));
  expect(purchase).toContain(".eq(\"key\", SETTINGS_KEYS.shopPrices)");
  expect(purchase).toContain("prices: readShopPrices(setting?.value),");
  expect(codeOnly(read("src/lib/creatures/purchases.ts"))).toContain("p_cost: priceOf(item, input.prices),");
});

test("the shop shows the family's prices; Settings -> Creatures edits them", () => {
  const shop = codeOnly(read("src/components/pocket-money/creature-shop.tsx"));
  expect(shop).toContain("const price = (item: ShopItem) => priceOf(item, prices);");
  expect(shop).not.toMatch(/\.cost\b/);
  const hook = codeOnly(read("src/hooks/use-point-rewards.ts"));
  expect(hook).toContain("useSetting<unknown>(SETTINGS_KEYS.shopPrices, null, { refetchInterval: 60_000 })");
  expect(hook).toContain('const r = await fetch("/api/creatures/shop-prices", {');
  const card = codeOnly(read("src/components/settings/shop-prices-settings.tsx"));
  // No edit before the family's prices are in, nor while one is saving.
  expect(card).toContain("const locked = !ready || save.isPending;");
  expect(card).toContain("disabled={locked}");
  expect(card).toContain('<Card id="prices" data-setting="prices" className="p-4 space-y-4" data-testid="shop-prices">');
  expect(card).toContain("const next = raw === \"\" ? item.cost : Number(raw);");
  expect(card).toContain("if (next === item.cost) delete list[item.id];");
  expect(codeOnly(read("src/app/settings/creatures/page.tsx"))).toMatch(/<CreaturesHomeSettings \/>\s*<GrowthSettings \/>\s*<ShopPricesSettings \/>/);
  expect(read("src/lib/settings-search/registry.ts")).toContain('{ anchor: "prices", labelKey: "settings.creatures.pricesLabel", descriptionKey: "settings.creatures.pricesHint" },');
});

test("every string is there in every language", () => {
  for (const lang of ["en", "de", "fr"]) {
    const m = JSON.parse(read(`messages/${lang}.json`));
    const c = m.settings.creatures;
    for (const k of ["pricesLabel", "pricesHint", "pricesStandard", "pricesInvalid", "priceAria", "pricesReset"]) expect(c[k], `${lang} ${k}`).toBeTruthy();
    expect(c.pricesStandard, lang).toContain("{count}");
    expect(c.pricesInvalid, lang).toMatch(/\{min\}.*\{max\}/);
    expect(c.priceAria, lang).toContain("{item}");
    expect(m.settingsSearch.keywords.creatures_prices, lang).toBeTruthy();
  }
});
