import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { publicOrigin } from "@/lib/oauth/origin";
import { CODE_TTL_S } from "@/lib/oauth/config";
import { buildRedirect, isLoopbackRedirect } from "@/lib/oauth/redirect";
import { narrowScopes } from "@/lib/oauth/scopes";
import { createOAuthStore } from "@/lib/oauth/store";
import { generateAuthorizationCode } from "@/lib/oauth/grants";
import { familyHasPin, verifySettingsPin, setSettingsPin, PIN_FORMAT } from "@/lib/settings-pin";
import { logApiError } from "@/lib/api-error";
import type { AuthRequest } from "@/lib/oauth/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pending(r: AuthRequest | null, now: Date): r is AuthRequest {
  return !!r && !r.familyId && !r.usedAt && new Date(r.expiresAt).getTime() > now.getTime();
}

/** What the consent page shows. The family comes from the session, never the request. */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const id = request.nextUrl.searchParams.get("request") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const r = await createOAuthStore().getAuthRequest(id);
  if (!pending(r, new Date())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    clientName: r.clientName,
    redirectHost: new URL(r.redirectUri).host,
    loopbackOnly: isLoopbackRedirect(r.redirectUri),
    scopes: r.scopes,
    pinSet: await familyHasPin(auth.session.familyId),
  });
}

/**
 * Approve or deny. Returns where the browser goes next; the page navigates
 * there.
 *
 * Controller Ruling 1 (amendment, binding): the settings PIN is mandatory to
 * approve an assistant. A family that has none sets its first PIN in this
 * same request — the consent page collects it twice and sends `newPin`. The
 * check order matters: scopes are validated *before* a new PIN is stored, so
 * a request that would fail anyway (no scopes granted) never has the side
 * effect of setting a PIN nobody confirmed they wanted.
 */
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.request === "string" ? body.request : "";
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date();
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  const store = createOAuthStore();
  try {
    const r = await store.getAuthRequest(id);
    if (!pending(r, now)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (body?.decision === "deny") {
      await store.denyAuthRequest(id, now);
      return NextResponse.json({ redirect: buildRedirect(r.redirectUri, { error: "access_denied", state: r.state, iss: origin }) });
    }
    if (body?.decision !== "approve") return NextResponse.json({ error: "invalid_request" }, { status: 400 });

    const familyId = auth.session.familyId;
    const hasPin = await familyHasPin(familyId);
    let newPin: string | null = null;
    if (hasPin) {
      const result = await verifySettingsPin(familyId, typeof body.pin === "string" ? body.pin : "");
      if (result === "rate_limited") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      if (result === "invalid") return NextResponse.json({ error: "pin_invalid" }, { status: 403 });
    } else {
      newPin = typeof body.newPin === "string" ? body.newPin : "";
      if (!PIN_FORMAT.test(newPin)) return NextResponse.json({ error: "new_pin_invalid" }, { status: 400 });
    }

    const granted = narrowScopes(r.scopes, Array.isArray(body.scopes) ? body.scopes : []);
    if (granted.length === 0) return NextResponse.json({ error: "no_scopes" }, { status: 400 });

    if (newPin !== null) await setSettingsPin(familyId, newPin);

    const code = generateAuthorizationCode();
    const approved = await store.approveAuthRequest(
      id, familyId, granted, code.hash, new Date(now.getTime() + CODE_TTL_S * 1000).toISOString(), now,
    );
    if (!approved) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ redirect: buildRedirect(r.redirectUri, { code: code.code, state: r.state, iss: origin }) });
  } catch (err) {
    await logApiError("oauth/consent", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
