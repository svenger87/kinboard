import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { publicOrigin } from "@/lib/oauth/origin";
import { OAUTH_REQUEST_COOKIE } from "@/lib/oauth/config";
import { isLoopbackRedirect } from "@/lib/oauth/redirect";
import { isCimdClientId } from "@/lib/oauth/clients";
import { createOAuthStore } from "@/lib/oauth/store";
import { generateAuthorizationCode } from "@/lib/oauth/grants";
import { familyHasPin, verifySettingsPin, setSettingsPinIfAbsent } from "@/lib/settings-pin";
import { decideConsent, type ConsentDeps } from "@/lib/oauth/consent";
import { logApiError } from "@/lib/api-error";
import { assistantsEnabledFor } from "@/lib/oauth/enabled";
import type { AuthRequest } from "@/lib/oauth/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pending(r: AuthRequest | null, now: Date): r is AuthRequest {
  return !!r && !r.familyId && !r.usedAt && new Date(r.expiresAt).getTime() > now.getTime();
}

/**
 * The browser answering this request must be the one /api/oauth/authorize
 * started it for. That route sets OAUTH_REQUEST_COOKIE when it parks the
 * pending request; without it, a consent *link* forwarded to someone else —
 * pasted into chat, read off a shared screen — could be approved in their
 * browser instead of the one that opened it. They might well have a joined
 * device of their own, even a PIN: the right credentials, held by the wrong
 * person.
 */
function cookieMatches(request: NextRequest, id: string): boolean {
  return request.cookies.get(OAUTH_REQUEST_COOKIE)?.value === id;
}

/**
 * A family that has not switched on "Allow AI assistants" cannot approve
 * one, even when another family on the same install has (which is what got
 * this far past the 404 on /api/oauth/authorize). Null to proceed.
 */
async function assistantsDisabled(familyId: string): Promise<NextResponse | null> {
  try {
    if (await assistantsEnabledFor(familyId)) return null;
  } catch (err) {
    await logApiError("oauth/consent/enabled", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  return NextResponse.json({ error: "assistants_disabled" }, { status: 403 });
}

/** What the consent page shows. The family comes from the session, never the request. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const disabled = await assistantsDisabled(auth.session.familyId);
  if (disabled) return disabled;
  const id = request.nextUrl.searchParams.get("request") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!cookieMatches(request, id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const r = await createOAuthStore().getAuthRequest(id);
  if (!pending(r, new Date())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const redirectUrl = new URL(r.redirectUri);
  // Who is really asking (RFC-010 §3.2). A CIMD client_id is an https URL
  // whose document Kinboard fetched from that host, so the host vouches for
  // the name. A DCR client named itself in an anonymous POST — "Claude" from
  // anyone — and the page must say it cannot confirm that.
  const verified = isCimdClientId(r.clientId);
  return NextResponse.json({
    clientName: r.clientName,
    verified,
    clientHost: verified ? new URL(r.clientId).host : null,
    // Always a host: only https and http-loopback redirect URIs are ever
    // accepted (isAcceptableRedirectUri), so there is no custom scheme here.
    redirectHost: redirectUrl.host,
    loopbackOnly: isLoopbackRedirect(r.redirectUri),
    scopes: r.scopes,
    pinSet: await familyHasPin(auth.session.familyId),
  });
}

/**
 * Approve or deny. Returns where the browser goes next; the page navigates
 * there. The decision itself — PIN, scopes, code minting — lives in
 * decideConsent (lib/oauth/consent.ts); this handler keeps the session,
 * request-id, Origin and cookie checks, the pending-request lookup and
 * error logging.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const disabled = await assistantsDisabled(auth.session.familyId);
  if (disabled) return disabled;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.request === "string" ? body.request : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!cookieMatches(request, id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date();
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  // A same-origin fetch from the consent page never sets Origin to anything
  // but this server's own origin. One present and different means the POST
  // did not come from that page, whatever the cookie says.
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const store = createOAuthStore();
  try {
    const r = await store.getAuthRequest(id);
    if (!pending(r, now)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const deps: ConsentDeps = {
      hasPin: familyHasPin,
      verifyPin: verifySettingsPin,
      setPinIfAbsent: (familyId, pin) => setSettingsPinIfAbsent(familyId, pin),
      approve: (reqId, familyId, granted, codeHash, codeExpiresAt, approveNow) =>
        store.approveAuthRequest(reqId, familyId, granted, codeHash, codeExpiresAt, approveNow),
      deny: (reqId, denyNow) => store.denyAuthRequest(reqId, denyNow),
      newCode: generateAuthorizationCode,
    };
    const outcome = await decideConsent(deps, {
      request: r,
      familyId: auth.session.familyId,
      origin,
      decision: body?.decision,
      pin: body?.pin,
      newPin: body?.newPin,
      scopes: body?.scopes,
      now,
    });
    if (outcome.status === 200) return NextResponse.json({ redirect: outcome.redirect });
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  } catch (err) {
    await logApiError("oauth/consent", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
