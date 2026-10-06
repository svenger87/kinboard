/** @jsxImportSource react */
import { test, expect } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CreatureAvatar } from "../src/components/pocket-money/creature-avatar";
import {
  DRAWN_SPECIES_IDS,
  DRAWN_STYLES,
  SHOP_ITEMS,
  SHOP_SLOTS,
  itemsIn,
  readLook,
  restorableLook,
  validateLook,
  wornNotOwned,
  type CreatureLook,
} from "../src/lib/pocket-money/creatures";
import { BACKDROP } from "../src/lib/pocket-money/creatures/items";
import { parseCreaturePatch } from "../src/lib/creatures/rules";
import { pointTotals } from "../src/lib/pocket-money/points";
import { buyItem, refundPurchase } from "../src/lib/creatures/purchases";
import type { AvatarTier } from "../src/lib/pocket-money/types";
import { codeOnly } from "./source-helpers";
import en from "../messages/en.json";
import de from "../messages/de.json";
import fr from "../messages/fr.json";

/**
 * The creature shop (RFC-017 §5), below the database: the catalogue, what a
 * look may wear, the balance with purchases, every item drawn on every
 * creature in every style, and the files that hold the rules. The database
 * and the browser are creature-shop-live.spec.ts; the PIN boundary is
 * pocket-money-pin.spec.ts.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test.describe("the catalogue", () => {
  test("the items, their slots and their prices, as decided", () => {
    const table = Object.fromEntries(SHOP_ITEMS.map((i) => [i.id, `${i.slot}:${i.cost}`]));
    expect(table).toEqual({
      cap: "head:25", wizard_hat: "head:40", pirate_hat: "head:40", headphones: "head:30", flower_crown: "head:35", space_helmet: "head:60",
      heart_glasses: "face:20", monocle: "face:25", star_glasses: "face:30",
      scarf: "neck:20", cape: "neck:45", medal: "neck:35", bow_tie: "neck:20",
      starry_sky: "background:60", rainbow: "background:80", beach: "background:80", outer_space: "background:120", forest: "background:70", snow: "background:70",
    });
  });

  test("every id fits the database's check, and none is a free accessory's name", () => {
    const sql = read("docker/migration_zzzzzzzzz_point_purchases.sql");
    const pattern = /item_id ~ '([^']+)'/.exec(sql)![1];
    for (const item of SHOP_ITEMS) {
      expect(new RegExp(pattern).test(item.id), item.id).toBe(true);
      expect(item.cost, item.id).toBeGreaterThanOrEqual(1);
      expect(item.cost, item.id).toBeLessThanOrEqual(10_000);
    }
    expect(new Set(SHOP_ITEMS.map((i) => i.id)).size).toBe(SHOP_ITEMS.length);
  });

  test("every item and slot has a name in en, de and fr, the German ones natural", () => {
    for (const [lang, messages] of [["en", en], ["de", de], ["fr", fr]] as const) {
      const shop = (messages as unknown as { shop: { items: Record<string, string>; slots: Record<string, string> } }).shop;
      for (const item of SHOP_ITEMS) expect(shop.items[item.id], `${lang} ${item.id}`).toBeTruthy();
      for (const slot of SHOP_SLOTS) expect(shop.slots[slot], `${lang} ${slot}`).toBeTruthy();
    }
    expect(de.shop.items).toMatchObject({
      cap: "Kappe", wizard_hat: "Zauberhut", pirate_hat: "Piratenhut", headphones: "Kopfhörer", flower_crown: "Blumenkranz",
      space_helmet: "Weltraumhelm", heart_glasses: "Herzbrille", monocle: "Monokel", star_glasses: "Sternenbrille",
      scarf: "Schal", cape: "Umhang", medal: "Medaille", bow_tie: "Fliege", starry_sky: "Sternenhimmel",
      rainbow: "Regenbogen", beach: "Strand", outer_space: "Weltall", forest: "Wald", snow: "Schnee",
    });
    expect([en.shop.title, de.shop.title, fr.shop.title]).toEqual(["Shop", "Shop", "Boutique"]);
  });
});

test.describe("what a look may wear", () => {
  test("a catalogue item in its own slot passes; another slot's, or an unknown one, is refused", () => {
    expect(validateLook({ head: "cap", face: "monocle", neck: "cape", background: "snow" })).toEqual({
      ok: true,
      look: { head: "cap", face: "monocle", neck: "cape", background: "snow" },
    });
    expect(validateLook({ head: "monocle" }).ok).toBe(false);
    expect(validateLook({ background: "cap" }).ok).toBe(false);
    expect(validateLook({ face: "laser_eyes" }).ok).toBe(false);
    expect(validateLook({ head: 3 }).ok).toBe(false);
  });

  test("wearing is the child's own change: no PIN", () => {
    const r = parseCreaturePatch({ look: { head: "wizard_hat" } });
    expect(r.ok && !r.parental).toBe(true);
  });

  test("only owned items: the server's check names what is not owned", () => {
    const look: CreatureLook = { head: "cap", face: "monocle", background: "beach", body: "#56B6E8" };
    expect(wornNotOwned(look, new Set(["cap", "beach"]))).toEqual(["monocle"]);
    expect(wornNotOwned(look, new Set(["cap", "monocle", "beach"]))).toEqual([]);
    expect(wornNotOwned({ body: "#56B6E8" }, new Set())).toEqual([]);
  });

  test("the screens draw leniently: unowned and unknown items are left off, the rest of the look kept", () => {
    const stored = { name: "Funkel", head: "cap", face: "monocle", neck: "jetpack", background: "snow" };
    expect(readLook(stored, new Set(["cap", "snow"]))).toEqual({ name: "Funkel", head: "cap", background: "snow" });
    // purchases not loaded yet: nothing from the shop
    expect(readLook(stored)).toEqual({ name: "Funkel" });
    // a restore keeps known items (the purchases come with it) and drops unknown ones
    expect(restorableLook(stored)).toEqual({ name: "Funkel", head: "cap", face: "monocle", background: "snow" });
  });
});

test.describe("the balance with purchases (pointTotals, mirroring point_person_totals)", () => {
  test("earned - approved - purchased, pending held, never below zero", () => {
    const t = pointTotals(200, [{ cost_points: 50, status: "approved" }, { cost_points: 30, status: "pending" }, { cost_points: 99, status: "denied" }], [{ cost: 60 }, { cost: 20 }]);
    expect(t).toEqual({ earned: 200, spent: 50, purchased: 80, pending: 30, balance: 70, owed: 0, available: 40 });
  });

  test("a task un-ticked after its points were spent in the shop: owed, nothing to spend", () => {
    expect(pointTotals(40, [], [{ cost: 60 }])).toMatchObject({ balance: 0, owed: 20, available: 0 });
  });

  test("without purchases it is what it was", () => {
    expect(pointTotals(100, [{ cost_points: 60, status: "approved" }])).toMatchObject({ purchased: 0, balance: 40 });
  });
});

test.describe("buying: the price is the catalogue's", () => {
  const recorder = () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    return {
      calls,
      client: { rpc: (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return Promise.resolve({ data: { ok: true, purchase: {}, balance: 0 }, error: null }); } },
    };
  };
  const PERSON = "c1a0de00-0217-4000-8000-0000000000a1";

  test("the function gets the catalogue's price for the item", async () => {
    const { calls, client } = recorder();
    expect((await buyItem(client, { familyId: "f", personId: PERSON, itemId: "outer_space" })).status).toBe(201);
    expect(calls).toEqual([["purchase_person_point_item", { p_family_id: "f", p_person_id: PERSON, p_item_id: "outer_space", p_cost: 120 }]]);
  });

  test("an unknown item or a bad person never reaches the database", async () => {
    const { calls, client } = recorder();
    expect(await buyItem(client, { familyId: "f", personId: PERSON, itemId: "gold_bar" })).toEqual({ status: 404, body: { error: "no_item" } });
    expect((await buyItem(client, { familyId: "f", personId: "nope", itemId: "cap" })).status).toBe(404);
    expect(calls).toEqual([]);
  });

  test("a refund names only the purchase and the session's family", async () => {
    const { calls, client } = recorder();
    await refundPurchase(client, { familyId: "f", purchaseId: PERSON });
    expect(calls).toEqual([["refund_person_point_purchase", { p_family_id: "f", p_purchase_id: PERSON }]]);
    expect(await refundPurchase(client, { familyId: "f", purchaseId: "1; drop" })).toEqual({ status: 404, body: { error: "not found" } });
    expect(calls).toHaveLength(1);
    const route = codeOnly(read("src/app/api/creatures/purchases/[id]/route.ts"));
    expect(route).toContain("familyId: auth.session.familyId");
    expect(route).toContain("requireSettingsUnlock");
  });

  test("the route takes only item_id from the body", () => {
    const route = codeOnly(read("src/app/api/creatures/[personId]/purchases/route.ts"));
    expect(route).toContain("familyId: auth.session.familyId");
    expect(route).toContain("itemId: body.item_id");
    expect(route).not.toMatch(/\bcost\b|price/);
    expect(route).not.toContain("requireSettingsUnlock");
  });

  test("the creature write checks ownership before it writes the look", () => {
    const server = codeOnly(read("src/lib/creatures/server.ts"));
    const check = server.indexOf("wornNotOwned(look, owned)");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(server.indexOf('.from("creatures")\n    .update(patch)'));
    expect(server).toContain('error: "not_owned"');
  });
});

// ---------------------------------------------------------------------------
// Drawn: every item on every creature, in every style
// ---------------------------------------------------------------------------

const render = (props: Parameters<typeof CreatureAvatar>[0]) => renderToStaticMarkup(createElement(CreatureAvatar, props));
const ids = (html: string) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const refs = (html: string) => [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
const count = (html: string, s: string) => html.split(s).length - 1;

test.describe("the render matrix: item × creature × style", () => {
  for (const species of DRAWN_SPECIES_IDS) {
    test(species, () => {
      for (const style of DRAWN_STYLES) {
        for (const item of SHOP_ITEMS) {
          for (const tier of [1, 2, 3, 6, 8] as AvatarTier[]) {
            const html = render({ species, tier, style, look: { [item.slot]: item.id }, animated: false });
            const where = `${species} ${style} ${item.id} stage ${tier}`;
            expect(html, where).not.toMatch(/NaN|undefined|null|Infinity/);
            // every id unique, every url(#…) resolves
            const own = ids(html);
            expect(new Set(own).size, where).toBe(own.length);
            for (const r of refs(html)) expect(own, `${where} → #${r}`).toContain(r);
            const drawn = html.includes(`data-item="${item.id}"`);
            if (item.slot === "background") {
              // on every stage, the egg too, and behind everything else
              expect(drawn, where).toBe(true);
              expect(html.indexOf('data-slot="background"'), where).toBeLessThan(html.indexOf("creature-ground"));
            } else if (tier === 1) {
              // the egg wears nothing, like the free accessories
              expect(drawn, where).toBe(false);
            } else if (tier === 2 && item.slot === "neck") {
              // the hatchling's neck is in the shell: drawn, and hidden by it (no assertion either way)
            } else {
              expect(drawn, where).toBe(true);
            }
          }
        }
      }
    });
  }

  test("a hat from the shop replaces the free bow, party hat and flower, and the crown of stage 8", () => {
    for (const species of DRAWN_SPECIES_IDS) {
      for (const acc of ["bow", "hat", "flower"] as const) {
        const html = render({ species, tier: 5, style: "sticker", look: { acc, head: "cap" } });
        expect(html, `${species} ${acc}`).not.toContain(`data-acc="${acc}"`);
        expect(html, `${species} ${acc}`).toContain('data-item="cap"');
        expect(render({ species, tier: 5, style: "sticker", look: { acc } }), `${species} ${acc} alone`).toContain(`data-acc="${acc}"`);
      }
      expect(render({ species, tier: 8, style: "gumdrop", look: {} }), species).toContain('data-part="crown"');
      expect(render({ species, tier: 8, style: "gumdrop", look: { head: "pirate_hat" } }), species).not.toContain('data-part="crown"');
    }
  });

  test("glasses from the shop replace the sunglasses and leave the eyes showing", () => {
    for (const species of DRAWN_SPECIES_IDS) {
      const sun = render({ species, tier: 5, style: "gumdrop", look: { acc: "glasses" } });
      expect(sun, species).toContain('data-acc="glasses"');
      expect(count(sun, "creature-blink"), species).toBe(0);
      const hearts = render({ species, tier: 5, style: "gumdrop", look: { acc: "glasses", face: "heart_glasses" } });
      expect(hearts, species).not.toContain('data-acc="glasses"');
      expect(hearts, species).toContain('data-item="heart_glasses"');
      expect(count(hearts, "creature-blink"), species).toBe(2);
    }
  });

  test("a species' own headwear and neckwear give way to what was bought", () => {
    const has = (species: string, tier: AvatarTier, look: CreatureLook, part: string) =>
      render({ species, tier, style: "gumdrop", look }).includes(`data-part="${part}"`);
    expect(has("princess", 5, {}, "tiara")).toBe(true);
    expect(has("princess", 5, { head: "wizard_hat" }, "tiara")).toBe(false);
    expect(has("prince", 5, {}, "circlet")).toBe(true);
    expect(has("prince", 5, { head: "headphones" }, "circlet")).toBe(false);
    expect(has("cat", 6, {}, "scarf")).toBe(true);
    expect(has("cat", 6, { neck: "medal" }, "scarf")).toBe(false);
    expect(has("penguin", 6, { neck: "bow_tie" }, "scarf")).toBe(false);
    expect(has("owl", 7, { head: "cap" }, "cap")).toBe(false);
    expect(has("owl", 6, { face: "monocle" }, "glasses")).toBe(false);
    // the people's own cape (stage 6) makes way for the shop's, drawn behind the body
    expect(has("princess", 6, {}, "cape")).toBe(true);
    const caped = render({ species: "princess", tier: 6, style: "gumdrop", look: { neck: "cape" } });
    expect(caped).toContain('data-part="cape-back"');
    expect(count(caped, 'data-part="cape"')).toBe(0);
  });

  test("the cape hangs behind the body; the rest sit on the head", () => {
    const html = render({ species: "dragon", tier: 6, style: "sticker", look: { neck: "cape" } });
    expect(html.indexOf('data-part="cape-back"')).toBeLessThan(html.indexOf('data-part="wings"'));
  });

  test("a background sits in the rounded frame, outlined in Sticker", () => {
    const sticker = render({ species: "robot", tier: 4, style: "sticker", look: { background: "forest" } });
    expect(sticker).toContain(`rx="${BACKDROP.radius}"`);
    expect(sticker).toMatch(/clip-path="url\(#[^)]+-backdrop\)"/);
    expect(sticker).toContain('stroke="#2B2340" stroke-width="4"');
    const storybook = render({ species: "robot", tier: 4, style: "storybook", look: { background: "forest" } });
    expect(storybook).toContain("-backdrop-light");
  });

  test("Storybook gives the items a highlight; the other styles do not", () => {
    for (const item of ["cap", "heart_glasses", "medal"]) {
      const slot = SHOP_ITEMS.find((i) => i.id === item)!.slot;
      expect(render({ species: "fox", tier: 5, style: "storybook", look: { [slot]: item } }), item).toContain("data-sheen");
      expect(render({ species: "fox", tier: 5, style: "gumdrop", look: { [slot]: item } }), item).not.toContain("data-sheen");
    }
  });

  test("a classic picture wears nothing; an unowned item read through readLook is not drawn", () => {
    expect(render({ species: "dragon", tier: 5, style: "classic", look: { head: "cap" } })).not.toContain("data-item");
    const look = readLook({ head: "cap", background: "snow" }, new Set(["snow"]));
    const html = render({ species: "dragon", tier: 5, style: "gumdrop", look });
    expect(html).not.toContain('data-item="cap"');
    expect(html).toContain('data-item="snow"');
  });

  test("every slot has items, and every item is in the matrix", () => {
    for (const slot of SHOP_SLOTS) expect(itemsIn(slot).length, slot).toBeGreaterThan(0);
    expect(DRAWN_SPECIES_IDS).toEqual(expect.arrayContaining(["dragon", "cat", "rex", "axolotl", "robot", "princess", "prince"]));
  });
});

// ---------------------------------------------------------------------------
// The migration, the realtime publication and the guards
// ---------------------------------------------------------------------------

const FILE = "migration_zzzzzzzzz_point_purchases.sql";
const SQL = codeOnly(read(`docker/${FILE}`), { sql: true });

test.describe("the migration", () => {
  test("sorts after the creatures and the balance it replaces", () => {
    const files = readdirSync(join(ROOT, "docker")).filter((f) => /^migration.*\.sql$/.test(f)).sort();
    const at = files.indexOf(FILE);
    expect(at).toBeGreaterThan(files.indexOf("migration_zzzzzzzz_pocket_money_creatures_out.sql"));
    expect(at).toBeGreaterThan(files.indexOf("migration_zzzzzzzzz_device_owner.sql"));
    // the last to define point_person_totals, so its version is the one left standing
    const definers = files.filter((f) => /FUNCTION public\.point_person_totals\(/.test(codeOnly(read(`docker/${f}`), { sql: true })));
    expect(definers[definers.length - 1]).toBe(FILE);
  });

  test("idempotent, serialised, and the browser only reads", () => {
    expect(SQL).toMatch(/^SELECT pg_advisory_lock\(hashtextextended\('migration_zzzzzzzzz_point_purchases', 0\)\);/m);
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.point_purchases");
    expect(SQL).toContain("CONSTRAINT point_purchases_person_item_key UNIQUE (person_id, item_id)");
    expect(SQL).toMatch(/REVOKE ALL ON TABLE public\.point_purchases FROM anon;/);
    expect(SQL).toMatch(/REVOKE ALL ON TABLE public\.point_purchases FROM authenticated;/);
    expect(SQL).toMatch(/GRANT SELECT ON TABLE public\.point_purchases TO authenticated;/);
    expect(SQL).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE|TRUNCATE|ALL)[^;]*TO (anon|authenticated)/);
    expect(SQL).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.point_purchases;/);
  });

  const body = (name: string) => {
    const fn = SQL.slice(SQL.indexOf(`FUNCTION public.${name}(`));
    return fn.slice(0, fn.indexOf("END $$;"));
  };

  test("buying checks everything after the child's lock, the child's presence too", () => {
    const fn = body("purchase_person_point_item");
    const lock = fn.indexOf("PERFORM public.point_lock_person(p_person_id);");
    expect(lock).toBeGreaterThan(0);
    for (const check of ["deleted_at IS NULL", "NOT v_creature.enabled", "NOT v_creature.shop_enabled", "'already_owned'", "(v_totals->>'pending')::BIGINT < p_cost"]) {
      expect(fn.indexOf(check), check).toBeGreaterThan(lock);
    }
  });

  test("a reward request checks the child is there under the lock too, with its signature unchanged", () => {
    const fn = body("request_person_point_redemption");
    expect(fn).toMatch(/^FUNCTION public\.request_person_point_redemption\(\s*p_family_id UUID, p_person_id UUID, p_reward_id UUID, p_device_id UUID DEFAULT NULL\s*\) RETURNS JSONB/);
    const lock = fn.indexOf("PERFORM public.point_lock_person(p_person_id);");
    expect(lock).toBeGreaterThan(0);
    expect(fn.indexOf("deleted_at IS NULL")).toBeGreaterThan(lock);
    // and this file's version is the one left standing
    const files = readdirSync(join(ROOT, "docker")).filter((f) => /^migration.*\.sql$/.test(f)).sort();
    const definers = files.filter((f) => /FUNCTION public\.request_person_point_redemption\(/.test(codeOnly(read(`docker/${f}`), { sql: true })));
    expect(definers[definers.length - 1]).toBe(FILE);
  });

  test("a refund takes the lock, deletes the purchase and takes it out of every slot of the look", () => {
    const fn = body("refund_person_point_purchase");
    const lock = fn.indexOf("PERFORM public.point_lock_person(v_person);");
    expect(lock).toBeGreaterThan(0);
    expect(fn.indexOf("DELETE FROM public.point_purchases")).toBeGreaterThan(lock);
    expect(fn).toMatch(/UPDATE public\.creatures c\s+SET look = c\.look - ARRAY\(/);
    expect(fn).toContain("e.key IN ('head', 'face', 'neck', 'background') AND e.value = v_row.item_id");
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.refund_person_point_purchase\(UUID, UUID\) TO service_role;/);
  });

  test("the balance subtracts purchases, and the request and decision read it", () => {
    const fn = SQL.slice(SQL.indexOf("FUNCTION public.point_person_totals("), SQL.indexOf("FUNCTION public.purchase_person_point_item("));
    expect(fn).toContain("'balance', GREATEST(0, v_earned - v_spent - v_purchased)");
    const step1 = codeOnly(read("docker/migration_zzzzzzzz_pocket_money_creatures_out.sql"), { sql: true });
    for (const name of ["request_person_point_redemption", "decide_point_redemption"]) {
      const body = step1.slice(step1.indexOf(`FUNCTION public.${name}(`));
      expect(body.slice(0, body.indexOf("END $$;")), name).toContain("public.point_person_totals(");
    }
  });

  test("the shop waits for the purchases, so an owned item never flashes 'Buy'", () => {
    const page = codeOnly(read("src/app/rewards/page.tsx"));
    expect(page).toMatch(/ownedReady && pointsReady && \(\s*<CreatureShop/);
  });

  test("'Wear it' builds on the current look, not the one the purchase started from", () => {
    const shop = codeOnly(read("src/components/pocket-money/creature-shop.tsx"));
    const wear = shop.slice(shop.indexOf("const wear = "), shop.indexOf("const purchase = "));
    expect(wear).toContain("= latest.current;");
  });

  test("the app subscribes to purchases", () => {
    expect(read("src/hooks/use-realtime.ts")).toContain('"point_purchases"');
  });

  test("export and import carry purchases, remapped by person", () => {
    expect(codeOnly(read("src/app/api/export/route.ts"))).toMatch(/from\("point_purchases"\)[\s\S]*point_purchases,\n\s*creatures,/);
    expect(codeOnly(read("src/app/api/import/route.ts"))).toContain('spec("point_purchases", { requiredFks: ["person_id"] })');
  });
});
