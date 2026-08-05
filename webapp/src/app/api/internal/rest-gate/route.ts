import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Edge gate for the public Supabase API router (pentest F3).
 *
 * The browser talks to PostgREST/GoTrue/Storage/Realtime directly, so those
 * paths are published on the public hostname. PostgREST accepts any validly
 * signed JWT — including the service_role key, which has BYPASSRLS and reads
 * everything. That key is only ever used server-side, over the internal
 * webapp→kong path that never touches Traefik, so it has no business arriving
 * from the internet. If it ever leaked (a log, a backup, a future proxy bug),
 * it would be a total bypass usable from anywhere.
 *
 * Traefik forward-auths every public /rest,/auth,/storage,/realtime request to
 * this route. It inspects the role claim on the presented credentials and
 * rejects service_role. Everything else — the anon key, family-scoped
 * `authenticated` tokens — passes, and PostgREST still verifies the signature
 * afterwards. This is a coarse gate in front of the real check, not a
 * replacement for it.
 *
 * Fail OPEN, deliberately. This guards against a key that is not currently
 * leaked, and it sits in front of every dashboard query. A bug that denied
 * legitimate traffic would take the whole app down to protect against a
 * hypothetical — a far worse trade than letting a malformed token through to
 * PostgREST, which rejects it anyway. So the only thing that produces a 403 is
 * a positively-decoded service_role claim; anything unparseable is allowed.
 */

function roleOf(token: string | null): string | null {
  if (!token) return null;
  const jwt = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function handle(request: NextRequest): NextResponse {
  // Supabase clients send the key as `apikey` and the user token as
  // `Authorization`. Either could carry service_role; check both.
  const roles = [roleOf(request.headers.get("apikey")), roleOf(request.headers.get("authorization"))];

  if (roles.includes("service_role")) {
    return NextResponse.json(
      { error: "service_role is not accepted from the public endpoint" },
      { status: 403 },
    );
  }
  // 204: nothing to add, request may proceed.
  return new NextResponse(null, { status: 204 });
}

// Traefik forward-auth issues a GET; cover the other verbs so a POST/PATCH to
// PostgREST is gated too.
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
