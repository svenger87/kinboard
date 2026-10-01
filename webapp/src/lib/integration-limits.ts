import { NextResponse } from "next/server";
import { hitLimit } from "@/lib/rate-limit";

/**
 * Per-assistant budgets on top of the Integration API's generic per-token
 * read/write limit (lib/integration-route.ts) — RFC-011 §7.
 *
 * The generic limit is about load. These are about what one token can do to
 * a household in a short time even while staying under it:
 *
 * - **Confirmations** (ruling 9). Every sensitive home action puts a prompt
 *   on every screen and a push on every phone. At most 2 may be waiting per
 *   assistant at once, and at most 5 created per 10 minutes. Checked before
 *   anything is stored or pushed.
 * - **Edits and deletes** (ruling 10). At most 30 PATCH/DELETE calls per 10
 *   minutes per assistant across tasks, shopping items, notes, calendar
 *   events and meal entries — an injected "clean everything up" stops long
 *   before it has emptied the household's lists. Applies only to OAuth-issued
 *   (assistant) tokens, never to a token created by hand in Settings — the
 *   Home Assistant component's "Clear completed" legitimately sends more than
 *   30 DELETEs in ten minutes for a long shopping list.
 *
 * Like every limiter in this codebase it is process-local (lib/rate-limit.ts).
 */

export const CONFIRM_MAX_PENDING = 2;
export const CONFIRM_LIMIT = 5;
export const CONFIRM_WINDOW_MS = 10 * 60_000;

export const DESTRUCTIVE_LIMIT = 30;
export const DESTRUCTIVE_WINDOW_MS = 10 * 60_000;

export const confirmLimitKey = (tokenId: string) => `integration:${tokenId}:home-confirm`;
export const destructiveLimitKey = (tokenId: string) => `integration:${tokenId}:destructive`;

/** Whole seconds for a Retry-After header, at least 1: 0 invites the immediate retry being throttled. */
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export type Budget = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * May this assistant ask for one more confirmation? `pendingExpiries` are
 * the `expires_at` of its requests still pending; one already past its
 * expiry is not waiting any more, whatever its stored status says. Only when
 * fewer than CONFIRM_MAX_PENDING are waiting is the 10-minute budget spent
 * (`hit`), so a refusal for "too many waiting" costs nothing.
 */
export function confirmationBudget(
  pendingExpiries: readonly string[],
  now: Date,
  hit: () => { limited: boolean; retryAfterMs: number },
): Budget {
  const waiting = pendingExpiries
    .map((at) => Date.parse(at))
    .filter((at) => Number.isFinite(at) && at > now.getTime())
    .sort((a, b) => a - b);
  if (waiting.length >= CONFIRM_MAX_PENDING) {
    // The earliest moment one of them is no longer waiting.
    return { ok: false, retryAfterMs: waiting[0] - now.getTime() };
  }
  const limit = hit();
  return limit.limited ? { ok: false, retryAfterMs: limit.retryAfterMs } : { ok: true };
}

/** The live counter for `confirmationBudget`. */
export function hitConfirmLimit(tokenId: string) {
  return hitLimit(confirmLimitKey(tokenId), CONFIRM_LIMIT, CONFIRM_WINDOW_MS);
}

/**
 * Spend one edit/delete of this assistant's budget, or the 429 to answer
 * with. Called first thing in every Integration API PATCH and DELETE handler
 * (e2e/integration-limits.spec.ts holds that); a refused call changes nothing.
 *
 * `assistant` is `context.assistant` (lib/integration-auth.ts) — true only for
 * an OAuth-issued token. A manually created token (Home Assistant, Bridge)
 * never spends this budget: its scripted bulk actions, like "Clear
 * completed" deleting every ticked shopping item one DELETE at a time, can
 * legitimately exceed 30 calls in ten minutes.
 */
export function destructiveLimitResponse({
  tokenId,
  assistant,
}: {
  tokenId: string;
  assistant: boolean;
}): NextResponse | null {
  if (!assistant) return null;
  const { limited, retryAfterMs } = hitLimit(destructiveLimitKey(tokenId), DESTRUCTIVE_LIMIT, DESTRUCTIVE_WINDOW_MS);
  if (!limited) return null;
  return NextResponse.json(
    { error: "too many edits and deletes — slow down", code: "rate_limited" },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds(retryAfterMs)) } },
  );
}
