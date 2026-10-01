import { NextRequest, NextResponse } from "next/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { matchCatalogItems } from "@/lib/catalog-match";

/**
 * POST /api/catalog/match
 * Batch match item names against local catalog and Bring! catalog
 *
 * Body: { family_id: string, items: string[] }
 * Returns: { matches: Record<string, CatalogMatch | null> }
 *
 * The matching itself lives in lib/catalog-match.ts, shared with the
 * Integration API's "put a recipe on the shopping list".
 */
// Same reasoning as ../search: family_id is optional, but where it is given
// it names a family's own catalog rows, so it has to be the session's.
export async function POST(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { family_id, items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Items array is required" },
        { status: 400 }
      );
    }

    if (!familyMatchesSession(auth.session, family_id)) {
      return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    }

    const matches = await matchCatalogItems(family_id, items);

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Error in POST /api/catalog/match:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
