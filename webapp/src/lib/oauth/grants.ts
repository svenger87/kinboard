import { randomBytes } from "node:crypto";
import { generateIntegrationToken, hashIntegrationToken } from "@/lib/integration-auth";
import {
  ACCESS_TOKEN_TTL_S, CODE_PREFIX, REFRESH_TOKEN_PREFIX, REFRESH_TOKEN_TTL_S,
} from "@/lib/oauth/config";
import { verifyPkceS256 } from "@/lib/oauth/pkce";
import { isCimdClientId } from "@/lib/oauth/clients";
import { assistantsEnabledFor } from "@/lib/oauth/enabled";
import type { OAuthStore } from "@/lib/oauth/types";

export interface TokenResponseBody {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface OAuthErrorBody {
  error: "invalid_request" | "invalid_grant" | "invalid_target" | "unsupported_grant_type";
  error_description: string;
}

export type GrantResult = { ok: true; body: TokenResponseBody } | { ok: false; body: OAuthErrorBody };

const fail = (error: OAuthErrorBody["error"], error_description: string): GrantResult =>
  ({ ok: false, body: { error, error_description } });

const secret = (prefix: string) => {
  const value = `${prefix}${randomBytes(32).toString("base64url")}`;
  return { value, hash: hashIntegrationToken(value) };
};

export function generateAuthorizationCode(): { code: string; hash: string } {
  const { value, hash } = secret(CODE_PREFIX);
  return { code: value, hash };
}

export function generateRefreshToken(): { token: string; hash: string } {
  const { value, hash } = secret(REFRESH_TOKEN_PREFIX);
  return { token: value, hash };
}

function freshTokens(now: Date) {
  const access = generateIntegrationToken();
  const refresh = generateRefreshToken();
  return {
    access, refresh,
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_S * 1000).toISOString(),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_S * 1000).toISOString(),
  };
}

/**
 * The name a connection is listed under in Settings → Integrations. A CIMD
 * client's name was published by the host in its client_id, so it stands on
 * its own. A DCR client chose its name in an anonymous registration — two
 * "Claude"s could be anyone — so the host it returns to is part of the name:
 * that is the one thing about it Kinboard actually checked.
 */
export function grantName(clientId: string, clientName: string, redirectUri: string): string {
  if (isCimdClientId(clientId)) return clientName;
  return `${clientName} (${new URL(redirectUri).host})`;
}

/**
 * What the grant functions look up besides the store. Injectable so the
 * in-memory tests do not need a database.
 *
 * `isEnabledFor` is the family's "Allow AI assistants" switch. The consent
 * page refuses while it is off, but a code approved a moment before it was
 * switched off, or a refresh token issued weeks ago, would otherwise keep
 * minting tokens: /api/mcp refuses them, yet the connection would sit
 * dormant and come back to life the day the switch is turned on again. So
 * the token endpoint asks too — and a lookup that fails throws, which the
 * route answers with a 500 rather than a token.
 */
export interface GrantDeps {
  isEnabledFor?: (familyId: string) => Promise<boolean>;
}

/**
 * RFC 6749 §4.1.3 with PKCE (RFC 7636) and resource indicators (RFC 8707).
 * A code presented twice revokes what the first presentation produced
 * (OAuth 2.1 §4.1.3): the second caller is either a retry gone wrong or
 * someone who intercepted the code, and the two cannot be told apart.
 */
export async function exchangeAuthorizationCode(
  store: OAuthStore,
  p: { code: string; codeVerifier: string; clientId: string; redirectUri: string; resource: string | null },
  now: Date = new Date(),
  { isEnabledFor = assistantsEnabledFor }: GrantDeps = {},
): Promise<GrantResult> {
  if (!p.code.startsWith(CODE_PREFIX)) return fail("invalid_grant", "unknown or expired code");
  const consumed = await store.consumeCode(hashIntegrationToken(p.code), now);
  if (consumed.status === "reused") {
    // By request id, not the request's grant_id: the first presentation
    // records the request on the grant in the same INSERT, whereas grant_id
    // is only linked a statement later.
    await store.revokeGrantsForRequest(consumed.requestId, now);
    return fail("invalid_grant", "code already used");
  }
  if (consumed.status === "missing") return fail("invalid_grant", "unknown or expired code");

  const r = consumed.request;
  if (r.clientId !== p.clientId || r.redirectUri !== p.redirectUri) {
    return fail("invalid_grant", "client_id or redirect_uri does not match the authorization request");
  }
  if (p.resource !== null && p.resource !== r.resource) return fail("invalid_target", "resource does not match");
  if (!verifyPkceS256(p.codeVerifier, r.codeChallenge)) return fail("invalid_grant", "PKCE verification failed");
  if (!r.familyId || !r.grantedScopes || r.grantedScopes.length === 0) return fail("invalid_grant", "request was not approved");
  // The code is spent either way (consumed above), so a switched-off family
  // cannot hold on to it and exchange it once the switch is back on.
  if (!(await isEnabledFor(r.familyId))) return fail("invalid_grant", "assistants are switched off");

  const t = freshTokens(now);
  const grantId = await store.insertGrant({
    requestId: r.id, familyId: r.familyId, name: grantName(r.clientId, r.clientName, r.redirectUri), scopes: r.grantedScopes, oauthClientId: r.clientId, resource: r.resource,
    accessHash: t.access.hash, accessExpiresAt: t.accessExpiresAt, refreshHash: t.refresh.hash, refreshExpiresAt: t.refreshExpiresAt,
  });
  await store.linkGrant(r.id, grantId);
  // A replay that arrived before the grant above existed revoked nothing,
  // but it marked the request first. Checked after the insert, so either
  // that replay's revoke saw this grant or this check sees its mark.
  if (await store.wasReplayed(r.id)) {
    await store.revokeGrant(grantId, now);
    return fail("invalid_grant", "code already used");
  }
  // Earlier connections from the same assistant are left alone: two people
  // in a household who each connect their own Claude share a client id, and
  // both must stay connected. Each connection is listed on its own under
  // Settings → Integrations and is revoked there on its own.
  return {
    ok: true,
    body: { access_token: t.access.token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, refresh_token: t.refresh.token, scope: r.grantedScopes.join(" ") },
  };
}

/**
 * Rotation by compare-and-swap on the stored refresh hash: of two requests
 * presenting the same refresh token, exactly one wins, and the loser gets
 * invalid_grant (MCP authorization spec, token theft: rotate for public clients).
 */
export async function refreshAccessToken(
  store: OAuthStore,
  p: { refreshToken: string; clientId: string; resource: string | null },
  now: Date = new Date(),
  { isEnabledFor = assistantsEnabledFor }: GrantDeps = {},
): Promise<GrantResult> {
  if (!p.refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) return fail("invalid_grant", "unknown refresh token");
  const oldHash = hashIntegrationToken(p.refreshToken);
  const g = await store.findGrantByRefreshHash(oldHash);
  if (!g || g.revokedAt || new Date(g.refreshExpiresAt).getTime() <= now.getTime()) {
    return fail("invalid_grant", "refresh token is expired or revoked");
  }
  if (g.oauthClientId !== p.clientId) return fail("invalid_grant", "refresh token was issued to another client");
  if (p.resource !== null && p.resource !== g.resource) return fail("invalid_target", "resource does not match");
  if (!(await isEnabledFor(g.familyId))) {
    // Revoked, not just refused: switching assistants off ends the family's
    // connections, so turning it back on does not quietly revive them.
    await store.revokeGrant(g.id, now);
    return fail("invalid_grant", "assistants are switched off");
  }

  const t = freshTokens(now);
  const swapped = await store.rotateGrant(g.id, oldHash, {
    accessHash: t.access.hash, accessExpiresAt: t.accessExpiresAt, refreshHash: t.refresh.hash, refreshExpiresAt: t.refreshExpiresAt,
  });
  if (!swapped) return fail("invalid_grant", "refresh token already used");
  return {
    ok: true,
    body: { access_token: t.access.token, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_S, refresh_token: t.refresh.token, scope: g.scopes.join(" ") },
  };
}
