import { CODE_TTL_S, type McpScope } from "@/lib/oauth/config";
import { buildRedirect } from "@/lib/oauth/redirect";
import { narrowScopes } from "@/lib/oauth/scopes";
import { PIN_FORMAT } from "@/lib/settings-pin";
import type { AuthRequest } from "@/lib/oauth/types";

/** Everything the approve/deny decision needs, injected so it is testable without a database or a session. */
export interface ConsentDeps {
  hasPin(familyId: string): Promise<boolean>;
  verifyPin(familyId: string, pin: string): Promise<"valid" | "invalid" | "rate_limited">;
  /** Stores a first PIN only if none exists, atomically; false if one appeared meanwhile. */
  setPinIfAbsent(familyId: string, pin: string): Promise<boolean>;
  approve(id: string, familyId: string, granted: McpScope[], codeHash: string, codeExpiresAt: string, now: Date): Promise<boolean>;
  deny(id: string, now: Date): Promise<void>;
  newCode(): { code: string; hash: string };
}

export type ConsentOutcome = { status: 200; redirect: string } | { status: 400 | 403 | 404 | 409 | 429; error: string };

export interface ConsentInput {
  request: AuthRequest;
  familyId: string;
  origin: string;
  decision: unknown;
  pin: unknown;
  newPin: unknown;
  scopes: unknown;
  now: Date;
}

/**
 * The approve/deny decision for an assistant consent request, factored out
 * of the route so it can be exercised with fake deps (see
 * e2e/oauth-consent.spec.ts) instead of a database and a signed-in browser.
 *
 * Caller's job: resolve `request` by id and confirm it is still pending
 * (unexpired, unanswered) before calling this — that lookup needs the
 * store and isn't part of the decision itself.
 *
 * Check order, unchanged from before this was factored out: decision →
 * PIN (verify an existing one, or validate a new one's format when the
 * family has none yet) → scopes non-empty → store the new PIN, if any →
 * mint and record the code. Scopes are checked before a new PIN is stored
 * so a request that was going to fail anyway never has the side effect of
 * setting a PIN nobody confirmed they wanted.
 *
 * A PIN set here is kept even if `approve()` then returns false because the
 * request expired in the gap between the two awaits — acceptable: the user
 * asked to set a PIN, and it is set; they just need to start the connection
 * again.
 *
 * "The family has no PIN" is read once, at the top, and could be stale by
 * the time the new PIN is stored — someone may have set one from Settings
 * (or a second consent tab) in between. Storing over it would let this
 * caller approve with a PIN they chose instead of the one they never knew.
 * So the store is insert-if-absent, decided by Postgres; losing that race
 * is 409 `pin_changed` and the request is not approved.
 */
export async function decideConsent(deps: ConsentDeps, input: ConsentInput): Promise<ConsentOutcome> {
  const { request: r, familyId, origin, decision, pin, newPin, scopes, now } = input;

  if (decision === "deny") {
    await deps.deny(r.id, now);
    return { status: 200, redirect: buildRedirect(r.redirectUri, { error: "access_denied", state: r.state, iss: origin }) };
  }
  if (decision !== "approve") return { status: 400, error: "invalid_request" };

  const hasPin = await deps.hasPin(familyId);
  let pinToSet: string | null = null;
  if (hasPin) {
    const result = await deps.verifyPin(familyId, typeof pin === "string" ? pin : "");
    if (result === "rate_limited") return { status: 429, error: "rate_limited" };
    if (result === "invalid") return { status: 403, error: "pin_invalid" };
  } else {
    pinToSet = typeof newPin === "string" ? newPin : "";
    if (!PIN_FORMAT.test(pinToSet)) return { status: 400, error: "new_pin_invalid" };
  }

  const granted = narrowScopes(r.scopes, Array.isArray(scopes) ? scopes : []);
  if (granted.length === 0) return { status: 400, error: "no_scopes" };

  if (pinToSet !== null && !(await deps.setPinIfAbsent(familyId, pinToSet))) {
    return { status: 409, error: "pin_changed" };
  }

  const code = deps.newCode();
  const approved = await deps.approve(
    r.id, familyId, granted, code.hash, new Date(now.getTime() + CODE_TTL_S * 1000).toISOString(), now,
  );
  if (!approved) return { status: 404, error: "not_found" };
  return { status: 200, redirect: buildRedirect(r.redirectUri, { code: code.code, state: r.state, iss: origin }) };
}
