import { NextRequest, NextResponse } from "next/server";
import { clientIp, hitLimit } from "@/lib/rate-limit";
import { admitDcrRegistration, parseRegistrationRequest } from "@/lib/oauth/clients";
import { registerDcrClient } from "@/lib/oauth/store";
import { logApiError } from "@/lib/api-error";
import { assistantsGate } from "@/lib/oauth/enabled";

export const dynamic = "force-dynamic";

// A registration document is a name and a short list of redirect URIs; 16
// KiB is generous. See the token route for why there are two checks.
const MAX_BODY_BYTES = 16 * 1024;
const tooLarge = () =>
  NextResponse.json({ error: "invalid_request", error_description: "request too large" }, { status: 413 });

/**
 * RFC 7591 Dynamic Client Registration — the fallback for assistants that do
 * not use CIMD. Anonymous by design (that is what DCR is), so it is
 * rate-limited per address and writes one small row. Every client is
 * registered as public: the response states `none` whatever was asked for.
 */
export async function POST(request: NextRequest) {
  // Absent until a family switches assistants on (lib/oauth/enabled.ts).
  const off = await assistantsGate();
  if (off) return off;
  if (hitLimit(`oauth-register:${clientIp(request)}`, 10, 60 * 60_000).limited) {
    return NextResponse.json({ error: "temporarily_unavailable", error_description: "too many registrations" }, { status: 429 });
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) return tooLarge();
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return tooLarge();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const parsed = parseRegistrationRequest(json);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, error_description: parsed.description }, { status: 400 });
  }
  try {
    if (!(await admitDcrRegistration())) {
      return NextResponse.json({ error: "temporarily_unavailable", error_description: "too many registrations" }, { status: 429 });
    }
    const client = await registerDcrClient(parsed.clientName, parsed.redirectUris);
    return NextResponse.json({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (err) {
    await logApiError("oauth/register", err);
    return NextResponse.json({ error: "server_error", error_description: "could not register the client" }, { status: 500 });
  }
}
