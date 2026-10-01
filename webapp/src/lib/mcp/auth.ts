import type { AuthInfo } from "@modelcontextprotocol/server";
import { evaluateToken, hashIntegrationToken, isIntegrationScope } from "@/lib/integration-auth";
import { findTokenByHash, TokenLookupUnavailable, type StoredToken } from "@/lib/integration-store";
import { wwwAuthenticate } from "@/lib/oauth/metadata";
import { mcpResource } from "@/lib/oauth/origin";

export type McpAuthResult = { ok: true; authInfo: AuthInfo } | { ok: false; response: Response };

/**
 * The MCP spec requires a 401 with a resource_metadata pointer to start
 * sign-in, and Claude ignores the header on any other status. A token bound
 * to another resource is refused (RFC 8707 audience); a token with no
 * resource was made by hand in Settings and is accepted, which is how Claude
 * Code on a LAN connects without OAuth.
 */
export async function authenticateMcpRequest(
  request: Request,
  origin: string,
  lookup: (hash: string) => Promise<StoredToken | null> = findTokenByHash,
  now: Date = new Date(),
): Promise<McpAuthResult> {
  const challenge = (error?: "invalid_token"): McpAuthResult => ({
    ok: false,
    response: new Response(JSON.stringify({ error: error ?? "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": wwwAuthenticate(origin, error ? { error } : {}) },
    }),
  });

  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return challenge();
  const token = match[1];
  const hash = hashIntegrationToken(token);

  let row: StoredToken | null;
  try {
    row = await lookup(hash);
  } catch (err) {
    if (err instanceof TokenLookupUnavailable) {
      // 503, never 401: a 401 tells the client to throw its credential away.
      return { ok: false, response: new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "content-type": "application/json", "retry-after": "5" } }) };
    }
    throw err;
  }

  const evaluated = evaluateToken(row, hash, now);
  if (!evaluated.ok || !row) return challenge("invalid_token");
  if (row.resource && row.resource !== mcpResource(origin)) return challenge("invalid_token");

  return {
    ok: true,
    authInfo: {
      token,
      clientId: row.oauth_client_id ?? `token:${row.id}`,
      scopes: (row.scopes ?? []).filter(isIntegrationScope),
      expiresAt: row.expires_at ? Math.floor(new Date(row.expires_at).getTime() / 1000) : undefined,
      resource: new URL(mcpResource(origin)),
    },
  };
}
