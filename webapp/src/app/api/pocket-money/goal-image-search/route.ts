import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { searchWebImages } from "@/lib/pocket-money/web-image-search";

export const dynamic = "force-dynamic";

// Curated-catalog "good enough" threshold: at or above this many hits
// we don't bother augmenting with web results, since the kid almost
// certainly finds what they want in the curated set. Below it, fan
// out to the web search to fill the gap.
const CATALOG_GOOD_ENOUGH = 5;
const TOTAL_RESULT_CAP = 15;

interface ResultRow {
  name: string;
  image_url: string;
  source: string | null;
}

// GET /api/pocket-money/goal-image-search?q=lego
// Hybrid: curated `item_catalog` first, then web image search to fill
// the rest of the page. Returns { results: [{ name, image_url, source }, ...] }
// where `source` is "catalog" (or whatever the curated row recorded)
// for catalog hits and "web" for web-search hits.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = createAdminClient();
  const { data: catalogRows, error } = await (supabase as any)
    .from("item_catalog")
    .select("name, image_url, source")
    .ilike("name", `%${q}%`)
    .not("image_url", "is", null)
    .order("name", { ascending: true })
    .limit(TOTAL_RESULT_CAP);

  if (error) {
    console.error("[pocket-money] image search:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const catalogResults: ResultRow[] = (catalogRows ?? []).map(
    (r: ResultRow) => ({
      name: r.name,
      image_url: r.image_url,
      source: r.source ?? "catalog",
    }),
  );

  if (catalogResults.length >= CATALOG_GOOD_ENOUGH) {
    return NextResponse.json({ results: catalogResults });
  }

  // Augment with web results. Failure is non-fatal — fall back to
  // catalog-only so the dialog still works when the upstream is down.
  let webResults: ResultRow[] = [];
  try {
    const want = TOTAL_RESULT_CAP - catalogResults.length;
    const found = await searchWebImages(q, want);
    const seen = new Set(catalogResults.map((r) => r.image_url));
    webResults = found
      .filter((r) => !seen.has(r.url))
      .map((r) => ({ name: r.title, image_url: r.url, source: "web" }));
  } catch (e) {
    console.error("[pocket-money] web image search failed:", e);
  }

  return NextResponse.json({
    results: [...catalogResults, ...webResults].slice(0, TOTAL_RESULT_CAP),
  });
}
