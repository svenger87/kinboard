import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { mintFamilyToken } from "@/lib/family-jwt";

export const dynamic = "force-dynamic";

/**
 * Hand the browser a family-scoped token for its direct PostgREST connection.
 *
 * This is the hinge between the two halves of the auth model:
 *
 *  - the device session cookie (HttpOnly, server-issued, revocable) proves the
 *    caller belongs to a family;
 *  - the token minted here carries that family as a claim, which is what the
 *    row-level security policies read.
 *
 * The browser can therefore query Supabase directly — which it must, that is
 * how the app is built — without the family id ever being something the client
 * chooses. It gets the family it was issued, or nothing.
 *
 * Deliberately not cacheable: it's a bearer credential with an expiry.
 */
export async function GET(request: NextRequest) {
  const result = await requireSession(request);
  if (!result.ok) return result.response;

  const { token, expiresAt } = mintFamilyToken(result.session.familyId);

  return NextResponse.json(
    {
      token,
      expiresAt,
      familyId: result.session.familyId,
    },
    {
      headers: {
        // Never let a proxy or the browser keep this.
        "Cache-Control": "no-store, private",
      },
    },
  );
}
