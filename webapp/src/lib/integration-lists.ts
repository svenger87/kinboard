/**
 * The two Kinboard lists a Home Assistant to-do entity can drive.
 *
 * Shopping and tasks are the same idea to a user — a list of things with a
 * tick box — and two quite different tables underneath. Rather than let each
 * route learn both, the differences are declared once here and everything
 * else works from the description.
 *
 * The differences that matter:
 *
 *   - Different column names. `shopping_items.name` / `checked` versus
 *     `todos.title` / `completed`.
 *   - **Different delete semantics.** todos are soft-deleted — a BEFORE DELETE
 *     trigger stamps `deleted_at` and the row goes to the recycle bin.
 *     shopping_items are not: the shopping list deletes for real on a single
 *     tap, deliberately, because it has Undo in the UI. Deleting from Home
 *     Assistant must behave the same way as deleting in Kinboard, so a task
 *     removed from HA is recoverable and a shopping item is not.
 *   - Only todos carry a due date.
 */

export type ListId = "shopping" | "tasks";

export interface ListDef {
  table: string;
  /** Column holding the item's text. */
  titleColumn: string;
  /** Boolean column meaning "done". */
  doneColumn: string;
  /** Column holding the due date, if the list has one. */
  dueColumn: string | null;
  /** Whether rows are soft-deleted, which decides how a list is read. */
  softDeletes: boolean;
  /** Scope required to change this list. */
  writeScope: "shopping:write" | "tasks:write";
}

export const LISTS: Record<ListId, ListDef> = {
  shopping: {
    table: "shopping_items",
    titleColumn: "name",
    doneColumn: "checked",
    dueColumn: null,
    softDeletes: false,
    writeScope: "shopping:write",
  },
  tasks: {
    table: "todos",
    titleColumn: "title",
    doneColumn: "completed",
    dueColumn: "due_date",
    softDeletes: true,
    writeScope: "tasks:write",
  },
};

export function isListId(value: string): value is ListId {
  return value === "shopping" || value === "tasks";
}

/** The wire shape, deliberately close to Home Assistant's TodoItem. */
export interface ListItem {
  id: string;
  summary: string;
  status: "needs_action" | "completed";
  due: string | null;
}

/**
 * Map a database row to the wire shape.
 *
 * `checked` is nullable on shopping_items with a default of false, so "done"
 * is `=== true` rather than truthiness — a null must read as needing action,
 * not as an unknown third state.
 */
export function toListItem(def: ListDef, row: Record<string, unknown>): ListItem {
  return {
    id: String(row.id),
    summary: String(row[def.titleColumn] ?? ""),
    status: row[def.doneColumn] === true ? "completed" : "needs_action",
    due: def.dueColumn ? ((row[def.dueColumn] as string | null) ?? null) : null,
  };
}

/** Trim, reject empty, and bound — free text on its way to a database column. */
export function itemSummary(value: unknown, max = 300): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length === 0 || t.length > max ? null : t;
}

/**
 * A due date, as a plain calendar day.
 *
 * Home Assistant sends either a date or a datetime depending on whether the
 * user set a time. Kinboard's column is a date, so a datetime is truncated
 * rather than rejected: losing the time is what the schema means, whereas
 * refusing the item would lose the whole task.
 */
export function itemDue(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? { ok: true, value: m[1] } : { ok: false };
}
