/**
 * "Trust this assistant" — one switch per assistant connection, in Settings →
 * Integrations. While it is on, what that assistant asks for that would
 * otherwise wait for a person on a Kinboard screen runs at once
 * (`submitActionRequest` in lib/home/action-requests.ts). One switch per
 * assistant, not per kind of action and not for a while: the family chose
 * that, and the warning beside the switch says what it means.
 *
 * What an assistant is, here: its connection — one `integration_tokens` row
 * with an `oauth_client_id`. A refreshed token is the same row, so it keeps
 * the trust; reconnecting is a new row, which starts untrusted; revoking
 * clears it (a trigger on the table, migration_zzzzzzzzzzz_assistant_trust.sql).
 * A token made by hand in Settings is never trusted.
 *
 * Who may switch it: a person at a Kinboard screen — a session route, never
 * the Integration API or a tool, so no assistant can trust itself. On needs
 * the settings PIN typed then and there, checked by `verifySettingsPin` and
 * its shared limiter (5 wrong a minute, 20 an hour, for the whole family);
 * an unlocked settings screen is not enough. A family without a PIN cannot
 * trust anything. Off needs nothing: taking power away must be as easy as
 * it can be.
 *
 * Pure: the PIN check and the write come in as dependencies, so every branch
 * is tested against fakes in e2e/assistant-trust.spec.ts.
 */

import { UUID } from "@/lib/home/action-requests";

export interface TrustDeps {
  hasPin: (familyId: string) => Promise<boolean>;
  verifyPin: (familyId: string, pin: string) => Promise<"valid" | "invalid" | "rate_limited">;
  /**
   * One UPDATE, scoped to this family. On: only an assistant connection that
   * is not revoked. Off: any row of the family. "not_found" when nothing
   * matched.
   */
  setTrust: (input: {
    familyId: string; tokenId: string; trusted: boolean; deviceId: string | null;
  }) => Promise<"ok" | "not_found">;
}

export interface TrustInput {
  familyId: string;
  deviceId: string | null;
  tokenId: string;
  body: unknown;
}

const MAX_PIN = 32;

export async function setAssistantTrust(
  input: TrustInput,
  deps: TrustDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = input.body as { trusted?: unknown; pin?: unknown } | null;
  if (!body || typeof body !== "object" || typeof body.trusted !== "boolean") {
    return { status: 400, body: { error: "invalid_request" } };
  }
  if (!UUID.test(input.tokenId)) return { status: 404, body: { error: "not_found" } };
  const notFound = { status: 404, body: { error: "not_found" } };

  if (!body.trusted) {
    const done = await deps.setTrust({ familyId: input.familyId, tokenId: input.tokenId, trusted: false, deviceId: input.deviceId });
    return done === "ok" ? { status: 200, body: { trusted: false } } : notFound;
  }

  const pin = body.pin;
  if (typeof pin !== "string" || pin.length === 0 || pin.length > MAX_PIN) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  // No PIN, no trust: without one, anyone at any screen could switch it on.
  if (!(await deps.hasPin(input.familyId))) return { status: 403, body: { error: "pin_required" } };
  const verdict = await deps.verifyPin(input.familyId, pin);
  if (verdict === "rate_limited") return { status: 429, body: { error: "rate_limited" } };
  if (verdict !== "valid") return { status: 403, body: { error: "pin_invalid" } };

  const done = await deps.setTrust({ familyId: input.familyId, tokenId: input.tokenId, trusted: true, deviceId: input.deviceId });
  return done === "ok" ? { status: 200, body: { trusted: true } } : notFound;
}
