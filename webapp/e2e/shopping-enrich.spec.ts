import { test, expect } from "@playwright/test";
import {
  addShoppingItemFromText,
  enrichShoppingItem,
  matchCatalogImage,
  pushToBring,
  type BringPushDeps,
  type CatalogSearchFn,
  type ShoppingStore,
} from "../src/lib/shopping-enrich";
import type { CatalogSearchParams, CatalogSearchResult } from "../src/lib/catalog-search";
import type { ServerBringSettings } from "../src/lib/bring-server";
import { detectCategory } from "../src/lib/shopping-categories";
import { parseShoppingInput } from "../src/hooks/use-item-catalog";
import { parseShoppingInput as libParse } from "../src/lib/shopping-input";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./source-helpers";

/**
 * Items an assistant adds through the Integration API get what the shopping
 * page gives a typed item: parsed quantity/unit, a category, the catalogue's
 * picture and a copy on Bring! with two-way sync on. ChatGPT's "Bananen"
 * arrived bare, in the default category, and never reached Bring!.
 *
 * The catalogue, the insert and Bring! are injected, so none of this needs a
 * database or the network.
 */

const FAMILY = "11111111-1111-1111-1111-111111111111";

const result = (over: Partial<CatalogSearchResult>): CatalogSearchResult => ({
  id: null, name: "", image_url: null, thumbnail_url: null, category: null, barcode: null,
  source: "local", default_unit: null, popularity: 0, ...over,
});

function catalog(results: CatalogSearchResult[]) {
  const calls: CatalogSearchParams[] = [];
  const search: CatalogSearchFn = async (params) => {
    calls.push(params);
    return { results };
  };
  return { search, calls };
}

const bananas = result({
  id: "cat-bananen", name: "Bananen", thumbnail_url: "https://img.example/bananen-thumb.jpg",
  image_url: "https://img.example/bananen.jpg",
});

function bring(settings: ServerBringSettings | null, add?: BringPushDeps["add"]) {
  const adds: Parameters<BringPushDeps["add"]>[0][] = [];
  const loaded: string[] = [];
  const deps: BringPushDeps = {
    loadSettings: async (familyId) => {
      loaded.push(familyId);
      return settings;
    },
    add: async (args) => {
      adds.push(args);
      if (add) await add(args);
    },
  };
  return { deps, adds, loaded };
}

const connected: ServerBringSettings = {
  credentials: { accessToken: "bring-token" },
  selectedListId: "list-123",
  twoWaySync: true,
};

test.describe("the parser moved out of the client hook", () => {
  test("the hook re-exports the server-safe one, so the pages keep working", () => {
    expect(parseShoppingInput).toBe(libParse);
    expect(libParse("2 kg Bananen")).toEqual({ name: "Bananen", quantity: 2, unit: "kg", notes: null });
  });
});

test.describe("enrichShoppingItem", () => {
  test("\"2 kg Bananen\" → Bananen, 2 kg, fruit and veg, the catalogue's picture", async () => {
    const { search, calls } = catalog([result({ name: "2 kg Bananen", source: "custom" }), bananas]);
    const item = await enrichShoppingItem(FAMILY, "2 kg Bananen", { search });

    expect(item).toEqual({
      name: "Bananen",
      quantity: 2,
      unit: "kg",
      notes: null,
      category: detectCategory("Bananen"),
      image_url: "https://img.example/bananen-thumb.jpg",
      catalog_item_id: "cat-bananen",
    });
    expect(item.category).toBe("obst_gemuese");
    // The caller's family, and the parsed name — not the raw text.
    expect(calls).toEqual([{ query: "Bananen", familyId: FAMILY, limit: 20 }]);
  });

  test("no catalogue match → no picture, category still detected", async () => {
    const { search } = catalog([result({ name: "Milch", image_url: "https://img.example/milch.jpg", id: "m" })]);
    const item = await enrichShoppingItem(FAMILY, "Bananen", { search });
    expect(item.image_url).toBeNull();
    expect(item.catalog_item_id).toBeNull();
    expect(item.category).toBe("obst_gemuese");
  });

  test("a matching result without a picture is passed over", async () => {
    const { search } = catalog([result({ name: "Bananen", id: "no-pic" })]);
    expect((await enrichShoppingItem(FAMILY, "Bananen", { search })).image_url).toBeNull();
  });

  test("an unknown item falls back to the default category, as on the page", async () => {
    const { search } = catalog([]);
    expect((await enrichShoppingItem(FAMILY, "Xyzzy", { search })).category).toBe("sonstiges");
  });

  test("the catalogue throwing still yields an item, without a picture", async () => {
    const search: CatalogSearchFn = async () => { throw new Error("Bring catalogue down"); };
    const item = await enrichShoppingItem(FAMILY, "2 kg Bananen", { search });
    expect(item).toMatchObject({ name: "Bananen", quantity: 2, unit: "kg", category: "obst_gemuese", image_url: null });
  });

  test("notes come through as the page parses them", async () => {
    const { search } = catalog([]);
    expect(await enrichShoppingItem(FAMILY, "3 Äpfel bio", { search })).toMatchObject({
      name: "Äpfel", quantity: 3, unit: "Stück", notes: "bio",
    });
  });
});

test.describe("matchCatalogImage — the page's fuzzy rule", () => {
  test("exact, contains and contained-in all match; the thumbnail wins over the full image", () => {
    expect(matchCatalogImage("bananen", [bananas])?.image_url).toBe("https://img.example/bananen-thumb.jpg");
    expect(matchCatalogImage("Bio Bananen", [bananas])?.catalog_item_id).toBe("cat-bananen");
    expect(matchCatalogImage("Banane", [bananas])?.catalog_item_id).toBe("cat-bananen");
    expect(matchCatalogImage("Äpfel", [bananas])).toBeNull();
  });
});

test.describe("pushToBring", () => {
  const item = { name: "Bananen", quantity: 2, unit: "kg" };

  test("Bring! off (no settings) → no push", async () => {
    const b = bring(null);
    expect(await pushToBring(FAMILY, item, b.deps)).toBe("skipped");
    expect(b.adds).toHaveLength(0);
  });

  test("two-way sync switched off → no push", async () => {
    const b = bring({ ...connected, twoWaySync: false });
    expect(await pushToBring(FAMILY, item, b.deps)).toBe("skipped");
    expect(b.adds).toHaveLength(0);
  });

  test("connected but no list selected, or no token → no push", async () => {
    const noList = bring({ ...connected, selectedListId: null });
    const noToken = bring({ ...connected, credentials: null });
    expect(await pushToBring(FAMILY, item, noList.deps)).toBe("skipped");
    expect(await pushToBring(FAMILY, item, noToken.deps)).toBe("skipped");
    expect(noList.adds.length + noToken.adds.length).toBe(0);
  });

  test("Bring! on → one push to the selected list with the page's specification, for the caller's family", async () => {
    const b = bring(connected);
    expect(await pushToBring(FAMILY, item, b.deps)).toBe("pushed");
    expect(b.loaded).toEqual([FAMILY]);
    expect(b.adds).toHaveLength(1);
    expect(b.adds[0]).toMatchObject({ accessToken: "bring-token", listId: "list-123", itemName: "Bananen", specification: "2 kg" });
  });

  test("a missing twoWaySync counts as on, as the page treats it", async () => {
    const b = bring({ credentials: { accessToken: "t" }, selectedListId: "l" });
    expect(await pushToBring(FAMILY, item, b.deps)).toBe("pushed");
  });

  test("a quantity without a unit goes across as the bare number", async () => {
    const b = bring(connected);
    await pushToBring(FAMILY, { name: "Milch", quantity: 2, unit: null }, b.deps);
    expect(b.adds[0].specification).toBe("2");
  });

  test("no quantity → no specification", async () => {
    const b = bring(connected);
    await pushToBring(FAMILY, { name: "Milch", quantity: null, unit: null }, b.deps);
    expect(b.adds[0].specification).toBeUndefined();
  });

  test("Bring! throwing is reported, not raised", async () => {
    const b = bring(connected, async () => { throw new Error("Failed to add item: 503"); });
    expect(await pushToBring(FAMILY, item, b.deps)).toBe("failed");
  });
});

test.describe("addShoppingItemFromText — the whole add", () => {
  function inserter() {
    const rows: { familyId: string; row: Record<string, unknown> }[] = [];
    let fail: Error | null = null;
    const store: ShoppingStore = {
      openItems: async () => [],
      insert: async (familyId, newRows) => {
        if (fail) throw fail;
        rows.push(...newRows.map((row) => ({ familyId, row })));
        return newRows.map(() => "row-1");
      },
      update: async () => {},
    };
    return { store, rows, failWith(e: Error) { fail = e; } };
  }

  test("inserts the enriched row and pushes once to Bring!", async () => {
    const { search } = catalog([bananas]);
    const { store, rows } = inserter();
    const b = bring(connected);
    const out = await addShoppingItemFromText(FAMILY, { text: "2 kg Bananen" }, { search, store, bring: b.deps });

    expect(out).toMatchObject({ merged: false, item: { id: "row-1" }, bring: "pushed" });
    expect(rows).toEqual([{
      familyId: FAMILY,
      row: {
        name: "Bananen", quantity: 2, unit: "kg", notes: null, category: "obst_gemuese",
        image_url: "https://img.example/bananen-thumb.jpg", catalog_item_id: "cat-bananen",
      },
    }]);
    expect(b.adds).toHaveLength(1);
  });

  test("the catalogue throwing still adds the item, without a picture", async () => {
    const search: CatalogSearchFn = async () => { throw new Error("network"); };
    const { store, rows } = inserter();
    const out = await addShoppingItemFromText(FAMILY, { text: "Bananen" }, { search, store, bring: bring(null).deps });
    expect(out.item.id).toBe("row-1");
    expect(rows[0].row.image_url).toBeNull();
  });

  test("Bring! throwing still adds the item", async () => {
    const { search } = catalog([]);
    const { store, rows } = inserter();
    const b = bring(connected, async () => { throw new Error("Bring down"); });
    const out = await addShoppingItemFromText(FAMILY, { text: "Bananen" }, { search, store, bring: b.deps });
    expect(out).toMatchObject({ item: { id: "row-1" }, bring: "failed" });
    expect(rows).toHaveLength(1);
  });

  test("a failed insert fails the add and never reaches Bring!", async () => {
    const { search } = catalog([]);
    const b = bring(connected);
    const ins = inserter();
    ins.failWith(new Error("db down"));
    await expect(addShoppingItemFromText(FAMILY, { text: "Bananen" }, { search, store: ins.store, bring: b.deps })).rejects.toThrow("db down");
    expect(b.adds).toHaveLength(0);
    expect(b.loaded).toHaveLength(0);
  });
});

test.describe("both Integration API writers go through it, for the token's own family", () => {
  const read = (rel: string) => codeOnly(readFileSync(join(__dirname, "..", rel), "utf8"));

  test("POST /lists/shopping enriches with the authenticated family, not one from the body", () => {
    const src = read("src/app/api/integration/v1/lists/[list]/route.ts");
    expect(src).toMatch(/addShoppingItemFromText\(context\.familyId,\s*\{\s*text:\s*summary,\s*quantity\s*\}\)/);
  });

  test("the add_shopping_item service does too, and no longer inserts a bare row itself", () => {
    const src = read("src/app/api/integration/v1/services/[service]/route.ts");
    // familyId here is the handler's argument, which POST fills from context.familyId.
    expect(src).toMatch(/addShoppingItemFromText\(familyId,\s*\{\s*text:\s*name\s*\}\)/);
    expect(src).toMatch(/def\.handle\(\{\s*familyId:\s*context\.familyId/);
    expect(src).not.toMatch(/from\("shopping_items"\)/);
  });
});
