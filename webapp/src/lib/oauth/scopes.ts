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

export function narrowScopes(requested: readonly McpScope[], granted: readonly unknown[]): McpScope[] {
  return requested.filter((s) => granted.includes(s));
}
