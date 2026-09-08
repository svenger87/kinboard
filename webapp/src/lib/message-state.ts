import type { Message } from "@/types/database";

/**
 * How long a new message keeps the board.
 *
 * A fixed constant, not a setting. RFC-005 §4.1: a household that wants a
 * different length has not told us anything yet, and a settings row costs more
 * to maintain than the constant it replaces.
 */
export const TAKEOVER_MS = 60_000;

export type MessageState = "takeover" | "waiting" | "done";

/**
 * Which of the three things a message is, right now.
 *
 * Pure, and takes `now` rather than reading a clock, so the caller can hand it
 * a server-corrected time — the board's own clock is not trusted for this (§4.3).
 */
export function messageState(message: Message, now: Date): MessageState {
  // Acknowledgement first, always. Checking elapsed time first would let a
  // message somebody has already dealt with come back as a takeover.
  if (message.acknowledged_at) return "done";
  return now.getTime() - Date.parse(message.created_at) < TAKEOVER_MS
    ? "takeover"
    : "waiting";
}
