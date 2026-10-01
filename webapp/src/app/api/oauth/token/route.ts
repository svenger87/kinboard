import { NextRequest, NextResponse } from "next/server";
import { clientIp, hitLimit } from "@/lib/rate-limit";
import { createOAuthStore } from "@/lib/oauth/store";
import { exchangeAuthorizationCode, refreshAccessToken } from "@/lib/oauth/grants";
import { logApiError } from "@/lib/api-error";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

/**
 * RFC 6749 token endpoint. Claude and ChatGPT send
 * application/x-www-form-urlencoded (RFC 6749 §4.1.3) — a JSON-only parser
 * here answers 415 and the connection fails with no useful message. Must
 * answer within Claude's 10 s (exchange) / 30 s (refresh) limits; it does two
 * or three single-row queries.
 */
export async function POST(request: NextRequest) {
  if (hitLimit(`oauth-token:${clientIp(request)}`, 60, 60_000).limited) {
    return NextResponse.json({ error: "temporarily_unavailable", error_description: "too many requests" }, { status: 429, headers: NO_STORE });
  }
  const form = new URLSearchParams(await request.text());
  const get = (k: string) => form.get(k) ?? "";
  const clientId = get("client_id");
  if (!clientId) {
    return NextResponse.json({ error: "invalid_request", error_description: "client_id is required" }, { status: 400, headers: NO_STORE });
  }
  const resource = form.get("resource");
  const store = createOAuthStore();
  try {
    const grantType = get("grant_type");
    const result =
      grantType === "authorization_code"
        ? await exchangeAuthorizationCode(store, { code: get("code"), codeVerifier: get("code_verifier"), clientId, redirectUri: get("redirect_uri"), resource })
        : grantType === "refresh_token"
          ? await refreshAccessToken(store, { refreshToken: get("refresh_token"), clientId, resource })
          : ({ ok: false, body: { error: "unsupported_grant_type", error_description: "use authorization_code or refresh_token" } } as const);
    return NextResponse.json(result.body, { status: result.ok ? 200 : 400, headers: NO_STORE });
  } catch (err) {
    await logApiError("oauth/token", err);
    return NextResponse.json({ error: "server_error", error_description: "try again" }, { status: 500, headers: NO_STORE });
  }
}
