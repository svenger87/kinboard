import type { AuthInfo } from "@modelcontextprotocol/server";
import { evaluateToken, hashIntegrationToken, isIntegrationScope } from "@/lib/integration-auth";
import { findTokenByHash, touchToken, TokenLookupUnavailable, type StoredToken } from "@/lib/integration-store";
import { wwwAuthenticate } from "@/lib/oauth/metadata";
import { mcpResource } from "@/lib/oauth/origin";
import { assistantsEnabledFor } from "@/lib/oauth/enabled";

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
  touch: (token: StoredToken, now?: Date) => Promise<void> = touchToken,
  familyEnabled: (familyId: string) => Promise<boolean> = (familyId) => assistantsEnabledFor(familyId),
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

  // 503, never 401: a 401 tells the client to throw its credential away.
  const unavailable = (): McpAuthResult => ({
    ok: false,
    response: new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "content-type": "application/json", "retry-after": "5" } }),
  });

  let row: StoredToken | null;
  try {
    row = await lookup(hash);
  } catch (err) {
    if (err instanceof TokenLookupUnavailable) return unavailable();
    throw err;
  }

  const evaluated = evaluateToken(row, hash, now);
  if (!evaluated.ok || !row) return challenge("invalid_token");
  if (row.resource && row.resource !== mcpResource(origin)) return challenge("invalid_token");

  // The family's "Allow AI assistants" switch (lib/oauth/enabled.ts). Any
  // token, OAuth or made by hand: /api/mcp is the assistants' door, and a
  // family that has it off has said no assistant may use it. The
  // Integration API itself is not behind this — Home Assistant keeps
  // working. A failed lookup is a 503 for the same reason as above.
  let enabled: boolean;
  try {
    enabled = await familyEnabled(row.family_id);
  } catch (err) {
    console.error("[mcp] assistants switch lookup failed", err);
    return unavailable();
  }
  if (!enabled) return challenge("invalid_token");

  // Fire-and-forget, like every other Integration API caller: a connection
  // that only ever lists tools (no scope-gated call ever reaches
  // withIntegrationAuth, which is the only other place last_used_at moves)
  // would otherwise show as never used in Settings.
  void touch(row, now);

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
