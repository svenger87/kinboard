import { MCP_SCOPES, type McpScope } from "@/lib/oauth/config";

/**
 * A missing scope parameter means "what the resource advertises" (MCP spec):
 * every assistant scope, which the consent page then lets the user trim.
 * Unknown scopes — `openid`, `offline_access` — are ignored rather than
 * refused; refresh tokens are always issued, so `offline_access` changes
 * nothing.
 */
export function parseRequestedScopes(raw: string | null | undefined): McpScope[] {
  if (!raw || !raw.trim()) return [...MCP_SCOPES];
  const wanted = new Set(raw.trim().split(/\s+/));
  return MCP_SCOPES.filter((s) => wanted.has(s));
}

/**
 * The assistant scopes a request did not ask for, in MCP_SCOPES order: what
 * the consent page offers, unticked, below the requested ones.
 *
 * Clients cache the scope list from when the connection was first set up
 * and replay it on every reconnect — ChatGPT does — so a permission Kinboard
 * added later is never requested and could never be granted. Offering it
 * here is how such a connection gets it: only if the user ticks it.
 */
export function unrequestedScopes(requested: readonly McpScope[]): McpScope[] {
  return MCP_SCOPES.filter((s) => !requested.includes(s));
}

/**
 * What a consent POST may grant: the posted scopes that are assistant
 * scopes, in MCP_SCOPES order, whether or not the client requested them
 * (see unrequestedScopes). Anything else — an Integration API scope an
 * assistant is never given (`events:read`), an unknown string, a
 * non-string — is dropped, exactly as before.
 */
export function grantableScopes(granted: readonly unknown[]): McpScope[] {
  return MCP_SCOPES.filter((s) => granted.includes(s));
}

/**
 * The `scope` of an insufficient_scope challenge: what the token already
 * holds plus what the refused tool needs, in MCP_SCOPES order. A client that
 * re-authorizes on the challenge (MCP step-up) requests exactly this list;
 * naming only the missing scope would get it a new token with that one
 * scope and nothing it had before. A held scope that is not an assistant
 * scope (a hand-made token can carry `events:read`) is left out — it could
 * not be granted through consent anyway.
 */
export function stepUpScopes(held: readonly string[], needed: readonly McpScope[]): McpScope[] {
  return MCP_SCOPES.filter((s) => held.includes(s) || needed.includes(s));
}
