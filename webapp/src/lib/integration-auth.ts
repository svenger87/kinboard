/**
 * The Integration API auth boundary.
 *
 * RFC-001 §4 requires scope enforcement to be **one shared server function**,
 * not a check written into each route. The reason is drift: per-route checks
 * are copied, then edited, then one of them is edited wrongly, and the gap is
 * invisible because every route still *looks* like it checks. `requireSession`
 * exists for the same reason on the browser-facing side, and its comment
 * records what happened when the check was assumed rather than centralised —
 * about a hundred routes shipped with none at all.
 *
 * So there is exactly one way in: `requireIntegrationAuth`. A route names the
 * scope it needs and gets back a family, or a response to return.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";

/**
 * The authoritative scope list. RFC-001 §5.2 maps each service to one of
 * these, and the Home Assistant component carries the same names in
 * `const.py`. They are public contract: add freely, never repurpose.
 */
export const INTEGRATION_SCOPES = [
  "family:read",
  "events:read",
  "shopping:write",
  "tasks:write",
  "notes:write",
  "announcements:write",
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

export function isIntegrationScope(value: string): value is IntegrationScope {
  return (INTEGRATION_SCOPES as readonly string[]).includes(value);
}

/**
 * Tokens carry a recognisable prefix.
 *
 * Two reasons, both practical: a household pasting a value into Home Assistant
 * can see at a glance that they copied the right thing, and secret scanners
 * (GitHub's included) match on distinctive prefixes — a token accidentally
 * committed is far more likely to be caught before it is exploited.
 */
export const TOKEN_PREFIX = "kbi_";

export interface IntegrationContext {
  tokenId: string;
  familyId: string;
  scopes: IntegrationScope[];
  name: string;
}

export type IntegrationAuthResult =
  | { ok: true; context: IntegrationContext }
  | { ok: false; response: NextResponse };

/** SHA-256 hex — the same shape `sessions` uses, for one convention not two. */
export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a token. The plaintext is returned once and never stored; only the
 * caller that creates it ever sees it, and Settings shows it a single time.
 *
 * 32 bytes from `randomBytes`, base64url so it survives a header, a YAML file
 * and a copy-paste without escaping.
 */
export function generateIntegrationToken(): { token: string; hash: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashIntegrationToken(token) };
}

/**
 * Extract the bearer token, tolerating the shapes people actually send.
 *
 * Returns null rather than throwing: a malformed Authorization header is
 * "unauthenticated", not "bad request" — telling an anonymous caller which of
 * the two it was is free information about the endpoint.
 */
export function bearerFrom(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The database lookup is by hash, so an attacker cannot learn anything from
 * *finding* a row. This guards the second comparison — it costs nothing and
 * removes the question entirely rather than requiring a reader to reason about
 * whether a timing signal exists.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

interface TokenRow {
  id: string;
  family_id: string;
  name: string;
  scopes: string[] | null;
  token_hash: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
}

/**
 * Decide whether a token row may be used, and why not if it may not.
 *
 * Split out from the request handling so it can be tested without a database
 * or a request — this is the part with the rules in it.
 */
export type TokenRejection = "unknown" | "revoked" | "expired";

export function evaluateToken(
  row: TokenRow | null,
  presentedHash: string,
  now: Date,
): { ok: true; row: TokenRow } | { ok: false; reason: TokenRejection } {
  if (!row) return { ok: false, reason: "unknown" };
  if (!hashesEqual(row.token_hash, presentedHash)) return { ok: false, reason: "unknown" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, row };
}

/**
 * Does this token carry the scope this route needs?
 *
 * No implication between scopes — `tasks:write` does not imply `family:read`.
 * A hierarchy is convenient right up to the moment someone has to answer "what
 * can this token actually do?" from the list in Settings, and then it is a
 * trap. Routes that read and write name both.
 */
export function hasScope(granted: readonly string[], required: IntegrationScope): boolean {
  return granted.includes(required);
}

/** Only refresh last_used_at this often. A heartbeat, not an access log. */
export const LAST_USED_REFRESH_MS = 60 * 60 * 1000;

export function shouldRefreshLastUsed(lastUsedAt: string | null, now: Date): boolean {
  if (!lastUsedAt) return true;
  return now.getTime() - new Date(lastUsedAt).getTime() > LAST_USED_REFRESH_MS;
}

/**
 * The single entry point. A route calls this with the scope it needs.
 *
 * Every rejection answers **401 `not_authenticated`**, including the case where
 * the token is valid but lacks the scope. 403 would be the more precise code
 * and is deliberately not used: it distinguishes "this token exists but may not
 * do that" from "no such token", which tells a caller probing an endpoint that
 * their token is real. `requireSession` makes the same trade for the same
 * reason, and its comment explains it at length.
 *
 * The `lookup` parameter is injected so this can be tested against a stub. It
 * takes the *hash*, never the token — nothing below this line should be able
 * to leak a plaintext credential into a log or a query string.
 */
export async function requireIntegrationAuth(
  request: NextRequest,
  required: IntegrationScope,
  lookup: (hash: string) => Promise<TokenRow | null>,
  now: Date = new Date(),
): Promise<IntegrationAuthResult> {
  const token = bearerFrom(request);
  if (!token) {
    return { ok: false, response: await apiError("not authenticated", "not_authenticated") };
  }

  const hash = hashIntegrationToken(token);
  const evaluated = evaluateToken(await lookup(hash), hash, now);
  if (!evaluated.ok) {
    return { ok: false, response: await apiError("not authenticated", "not_authenticated") };
  }

  const scopes = (evaluated.row.scopes ?? []).filter(isIntegrationScope);
  if (!hasScope(scopes, required)) {
    return { ok: false, response: await apiError("not authenticated", "not_authenticated") };
  }

  return {
    ok: true,
    context: {
      tokenId: evaluated.row.id,
      familyId: evaluated.row.family_id,
      scopes,
      name: evaluated.row.name,
    },
  };
}
