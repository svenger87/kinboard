import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession, type SessionContext } from "@/lib/session";
import { apiError } from "@/lib/api-error";

/**
 * The auth boundary for API routes. Not a second line of defence — the line.
 *
 * An earlier version of this comment said "proxy.ts rejects unauthenticated
 * requests early", and described this as belt and braces behind it. Read
 * proxy.ts: it refreshes Supabase cookies and returns NextResponse.next() on
 * every path it matches. It rejects nothing, and never has. Believing
 * otherwise is how ~100 routes shipped with no check at all — each one
 * looking like the redundant half of a pair whose other half didn't exist.
 *
 * Next's own docs make the same point about proxies in general, and it holds
 * doubly when the proxy is a no-op:
 *
 *   "Always verify authentication and authorization inside each Server
 *    Function rather than relying on Proxy alone." — a matcher change or a
 *    refactor that moves a route can silently remove coverage.
 *
 * So the real check is here, in the route, and `e2e/api-route-auth.spec.ts`
 * fails the build if a route reaches for the service-role client without
 * calling this.
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
    // The `error` string is unchanged, so every existing caller reading
    // `.error` keeps working; `code` and `correlationId` are added beside it.
    // This one call site covers every route behind the auth boundary, which
    // is why it is the first adopter.
    return { ok: false, response: await apiError("not authenticated", "not_authenticated") };
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
 *
 * A mismatch is answered with the same 401 body as no session at all, and
 * deliberately not with a 403. 403 would mean "you are known, and this isn't
 * yours" — an admission that the family exists, handed to someone who only
 * guessed its id. For a caller asking about a family that isn't theirs, "not
 * authenticated" is both true and all they get to learn.
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
