import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionContext } from "@/lib/session";

/**
 * The per-route half of the auth boundary.
 *
 * proxy.ts rejects unauthenticated requests early, but Next's own docs are
 * explicit that it must not be the only check:
 *
 *   "Always verify authentication and authorization inside each Server
 *    Function rather than relying on Proxy alone." — a matcher change or a
 *    refactor that moves a route can silently remove coverage.
 *
 * So routes call this too. Belt and braces, on purpose: the proxy is a gate,
 * this is the lock.
 *
 * The important property is not that it authenticates — it's that it returns
 * the family, so a route never has to take `family_id` from the query string.
 * A route that gets its tenant from the session cannot be told to read
 * someone else's, which retires the whole class of bug that #54 and #71
 * fixed one route at a time.
 */

export type SessionResult =
  | { ok: true; session: SessionContext }
  | { ok: false; response: NextResponse };

export async function requireSession(request: NextRequest): Promise<SessionResult> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "not authenticated" }, { status: 401 }),
    };
  }

  return { ok: true, session };
}

/**
 * For routes still taking family_id from the request while stage 2 is in
 * progress: confirm it matches the session before trusting it.
 *
 * A route that has been converted to read the family from the session doesn't
 * need this. It exists so the migration can happen route by route without a
 * window where some routes are unprotected.
 */
export function familyMatchesSession(
  session: SessionContext,
  requestedFamilyId: string | null | undefined,
): boolean {
  // Absent is fine — the route is expected to fall back to the session's
  // family. Present and different is not.
  if (!requestedFamilyId) return true;
  return requestedFamilyId === session.familyId;
}
