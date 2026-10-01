import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { publicOrigin } from "@/lib/oauth/origin";
import { logApiError } from "@/lib/api-error";
import { decideActionRequest, familyActionRequest } from "@/lib/home/action-requests";
import { liveActionStore, liveDecideDeps } from "@/lib/home/action-requests-live";
import { screenTranslator, withRooms } from "@/lib/home/action-requests-rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/assistant-actions/{id} — one request of the session's family, in
 * any state. The push notification's deep link (`/assistant-actions/{id}`)
 * reads it, so a phone that opens it late still learns what happened.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const { familyId } = auth.session;
  try {
    const row = await familyActionRequest(id, familyId, { store: liveActionStore });
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const [screen] = await withRooms(familyId, [row], screenTranslator(request));
    return NextResponse.json({ request: screen });
  } catch (err) {
    await logApiError("assistant-actions/read", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * POST /api/assistant-actions/{id}  `{ decision: "approve", pin }` or `{ decision: "deny" }`
 *
 * A family member deciding a sensitive assistant action (RFC-011 §4.3):
 * allowing it takes the settings PIN, denying it takes nothing — anyone at
 * a screen may stop it; a `pin` sent with a deny is ignored. Everything that matters — the PIN through the shared
 * limiter, the compare-and-swap, the revoke and expiry checks, running the
 * stored action exactly once — is `decideActionRequest`
 * (`lib/home/action-requests.ts`). This handler keeps the session, the
 * Origin check and the error log.
 *
 * Errors are `{ error }` with one of: invalid_request (400), forbidden
 * (403, Origin), not_found (404), expired, revoked, already_decided (409);
 * and for approve only: pin_required, pin_invalid (403), rate_limited (429).
 * A 200 can still be a `failed` request — its `result.reason` says why it
 * never reached Home Assistant (not_in_catalogue, catalogue_unavailable,
 * not_allowed).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  // As on the consent page: a same-origin fetch from a Kinboard screen never
  // sends an Origin other than this server's. One that is present and
  // different did not come from a Kinboard page, whatever the cookie says.
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const { familyId, deviceId } = auth.session;
  try {
    const outcome = await decideActionRequest(
      { id, familyId, deviceId, decision: body?.decision, pin: body?.pin },
      liveDecideDeps,
    );
    const [screen] = outcome.request ? await withRooms(familyId, [outcome.request], screenTranslator(request)) : [undefined];
    if (outcome.status === 200) return NextResponse.json({ request: screen });
    return NextResponse.json(
      screen ? { error: outcome.error, request: screen } : { error: outcome.error },
      { status: outcome.status },
    );
  } catch (err) {
    await logApiError("assistant-actions/decide", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
