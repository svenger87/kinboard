import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createRecipe,
  parseRecipeCreate,
  MAX_RECIPE_INGREDIENTS,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_TAGS,
  type RecipeDb,
} from "../src/lib/integration-recipes";
import { hasScope } from "../src/lib/integration-auth";
import { TOOL_SCOPES } from "../src/lib/mcp/server";
import { codeOnly } from "./source-helpers";

/**
 * POST /api/integration/v1/recipes: an assistant saves a recipe to the
 * family's collection — one it invented ("a nice dinner for tonight") or one
 * the user worked out with it ("save that to Kinboard"). The rows are the
 * ones the recipe page's useCreateRecipe writes (recipes, recipe_ingredients
 * in order, the tags through the same syncRecipeTags), with the service-role
 * client, so family scoping is the code's job and is tested here.
 *
 * No stack: the database is a fake that applies the filters it is given, so
 * a tag lookup that forgot `family_id` really would see another family's tag.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "is" | "not-in", column: string, value: unknown];

function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  const log: string[] = [];
  const rpcs: Array<{ fn: string; args: unknown }> = [];
  let failOn: string | null = null;
  let nextId = 1;
  const matches = (row: Row, filters: Filter[]) => filters.every(([op, column, value]) => {
    if (op === "is") return (row[column] ?? null) === value;
    if (op === "not-in") return !(value as string[]).includes(String(row[column]));
    return row[column] === value;
  });
  const fail = (table: string, op: string) => (failOn === `${op}:${table}` ? { message: `${op} ${table} failed` } : null);

  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      const rowsOf = () => (tables[table] ??= []);
      const filtered = {
        eq(column: string, value: unknown) { filters.push(["eq", column, value]); return filtered; },
        is(column: string, value: unknown) { filters.push(["is", column, value]); return filtered; },
        not(column: string, _op: string, list: string) {
          filters.push(["not-in", column, list.replace(/[()]/g, "").split(",").filter(Boolean)]);
          return filtered;
        },
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve({ data: rowsOf().filter((r) => matches(r, filters)), error: null }).then(resolve);
        },
      };
      return {
        select(_columns: string) {
          log.push(`select:${table}`);
          return filtered;
        },
        insert(input: Row | Row[]) {
          const error = fail(table, "insert");
          log.push(`insert:${table}`);
          const stored = error ? [] : (Array.isArray(input) ? input : [input]).map((row) => ({ id: `${table}-${nextId++}`, ...row }));
          if (!error) rowsOf().push(...stored);
          const result = { data: stored, error };
          return {
            select: () => ({
              single: async () => ({ data: stored[0] ?? null, error }),
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
            }),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error }).then(resolve),
          };
        },
        upsert(input: Row[]) {
          const error = fail(table, "upsert");
          log.push(`upsert:${table}`);
          if (!error) rowsOf().push(...input);
          return Promise.resolve({ error });
        },
        delete() {
          log.push(`delete:${table}`);
          const del = {
            eq(column: string, value: unknown) { filters.push(["eq", column, value]); return del; },
            not(column: string, _op: string, list: string) {
              filters.push(["not-in", column, list.replace(/[()]/g, "").split(",").filter(Boolean)]);
              return del;
            },
            then(resolve: (v: unknown) => unknown) {
              tables[table] = rowsOf().filter((r) => !matches(r, filters));
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return del;
        },
      };
    },
    async rpc(fn: string, args: unknown) {
      rpcs.push({ fn, args });
      return { data: 1, error: null };
    },
  };
  return { db: db as unknown as RecipeDb, tables, log, rpcs, failOn(what: string) { failOn = what; } };
}

const valid = () => ({
  title: "Ofengemüse mit Feta",
  description: "Schnell und bunt",
  servings: 4,
  prep_time_minutes: 15,
  cook_time_minutes: 30,
  tags: ["Vegetarisch", "Schnell"],
  ingredients: [
    { name: "Paprika", quantity: 2, unit: "Stück" },
    { name: "Feta", quantity: 200, unit: "g", group: "Topping", notes: "zerbröselt" },
    { name: "Salz" },
  ],
  instructions: ["Ofen auf 200 °C vorheizen.", "Gemüse schneiden.", "30 Minuten backen."],
});

test.describe("parseRecipeCreate", () => {
  test("a full recipe is accepted and trimmed; servings default to 4", () => {
    const parsed = parseRecipeCreate({ ...valid(), title: "  Ofengemüse  " });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.title).toBe("Ofengemüse");
    const bare = parseRecipeCreate({ title: "Brot", ingredients: [{ name: "Mehl" }], instructions: ["Backen."] });
    expect(bare.ok && bare.value.servings).toBe(4);
  });

  test("a missing or blank title is refused", () => {
    for (const title of [undefined, "", "   ", 3]) {
      const parsed = parseRecipeCreate({ ...valid(), title });
      expect(parsed.ok, JSON.stringify(title)).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("title");
    }
  });

  test("lists are capped: ingredients, steps and tags", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Zutat ${i}` }));
    expect(parseRecipeCreate({ ...valid(), ingredients: many(MAX_RECIPE_INGREDIENTS) }).ok).toBe(true);
    const tooMany = parseRecipeCreate({ ...valid(), ingredients: many(MAX_RECIPE_INGREDIENTS + 1) });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toContain("ingredients");
    expect(parseRecipeCreate({ ...valid(), instructions: Array(MAX_RECIPE_STEPS + 1).fill("Rühren.") }).ok).toBe(false);
    expect(parseRecipeCreate({ ...valid(), tags: Array.from({ length: MAX_RECIPE_TAGS + 1 }, (_, i) => `t${i}`) }).ok).toBe(false);
  });

  test("a recipe needs at least one ingredient and one step", () => {
    expect(parseRecipeCreate({ ...valid(), ingredients: [] }).ok).toBe(false);
    expect(parseRecipeCreate({ ...valid(), instructions: [] }).ok).toBe(false);
    expect(parseRecipeCreate({ ...valid(), instructions: ["  "] }).ok).toBe(false);
  });

  test("bad fields are refused, not dropped", () => {
    for (const bad of [
      { servings: 0 }, { servings: 51 }, { servings: 2.5 },
      { prep_time_minutes: -1 }, { cook_time_minutes: 1441 },
      { description: "x".repeat(2001) }, { title: "x".repeat(201) },
      { ingredients: [{ name: "" }] }, { ingredients: [{ name: "Mehl", quantity: 0 }] },
      { ingredients: [{ name: "Mehl", quantity: -1 }] }, { ingredients: [{ name: "Mehl", quantity: "2" }] },
      { ingredients: [{ name: "Mehl", unit: "x".repeat(31) }] }, { ingredients: "Mehl" },
      { instructions: "Alles kochen." }, { tags: ["x".repeat(51)] }, { tags: "Vegan" },
    ]) {
      expect(parseRecipeCreate({ ...valid(), ...bad }).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("tags differing only in case are one tag", () => {
    const parsed = parseRecipeCreate({ ...valid(), tags: ["Vegan", "vegan", " VEGAN "] });
    expect(parsed.ok && parsed.value.tags).toEqual(["Vegan"]);
  });
});

test.describe("createRecipe", () => {
  const create = async (body: Record<string, unknown>, fake = fakeDb()) => {
    const parsed = parseRecipeCreate(body);
    if (!parsed.ok) throw new Error(parsed.error);
    return { fake, recipe: await createRecipe(OURS, parsed.value, fake.db) };
  };

  test("writes the recipe for this family as the recipe page does", async () => {
    const { fake } = await create(valid());
    expect(fake.tables.recipes).toEqual([expect.objectContaining({
      family_id: OURS, title: "Ofengemüse mit Feta", description: "Schnell und bunt", servings: 4,
      prep_time_minutes: 15, cook_time_minutes: 30, total_time_minutes: 45,
      instructions: [
        { step: 1, text: "Ofen auf 200 °C vorheizen." },
        { step: 2, text: "Gemüse schneiden." },
        { step: 3, text: "30 Minuten backen." },
      ],
    })]);
    // No picture, no source, no favourite: nothing an assistant was asked for.
    const row = fake.tables.recipes[0];
    expect(row).not.toHaveProperty("image_url");
    expect(row).not.toHaveProperty("source_url");
  });

  test("ingredients are stored in the order given, on this recipe", async () => {
    const { fake } = await create(valid());
    const recipeId = fake.tables.recipes[0].id;
    expect(fake.tables.recipe_ingredients.map((r) => ({ ...r, id: undefined }))).toEqual([
      { id: undefined, recipe_id: recipeId, name: "Paprika", quantity: 2, unit: "Stück", group_name: null, notes: null, category: null, sort_order: 0 },
      { id: undefined, recipe_id: recipeId, name: "Feta", quantity: 200, unit: "g", group_name: "Topping", notes: "zerbröselt", category: null, sort_order: 1 },
      { id: undefined, recipe_id: recipeId, name: "Salz", quantity: null, unit: null, group_name: null, notes: null, category: null, sort_order: 2 },
    ]);
  });

  test("answers the new recipe's id and its ingredient ids, in order, for add_meal and the shopping list", async () => {
    const { fake, recipe } = await create(valid());
    expect(recipe.id).toBe(fake.tables.recipes[0].id);
    expect(recipe.ingredients.map((i) => i.id)).toEqual(fake.tables.recipe_ingredients.map((r) => r.id));
    expect(recipe.ingredients.map((i) => i.name)).toEqual(["Paprika", "Feta", "Salz"]);
    expect(recipe.ingredients[1]).toMatchObject({ quantity: 200, unit: "g", group: "Topping", notes: "zerbröselt" });
    expect(recipe.instructions).toEqual(["Ofen auf 200 °C vorheizen.", "Gemüse schneiden.", "30 Minuten backen."]);
    expect(recipe).toMatchObject({ title: "Ofengemüse mit Feta", servings: 4, total_time_minutes: 45, tags: ["Vegetarisch", "Schnell"] });
  });

  test("tags: this family's tag is reused whatever its case, another family's never is", async () => {
    const fake = fakeDb({
      recipe_tags: [
        { id: "tag-ours", family_id: OURS, name: "vegetarisch" },
        { id: "tag-theirs", family_id: THEIRS, name: "Schnell" },
      ],
    });
    await create(valid(), fake);
    const recipeId = fake.tables.recipes[0].id;
    const created = fake.tables.recipe_tags.filter((t) => !["tag-ours", "tag-theirs"].includes(String(t.id)));
    expect(created).toEqual([expect.objectContaining({ family_id: OURS, name: "Schnell" })]);
    expect(fake.tables.recipe_tag_assignments).toEqual([
      { recipe_id: recipeId, tag_id: "tag-ours" },
      { recipe_id: recipeId, tag_id: created[0].id },
    ]);
  });

  test("no tags: no tag table is touched", async () => {
    const { fake } = await create({ ...valid(), tags: undefined });
    expect(fake.log.filter((l) => l.includes("recipe_tag"))).toEqual([]);
  });

  test("when the ingredients cannot be stored, the half-made recipe is taken out again and the error is thrown", async () => {
    const fake = fakeDb();
    fake.failOn("insert:recipe_ingredients");
    const parsed = parseRecipeCreate(valid());
    if (!parsed.ok) throw new Error(parsed.error);
    await expect(createRecipe(OURS, parsed.value, fake.db)).rejects.toMatchObject({ message: "insert recipe_ingredients failed" });
    expect(fake.tables.recipes).toEqual([]);
    expect(fake.rpcs).toEqual([{ fn: "purge_deleted", args: { p_table: "recipes", p_id: "recipes-1" } }]);
  });

  test("so does a failure linking the tags", async () => {
    const fake = fakeDb();
    fake.failOn("upsert:recipe_tag_assignments");
    const parsed = parseRecipeCreate(valid());
    if (!parsed.ok) throw new Error(parsed.error);
    await expect(createRecipe(OURS, parsed.value, fake.db)).rejects.toBeTruthy();
    expect(fake.rpcs.map((r) => r.fn)).toEqual(["purge_deleted"]);
  });
});

test.describe("the route", () => {
  const route = () => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "recipes", "route.ts"), "utf8"));

  test("creating needs meals:write, which family:read alone does not give; no new scope", () => {
    const source = route();
    expect(source).toContain('withIntegrationAuth(request, "meals:write"');
    // Searching stays a read.
    expect(source).toContain('withIntegrationAuth(request, "family:read"');
    expect(hasScope(["family:read"], "meals:write")).toBe(false);
    expect(TOOL_SCOPES.create_recipe).toBe("meals:write");
  });

  test("a create takes an Idempotency-Key, and a refusal is answered before anything is written", () => {
    const source = route();
    const post = source.slice(source.indexOf("export async function POST"));
    expect(post).toContain("validateIdempotencyKey(");
    expect(post).toContain("findStoredResult(");
    expect(post).toContain('fingerprintRequest("recipes.create", body)');
    const refused = post.indexOf("if (!parsed.ok)");
    expect(refused).toBeGreaterThan(-1);
    expect(refused).toBeLessThan(post.indexOf("createRecipe("));
    expect(post).toContain("createRecipe(context.familyId,");
  });

  test("a search also says which language the family's recipes are written in", () => {
    expect(route()).toContain("familyContentLanguage(context.familyId)");
  });
});
