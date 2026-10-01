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

/**
 * The `assistantActions` message key for a decision's error code. An
 * approval that failed for any other reason (a 500, a dropped connection)
 * may have reached Home Assistant, so it says the outcome is unknown and
 * points at the device — "try again" could run it twice.
 */
export function decisionErrorKey(code: unknown, decision: "approve" | "deny" = "deny"): string {
  if (typeof code === "string" && KNOWN_ERRORS.has(code)) return `errors.${code}`;
  return decision === "approve" ? "errors.unknown_outcome" : "errors.generic";
}

/** Errors after which the request is finished: shown until dismissed, since the card itself goes. */
export function isFinalError(code: unknown, decision: "approve" | "deny"): boolean {
  if (code === "pin_invalid" || code === "rate_limited" || code === "pin_required") return false;
  if (typeof code === "string" && KNOWN_ERRORS.has(code)) return true;
  return decision === "approve";
}

/** Allow needs a well-formed PIN, time left, and no decision in flight. */
export function canApprove(pin: string, busy: boolean, secondsRemaining: number): boolean {
  return !busy && secondsRemaining > 0 && PIN_DIGITS.test(pin);
}

/** Deny needs no PIN — anyone at a screen may stop a request. */
export function canDeny(busy: boolean, secondsRemaining: number): boolean {
  return !busy && secondsRemaining > 0;
}

const RANK: Record<ScreenRequest["status"], number> = {
  pending: 0, approved: 1, denied: 2, expired: 2, failed: 2, done: 2,
};

/** Whether nothing more will happen to this request. */
export function isTerminal(request: Pick<ScreenRequest, "status">): boolean {
  return RANK[request.status] === 2;
}

/**
 * The deep-link page has two copies of a request: the one its decision
 * returned and the one it polls. Show the further-along one; on a tie the
 * polled one, which is newer.
 */
export function newerRequest(polled: ScreenRequest | null | undefined, decided: ScreenRequest | null): ScreenRequest | null {
  if (!polled) return decided;
  if (!decided || decided.id !== polled.id) return polled;
  return RANK[decided.status] > RANK[polled.status] ? decided : polled;
}

/** Failure reasons with words of their own under `assistantActions.status`. */
const STATUS_REASONS: ReadonlySet<string> = new Set([
  "unknown_outcome", "not_in_catalogue", "catalogue_unavailable", "not_allowed", "not_available",
  "insufficient_funds", "no_account", "booking_failed",
]);

/**
 * The `assistantActions` key that says what became of a request. A failed
 * pocket-money booking always has a reason, so it never gets `status.failed`,
 * which is about Home Assistant.
 */
export function statusMessageKey(request: Pick<ScreenRequest, "status" | "result"> & { kind?: ScreenRequest["kind"] }): string {
  const reason = (request.result as { reason?: unknown } | null)?.reason;
  if (request.status === "failed" && request.kind === "pocket_money"
    && (typeof reason !== "string" || reason === "unknown_outcome")) {
    // Nothing about Home Assistant or a device: the booking may not have happened.
    return "status.booking_failed";
  }
  if (request.status === "failed" && typeof reason === "string" && STATUS_REASONS.has(reason)) {
    return `status.${reason}`;
  }
  return `status.${request.status}`;
}

/**
 * What the overlay keeps on screen after Allow succeeded: the outcome, as a
 * `status.*` key — done, didn't work (with its reason), or unknown and
 * "check the device" — or null when there is nothing to say (a request that
 * is somehow still pending, which the overlay keeps showing as a card).
 * A request still `approved` has been claimed but not answered: from this
 * screen its outcome is unknown.
 */
export function outcomeNoticeKey(request: Pick<ScreenRequest, "status" | "result"> & { kind?: ScreenRequest["kind"] }): string | null {
  if (request.status === "pending") return null;
  if (request.status === "approved") return request.kind === "pocket_money" ? "status.booking_failed" : "status.unknown_outcome";
  return statusMessageKey(request);
}

/**
 * Whether a realtime change to `assistant_action_requests` is worth a
 * refetch of the pending list. An INSERT that is not pending is the audit
 * row of an action that already ran (one per light an assistant switches),
 * which no screen shows.
 */
export function actionChangeMatters(payload: { eventType?: string; new?: unknown }): boolean {
  if (payload.eventType !== "INSERT") return true;
  return (payload.new as { status?: unknown } | null | undefined)?.status === "pending";
}

/**
 * Where the overlay prompt appears: every page of a joined device, except
 * the join screen (no session — it would poll into 401s) and the deep-link
 * page, which shows the request itself.
 */
export function promptShownOn(pathname: string, joined: boolean): boolean {
  if (!joined) return false;
  if (pathname === "/join" || pathname.startsWith("/join/")) return false;
  if (pathname.startsWith("/assistant-actions/")) return false;
  return true;
}
