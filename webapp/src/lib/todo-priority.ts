/**
 * `todos.priority` holds "high" | "medium" | "low" as text.
 *
 * The dashboard widget sorted it with `parseInt(a.priority) || 0`, which is
 * NaN for every one of those, so `|| 0` flattened them all to the same rank
 * and the priority step of the sort did nothing. A high-priority task with
 * no due date sat below a low-priority one purely on age.
 *
 * The todos page had the correct ordering inline. It lives here now so the
 * two agree, and so an unrecognised value lands somewhere sensible instead
 * of at `undefined`.
 */

export type TodoPriority = "high" | "medium" | "low";

/** Lower sorts first — high priority at the top. */
const RANK: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

const DEFAULT: TodoPriority = "medium";

export function priorityRank(priority: string | null | undefined): number {
  return RANK[normalizePriority(priority)];
}

/** Anything unrecognised is treated as medium rather than sorting oddly. */
export function normalizePriority(priority: string | null | undefined): TodoPriority {
  return priority && priority in RANK ? (priority as TodoPriority) : DEFAULT;
}

/** Comparator: highest priority first. */
export function comparePriority(
  a: { priority?: string | null },
  b: { priority?: string | null },
): number {
  return priorityRank(a.priority) - priorityRank(b.priority);
}
