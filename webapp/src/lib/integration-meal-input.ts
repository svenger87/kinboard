/**
 * Validation for `POST /api/integration/v1/meals`.
 *
 * Mirrors `integration-event-input.ts`'s split: pure rules here, tested
 * without a database, applied by the route.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const MAX_MEAL_NOTE = 200;
export const MAX_SERVINGS = 50;

/** A real calendar date, same check as `integration-event-input.ts`'s `dayNumber`. */
export function isRealDate(value: string): boolean {
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export interface MealEntryInput {
  date: string;
  mealType: MealType;
  recipeId?: string;
  note?: string;
  servings?: number;
}

export type MealEntryInputResult =
  | { ok: true; value: MealEntryInput }
  | { ok: false; error: string };

/**
 * `recipe_id` and `note` are mutually exclusive, not "either or both": a
 * slot holding both a linked recipe and free text has no single rendering,
 * and silently preferring one over the other is exactly the kind of
 * decision an assistant should not make for the household. Exactly one is
 * required rather than neither, for the same reason `/lists/{list}/{item}`
 * refuses an empty patch — a body that changes nothing should not look like
 * success.
 */
export function parseMealEntryInput(body: Record<string, unknown>): MealEntryInputResult {
  const fail = (error: string): MealEntryInputResult => ({ ok: false, error });

  const date = typeof body.date === "string" ? body.date : "";
  if (!isRealDate(date)) return fail("`date` must be a YYYY-MM-DD date");

  const mealType = typeof body.meal_type === "string" ? body.meal_type : "";
  if (!(MEAL_TYPES as readonly string[]).includes(mealType)) {
    return fail(`\`meal_type\` must be one of ${MEAL_TYPES.join(", ")}`);
  }

  const hasRecipe = body.recipe_id !== undefined && body.recipe_id !== null;
  const hasNote = body.note !== undefined && body.note !== null;
  if (hasRecipe === hasNote) {
    return fail("send exactly one of `recipe_id` or `note`");
  }

  const value: MealEntryInput = { date, mealType: mealType as MealType };

  if (hasRecipe) {
    if (typeof body.recipe_id !== "string" || !UUID.test(body.recipe_id)) {
      return fail("`recipe_id` must be a recipe ID");
    }
    value.recipeId = body.recipe_id;
  } else {
    if (typeof body.note !== "string") return fail("`note` must be a string");
    const trimmed = body.note.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_MEAL_NOTE) {
      return fail(`\`note\` must be 1-${MAX_MEAL_NOTE} characters`);
    }
    value.note = trimmed;
  }

  if (body.servings !== undefined) {
    const servings = body.servings;
    if (
      typeof servings !== "number" ||
      !Number.isInteger(servings) ||
      servings < 1 ||
      servings > MAX_SERVINGS
    ) {
      return fail(`\`servings\` must be a whole number from 1 to ${MAX_SERVINGS}`);
    }
    value.servings = servings;
  }

  return { ok: true, value };
}

/** A meal-plan row as `GET /meals` reads it, with its recipe embedded. */
export interface MealEntryRow {
  id: string;
  date: string;
  meal_type: string;
  recipe_id: string | null;
  note: string | null;
  servings: number | null;
  recipe?: { title: string | null; deleted_at?: string | null } | null;
}

/**
 * The wire shape of a meal-plan entry. A recipe in the recycle bin is not
 * there any more as far as an assistant is concerned — the family's own
 * screens hide it (RLS), but the Integration API reads with the admin
 * client — so an entry pointing at one carries no recipe at all.
 */
export function toMealEntry(row: MealEntryRow) {
  const recipe = row.recipe && !row.recipe.deleted_at ? row.recipe : null;
  return {
    id: row.id,
    date: row.date,
    meal_type: row.meal_type,
    recipe_id: recipe ? row.recipe_id : null,
    recipe_title: recipe?.title ?? null,
    note: row.note,
    servings: row.servings,
  };
}
