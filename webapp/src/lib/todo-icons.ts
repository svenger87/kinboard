/**
 * The icons a task may carry: the picker on the task form offers exactly
 * these, and the Integration API accepts nothing else, so an assistant cannot
 * put an icon on a task that the form could not have put there.
 *
 * Exact strings, variation selectors included ("🗑️" is U+1F5D1 U+FE0F).
 */
export const TODO_ICONS = ["🧹", "🗑️", "🧺", "🍽️", "📚", "🪥", "🐾", "🌱", "⭐"] as const;

export type TodoIcon = (typeof TODO_ICONS)[number];

export function isTodoIcon(value: unknown): value is TodoIcon {
  return typeof value === "string" && (TODO_ICONS as readonly string[]).includes(value);
}
