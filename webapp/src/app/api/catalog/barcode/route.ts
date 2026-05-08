import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Open Food Facts API base URL
const OFF_API_BASE = "https://world.openfoodfacts.org";

// Local catalog item type (until types are regenerated)
interface LocalCatalogItem {
  id: string;
  family_id: string | null;
  name: string;
  name_normalized: string;
  barcode: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  default_unit: string | null;
  default_quantity: number | null;
  nutrition_json: Record<string, number> | null;
  source: string;
  popularity: number;
  created_at: string;
}

interface OpenFoodFactsProduct {
  code: string;
  product_name: string;
  product_name_de?: string;
  brands?: string;
  image_url?: string;
  image_small_url?: string;
  image_thumb_url?: string;
  categories_tags?: string[];
  nutriscore_grade?: string;
  nutriments?: Record<string, number>;
  quantity?: string;
}

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
  nutrition: Record<string, number> | null;
}

// Map Open Food Facts categories to our shopping categories
function mapOFFCategoryToLocal(categories: string[] | undefined): string | null {
  if (!categories || categories.length === 0) return null;

  const categoryMap: Record<string, string> = {
    "en:fruits": "obst_gemuese",
    "en:vegetables": "obst_gemuese",
    "en:fresh-fruits": "obst_gemuese",
    "en:fresh-vegetables": "obst_gemuese",
    "en:dairies": "milchprodukte",
    "en:milks": "milchprodukte",
    "en:cheeses": "milchprodukte",
    "en:yogurts": "milchprodukte",
    "en:butters": "milchprodukte",
    "en:breads": "backwaren",
    "en:pastries": "backwaren",
    "en:meats": "fleisch",
    "en:fishes": "fleisch",
    "en:seafood": "fleisch",
    "en:poultry": "fleisch",
    "en:beverages": "getraenke",
    "en:waters": "getraenke",
    "en:juices": "getraenke",
    "en:sodas": "getraenke",
    "en:frozen-foods": "tiefkuehl",
    "en:ice-creams-and-sorbets": "tiefkuehl",
    "en:cleaning-products": "haushalt",
  };

  for (const cat of categories) {
    if (categoryMap[cat]) {
      return categoryMap[cat];
    }
  }

  return "sonstiges";
}

// Lookup product by barcode from Open Food Facts
async function lookupBarcode(barcode: string): Promise<ProductLookupResult | null> {
  try {
    const url = `${OFF_API_BASE}/api/v2/product/${barcode}?lc=de&fields=code,product_name,product_name_de,brands,image_url,image_small_url,image_thumb_url,categories_tags,nutriscore_grade,nutriments,quantity`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "FamilyCalendar/1.0 (contact@example.com)",
      },
      next: { revalidate: 86400 }, // Cache for 24 hours
    });

    if (!response.ok) {
      console.error("Open Food Facts barcode lookup error:", response.status);
      return null;
    }

    const data = await response.json();

    if (data.status !== 1 || !data.product) {
      return null;
    }

    const product: OpenFoodFactsProduct = data.product;
    const productName = product.product_name_de || product.product_name;

    if (!productName) {
      return null;
    }

    return {
      id: null,
      name: productName,
      brand: product.brands || null,
      image_url: product.image_url || null,
      thumbnail_url: product.image_thumb_url || product.image_small_url || null,
      category: mapOFFCategoryToLocal(product.categories_tags),
      barcode: product.code,
      source: "openfoodfacts",
      default_unit: null,
      quantity: product.quantity || null,
      nutrition: product.nutriments || null,
    };
  } catch (error) {
    console.error("Error looking up barcode:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const barcode = searchParams.get("barcode");
  const familyId = searchParams.get("family_id");

  if (!barcode || barcode.length < 8) {
    return NextResponse.json(
      { error: "Valid barcode is required (at least 8 digits)" },
      { status: 400 }
    );
  }

  // 1. Check local catalog first
  if (familyId) {
    try {
      const supabase = await createAdminClient();
       
      const { data: localItem } = await (supabase as any)
        .from("item_catalog")
        .select("*")
        .eq("barcode", barcode)
        .or(`family_id.eq.${familyId},family_id.is.null`)
        .single();

      if (localItem) {
        const item = localItem as LocalCatalogItem;
        return NextResponse.json({
          product: {
            id: item.id,
            name: item.name,
            brand: null,
            image_url: item.image_url,
            thumbnail_url: item.thumbnail_url,
            category: item.category,
            barcode: item.barcode,
            source: item.source,
            default_unit: item.default_unit,
            quantity: null,
            nutrition: item.nutrition_json,
          } as ProductLookupResult,
          source: "local",
        });
      }
    } catch (error) {
      console.error("Error checking local catalog:", error);
    }
  }

  // 2. Lookup from Open Food Facts
  const offProduct = await lookupBarcode(barcode);

  if (!offProduct) {
    return NextResponse.json(
      { error: "Product not found", barcode },
      { status: 404 }
    );
  }

  return NextResponse.json({
    product: offProduct,
    source: "openfoodfacts",
  });
}
