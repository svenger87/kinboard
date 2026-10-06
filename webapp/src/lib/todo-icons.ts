/**
 * The icons a task may carry: any single emoji the picker offers (the full
 * Unicode set without flags, lib/emoji/validate.ts). The task form picks from
 * exactly that set, and the Integration API and the MCP server accept nothing
 * else, so an assistant cannot put an icon on a task that the form could not
 * have put there.
 *
 * Server-side: it pulls in the emoji set. The form imports the picker, not this.
 */

import { canonicalEmoji, isEmojiIcon } from "@/lib/emoji/validate";

/**
 * The nine icons the task form offered before the emoji picker. Every task
 * stored since has one of these or none; each is still a valid icon, so no
 * old task fails an edit (e2e/emoji-picker.spec.ts).
 */
export const LEGACY_TODO_ICONS = ["🧹", "🗑️", "🧺", "🍽️", "📚", "🪥", "🐾", "🌱", "⭐"] as const;

export function isTodoIcon(value: unknown): value is string {
  return isEmojiIcon(value);
}

/** The icon as stored: the fully qualified emoji, or null when it is not one. */
export function todoIcon(value: unknown): string | null {
  return canonicalEmoji(value);
}
