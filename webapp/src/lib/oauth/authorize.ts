import { AUTH_REQUEST_TTL_S } from "@/lib/oauth/config";
import { mcpResource } from "@/lib/oauth/origin";
import { isValidCodeChallenge } from "@/lib/oauth/pkce";
import { buildRedirect, redirectUriMatches } from "@/lib/oauth/redirect";
import { parseRequestedScopes } from "@/lib/oauth/scopes";
import type { NewAuthRequest, OAuthClient } from "@/lib/oauth/types";

export type AuthorizeCheck =
  | { kind: "page"; status: number; message: string }
  | { kind: "redirect"; location: string }
  | { kind: "ok"; request: NewAuthRequest };

/**
 * RFC 6749 §4.1.2.1: until the client and its redirect URI are verified, an
 * error is shown, not redirected — otherwise this endpoint is an open
 * redirector. After that, errors go back to the client, with `iss` (RFC 9207)
 * because the metadata promises it on every response.
 */
export function validateAuthorizeQuery(
  q: URLSearchParams, origin: string, client: OAuthClient | null, now: Date = new Date(),
): AuthorizeCheck {
  const redirectUri = q.get("redirect_uri") ?? "";
  if (!client) return { kind: "page", status: 400, message: "Unknown client. Start the connection again from the assistant." };
  if (!redirectUriMatches(client.redirectUris, redirectUri)) {
    return { kind: "page", status: 400, message: "This assistant asked to return to an address it did not register." };
  }
  const state = q.get("state");
  const back = (error: string, description: string): AuthorizeCheck => ({
    kind: "redirect",
    location: buildRedirect(redirectUri, { error, error_description: description, state, iss: origin }),
  });

  if (q.get("response_type") !== "code") return back("unsupported_response_type", "only response_type=code is supported");
  const challenge = q.get("code_challenge") ?? "";
  if (q.get("code_challenge_method") !== "S256" || !isValidCodeChallenge(challenge)) {
    return back("invalid_request", "PKCE with S256 is required");
  }
  const resource = q.get("resource") ?? mcpResource(origin);
  if (resource !== mcpResource(origin)) return back("invalid_target", "resource must be this server's MCP endpoint");
  const scopes = parseRequestedScopes(q.get("scope"));
  if (scopes.length === 0) return back("invalid_scope", "none of the requested scopes exist");

  return {
    kind: "ok",
    request: {
      clientId: client.clientId, clientName: client.clientName, redirectUri, state, codeChallenge: challenge,
      scopes, resource, expiresAt: new Date(now.getTime() + AUTH_REQUEST_TTL_S * 1000).toISOString(),
    },
  };
}
