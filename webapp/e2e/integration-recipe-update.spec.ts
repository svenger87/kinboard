import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRecipeUpdate,
  updateRecipe,
  MAX_RECIPE_INGREDIENTS,
  RECIPE_UPDATE_FIELDS,
  type RecipeDb,
  type RecipePatch,
} from "../src/lib/integration-recipes";
import { hasScope } from "../src/lib/integration-auth";
import { TOOL_SCOPES } from "../src/lib/mcp/server";
import { codeOnly } from "./source-helpers";

/**
 * PATCH /api/integration/v1/recipes/{id}: an assistant changes a saved
 * recipe -- "use crème fraîche instead of cream in the one we saved", or the
 * duplicate case create_recipe asks about ("update that one"). The rows are
 * the ones the recipe page's useUpdateRecipe writes, with the service-role
 * client, so family scoping and all-or-nothing are the code's job and are
 * tested here.
 *
 * No stack: the database is a fake that applies the filters it is given and
 * assembles the recipe's embedded tags and ingredients the way PostgREST
 * does, and can be told to fail one statement.
 */

const OURS = "11111111-1111-1111-1111-111111111111";
const THEIRS = "22222222-2222-2222-2222-222222222222";
const RECIPE = "33333333-3333-4333-8333-333333333333";
const BINNED = "44444444-4444-4444-8444-444444444444";
const FOREIGN = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;
type Filter = [op: "eq" | "is" | "in" | "not-in", column: string, value: unknown];

const seed = (): Record<string, Row[]> => ({
  recipes: [
    {
      id: RECIPE, family_id: OURS, deleted_at: null, title: "Nudelauflauf", description: "Für Mittwoch",
      source_url: null, servings: 4, prep_time_minutes: 15, cook_time_minutes: 30, total_time_minutes: 45,
      difficulty: "easy", is_favorite: true, image_url: "recipes/auflauf.jpg",
      instructions: [{ step: 1, text: "Nudeln kochen." }, { step: 2, text: "Mit Sahne backen." }],
    },
    { id: BINNED, family_id: OURS, deleted_at: "2026-10-01T10:00:00Z", title: "Alt", servings: 2, instructions: [] },
    { id: FOREIGN, family_id: THEIRS, deleted_at: null, title: "Nudelauflauf", servings: 4, instructions: [] },
  ],
  recipe_ingredients: [
    { id: "ing-1", recipe_id: RECIPE, name: "Nudeln", quantity: 500, unit: "g", group_name: null, notes: null, category: null, sort_order: 0 },
    { id: "ing-2", recipe_id: RECIPE, name: "Sahne", quantity: 200, unit: "ml", group_name: null, notes: null, category: null, sort_order: 1 },
    { id: "ing-foreign", recipe_id: FOREIGN, name: "Sahne", quantity: 200, unit: "ml", group_name: null, notes: null, category: null, sort_order: 0 },
  ],
  recipe_tags: [
    { id: "tag-ours", family_id: OURS, name: "Pasta" },
    { id: "tag-ours-2", family_id: OURS, name: "vegetarisch" },
    { id: "tag-theirs", family_id: THEIRS, name: "Schnell" },
  ],
  recipe_tag_assignments: [
    { recipe_id: RECIPE, tag_id: "tag-ours" },
    { recipe_id: FOREIGN, tag_id: "tag-theirs" },
  ],
});

function fakeDb() {
  const tables = seed();
  const log: string[] = [];
  let failOn: string | null = null;
  let nextId = 1;
  const matches = (row: Row, filters: Filter[]) => filters.every(([op, column, value]) => {
    if (op === "is") return (row[column] ?? null) === value;
    if (op === "in") return (value as unknown[]).includes(row[column]);
    if (op === "not-in") return !(value as string[]).includes(String(row[column]));
    return row[column] === value;
  });
  // One statement fails, once: what a lost connection or a timeout does. The
  // undo that follows then reaches the database as normal.
  const fail = (op: string, table: string) => {
    if (failOn !== `${op}:${table}`) return null;
    failOn = null;
    return { message: `${op} ${table} failed` };
  };
  /** A recipe row as PostgREST embeds it: its tags by name and its ingredients. */
  const embed = (table: string, row: Row) => table !== "recipes" ? { ...row } : {
    ...row,
    tags: tables.recipe_tag_assignments
      .filter((a) => a.recipe_id === row.id)
      .map((a) => tables.recipe_tags.find((t) => t.id === a.tag_id))
      .filter(Boolean)
      .map((t) => ({ name: (t as Row).name })),
    ingredients: tables.recipe_ingredients.filter((i) => i.recipe_id === row.id).map((i) => ({ ...i })),
  };

  /** A filter chain that ends in a read, an update, or a delete. */
  const chain = (table: string, finish: (filters: Filter[]) => { data: unknown; error: unknown }) => {
    const filters: Filter[] = [];
    const c = {
      eq(column: string, value: unknown) { filters.push(["eq", column, value]); return c; },
      is(column: string, value: unknown) { filters.push(["is", column, value]); return c; },
      in(column: string, values: unknown[]) { filters.push(["in", column, values]); return c; },
      not(column: string, _op: string, list: string) {
        filters.push(["not-in", column, list.replace(/[()]/g, "").split(",").filter(Boolean)]);
        return c;
      },
      select() { return c; },
      async maybeSingle() {
        const { data, error } = finish(filters);
        return { data: Array.isArray(data) ? data[0] ?? null : data, error };
      },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve(finish(filters)).then(resolve); },
    };
    return c;
  };

  const db = {
    from(table: string) {
      const rows = () => (tables[table] ??= []);
      return {
        select(_columns: string) {
          log.push(`select:${table}`);
          return chain(table, (filters) => ({ data: rows().filter((r) => matches(r, filters)).map((r) => embed(table, r)), error: null }));
        },
        insert(input: Row | Row[]) {
          log.push(`insert:${table}`);
          const error = fail("insert", table);
          const stored = error ? [] : (Array.isArray(input) ? input : [input]).map((row) => ({ id: `${table}-new-${nextId++}`, ...row }));
          if (!error) rows().push(...stored);
          const result = { data: stored, error };
          return {
            select: () => ({ then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) }),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error }).then(resolve),
          };
        },
        update(values: Row) {
          log.push(`update:${table}`);
          return chain(table, (filters) => {
            const error = fail("update", table);
            if (error) return { data: null, error };
            const hit = rows().filter((r) => matches(r, filters));
            for (const r of hit) Object.assign(r, values);
            return { data: hit.map((r) => ({ id: r.id })), error: null };
          });
        },
        delete() {
          log.push(`delete:${table}`);
          return chain(table, (filters) => {
            const error = fail("delete", table);
            if (error) return { data: null, error };
            tables[table] = rows().filter((r) => !matches(r, filters));
            return { data: null, error: null };
          });
        },
        upsert(input: Row[]) {
          log.push(`upsert:${table}`);
          const error = fail("upsert", table);
          if (!error) {
            for (const row of input) {
              if (!rows().some((r) => r.recipe_id === row.recipe_id && r.tag_id === row.tag_id)) rows().push(row);
            }
          }
          return Promise.resolve({ error });
        },
      };
    },
  };
  return { db: db as unknown as RecipeDb, tables, log, failOn(what: string | null) { failOn = what; } };
}

/** The tables a recipe change may touch, without the timestamp the change stamps. */
const recipeState = (tables: Record<string, Row[]>) => ({
  recipes: tables.recipes.map(({ updated_at: _u, ...row }) => row),
  // Rows, not their order in the table: a link taken out and put back is the same link.
  recipe_ingredients: [...tables.recipe_ingredients].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  recipe_tag_assignments: [...tables.recipe_tag_assignments].sort((a, b) => `${a.recipe_id}${a.tag_id}`.localeCompare(`${b.recipe_id}${b.tag_id}`)),
});

const parsed = (body: Record<string, unknown>): RecipePatch => {
  const result = parseRecipeUpdate(body);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

test.describe("parseRecipeUpdate", () => {
  test("only the fields sent come back, checked and trimmed as on create", () => {
    expect(parsed({ title: "  Nudelauflauf mit Brokkoli " })).toEqual({ title: "Nudelauflauf mit Brokkoli" });
    expect(parsed({ servings: 6, prep_time_minutes: 20 })).toEqual({ servings: 6, prepTimeMinutes: 20 });
    expect(parsed({ ingredients: [{ name: " Crème fraîche ", quantity: 200, unit: "g" }] })).toEqual({
      ingredients: [{ name: "Crème fraîche", quantity: 200, unit: "g", group: null, notes: null }],
    });
    expect(parsed({ instructions: ["Nudeln kochen.", " Backen. "] })).toEqual({ steps: ["Nudeln kochen.", "Backen."] });
  });

  test("null clears the description and the times; an empty tag list removes every tag", () => {
    expect(parsed({ description: null, prep_time_minutes: null, cook_time_minutes: null }))
      .toEqual({ description: null, prepTimeMinutes: null, cookTimeMinutes: null });
    expect(parsed({ tags: [] })).toEqual({ tags: [] });
  });

  test("nothing to change, or a field that cannot be changed, is refused", () => {
    expect(parseRecipeUpdate({}).ok).toBe(false);
    for (const key of ["image_url", "is_favorite", "source_url", "family_id", "id", "steps"]) {
      const result = parseRecipeUpdate({ title: "x", [key]: "y" });
      expect(result, key).toEqual({ ok: false, error: expect.stringContaining(`\`${key}\` cannot be changed here`) });
    }
    expect(RECIPE_UPDATE_FIELDS).toEqual(["title", "description", "servings", "prep_time_minutes", "cook_time_minutes", "tags", "ingredients", "instructions"]);
  });

  test("bad values are refused, not dropped", () => {
    for (const bad of [
      { title: "" }, { title: null }, { servings: 0 }, { servings: null }, { servings: 2.5 },
      { prep_time_minutes: -1 }, { cook_time_minutes: 1441 }, { description: 5 },
      { tags: null }, { tags: ["x".repeat(51)] },
      { ingredients: [] }, { ingredients: null }, { ingredients: [{ quantity: 2 }] }, { ingredients: [{ name: "Mehl", quantity: 0 }] },
      { ingredients: Array.from({ length: MAX_RECIPE_INGREDIENTS + 1 }, () => ({ name: "x" })) },
      { instructions: [] }, { instructions: "Alles kochen." }, { instructions: [""] },
    ]) {
      expect(parseRecipeUpdate(bad).ok, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
});

test.describe("updateRecipe", () => {
  test("another family's recipe and a binned one are not found, and nothing is written", async () => {
    for (const id of [FOREIGN, BINNED, "66666666-6666-4666-8666-666666666666"]) {
      const fake = fakeDb();
      const before = JSON.stringify(fake.tables);
      expect(await updateRecipe(OURS, id, parsed({ title: "Gekapert" }), fake.db), id).toBeNull();
      expect(JSON.stringify(fake.tables)).toBe(before);
      expect(fake.log, id).toEqual(["select:recipes"]);
    }
  });

  test("a title change touches the row only: ingredients, their ids and the tags stay", async () => {
    const fake = fakeDb();
    const recipe = await updateRecipe(OURS, RECIPE, parsed({ title: "Nudelauflauf mit Brokkoli" }), fake.db);
    expect(fake.log).toEqual(["select:recipes", "update:recipes"]);
    expect(fake.tables.recipes[0]).toMatchObject({ title: "Nudelauflauf mit Brokkoli", description: "Für Mittwoch", servings: 4 });
    expect(fake.tables.recipes[0].updated_at).toEqual(expect.any(String));
    expect(recipe?.ingredients.map((i) => i.id)).toEqual(["ing-1", "ing-2"]);
    expect(recipe?.tags).toEqual(["Pasta"]);
    expect(recipe?.instructions).toEqual(["Nudeln kochen.", "Mit Sahne backen."]);
    // The other family's recipe of the same name is untouched.
    expect(fake.tables.recipes[2].title).toBe("Nudelauflauf");
  });

  test("ingredients are replaced as a whole list, in order, with new ids the answer carries", async () => {
    const fake = fakeDb();
    const recipe = await updateRecipe(OURS, RECIPE, parsed({
      ingredients: [{ name: "Nudeln", quantity: 500, unit: "g" }, { name: "Crème fraîche", quantity: 200, unit: "g" }],
    }), fake.db);
    const ours = fake.tables.recipe_ingredients.filter((r) => r.recipe_id === RECIPE);
    expect(ours.map((r) => [r.name, r.sort_order])).toEqual([["Nudeln", 0], ["Crème fraîche", 1]]);
    expect(ours.map((r) => r.id)).not.toContain("ing-1");
    expect(recipe?.ingredients.map((i) => i.id)).toEqual(ours.map((r) => r.id));
    expect(recipe?.ingredients[1]).toMatchObject({ name: "Crème fraîche", quantity: 200, unit: "g" });
    // Another recipe's ingredients are never touched.
    expect(fake.tables.recipe_ingredients.find((r) => r.id === "ing-foreign")).toBeTruthy();
    // The new rows go in before the old ones are deleted.
    expect(fake.log.indexOf("insert:recipe_ingredients")).toBeLessThan(fake.log.indexOf("delete:recipe_ingredients"));
  });

  test("times: total is prep plus cook again; null clears one", async () => {
    const fake = fakeDb();
    const recipe = await updateRecipe(OURS, RECIPE, parsed({ cook_time_minutes: 40 }), fake.db);
    expect(fake.tables.recipes[0]).toMatchObject({ prep_time_minutes: 15, cook_time_minutes: 40, total_time_minutes: 55 });
    expect(recipe).toMatchObject({ prep_time_minutes: 15, cook_time_minutes: 40, total_time_minutes: 55 });
    await updateRecipe(OURS, RECIPE, parsed({ prep_time_minutes: null, cook_time_minutes: null }), fake.db);
    expect(fake.tables.recipes[0]).toMatchObject({ prep_time_minutes: null, cook_time_minutes: null, total_time_minutes: null });
  });

  test("steps are replaced and numbered from 1, as on create", async () => {
    const fake = fakeDb();
    await updateRecipe(OURS, RECIPE, parsed({ instructions: ["Nudeln kochen.", "Mit Crème fraîche mischen.", "Backen."] }), fake.db);
    expect(fake.tables.recipes[0].instructions).toEqual([
      { step: 1, text: "Nudeln kochen." }, { step: 2, text: "Mit Crème fraîche mischen." }, { step: 3, text: "Backen." },
    ]);
  });

  test("tags: this family's tag is reused whatever its case, another family's never is", async () => {
    const fake = fakeDb();
    const recipe = await updateRecipe(OURS, RECIPE, parsed({ tags: ["Vegetarisch", "Schnell"] }), fake.db);
    const created = fake.tables.recipe_tags.filter((t) => !String(t.id).startsWith("tag-"));
    expect(created).toEqual([expect.objectContaining({ family_id: OURS, name: "Schnell" })]);
    expect(fake.tables.recipe_tag_assignments.filter((a) => a.recipe_id === RECIPE)).toEqual([
      { recipe_id: RECIPE, tag_id: "tag-ours-2" },
      { recipe_id: RECIPE, tag_id: created[0].id },
    ]);
    expect(recipe?.tags).toEqual(["Vegetarisch", "Schnell"]);
  });

  test("the description changes or clears; picture, favourite and source are kept", async () => {
    const fake = fakeDb();
    const recipe = await updateRecipe(OURS, RECIPE, parsed({ description: "From: Das große Kochbuch" }), fake.db);
    expect(recipe).toMatchObject({ description: "From: Das große Kochbuch", is_favorite: true, image_url: "recipes/auflauf.jpg", difficulty: "easy" });
    await updateRecipe(OURS, RECIPE, parsed({ description: null }), fake.db);
    expect(fake.tables.recipes[0].description).toBeNull();
  });

  /**
   * All or nothing. Each statement of a full change is made to fail in turn;
   * whichever it is, the recipe, its ingredients and its tag links are
   * exactly as they were, and the error reaches the caller. (A tag the
   * family did not have before may stay behind, unlinked, as the recipe
   * page leaves one.)
   */
  for (const failing of ["insert:recipe_ingredients", "update:recipes", "upsert:recipe_tag_assignments", "delete:recipe_ingredients"]) {
    test(`a failure at ${failing} leaves the recipe exactly as it was`, async () => {
      const fake = fakeDb();
      const before = recipeState(seed());
      fake.failOn(failing);
      await expect(updateRecipe(OURS, RECIPE, parsed({
        title: "Halb geändert",
        cook_time_minutes: 99,
        instructions: ["Ein einziger Schritt."],
        tags: ["Neu"],
        ingredients: [{ name: "Etwas anderes", quantity: 1 }],
      }), fake.db)).rejects.toMatchObject({ message: `${failing.replace(":", " ")} failed` });
      expect(recipeState(fake.tables)).toEqual(before);
    });
  }
});

test.describe("the route", () => {
  const route = () => codeOnly(readFileSync(join(__dirname, "..", "src", "app", "api", "integration", "v1", "recipes", "[id]", "route.ts"), "utf8"));
  const patch = () => route().slice(route().indexOf("export async function PATCH"));

  test("changing needs meals:write, which family:read alone does not give; no new scope", () => {
    expect(patch()).toContain('withIntegrationAuth(request, "meals:write"');
    // Reading stays a read.
    expect(route()).toContain('withIntegrationAuth(request, "family:read"');
    expect(hasScope(["family:read"], "meals:write")).toBe(false);
    expect(TOOL_SCOPES.update_recipe).toBe("meals:write");
  });

  test("an Idempotency-Key is required and tied to this recipe; a refusal is answered before anything is written", () => {
    const source = patch();
    expect(source).toContain("validateIdempotencyKey(");
    expect(source).toContain("findStoredResult(");
    expect(source).toContain("fingerprintRequest(`recipes.update:${id}`, body)");
    const refused = source.indexOf("if (!parsed.ok)");
    expect(refused).toBeGreaterThan(-1);
    expect(refused).toBeLessThan(source.indexOf("updateRecipe("));
    expect(source).toContain("updateRecipe(context.familyId, id,");
  });

  test("it counts against the limit on edits and deletes, and a bad or unknown id is not found", () => {
    const source = patch();
    expect(source).toContain("destructiveLimitResponse(context)");
    expect(source).toContain("if (!isUuid(id))");
    expect(source).toMatch(/if \(!recipe\) \{\s*return NextResponse\.json\(\{ error: "no such recipe", code: "not_found" \}, \{ status: 404 \}\)/);
  });
});
