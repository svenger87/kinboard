/**
 * Recipes for assistants (RFC-012): find the family's recipes, read one, save
 * a new one, and put its ingredients on the shopping list.
 *
 * The add is the recipe page's `useAddRecipeToShoppingList`
 * (hooks/use-recipes.ts) on the server: quantities scaled by target over
 * recipe servings, the catalogue match for category, picture (thumbnail
 * first) and catalogue id, the ingredient's own category and then
 * "sonstiges" as fallbacks, `recipe_id` on every row, one bulk insert —
 * except that an ingredient already on the list, unticked, is merged into
 * that item instead (lib/shopping-merge.ts), which the page does not do. Two
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
import {
  addOrMergeShoppingItems,
  pushToBring,
  supabaseShoppingStore,
  type BringPushDeps,
  type ShoppingAddRow,
} from "@/lib/shopping-enrich";
import { getMergedSetting } from "@/lib/integration-secrets";
import type { ServerBringSettings } from "@/lib/bring-server";
import { syncRecipeTags } from "@/lib/recipe-tags";

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
  /** The item's quantity now — after a merge, the combined one. */
  quantity: number | null;
  unit: string | null;
  /** quantity and unit as printed on the list ("750 g", "2 Stück + 1 Packung"). */
  amount: string | null;
  /** True when this ingredient went into an item already on the list. */
  merged: boolean;
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

  const rows: ShoppingAddRow[] = ingredients.map((ing) => {
    const found = matches[ing.name.toLowerCase().trim()];
    return {
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
    };
  });

  // An ingredient already on the list (unticked) is merged into it rather
  // than added twice — two recipes that both need milk leave one milk
  // (lib/shopping-merge.ts). A merged item keeps the recipe it came from.
  const { outcomes, changed } = await addOrMergeShoppingItems(familyId, rows, supabaseShoppingStore(db));
  const added: AddedShoppingItem[] = outcomes.map(({ merged, item }) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    amount: item.amount,
    merged,
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
    await Promise.all(changed.map((item) => pushToBring(familyId, item, bring)));
  }

  return { added };
}

// ---------------------------------------------------------------------------
// Saving a recipe: what the recipe page's useCreateRecipe writes
// (hooks/use-recipes.ts), from an assistant. The bounds are the Integration
// API's, not the form's (the form has none): enough for any real recipe, and
// small enough that a runaway model cannot fill the collection with a novel.
// ---------------------------------------------------------------------------

export const MAX_RECIPE_TITLE = 200;
export const MAX_RECIPE_DESCRIPTION = 2000;
/** A day, for prep and for cooking each. */
export const MAX_RECIPE_MINUTES = 1440;
export const MAX_RECIPE_TAGS = 10;
export const MAX_RECIPE_TAG = 50;
export const MAX_RECIPE_INGREDIENTS = 100;
export const MAX_INGREDIENT_NAME = 200;
export const MAX_INGREDIENT_UNIT = 30;
export const MAX_INGREDIENT_GROUP = 100;
export const MAX_INGREDIENT_NOTES = 300;
/** `recipe_ingredients.quantity` is DECIMAL(10,2); this stays well inside it. */
export const MAX_INGREDIENT_QUANTITY = 100_000;
export const MAX_RECIPE_STEPS = 50;
export const MAX_RECIPE_STEP = 2000;

export interface NewIngredient {
  name: string;
  quantity: number | null;
  unit: string | null;
  group: string | null;
  notes: string | null;
}

export interface NewRecipe {
  title: string;
  description: string | null;
  servings: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  tags: string[];
  ingredients: NewIngredient[];
  steps: string[];
}

/** A trimmed string of 1..max characters, absent, or a refusal. */
function optionalText(value: unknown, max: number, field: string): Result<string | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string" || value.trim().length > max) {
    return { ok: false, error: `\`${field}\` must be text of at most ${max} characters` };
  }
  return { ok: true, value: value.trim() || null };
}

function wholeNumber(value: unknown, min: number, max: number, field: string): Result<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `\`${field}\` must be a whole number from ${min} to ${max}` };
  }
  return { ok: true, value };
}

/** `tags`, checked: names of 1..MAX_RECIPE_TAG characters, two spellings of one name kept once. */
function parseTags(value: unknown): Result<string[]> {
  const tags: string[] = [];
  if (value === undefined || value === null) return { ok: true, value: tags };
  const tagError = `\`tags\` must be a list of at most ${MAX_RECIPE_TAGS} names of 1 to ${MAX_RECIPE_TAG} characters`;
  if (!Array.isArray(value) || value.length > MAX_RECIPE_TAGS) return { ok: false, error: tagError };
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || !raw.trim() || raw.trim().length > MAX_RECIPE_TAG) return { ok: false, error: tagError };
    const name = raw.trim();
    // The page matches tags case-insensitively; two spellings are one tag.
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    tags.push(name);
  }
  return { ok: true, value: tags };
}

/** `ingredients`, checked: 1..MAX_RECIPE_INGREDIENTS, each with a name; quantity above 0 or left out. */
function parseIngredients(value: unknown): Result<NewIngredient[]> {
  const bad = (error: string): Result<NewIngredient[]> => ({ ok: false, error });
  const ingredientsError = `\`ingredients\` must be a list of 1 to ${MAX_RECIPE_INGREDIENTS}, each with a \`name\``;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPE_INGREDIENTS) {
    return bad(ingredientsError);
  }
  const ingredients: NewIngredient[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad(ingredientsError);
    const ing = raw as Record<string, unknown>;
    const at = `ingredients[${index}]`;
    if (typeof ing.name !== "string" || !ing.name.trim() || ing.name.trim().length > MAX_INGREDIENT_NAME) {
      return bad(`\`${at}.name\` is required, at most ${MAX_INGREDIENT_NAME} characters`);
    }
    let quantity: number | null = null;
    if (ing.quantity !== undefined && ing.quantity !== null) {
      if (typeof ing.quantity !== "number" || !Number.isFinite(ing.quantity) || ing.quantity <= 0 || ing.quantity > MAX_INGREDIENT_QUANTITY) {
        return bad(`\`${at}.quantity\` must be a number above 0 and at most ${MAX_INGREDIENT_QUANTITY}, or left out`);
      }
      quantity = ing.quantity;
    }
    const unit = optionalText(ing.unit, MAX_INGREDIENT_UNIT, `${at}.unit`);
    if (!unit.ok) return bad(unit.error);
    const group = optionalText(ing.group, MAX_INGREDIENT_GROUP, `${at}.group`);
    if (!group.ok) return bad(group.error);
    const notes = optionalText(ing.notes, MAX_INGREDIENT_NOTES, `${at}.notes`);
    if (!notes.ok) return bad(notes.error);
    ingredients.push({ name: ing.name.trim(), quantity, unit: unit.value, group: group.value, notes: notes.value });
  }
  return { ok: true, value: ingredients };
}

/** `instructions`, checked: 1..MAX_RECIPE_STEPS steps of 1..MAX_RECIPE_STEP characters, in order. */
function parseSteps(value: unknown): Result<string[]> {
  const stepsError = `\`instructions\` must be a list of 1 to ${MAX_RECIPE_STEPS} steps, each 1 to ${MAX_RECIPE_STEP} characters`;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPE_STEPS) {
    return { ok: false, error: stepsError };
  }
  const steps: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || !raw.trim() || raw.trim().length > MAX_RECIPE_STEP) return { ok: false, error: stepsError };
    steps.push(raw.trim());
  }
  return { ok: true, value: steps };
}

/** A title of 1..MAX_RECIPE_TITLE characters. */
function parseTitle(value: unknown): Result<string> {
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_RECIPE_TITLE) {
    return { ok: false, error: `\`title\` is required, at most ${MAX_RECIPE_TITLE} characters` };
  }
  return { ok: true, value: value.trim() };
}

/**
 * The POST body, checked. Every field is refused rather than dropped when it
 * is wrong: a recipe saved without the quantity the user agreed on is worse
 * than a 400 the assistant can read and fix.
 */
export function parseRecipeCreate(body: Record<string, unknown>): Result<NewRecipe> {
  const bad = (error: string): Result<NewRecipe> => ({ ok: false, error });

  const title = parseTitle(body.title);
  if (!title.ok) return bad(title.error);
  const description = optionalText(body.description, MAX_RECIPE_DESCRIPTION, "description");
  if (!description.ok) return bad(description.error);
  const servings = wholeNumber(body.servings, 1, MAX_RECIPE_SERVINGS, "servings");
  if (!servings.ok) return bad(servings.error);
  const prep = wholeNumber(body.prep_time_minutes, 0, MAX_RECIPE_MINUTES, "prep_time_minutes");
  if (!prep.ok) return bad(prep.error);
  const cook = wholeNumber(body.cook_time_minutes, 0, MAX_RECIPE_MINUTES, "cook_time_minutes");
  if (!cook.ok) return bad(cook.error);
  const tags = parseTags(body.tags);
  if (!tags.ok) return bad(tags.error);
  const ingredients = parseIngredients(body.ingredients);
  if (!ingredients.ok) return bad(ingredients.error);
  const steps = parseSteps(body.instructions);
  if (!steps.ok) return bad(steps.error);

  return {
    ok: true,
    value: {
      title: title.value,
      description: description.value,
      servings: servings.value ?? DEFAULT_SERVINGS,
      prepTimeMinutes: prep.value,
      cookTimeMinutes: cook.value,
      tags: tags.value,
      ingredients: ingredients.value,
      steps: steps.value,
    },
  };
}

/**
 * Take a recipe whose save failed half way back out: delete (which the soft
 * delete turns into the recycle bin) and then purge, as the recycle bin's
 * own "delete forever" does, so no half recipe is left in the collection or
 * the bin. A failure here is logged; the original error is what the caller
 * gets.
 */
async function discardRecipe(db: RecipeDb, familyId: string, recipeId: string) {
  try {
    const { error } = await (db as any).from("recipes").delete().eq("id", recipeId).eq("family_id", familyId);
    if (error) throw error;
    const purged = await (db as any).rpc("purge_deleted", { p_table: "recipes", p_id: recipeId });
    if (purged.error) throw purged.error;
  } catch (err) {
    console.error("[integration-recipes] could not take a half-saved recipe back out:", recipeId, err);
  }
}

/**
 * Save a recipe to the family's collection as the recipe page does: the
 * recipe (total time is prep plus cook, as the form computes it; steps
 * numbered from 1), its ingredients in the order given, and its tags through
 * the page's own syncRecipeTags. No picture, no source, not a favourite.
 *
 * All or nothing: if the ingredients or the tags cannot be stored, the
 * recipe is taken back out and the error thrown. Answers what was stored,
 * with the ids add_meal and add_recipe_to_shopping_list take.
 */
export async function createRecipe(familyId: string, input: NewRecipe, db: RecipeDb = createAdminClient()): Promise<RecipeDetail> {
  const total = input.prepTimeMinutes === null && input.cookTimeMinutes === null
    ? null
    : (input.prepTimeMinutes ?? 0) + (input.cookTimeMinutes ?? 0);
  const { data: recipe, error } = await (db as any)
    .from("recipes")
    .insert({
      family_id: familyId,
      title: input.title,
      description: input.description,
      servings: input.servings,
      prep_time_minutes: input.prepTimeMinutes,
      cook_time_minutes: input.cookTimeMinutes,
      total_time_minutes: total,
      instructions: input.steps.map((text, index) => ({ step: index + 1, text })),
    })
    .select("id")
    .single();
  if (error) throw error;
  const recipeId = String(recipe.id);

  let stored: IngredientRow[];
  try {
    const { data, error: ingredientsError } = await (db as any)
      .from("recipe_ingredients")
      .insert(input.ingredients.map((ing, index) => ({
        recipe_id: recipeId,
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        group_name: ing.group,
        notes: ing.notes,
        category: null,
        sort_order: index,
      })))
      .select("id, name, quantity, unit, group_name, notes, category, sort_order");
    if (ingredientsError) throw ingredientsError;
    stored = (data ?? []) as IngredientRow[];
    if (input.tags.length > 0) await syncRecipeTags(db, familyId, recipeId, input.tags);
  } catch (err) {
    await discardRecipe(db, familyId, recipeId);
    throw err;
  }

  return {
    id: recipeId,
    title: input.title,
    servings: input.servings,
    total_time_minutes: total,
    prep_time_minutes: input.prepTimeMinutes,
    cook_time_minutes: input.cookTimeMinutes,
    difficulty: null,
    tags: input.tags,
    is_favorite: false,
    image_url: null,
    description: input.description,
    source_url: null,
    ingredients: [...stored]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((ing) => ({
        id: String(ing.id),
        name: ing.name,
        quantity: toNumber(ing.quantity),
        unit: ing.unit ?? null,
        group: ing.group_name ?? null,
        notes: ing.notes ?? null,
        sort_order: ing.sort_order ?? 0,
      })),
    instructions: input.steps,
  };
}

// ---------------------------------------------------------------------------
// Changing a saved recipe: what the recipe page's useUpdateRecipe writes
// (hooks/use-recipes.ts), from an assistant, with the create's checks.
// ---------------------------------------------------------------------------

/** What a PATCH may send; anything else is refused, so a misspelt field is never silently ignored. */
export const RECIPE_UPDATE_FIELDS = [
  "title", "description", "servings", "prep_time_minutes", "cook_time_minutes", "tags", "ingredients", "instructions",
] as const;

/**
 * A change to a recipe. Only the fields present change. `ingredients` and
 * `steps` replace the whole list; `tags` makes the tags exactly these (an
 * empty list removes them all). `description` and the two times may be null
 * to clear them.
 */
export interface RecipePatch {
  title?: string;
  description?: string | null;
  servings?: number;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  tags?: string[];
  ingredients?: NewIngredient[];
  steps?: string[];
}

/** The PATCH body, checked field by field with the create's own rules. */
export function parseRecipeUpdate(body: Record<string, unknown>): Result<RecipePatch> {
  const bad = (error: string): Result<RecipePatch> => ({ ok: false, error });
  const unknown = Object.keys(body).find((key) => !(RECIPE_UPDATE_FIELDS as readonly string[]).includes(key));
  if (unknown) return bad(`\`${unknown}\` cannot be changed here; send ${RECIPE_UPDATE_FIELDS.join(", ")}`);

  const patch: RecipePatch = {};
  if ("title" in body) {
    const title = parseTitle(body.title);
    if (!title.ok) return bad(title.error);
    patch.title = title.value;
  }
  if ("description" in body) {
    const description = optionalText(body.description, MAX_RECIPE_DESCRIPTION, "description");
    if (!description.ok) return bad(description.error);
    patch.description = description.value;
  }
  if ("servings" in body) {
    const servings = wholeNumber(body.servings, 1, MAX_RECIPE_SERVINGS, "servings");
    if (!servings.ok) return bad(servings.error);
    if (servings.value === null) return bad(`\`servings\` must be a whole number from 1 to ${MAX_RECIPE_SERVINGS}`);
    patch.servings = servings.value;
  }
  if ("prep_time_minutes" in body) {
    const prep = wholeNumber(body.prep_time_minutes, 0, MAX_RECIPE_MINUTES, "prep_time_minutes");
    if (!prep.ok) return bad(prep.error);
    patch.prepTimeMinutes = prep.value;
  }
  if ("cook_time_minutes" in body) {
    const cook = wholeNumber(body.cook_time_minutes, 0, MAX_RECIPE_MINUTES, "cook_time_minutes");
    if (!cook.ok) return bad(cook.error);
    patch.cookTimeMinutes = cook.value;
  }
  if ("tags" in body) {
    if (body.tags === null) return bad(`\`tags\` must be a list; send [] to remove every tag`);
    const tags = parseTags(body.tags);
    if (!tags.ok) return bad(tags.error);
    patch.tags = tags.value;
  }
  if ("ingredients" in body) {
    const ingredients = parseIngredients(body.ingredients);
    if (!ingredients.ok) return bad(ingredients.error);
    patch.ingredients = ingredients.value;
  }
  if ("instructions" in body) {
    const steps = parseSteps(body.instructions);
    if (!steps.ok) return bad(steps.error);
    patch.steps = steps.value;
  }
  if (Object.keys(patch).length === 0) {
    return bad(`nothing to change; send any of ${RECIPE_UPDATE_FIELDS.join(", ")}`);
  }
  return { ok: true, value: patch };
}

const INGREDIENT_COLUMNS = "id, name, quantity, unit, group_name, notes, category, sort_order";

/**
 * Change one of the family's live recipes as the recipe page does: the row
 * (total time again prep plus cook, steps numbered from 1, `updated_at`),
 * the ingredients replaced as a whole list in the order given, the tags
 * through the page's own syncRecipeTags. Null when the recipe is not this
 * family's or is in the recycle bin.
 *
 * All or nothing, which the page is not (it deletes the ingredients before
 * inserting the new ones). The new ingredients go in first, beside the old;
 * then the row; then the tags; the old ingredients are deleted last, in one
 * statement. A failure at any step undoes the steps before it -- the new
 * ingredients deleted, the row and the tags put back as they were -- and the
 * error is thrown, so a half-changed recipe is never left behind. Replacing
 * the ingredients gives them new ids; the answer carries them.
 */
export async function updateRecipe(
  familyId: string,
  recipeId: string,
  patch: RecipePatch,
  db: RecipeDb = createAdminClient(),
): Promise<RecipeDetail | null> {
  const old = await loadRecipe(familyId, recipeId, db);
  if (!old) return null;

  const prep = patch.prepTimeMinutes !== undefined ? patch.prepTimeMinutes : old.prep_time_minutes ?? null;
  const cook = patch.cookTimeMinutes !== undefined ? patch.cookTimeMinutes : old.cook_time_minutes ?? null;
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.servings !== undefined) row.servings = patch.servings;
  if (patch.prepTimeMinutes !== undefined || patch.cookTimeMinutes !== undefined) {
    row.prep_time_minutes = prep;
    row.cook_time_minutes = cook;
    row.total_time_minutes = prep === null && cook === null ? null : (prep ?? 0) + (cook ?? 0);
  }
  if (patch.steps !== undefined) row.instructions = patch.steps.map((text, index) => ({ step: index + 1, text }));

  // What the row held before, for putting it back.
  const before: Record<string, unknown> = {};
  for (const column of Object.keys(row)) before[column] = (old as unknown as Record<string, unknown>)[column] ?? null;
  if ("instructions" in row) before.instructions = old.instructions ?? [];
  const oldTags = tagNames(old);
  const oldIngredientIds = (old.ingredients ?? []).map((ing) => String(ing.id));

  let added: IngredientRow[] | null = null;
  let rowChanged = false;
  let tagsTouched = false;
  try {
    if (patch.ingredients) {
      const { data, error } = await (db as any)
        .from("recipe_ingredients")
        .insert(patch.ingredients.map((ing, index) => ({
          recipe_id: recipeId,
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          group_name: ing.group,
          notes: ing.notes,
          category: null,
          sort_order: index,
        })))
        .select(INGREDIENT_COLUMNS);
      if (error) throw error;
      added = (data ?? []) as IngredientRow[];
    }
    if (Object.keys(row).length > 0) {
      rowChanged = true;
      const { data, error } = await (db as any)
        .from("recipes")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", recipeId)
        .eq("family_id", familyId)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("the recipe went away while it was being changed");
    }
    if (patch.tags !== undefined) {
      tagsTouched = true;
      await syncRecipeTags(db, familyId, recipeId, patch.tags);
    }
    if (patch.ingredients && oldIngredientIds.length > 0) {
      const { error } = await (db as any)
        .from("recipe_ingredients")
        .delete()
        .eq("recipe_id", recipeId)
        .in("id", oldIngredientIds);
      if (error) throw error;
    }
  } catch (err) {
    await undoRecipeUpdate(db, familyId, recipeId, {
      added: added?.map((ing) => String(ing.id)) ?? [],
      row: rowChanged ? before : null,
      tags: tagsTouched ? oldTags : null,
    });
    throw err;
  }

  const ingredients = added ?? old.ingredients ?? [];
  return {
    id: recipeId,
    title: patch.title ?? old.title,
    servings: patch.servings ?? servingsOf(old),
    total_time_minutes: "total_time_minutes" in row ? (row.total_time_minutes as number | null) : old.total_time_minutes ?? null,
    prep_time_minutes: prep,
    cook_time_minutes: cook,
    difficulty: old.difficulty ?? null,
    tags: patch.tags ?? oldTags,
    is_favorite: old.is_favorite === true,
    image_url: old.image_url ?? null,
    description: patch.description !== undefined ? patch.description : old.description ?? null,
    source_url: old.source_url ?? null,
    ingredients: [...ingredients]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((ing) => ({
        id: String(ing.id),
        name: ing.name,
        quantity: toNumber(ing.quantity),
        unit: ing.unit ?? null,
        group: ing.group_name ?? null,
        notes: ing.notes ?? null,
        sort_order: ing.sort_order ?? 0,
      })),
    instructions: patch.steps ?? parseInstructions(old.instructions).map((step) => step.text),
  };
}

/**
 * Put a recipe back as it was before a failed update: delete the
 * ingredients it added, write the row's old values, set the old tags. Each
 * step is tried on its own; a failure here is logged, and the caller throws
 * the original error.
 */
async function undoRecipeUpdate(
  db: RecipeDb,
  familyId: string,
  recipeId: string,
  undo: { added: string[]; row: Record<string, unknown> | null; tags: string[] | null },
) {
  const attempt = async (what: string, step: () => Promise<{ error?: unknown } | void>) => {
    try {
      const result = await step();
      if (result && result.error) throw result.error;
    } catch (err) {
      console.error(`[integration-recipes] could not undo a failed update (${what}):`, recipeId, err);
    }
  };
  if (undo.added.length > 0) {
    await attempt("ingredients", () => (db as any).from("recipe_ingredients").delete().eq("recipe_id", recipeId).in("id", undo.added));
  }
  if (undo.row) {
    const row = undo.row;
    await attempt("recipe", () => (db as any).from("recipes").update(row).eq("id", recipeId).eq("family_id", familyId));
  }
  if (undo.tags) {
    const tags = undo.tags;
    await attempt("tags", () => syncRecipeTags(db, familyId, recipeId, tags));
  }
}
