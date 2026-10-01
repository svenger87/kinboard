import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  addRecipeToShoppingList,
  getRecipe,
  parseRecipeSearch,
  parseRecipeShoppingBody,
  parseRecipeShoppingInput,
  scaleQuantity,
  searchRecipes,
  MAX_RECIPE_RESULTS,
  type RecipeDb,
} from "../src/lib/integration-recipes";
import { fuzzyMatch, matchCatalogItems, mapBringSectionToCategory } from "../src/lib/catalog-match";
import type { BringPushDeps } from "../src/lib/shopping-enrich";
import type { ServerBringSettings } from "../src/lib/bring-server";
import { hasScope } from "../src/lib/integration-auth";
import { TOOL_SCOPES } from "../src/lib/mcp/server";
import { codeOnly } from "./source-helpers";

/**
 * RFC-012 task 1: recipes for assistants — search, read, and put a recipe's
 * ingredients on the shopping list the way the recipe page's
 * useAddRecipeToShoppingList does. The database, the catalogue and Bring!
 * are injected, so none of this needs a stack.
 *
 * The fake client applies the `.eq`/`.is` filters it is given, so a query
 * that forgets `family_id` or `deleted_at` really does see the foreign or
 * binned row here — that is what makes the "excluded" tests mean something.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const PASTA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CURRY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const BINNED = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const FOREIGN = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ING = (n: number) => `eeeeeeee-eeee-eeee-eeee-${String(n).padStart(12, "0")}`;

type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>) {
  const inserted: Record<string, Row[]> = {};
  const selects: Array<{ table: string; columns: string; filters: Array<[string, string, unknown]>; ops: string[] }> = [];
  let failInsert: unknown = null;
  let nextId = 1;

  const db = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let rowLimit = Infinity;
      const entry = { table, columns: "", filters, ops: [] as string[] };
      const run = () => {
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every(([op, column, value]) => (op === "is" ? (row[column] ?? null) === value : row[column] === value)),
        );
        return rows.slice(0, rowLimit);
      };
      const chain = {
        select(columns: string) {
          entry.columns = columns;
          selects.push(entry);
          return chain;
        },
        eq(column: string, value: unknown) { filters.push(["eq", column, value]); return chain; },
        is(column: string, value: unknown) { filters.push(["is", column, value]); return chain; },
        order(column: string) { entry.ops.push(`order:${column}`); return chain; },
        limit(n: number) { entry.ops.push("limit"); rowLimit = n; return chain; },
        async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: run(), error: null }).then(resolve); },
        insert(rows: Row[]) {
          return {
            select: async () => {
              if (failInsert) return { data: null, error: failInsert };
              const stored = rows.map((row) => ({ id: `item-${nextId++}`, ...row }));
              (inserted[table] ??= []).push(...stored);
              return { data: stored, error: null };
            },
          };
        },
      };
      return chain;
    },
  };
  return {
    db: db as unknown as RecipeDb,
    inserted,
    selects,
    failInsertWith(error: unknown) { failInsert = error; },
  };
}

const tag = (name: string) => ({ name });

const recipeRows = (): Row[] => [
  {
    id: PASTA, family_id: OURS, deleted_at: null, title: "Spaghetti Bolognese", description: "Klassiker",
    source_url: "https://example.com/bolo", servings: 4, prep_time_minutes: 15, cook_time_minutes: 45,
    total_time_minutes: 60, difficulty: "einfach", is_favorite: true, image_url: "https://img.example/bolo.jpg",
    instructions: [{ step: 1, text: "Zwiebeln hacken" }, { step: 2, text: "Anbraten" }],
    tags: [tag("Pasta"), tag("Schnell")],
    ingredients: [
      { id: ING(2), name: "Hackfleisch", quantity: 500, unit: "g", group_name: null, notes: null, category: "fleisch", sort_order: 2 },
      { id: ING(1), name: "Spaghetti", quantity: 400, unit: "g", group_name: "Nudeln", notes: "al dente", category: null, sort_order: 1 },
      { id: ING(3), name: "Salz", quantity: null, unit: null, group_name: null, notes: "nach Geschmack", category: null, sort_order: 3 },
    ],
  },
  {
    id: CURRY, family_id: OURS, deleted_at: null, title: "Gemüsecurry", description: null, source_url: null,
    servings: null, prep_time_minutes: null, cook_time_minutes: null, total_time_minutes: 30, difficulty: null,
    is_favorite: false, image_url: null, instructions: "Alles kochen.", tags: [tag("Vegetarisch")],
    ingredients: [{ id: ING(10), name: "Kokosmilch", quantity: 1, unit: "Dose", group_name: null, notes: null, category: null, sort_order: 0 }],
  },
  {
    id: BINNED, family_id: OURS, deleted_at: "2026-09-30T10:00:00Z", title: "Pasta im Papierkorb",
    servings: 2, tags: [tag("Pasta")], ingredients: [{ id: ING(20), name: "Nudeln", quantity: 1, unit: null, sort_order: 0 }],
  },
  {
    id: FOREIGN, family_id: THEIRS, deleted_at: null, title: "Pasta der Nachbarn",
    servings: 2, tags: [tag("Pasta")], ingredients: [{ id: ING(30), name: "Nudeln", quantity: 1, unit: null, sort_order: 0 }],
  },
];

const noCatalog = async () => ({});
const addedOf = (result: Awaited<ReturnType<typeof addRecipeToShoppingList>>) => {
  if (!result || !("added" in result)) throw new Error(`expected items to be added, got ${JSON.stringify(result)}`);
  return result.added;
};
const bringOff = { loadSettings: async () => null };

test.describe("search parameters", () => {
  test("query and tag are trimmed; empty means no filter; the limit defaults to 20", () => {
    expect(parseRecipeSearch(new URLSearchParams("query=%20Pasta%20&tag="))).toEqual({
      ok: true, value: { query: "Pasta", tag: null, limit: 20 },
    });
  });

  test("the limit is a whole number from 1 to 50", () => {
    expect(parseRecipeSearch(new URLSearchParams("limit=50"))).toMatchObject({ ok: true, value: { limit: 50 } });
    expect(parseRecipeSearch(new URLSearchParams("limit=51")).ok).toBe(false);
    expect(parseRecipeSearch(new URLSearchParams("limit=0")).ok).toBe(false);
    expect(parseRecipeSearch(new URLSearchParams("limit=2.5")).ok).toBe(false);
    expect(parseRecipeSearch(new URLSearchParams("limit=abc")).ok).toBe(false);
    expect(MAX_RECIPE_RESULTS).toBe(50);
  });

  test("an absurdly long query is refused rather than scanned", () => {
    expect(parseRecipeSearch(new URLSearchParams(`query=${"x".repeat(201)}`)).ok).toBe(false);
  });
});

test.describe("searchRecipes", () => {
  test("lists only the family's own recipes, never a binned one, favourites first", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    const found = await searchRecipes(OURS, { query: null, tag: null, limit: 20 }, db);
    expect(found.map((r) => r.id)).toEqual([PASTA, CURRY]);
  });

  test("the query matches the title, case-insensitively", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    const found = await searchRecipes(OURS, { query: "bolo", tag: null, limit: 20 }, db);
    expect(found.map((r) => r.id)).toEqual([PASTA]);
  });

  test("the query also matches a tag name", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    const found = await searchRecipes(OURS, { query: "vegetar", tag: null, limit: 20 }, db);
    expect(found.map((r) => r.id)).toEqual([CURRY]);
  });

  test("tag filters on a whole tag name, case-insensitively — and still not to binned or foreign recipes", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    expect((await searchRecipes(OURS, { query: null, tag: "pasta", limit: 20 }, db)).map((r) => r.id))
      .toEqual([PASTA]);
    expect(await searchRecipes(OURS, { query: null, tag: "Past", limit: 20 }, db)).toEqual([]);
  });

  test("the limit caps the answer", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    expect(await searchRecipes(OURS, { query: null, tag: null, limit: 1 }, db)).toHaveLength(1);
  });

  test("answers the documented fields and tag names, nothing else", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    const [pasta] = await searchRecipes(OURS, { query: "spaghetti", tag: null, limit: 20 }, db);
    expect(pasta).toEqual({
      id: PASTA, title: "Spaghetti Bolognese", servings: 4, total_time_minutes: 60, prep_time_minutes: 15,
      cook_time_minutes: 45, difficulty: "einfach", tags: ["Pasta", "Schnell"], is_favorite: true,
      image_url: "https://img.example/bolo.jpg",
    });
  });

  test("the query is scoped by family and filters deleted_at itself", async () => {
    const { db, selects } = fakeDb({ recipes: recipeRows() });
    await searchRecipes(OURS, { query: null, tag: null, limit: 20 }, db);
    expect(selects[0].filters).toEqual(expect.arrayContaining([["eq", "family_id", OURS], ["is", "deleted_at", null]]));
  });
});

test("the scan is ordered before it is capped, so a cut is always the same rows", async () => {
  const { db, selects } = fakeDb({ recipes: recipeRows() });
  await searchRecipes(OURS, { query: null, tag: null, limit: 20 }, db);
  expect(selects[0].ops).toEqual(["order:is_favorite", "order:title", "limit"]);
});

test.describe("getRecipe", () => {
  test("a binned recipe and another family's recipe are both not found", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    expect(await getRecipe(OURS, BINNED, db)).toBeNull();
    expect(await getRecipe(OURS, FOREIGN, db)).toBeNull();
  });

  test("answers ingredients in sort order and instructions as plain steps", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    const recipe = await getRecipe(OURS, PASTA, db);
    expect(recipe).toMatchObject({
      id: PASTA, title: "Spaghetti Bolognese", description: "Klassiker", source_url: "https://example.com/bolo",
      servings: 4, tags: ["Pasta", "Schnell"], instructions: ["Zwiebeln hacken", "Anbraten"],
    });
    expect(recipe!.ingredients).toEqual([
      { id: ING(1), name: "Spaghetti", quantity: 400, unit: "g", group: "Nudeln", notes: "al dente", sort_order: 1 },
      { id: ING(2), name: "Hackfleisch", quantity: 500, unit: "g", group: null, notes: null, sort_order: 2 },
      { id: ING(3), name: "Salz", quantity: null, unit: null, group: null, notes: "nach Geschmack", sort_order: 3 },
    ]);
  });

  test("free-text instructions become steps too, and an unset servings reads as the default 4", async () => {
    const { db } = fakeDb({ recipes: recipeRows() });
    expect(await getRecipe(OURS, CURRY, db)).toMatchObject({ instructions: ["Alles kochen."], servings: 4 });
  });
});

test.describe("adding a recipe to the shopping list: input", () => {
  test("no body at all means everything; a garbled or non-object body is refused", () => {
    expect(parseRecipeShoppingBody("")).toEqual({ ok: true, value: {} });
    expect(parseRecipeShoppingBody("  \n")).toEqual({ ok: true, value: {} });
    expect(parseRecipeShoppingBody('{"servings":2}')).toEqual({ ok: true, value: { servings: 2 } });
    for (const bad of [`{"ingredient_ids":["${ING(1)}"]`, "[]", "null", "4", '"x"', "not json"]) {
      expect(parseRecipeShoppingBody(bad), bad).toEqual({ ok: false, error: "the body must be a JSON object" });
    }
  });

  test("an empty body is fine — everything, at the recipe's own servings", () => {
    expect(parseRecipeShoppingInput({})).toEqual({ ok: true, value: {} });
  });

  test("servings is a whole number from 1 to 50", () => {
    expect(parseRecipeShoppingInput({ servings: 8 })).toEqual({ ok: true, value: { servings: 8 } });
    for (const bad of [0, 51, 2.5, "4", null]) expect(parseRecipeShoppingInput({ servings: bad }).ok).toBe(false);
  });

  test("ingredient_ids is a non-empty list of ids, de-duplicated", () => {
    expect(parseRecipeShoppingInput({ ingredient_ids: [ING(1), ING(1)] }))
      .toEqual({ ok: true, value: { ingredientIds: [ING(1)] } });
    expect(parseRecipeShoppingInput({ ingredient_ids: [] }).ok).toBe(false);
    expect(parseRecipeShoppingInput({ ingredient_ids: ["nope"] }).ok).toBe(false);
    expect(parseRecipeShoppingInput({ ingredient_ids: ING(1) }).ok).toBe(false);
  });
});

test.describe("scaleQuantity", () => {
  test("scales and rounds to the two places the column stores", () => {
    expect(scaleQuantity(400, 2)).toBe(800);
    expect(scaleQuantity(1, 1 / 3)).toBe(0.33);
    expect(scaleQuantity(500, 6 / 4)).toBe(750);
  });

  test("no quantity stays no quantity — as does zero, as the page does", () => {
    expect(scaleQuantity(null, 2)).toBeNull();
    expect(scaleQuantity(0, 2)).toBeNull();
  });

  test("a numeric that arrives as a string is still a number", () => {
    expect(scaleQuantity("1.5" as unknown as number, 2)).toBe(3);
  });
});

test.describe("addRecipeToShoppingList", () => {
  test("adds every ingredient at the recipe's servings, tagged with the recipe and family", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const result = await addRecipeToShoppingList(OURS, PASTA, {}, { db: f.db, match: noCatalog, bring: bringOff });
    expect(result).not.toBeNull();
    expect(f.inserted.shopping_items.map((r) => [r.name, r.quantity, r.unit])).toEqual([
      ["Spaghetti", 400, "g"], ["Hackfleisch", 500, "g"], ["Salz", null, null],
    ]);
    for (const row of f.inserted.shopping_items) {
      expect(row).toMatchObject({ family_id: OURS, recipe_id: PASTA, checked: false, source_device_id: null });
    }
    expect(f.inserted.shopping_items[0].notes).toBe("al dente");
    expect(addedOf(result)).toEqual([
      { id: "item-1", name: "Spaghetti", quantity: 400, unit: "g" },
      { id: "item-2", name: "Hackfleisch", quantity: 500, unit: "g" },
      { id: "item-3", name: "Salz", quantity: null, unit: null },
    ]);
  });

  test("scales by target over recipe servings; null quantities stay null", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    await addRecipeToShoppingList(OURS, PASTA, { servings: 6 }, { db: f.db, match: noCatalog, bring: bringOff });
    expect(f.inserted.shopping_items.map((r) => r.quantity)).toEqual([600, 750, null]);
  });

  test("a recipe with no servings is scaled from the default 4", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    await addRecipeToShoppingList(OURS, CURRY, { servings: 2 }, { db: f.db, match: noCatalog, bring: bringOff });
    expect(f.inserted.shopping_items[0]).toMatchObject({ name: "Kokosmilch", quantity: 0.5, unit: "Dose" });
  });

  test("an empty body adds every ingredient", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const body = parseRecipeShoppingBody("");
    if (!body.ok) throw new Error("empty body refused");
    const input = parseRecipeShoppingInput(body.value);
    if (!input.ok) throw new Error("empty input refused");
    await addRecipeToShoppingList(OURS, PASTA, input.value, { db: f.db, match: noCatalog, bring: bringOff });
    expect(f.inserted.shopping_items.map((r) => r.name)).toEqual(["Spaghetti", "Hackfleisch", "Salz"]);
  });

  test("ingredient_ids adds only those", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const result = await addRecipeToShoppingList(OURS, PASTA, { ingredientIds: [ING(3)] }, { db: f.db, match: noCatalog, bring: bringOff });
    expect(f.inserted.shopping_items.map((r) => r.name)).toEqual(["Salz"]);
    expect(addedOf(result)).toHaveLength(1);
  });

  test("an ingredient id from another recipe is refused, and nothing is added", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const result = await addRecipeToShoppingList(OURS, PASTA, { ingredientIds: [ING(1), ING(10)] }, { db: f.db, match: noCatalog, bring: bringOff });
    expect(result).toEqual({ error: "unknown_ingredients", ids: [ING(10)] });
    expect(f.inserted.shopping_items).toBeUndefined();
  });

  test("a binned or foreign recipe is not found, and nothing is added", async () => {
    for (const id of [BINNED, FOREIGN]) {
      const f = fakeDb({ recipes: recipeRows() });
      expect(await addRecipeToShoppingList(OURS, id, {}, { db: f.db, match: noCatalog, bring: bringOff })).toBeNull();
      expect(f.inserted.shopping_items).toBeUndefined();
    }
  });

  test("a catalogue match gives category, the thumbnail before the image, and the catalogue id", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const asked: Array<[string, string[]]> = [];
    const match = async (familyId: string, names: string[]) => {
      asked.push([familyId, names]);
      return {
        spaghetti: { id: "cat-1", name: "Spaghetti", category: "vorrat", image_url: "big.jpg", thumbnail_url: "thumb.jpg", source: "local" },
        hackfleisch: { id: null, name: "Hackfleisch", category: null, image_url: "hack.jpg", thumbnail_url: null, source: "bring" },
      };
    };
    await addRecipeToShoppingList(OURS, PASTA, {}, { db: f.db, match, bring: bringOff });
    expect(asked).toEqual([[OURS, ["Spaghetti", "Hackfleisch", "Salz"]]]);
    const [spaghetti, hack, salz] = f.inserted.shopping_items;
    expect(spaghetti).toMatchObject({ category: "vorrat", image_url: "thumb.jpg", catalog_item_id: "cat-1" });
    // No catalogue category: the ingredient's own, then "sonstiges".
    expect(hack).toMatchObject({ category: "fleisch", image_url: "hack.jpg", catalog_item_id: null });
    expect(salz).toMatchObject({ category: "sonstiges", image_url: null, catalog_item_id: null });
  });

  test("a failing catalogue still adds everything, without pictures", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const result = await addRecipeToShoppingList(OURS, PASTA, {}, {
      db: f.db, match: async () => { throw new Error("catalogue down"); }, bring: bringOff,
    });
    expect(addedOf(result)).toHaveLength(3);
    expect(f.inserted.shopping_items.map((r) => r.image_url)).toEqual([null, null, null]);
    expect(f.inserted.shopping_items[1].category).toBe("fleisch");
  });

  test("an insert failure is thrown, not swallowed", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    f.failInsertWith({ message: "insert failed" });
    await expect(addRecipeToShoppingList(OURS, PASTA, {}, { db: f.db, match: noCatalog, bring: bringOff })).rejects.toBeTruthy();
  });

  const connected: ServerBringSettings = {
    credentials: { accessToken: "bring-token" }, selectedListId: "list-1", twoWaySync: true,
  };
  function bring(settings: ServerBringSettings | null, fail = false) {
    const adds: Parameters<BringPushDeps["add"]>[0][] = [];
    const deps: Partial<BringPushDeps> = {
      loadSettings: async () => settings,
      add: async (args) => { adds.push(args); if (fail) throw new Error("bring down"); },
    };
    return { deps, adds };
  }

  test("with Bring! two-way sync on, each added item goes to Bring! with the scaled quantity", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const b = bring(connected);
    await addRecipeToShoppingList(OURS, PASTA, { servings: 2 }, { db: f.db, match: noCatalog, bring: b.deps });
    expect(b.adds.map((a) => [a.itemName, a.specification, a.listId])).toEqual([
      ["Spaghetti", "200 g", "list-1"], ["Hackfleisch", "250 g", "list-1"], ["Salz", undefined, "list-1"],
    ]);
  });

  test("the Bring! settings are read once for the whole recipe, not per item", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const b = bring(connected);
    let loads = 0;
    const loadSettings = b.deps.loadSettings!;
    await addRecipeToShoppingList(OURS, PASTA, {}, {
      db: f.db, match: noCatalog, bring: { ...b.deps, loadSettings: async (id) => { loads++; return loadSettings(id); } },
    });
    expect(loads).toBe(1);
    expect(b.adds).toHaveLength(3);
  });

  test("with two-way sync off nothing reaches Bring!", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const b = bring({ ...connected, twoWaySync: false });
    await addRecipeToShoppingList(OURS, PASTA, {}, { db: f.db, match: noCatalog, bring: b.deps });
    expect(b.adds).toEqual([]);
  });

  test("Bring! failing never fails the add", async () => {
    const f = fakeDb({ recipes: recipeRows() });
    const b = bring(connected, true);
    const result = await addRecipeToShoppingList(OURS, PASTA, {}, { db: f.db, match: noCatalog, bring: b.deps });
    expect(addedOf(result)).toHaveLength(3);
    expect(b.adds).toHaveLength(3);
  });
});

test.describe("the catalogue match, moved out of the route", () => {
  test("the fuzzy rules are unchanged", () => {
    expect(fuzzyMatch("Milch", "milch")).toEqual({ match: true, score: 100 });
    expect(fuzzyMatch("Milch", "Frische Milch")).toEqual({ match: true, score: 80 });
    expect(fuzzyMatch("Tomate", "Tomaten")).toEqual({ match: true, score: 70 });
    expect(fuzzyMatch("eis", "Reis")).toEqual({ match: true, score: 50 });
    expect(fuzzyMatch("Brot", "Käse")).toEqual({ match: false, score: 0 });
    expect(mapBringSectionToCategory("Obst & Gemüse")).toBe("obst_gemuese");
    expect(mapBringSectionToCategory("Unbekannt")).toBe("sonstiges");
  });

  test("the family's own catalogue wins; Bring! fills the rest; keys are lower-cased names", async () => {
    const families: Array<string> = [];
    const matches = await matchCatalogItems(OURS, ["Milch", "Äpfel", "Zahnpasta Deluxe Spezial"], {
      loadLocal: async (familyId) => {
        families.push(familyId);
        return [{ id: "cat-milch", name: "Milch", category: "milchprodukte", image_url: "m.jpg", thumbnail_url: "mt.jpg" }];
      },
      loadBring: async () => [
        { itemId: "Milch", name: "Milch", sectionId: "s1", sectionName: "Milch & Käse" },
        { itemId: "Äpfel", name: "Äpfel", sectionId: "s2", sectionName: "Obst & Gemüse" },
      ],
    });
    expect(families).toEqual([OURS]);
    expect(matches["milch"]).toMatchObject({ id: "cat-milch", source: "local", thumbnail_url: "mt.jpg" });
    expect(matches["äpfel"]).toMatchObject({ id: null, category: "obst_gemuese", source: "bring" });
    expect(matches["zahnpasta deluxe spezial"]).toBeNull();
  });

  test("no family means no local catalogue, and a local failure falls back to Bring!", async () => {
    let loaded = false;
    const bringOnly = await matchCatalogItems(null, ["Äpfel"], {
      loadLocal: async () => { loaded = true; return []; },
      loadBring: async () => [{ itemId: "Äpfel", name: "Äpfel", sectionId: "s2", sectionName: "Obst & Gemüse" }],
    });
    expect(loaded).toBe(false);
    expect(bringOnly["äpfel"]).toMatchObject({ source: "bring" });

    const fellBack = await matchCatalogItems(OURS, ["Äpfel"], {
      loadLocal: async () => { throw new Error("db down"); },
      loadBring: async () => [{ itemId: "Äpfel", name: "Äpfel", sectionId: "s2", sectionName: "Obst & Gemüse" }],
    });
    expect(fellBack["äpfel"]).toMatchObject({ source: "bring" });
  });

  test("the session route keeps its checks and calls the lib", () => {
    const route = codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "catalog", "match", "route.ts"), "utf8"));
    expect(route).toContain("requireSession(request)");
    expect(route).toContain("familyMatchesSession(auth.session, family_id)");
    expect(route).toContain("matchCatalogItems(family_id, items)");
    expect(route).not.toContain("function fuzzyMatch");
  });
});

test.describe("scopes", () => {
  test("search_recipes and get_recipe read with family:read; add_recipe_to_shopping_list needs shopping:write", () => {
    expect(TOOL_SCOPES.search_recipes).toBe("family:read");
    expect(TOOL_SCOPES.get_recipe).toBe("family:read");
    expect(TOOL_SCOPES.add_recipe_to_shopping_list).toBe("shopping:write");
    expect(hasScope(["family:read"], "shopping:write")).toBe(false);
  });

  test("each route asks for its scope and the write takes an Idempotency-Key", () => {
    const read = (p: string) => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "recipes", p), "utf8"));
    expect(read("route.ts")).toContain('withIntegrationAuth(request, "family:read"');
    expect(read("[id]/route.ts")).toContain('withIntegrationAuth(request, "family:read"');
    const shopping = read("[id]/shopping/route.ts");
    expect(shopping).toContain('withIntegrationAuth(request, "shopping:write"');
    expect(shopping).toContain("validateIdempotencyKey(");
    expect(shopping).toContain("findStoredResult(");
    // A garbled body answers 400 before anything is looked up or added.
    const refused = shopping.indexOf("if (!parsedBody.ok)");
    expect(refused).toBeGreaterThan(-1);
    expect(shopping).not.toContain("request.json()");
    expect(refused).toBeLessThan(shopping.indexOf("findStoredResult("));
    expect(refused).toBeLessThan(shopping.indexOf("addRecipeToShoppingList("));
    // The path id is part of the fingerprint's service string.
    expect(shopping).toContain("const service = `recipes/${id.toLowerCase()}/shopping`");
    expect(shopping).toContain("fingerprintRequest(service, body)");
  });
});
