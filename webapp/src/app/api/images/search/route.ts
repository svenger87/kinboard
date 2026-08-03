import { NextRequest, NextResponse } from "next/server";
import { searchSafeImages, imageSearchDisabled } from "@/lib/safe-image-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Image search for shopping-list item photos.
 *
 * `mode: "product"` puts Open Food Facts first — on a shopping list the
 * useful result is a photo of the actual packet, not a stock photo of
 * milk in a glass.
 *
 * The Bing and DuckDuckGo HTML scrapers that used to live here are gone.
 * They rotted silently upstream and started serving results unrelated to
 * the query and unfiltered for adult content; see the module comment in
 * lib/safe-image-search.ts for the full post-mortem.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");
  const familyId = searchParams.get("family_id") ?? undefined;

  const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "12", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 30)
    : 12;

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
    mode: "product",
  });

  return NextResponse.json({
    results,
    total: results.length,
    query,
  });
}
