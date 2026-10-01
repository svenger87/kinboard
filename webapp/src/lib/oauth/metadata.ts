import { MCP_SCOPES } from "@/lib/oauth/config";
import { MCP_PATH, mcpResource } from "@/lib/oauth/origin";

/** RFC 9728. `resource` must equal the URL as the user typed it, path included. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Kinboard",
  };
}

/**
 * RFC 8414. Each flag here is one a client branches on:
 * - Claude selects CIMD only with `client_id_metadata_document_supported` AND
 *   `"none"` in `token_endpoint_auth_methods_supported`, else falls back to DCR;
 * - ChatGPT uses its stable redirect URI only when
 *   `authorization_response_iss_parameter_supported` is true, and we then owe
 *   `iss` on every authorization response, success or error.
 */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    scopes_supported: [...MCP_SCOPES],
  };
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

export function wwwAuthenticate(
  origin: string,
  opts: { error?: "invalid_token" | "insufficient_scope"; scope?: string } = {},
): string {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl(origin)}"`];
  if (opts.error) parts.push(`error="${opts.error}"`);
  parts.push(`scope="${opts.scope ?? MCP_SCOPES.join(" ")}"`);
  return `Bearer ${parts.join(", ")}`;
}
