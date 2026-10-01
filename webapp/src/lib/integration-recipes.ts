/**
 * Recipes for assistants (RFC-012): find the family's recipes, read one, and
 * put its ingredients on the shopping list.
 *
 * The add is the recipe page's `useAddRecipeToShoppingList`
 * (hooks/use-recipes.ts) on the server: quantities scaled by target over
 * recipe servings, the catalogue match for category, picture (thumbnail
 * first) and catalogue id, the ingredient's own category and then
 * "sonstiges" as fallbacks, `recipe_id` on every row, one bulk insert. Two
 * additions the page does not need: each added item is put on Bring! when
 * two-way sync is on (the page's shopping list does that itself; an
 * assistant has no page), and an ingredient id that is not in the recipe is
 * refused rather than silently ignored — an assistant sending one is
 * confused, and adding "the rest" would hide that.
 *
 * The admin client carries the service role and so bypasses RLS and the
 * `deleted_at IS NULL` the browser policies add: every recipe read here
 * filters family and `deleted_at` itself. A binned recipe is gone for an
 * assistant; another family's does not exist.
 *
 * The database, catalogue and Bring! are parameters with production
 * defaults, so all of this is tested without a stack.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { parseInstructions } from "@/lib/recipe-instructions";
import { matchCatalogItems, type CatalogMatch } from "@/lib/catalog-match";
import { pushToBring, type BringPushDeps } from "@/lib/shopping-enrich";
import { getMergedSetting } from "@/lib/integration-secrets";
import type { ServerBringSettings } from "@/lib/bring-server";

const defaultLoadBringSettings = (familyId: string) =>
  getMergedSetting<ServerBringSettings>(familyId, "bring_settings");

/** The slice of the Supabase client used here; a test passes a fake. */
export type RecipeDb = ReturnType<typeof createAdminClient>;

export const DEFAULT_RECIPE_RESULTS = 20;
export const MAX_RECIPE_RESULTS = 50;
export const MAX_RECIPE_QUERY = 200;
/** Same bound as a meal's servings. */
export const MAX_RECIPE_SERVINGS = 50;
export const MAX_INGREDIENT_IDS = 200;
/** What the recipes table defaults to, and what the page assumes when it is unset. */
const DEFAULT_SERVINGS = 4;
/** More than any household's recipe box; a search scans at most this many. */
const MAX_SCANNED = 1000;
/** How long the catalogue may take before the items are added without pictures. */
const CATALOG_TIMEOUT_MS = 4_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RecipeSearch {
  query: string | null;
  tag: string | null;
  limit: number;
}

export function parseRecipeSearch(params: URLSearchParams): Result<RecipeSearch> {
  const query = params.get("query")?.trim() || null;
  const tag = params.get("tag")?.trim() || null;
  if ((query?.length ?? 0) > MAX_RECIPE_QUERY || (tag?.length ?? 0) > MAX_RECIPE_QUERY) {
    return { ok: false, error: `\`query\` and \`tag\` may be at most ${MAX_RECIPE_QUERY} characters` };
  }
  const rawLimit = params.get("limit");
  let limit = DEFAULT_RECIPE_RESULTS;
  if (rawLimit !== null && rawLimit.trim() !== "") {
    if (!/^\d+$/.test(rawLimit.trim())) {
      return { ok: false, error: `\`limit\` must be a whole number from 1 to ${MAX_RECIPE_RESULTS}` };
    }
    limit = Number(rawLimit.trim());
    if (limit < 1 || limit > MAX_RECIPE_RESULTS) {
      return { ok: false, error: `\`limit\` must be a whole number from 1 to ${MAX_RECIPE_RESULTS}` };
    }
  }
  return { ok: true, value: { query, tag, limit } };
}

export interface RecipeSummary {
  id: string;
  title: string;
  servings: number;
  total_time_minutes: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  difficulty: string | null;
  tags: string[];
  is_favorite: boolean;
  image_url: string | null;
}

export interface RecipeIngredientOut {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  group: string | null;
  notes: string | null;
  sort_order: number;
}

export interface RecipeDetail extends RecipeSummary {
  description: string | null;
  source_url: string | null;
  ingredients: RecipeIngredientOut[];
  instructions: string[];
}

interface RecipeRow {
  id: string;
  title: string;
  description?: string | null;
  source_url?: string | null;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  difficulty: string | null;
  is_favorite: boolean | null;
  image_url: string | null;
  instructions?: unknown;
  tags?: { name: string }[] | null;
  ingredients?: IngredientRow[] | null;
}

interface IngredientRow {
  id: string;
  name: string;
  quantity: number | string | null;
  unit: string | null;
  group_name: string | null;
  notes: string | null;
  category: string | null;
  sort_order: number | null;
}

const SUMMARY_COLUMNS =
  "id, title, servings, prep_time_minutes, cook_time_minutes, total_time_minutes, difficulty, is_favorite, image_url, tags:recipe_tags(name)";
const DETAIL_COLUMNS =
  `${SUMMARY_COLUMNS}, description, source_url, instructions, ` +
  "ingredients:recipe_ingredients(id, name, quantity, unit, group_name, notes, category, sort_order)";

const tagNames = (row: RecipeRow) => (row.tags ?? []).map((t) => t.name).filter((n): n is string => typeof n === "string");
const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const servingsOf = (row: Pick<RecipeRow, "servings">) => row.servings || DEFAULT_SERVINGS;

function toSummary(row: RecipeRow): RecipeSummary {
  return {
    id: row.id,
    title: row.title,
    servings: servingsOf(row),
    total_time_minutes: row.total_time_minutes ?? null,
    prep_time_minutes: row.prep_time_minutes ?? null,
    cook_time_minutes: row.cook_time_minutes ?? null,
    difficulty: row.difficulty ?? null,
    tags: tagNames(row),
    is_favorite: row.is_favorite === true,
    image_url: row.image_url ?? null,
  };
}

const sortedIngredients = (row: RecipeRow) =>
  [...(row.ingredients ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

/**
 * The family's live recipes matching `query` (a substring of the title or
 * of a tag name) and `tag` (a whole tag name), both case-insensitive;
 * favourites first, then by title. Filtering happens here rather than in
 * PostgREST because "title or any tag" spans an embedded relation, and a
 * household's recipe box is small.
 */
export async function searchRecipes(familyId: string, search: RecipeSearch, db: RecipeDb = createAdminClient()): Promise<RecipeSummary[]> {
  const { data, error } = await (db as any)
    .from("recipes")
    .select(SUMMARY_COLUMNS)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    // Ordered before the cap, so a family past it loses the same rows every time.
    .order("is_favorite", { ascending: false })
    .order("title")
    .limit(MAX_SCANNED);
  if (error) throw error;

  const query = search.query?.toLowerCase() ?? null;
  const tag = search.tag?.toLowerCase() ?? null;
  return ((data ?? []) as RecipeRow[])
    .filter((row) => {
      const tags = tagNames(row).map((t) => t.toLowerCase());
      if (tag && !tags.includes(tag)) return false;
      if (query && !row.title.toLowerCase().includes(query) && !tags.some((t) => t.includes(query))) return false;
      return true;
    })
    .sort((a, b) => Number(b.is_favorite === true) - Number(a.is_favorite === true) || a.title.localeCompare(b.title))
    .slice(0, search.limit)
    .map(toSummary);
}

async function loadRecipe(familyId: string, recipeId: string, db: RecipeDb): Promise<RecipeRow | null> {
  const { data, error } = await (db as any)
    .from("recipes")
    .select(DETAIL_COLUMNS)
    .eq("id", recipeId)
    .eq("family_id", familyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as RecipeRow | null) ?? null;
}

/** One live recipe of this family, or null — binned and foreign alike. */
export async function getRecipe(familyId: string, recipeId: string, db: RecipeDb = createAdminClient()): Promise<RecipeDetail | null> {
  const row = await loadRecipe(familyId, recipeId, db);
  if (!row) return null;
  return {
    ...toSummary(row),
    description: row.description ?? null,
    source_url: row.source_url ?? null,
    ingredients: sortedIngredients(row).map((ing) => ({
      id: ing.id,
      name: ing.name,
      quantity: toNumber(ing.quantity),
      unit: ing.unit ?? null,
      group: ing.group_name ?? null,
      notes: ing.notes ?? null,
      sort_order: ing.sort_order ?? 0,
    })),
    instructions: parseInstructions(row.instructions).map((step) => step.text),
  };
}

export interface RecipeShoppingInput {
  servings?: number;
  ingredientIds?: string[];
}

/**
 * The POST body as an object. No body at all means "everything at the
 * recipe's servings"; anything else must be a JSON object. A garbled or
 * truncated body is refused rather than read as `{}` — here `{}` is a valid
 * request that puts the whole recipe on the list, so falling back to it
 * would turn "not understood" into "added everything".
 */
export function parseRecipeShoppingBody(text: string): Result<Record<string, unknown>> {
  if (text.trim() === "") return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "the body must be a JSON object" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "the body must be a JSON object" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export function parseRecipeShoppingInput(body: Record<string, unknown>): Result<RecipeShoppingInput> {
  const value: RecipeShoppingInput = {};
  if (body.servings !== undefined) {
    const s = body.servings;
    if (typeof s !== "number" || !Number.isInteger(s) || s < 1 || s > MAX_RECIPE_SERVINGS) {
      return { ok: false, error: `\`servings\` must be a whole number from 1 to ${MAX_RECIPE_SERVINGS}` };
    }
    value.servings = s;
  }
  if (body.ingredient_ids !== undefined) {
    const ids = body.ingredient_ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_INGREDIENT_IDS || !ids.every(isUuid)) {
      return { ok: false, error: `\`ingredient_ids\` must be a list of 1 to ${MAX_INGREDIENT_IDS} ingredient ids from get_recipe` };
    }
    value.ingredientIds = [...new Set(ids.map((id) => id.toLowerCase()))];
  }
  return { ok: true, value };
}

/**
 * The page's `ing.quantity ? ing.quantity * multiplier : null` — so a zero
 * quantity, like a missing one, is no quantity — rounded to the two places
 * `shopping_items.quantity` (DECIMAL(10,2)) keeps, so the answer says what
 * was stored.
 */
export function scaleQuantity(quantity: number | null, multiplier: number): number | null {
  const n = toNumber(quantity);
  if (!n) return null;
  return Math.round(n * multiplier * 100) / 100;
}

export type CatalogMatchFn = (familyId: string, names: string[]) => Promise<Record<string, CatalogMatch | null>>;

export interface AddedShoppingItem {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
}

export type AddRecipeResult =
  | { added: AddedShoppingItem[] }
  | { error: "unknown_ingredients"; ids: string[] };

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Put a recipe's ingredients (or the chosen ones) on the family's shopping
 * list. Null when the recipe is not this family's live recipe. Throws only
 * when reading the recipe or the insert fails; the catalogue and Bring!
 * cannot fail it.
 */
export async function addRecipeToShoppingList(
  familyId: string,
  recipeId: string,
  input: RecipeShoppingInput,
  deps: { db?: RecipeDb; match?: CatalogMatchFn; bring?: Partial<BringPushDeps> } = {},
): Promise<AddRecipeResult | null> {
  const db = deps.db ?? createAdminClient();
  const match = deps.match ?? ((id, names) => matchCatalogItems(id, names));

  const recipe = await loadRecipe(familyId, recipeId, db);
  if (!recipe) return null;

  const recipeServings = servingsOf(recipe);
  const multiplier = (input.servings || recipeServings) / recipeServings;

  let ingredients = sortedIngredients(recipe);
  if (input.ingredientIds) {
    const wanted = new Set(input.ingredientIds);
    const known = new Set(ingredients.map((ing) => ing.id.toLowerCase()));
    const unknown = input.ingredientIds.filter((id) => !known.has(id));
    if (unknown.length > 0) return { error: "unknown_ingredients", ids: unknown };
    ingredients = ingredients.filter((ing) => wanted.has(ing.id.toLowerCase()));
  }
  if (ingredients.length === 0) return { added: [] };

  let matches: Record<string, CatalogMatch | null> = {};
  try {
    matches = await withTimeout(match(familyId, ingredients.map((ing) => ing.name)), CATALOG_TIMEOUT_MS, "catalogue match");
  } catch (err) {
    console.error("[integration-recipes] catalogue match failed, adding without pictures:", err);
  }

  const rows = ingredients.map((ing) => {
    const found = matches[ing.name.toLowerCase().trim()];
    return {
      family_id: familyId,
      name: ing.name,
      quantity: scaleQuantity(toNumber(ing.quantity), multiplier),
      unit: ing.unit ?? null,
      notes: ing.notes ?? null,
      category: found?.category || ing.category || "sonstiges",
      image_url: found?.thumbnail_url || found?.image_url || null,
      catalog_item_id: found?.id || null,
      recipe_id: recipe.id,
      // An assistant is not a Kinboard screen; no device added these.
      source_device_id: null,
      checked: false,
    };
  });

  const { data, error } = await (db as any)
    .from("shopping_items")
    .insert(rows)
    .select("id, name, quantity, unit");
  if (error) throw error;

  const added: AddedShoppingItem[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    quantity: toNumber(row.quantity),
    unit: (row.unit as string | null) ?? null,
  }));

  // In parallel: each push has its own timeout, and a recipe's worth of
  // sequential ones could keep the assistant waiting for a minute.
  // The settings are read once, not once per item.
  const loadSettings = deps.bring?.loadSettings ?? defaultLoadBringSettings;
  let settings: ServerBringSettings | null = null;
  try {
    settings = await loadSettings(familyId);
  } catch (err) {
    console.error("[integration-recipes] reading the Bring! settings failed; nothing goes to Bring!:", err);
  }
  if (settings) {
    const bring = { ...deps.bring, loadSettings: async () => settings };
    await Promise.all(added.map((item) => pushToBring(familyId, item, bring)));
  }

  return { added };
}
