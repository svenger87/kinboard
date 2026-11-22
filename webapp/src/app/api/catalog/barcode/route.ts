import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { familyMatchesSession, requireSession } from "@/lib/require-session";
import { barcodeCandidates } from "@/lib/barcode/gtin";
import { lookupOpenFacts } from "@/lib/barcode/open-facts";

interface ProductLookupResult {
  id: string | null;
  name: string;
  brand: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  barcode: string;
  source: "local" | "openfoodfacts";
  default_unit: string | null;
  quantity: string | null;
}

interface LocalCatalogRow {
  id: string;
  family_id: string | null;
  name: string;
  barcode: string;
  image_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  default_unit: string | null;
}

const LANG = /^[a-z]{2}$/;

/**
 * A product by its barcode, for the shopping list's scanner: the family's own
 * catalog first (a product somebody named once, because no database knew it),
 * then Open Food Facts and its sister databases (lib/barcode/open-facts.ts),
 * named in `lang` where they have it.
 *
 * Same reasoning as ../search: family_id is optional, but where it is given
 * it names a family's own catalog rows, so it has to be the session's.
 */
export async function GET(request: NextRequest) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const raw = searchParams.get("barcode") ?? "";
  // Usually one; typed eight digits can be an EAN-8 and a UPC-E at once.
  const candidates = barcodeCandidates(raw);
  const familyId = searchParams.get("family_id");
  const langParam = searchParams.get("lang")?.toLowerCase() ?? "en";
  const lang = LANG.test(langParam) ? langParam : "en";

  if (candidates.length === 0) {
    return NextResponse.json({ error: "invalid barcode", barcode: raw.slice(0, 32) }, { status: 400 });
  }

  if (!familyMatchesSession(auth.session, familyId)) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // 1. The family's own catalog: a product somebody in this family named.
  // Only the family's own rows, never shared ones (family_id NULL): what a
  // barcode is called must not be something another family could write.
  try {
    const supabase = await createAdminClient();
     
    const { data: rows } = await (supabase as any)
      .from("item_catalog")
      .select("id, family_id, name, barcode, image_url, thumbnail_url, category, default_unit")
      .eq("family_id", auth.session.familyId)
      .in("barcode", candidates)
      .limit(5);
    const list = (rows ?? []) as LocalCatalogRow[];
    const item = [...list].sort((a, b) => candidates.indexOf(a.barcode) - candidates.indexOf(b.barcode))[0];
    if (item) {
      const product: ProductLookupResult = {
        id: item.id,
        name: item.name,
        brand: null,
        image_url: item.image_url,
        thumbnail_url: item.thumbnail_url,
        category: item.category,
        barcode: item.barcode,
        source: "local",
        default_unit: item.default_unit,
        quantity: null,
      };
      return NextResponse.json({ product, source: "local" });
    }
  } catch (error) {
    console.error("Error checking local catalog:", error);
  }

  // 2. Open Food Facts, then Open Beauty / Pet Food / Products Facts.
  let found = null;
  let barcode = candidates[0];
  for (const candidate of candidates) {
    found = await lookupOpenFacts(candidate, lang);
    if (found) {
      barcode = candidate;
      break;
    }
  }
  if (!found) {
    return NextResponse.json({ error: "Product not found", barcode }, { status: 404 });
  }

  const product: ProductLookupResult = {
    id: null,
    name: found.name,
    brand: found.brand,
    image_url: found.image_url,
    thumbnail_url: found.thumbnail_url,
    category: found.category,
    barcode,
    source: "openfoodfacts",
    default_unit: null,
    quantity: found.quantity,
  };
  return NextResponse.json({ product, source: "openfoodfacts", database: found.database });
}
