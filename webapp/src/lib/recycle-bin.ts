/**
 * Shared definitions for the recycle bin.
 *
 * The set of tables here must stay in step with the trigger list in
 * `docker/migration_soft_delete.sql`. A table with a trigger but no entry here
 * would collect deleted rows the bin never shows — the silent-loss failure the
 * bin exists to prevent — so the API asserts the two agree on boot.
 */

/** Tables that soft-delete, and how to describe a row of each to a human. */
export const RECYCLABLE = {
  // `scope` is how a row reaches its family. Most carry family_id; meal plan
  // entries reach it through meal_plans and pocket-money goals through
  // pocket_money_accounts, which is why the listing cannot assume one column.
  birthdays: { labelKey: "birthdays", title: "name", subtitle: "date", scope: "family_id" },
  birthday_gift_ideas: { labelKey: "giftIdeas", title: "text", subtitle: null, scope: "family_id" },
  // notes has no title column, only content.
  notes: { labelKey: "notes", title: "content", subtitle: null, scope: "family_id" },
  todos: { labelKey: "todos", title: "title", subtitle: null, scope: "family_id" },
  subjects: { labelKey: "subjects", title: "name", subtitle: null, scope: "family_id" },
  meal_plan_entries: {
    labelKey: "mealPlan", title: "date", subtitle: "meal_type",
    scope: "meal_plan_id:meal_plans",
  },
  pocket_money_goals: {
    labelKey: "pocketMoneyGoals", title: "name", subtitle: null,
    scope: "account_id:pocket_money_accounts",
  },
  recipes: { labelKey: "recipes", title: "title", subtitle: "description", scope: "family_id" },
  people: { labelKey: "people", title: "name", subtitle: null, scope: "family_id" },
} as const;

export type RecyclableTable = keyof typeof RECYCLABLE;

export function isRecyclable(t: string): t is RecyclableTable {
  return Object.prototype.hasOwnProperty.call(RECYCLABLE, t);
}

export interface DeletedRow {
  table: RecyclableTable;
  id: string;
  title: string;
  subtitle: string | null;
  deleted_at: string;
}

/** Default retention. 0 means keep forever. */
export const DEFAULT_RETENTION_DAYS = 30;
export const RECYCLE_BIN_SETTING_KEY = "recycle_bin";

/**
 * `people` deletes cascade to schedules and pocket-money accounts, and those
 * cascades are cancelled along with the delete — so a restored person comes
 * back whole. Worth surfacing in the UI so restoring a person does not look
 * like it will leave their data behind.
 */
export const RESTORES_DEPENDENTS: RecyclableTable[] = ["people", "recipes", "birthdays"];
