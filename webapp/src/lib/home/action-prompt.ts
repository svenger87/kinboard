/**
 * The screen-side rules of the assistant action prompt, without React, so
 * they are tested directly (`e2e/assistant-actions.spec.ts`).
 */

import type { ScreenRequest } from "@/lib/home/action-requests";

/** A settings PIN is four digits (`PIN_FORMAT` in lib/settings-pin.ts). */
export const PIN_DIGITS = /^\d{4}$/;

/** Whole seconds until `expiresAt`, never negative; an unreadable time is 0. */
export function secondsLeft(expiresAt: string, now: Date): number {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

/** What a screen shows: still pending, not yet run out on this screen's (server-corrected) clock. */
export function visibleRequests(requests: readonly ScreenRequest[], now: Date): ScreenRequest[] {
  return requests.filter((r) => r.status === "pending" && secondsLeft(r.expires_at, now) > 0);
}

const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "pin_invalid", "rate_limited", "expired", "already_decided", "revoked", "pin_required", "not_found",
]);

/** The `assistantActions` message key for a decision's error code. */
export function decisionErrorKey(code: unknown): string {
  return typeof code === "string" && KNOWN_ERRORS.has(code) ? `errors.${code}` : "errors.generic";
}

/** Allow needs a well-formed PIN; Deny too (the server asks the PIN for both). */
export function canDecide(pin: string, busy: boolean, secondsRemaining: number): boolean {
  return !busy && secondsRemaining > 0 && PIN_DIGITS.test(pin);
}
