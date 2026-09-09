import { NextRequest, NextResponse } from "next/server";
import { searchSafeImages, imageSearchDisabled } from "@/lib/safe-image-search";
import { familyMatchesSession, requireSession } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Image search, shared across callers.
 *
 * `mode` defaults to `"product"`, which puts Open Food Facts first — on a
 * shopping list the useful result is a photo of the actual packet, not a
 * stock photo of milk in a glass. That is the shopping list's behavior,
 * unchanged. Callers searching for something that isn't groceries (e.g. the
 * device catalogue) pass `mode=general`.
 *
 * The Bing and DuckDuckGo HTML scrapers that used to live here are gone.
 * They rotted silently upstream and started serving results unrelated to
 * the query and unfiltered for adult content; see the module comment in
 * lib/safe-image-search.ts for the full post-mortem.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const familyId = searchParams.get("family_id") ?? undefined;

  // family_id is optional here — it only picks which family's stored image
  // provider to spend — so absent is fine and present has to be the caller's.
  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "12", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 30)
    : 12;

  const modeParam = searchParams.get("mode");
  // Defaults to "product" so the shopping list, the only caller today, is
  // unchanged. Devices pass "general": Open Food Facts carries groceries, and
  // a washing machine is not one.
  const mode = modeParam === "general" ? "general" : "product";

  if (!query || query.trim().length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 },
    );
  }

  if (imageSearchDisabled()) {
    return NextResponse.json({
      results: [],
      total: 0,
      query,
      disabled: true,
    });
  }

  const results = await searchSafeImages(query, {
    limit,
    familyId,
    mode,
    locale: searchParams.get("locale") ?? "en",
  });

  return NextResponse.json({
    results,
    total: results.length,
    query,
  });
}
