import { createAdminClient } from "@/lib/supabase/server";
import type { IntegrationScope } from "@/lib/integration-auth";
import { RECYCLABLE, describeDeletedRow, type RecyclableTable } from "@/lib/recycle-bin";

/**
 * The recycle bin for assistants (RFC-012 §4): list what was deleted and
 * restore it — never purge.
 *
 * Only the kinds an assistant can delete are reachable: tasks, notes, meal
 * plan entries and birthdays. Recipes, people, subjects, gift ideas and
 * pocket-money goals stay in the Settings bin only.
 *
 * Every query runs with the service role, which bypasses RLS — and with it
 * the `deleted_at IS NULL` predicate that normally hides binned rows — so
 * the family boundary is enforced here or nowhere. `todos`, `notes` and
 * `birthdays` carry `family_id`; `meal_plan_entries` reaches its family only
 * through `meal_plans`, joined with `meal_plans!inner(family_id)` exactly as
 * `GET /meals` and `DELETE /meals/{id}` do.
 */

export const RESTORE_TYPE_NAMES = ["task", "note", "meal", "birthday"] as const;
export type RestoreType = (typeof RESTORE_TYPE_NAMES)[number];

export const RESTORE_TYPES = {
  task: { table: "todos", scope: "tasks:write" },
  note: { table: "notes", scope: "notes:write" },
  meal: { table: "meal_plan_entries", scope: "meals:write" },
  birthday: { table: "birthdays", scope: "birthdays:write" },
} as const satisfies Record<RestoreType, { table: RecyclableTable; scope: IntegrationScope }>;

export function isRestoreType(value: string): value is RestoreType {
  return Object.prototype.hasOwnProperty.call(RESTORE_TYPES, value);
}

/** The most the listing returns, across all types together. */
export const MAX_DELETED_ITEMS = 50;

export type RecycleDb = ReturnType<typeof createAdminClient>;

export interface DeletedItem {
  id: string;
  type: RestoreType;
  /** The bin's title column: a task's title, a birthday's name, a note's text (cut to 120), a meal's date. */
  title: string;
  /** The bin's subtitle column: a birthday's date, a meal's type; otherwise null. */
  subtitle: string | null;
  /**
   * Meal entries only, so two binned dinners on one day can be told apart:
   * the linked recipe's title and the entry's note, joined with " — ", cut
   * to 120. The recipe title is left out when that recipe is itself in the
   * bin (RFC-012 §4: binned recipes are never exposed) or is not this
   * family's. Null for the other types, and for an entry with neither.
   */
  detail: string | null;
  deleted_at: string;
}

const viaMealPlan = (table: RecyclableTable) => table === "meal_plan_entries";

/** See DeletedItem.detail. */
function mealDetail(row: Record<string, unknown>, familyId: string): string | null {
  const recipe = row.recipe as { title?: unknown; family_id?: unknown; deleted_at?: unknown } | null | undefined;
  const recipeTitle = recipe && recipe.family_id === familyId && recipe.deleted_at == null
    && typeof recipe.title === "string" && recipe.title.trim() !== "" ? recipe.title.trim() : null;
  const note = typeof row.note === "string" && row.note.trim() !== "" ? row.note.trim() : null;
  const parts = [recipeTitle, note].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" — ").slice(0, 120) : null;
}

/**
 * The family's deleted rows of one type, or of all four, newest deletion
 * first, at most MAX_DELETED_ITEMS in all.
 */
export async function listDeletedItems(
  familyId: string,
  type: RestoreType | null,
  db: RecycleDb = createAdminClient(),
): Promise<DeletedItem[]> {
  const items: DeletedItem[] = [];
  for (const name of type ? [type] : RESTORE_TYPE_NAMES) {
    const table = RESTORE_TYPES[name].table;
    const cfg = RECYCLABLE[table];
    const columns = ["id", "deleted_at", cfg.title, cfg.subtitle].filter(Boolean).join(", ");

    let q = viaMealPlan(table)
      ? (db as any).from(table)
        .select(`${columns}, note, recipe:recipes(title, family_id, deleted_at), meal_plan:meal_plans!inner(family_id)`)
        .eq("meal_plan.family_id", familyId)
      : (db as any).from(table).select(columns).eq("family_id", familyId);
    q = q.not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(MAX_DELETED_ITEMS);

    const { data, error } = await q;
    if (error) throw error;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const { id, title, subtitle, deleted_at } = describeDeletedRow(table, row);
      const detail = viaMealPlan(table) ? mealDetail(row, familyId) : null;
      items.push({ id, type: name, title, subtitle, detail, deleted_at });
    }
  }
  items.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at) || a.id.localeCompare(b.id));
  return items.slice(0, MAX_DELETED_ITEMS);
}

/**
 * Take one row out of the bin: `deleted_at = NULL`, nothing else changes.
 * True when a row was restored; false when there is no such row in this
 * family's bin — missing, another family's, or not deleted at all (a live
 * row is left alone rather than "restored" to itself).
 *
 * The UPDATE carries the "is deleted" guard itself, and for the three
 * tables with `family_id` the family filter too, so a single statement
 * decides. A meal entry's family can only be checked through the join,
 * which a PostgREST write cannot filter on, so it is confirmed with a
 * SELECT first and the UPDATE is then pinned to that entry's own plan.
 */
export async function restoreDeletedItem(
  familyId: string,
  type: RestoreType,
  id: string,
  db: RecycleDb = createAdminClient(),
): Promise<boolean> {
  const table = RESTORE_TYPES[type].table;

  let update = (db as any).from(table).update({ deleted_at: null }).eq("id", id);
  if (viaMealPlan(table)) {
    const { data: found, error } = await (db as any)
      .from(table)
      .select("id, meal_plan_id, meal_plan:meal_plans!inner(family_id)")
      .eq("id", id)
      .eq("meal_plan.family_id", familyId)
      .not("deleted_at", "is", null)
      .maybeSingle();
    if (error) throw error;
    if (!found) return false;
    update = update.eq("meal_plan_id", found.meal_plan_id);
  } else {
    update = update.eq("family_id", familyId);
  }

  const { data, error } = await update.not("deleted_at", "is", null).select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}
