import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Bring! catalog URL for German locale
const BRING_CATALOG_URL = "https://web.getbring.com/locale/catalog.de-DE.json";

// Cache for Bring! catalog (in-memory, refreshed hourly)
let bringCatalogCache: BringCatalogItem[] | null = null;
let bringCatalogCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface BringCatalogItem {
  itemId: string;
  name: string;
  sectionId: string;
  sectionName: string;
}

interface RawCatalogSection {
  sectionId: string;
  name: string;
  items: { itemId: string; name: string }[];
}

interface RawCatalogResponse {
  language: string;
  catalog: {
    sections: RawCatalogSection[];
  };
}

interface CatalogMatch {
  id: string | null;
  name: string;
  category: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  source: string;
}

// Map Bring! section names to our shopping categories
function mapBringSectionToCategory(sectionName: string): string {
  const sectionMap: Record<string, string> = {
    "Obst & Gemüse": "obst_gemuese",
    "Milch & Käse": "milchprodukte",
    "Brot & Gebäck": "backwaren",
    "Fleisch & Fisch": "fleisch",
    "Getränke": "getraenke",
    "Tiefkühl": "tiefkuehl",
    "Frühstück": "fruehstueck",
    "Brotaufstriche & Aufstriche": "fruehstueck",
    "Müsli & Cerealien": "fruehstueck",
    "Süßigkeiten & Snacks": "suessigkeiten",
    "Snacks": "suessigkeiten",
    "Süßwaren": "suessigkeiten",
    "Fertiggerichte": "vorrat",
    "Gewürze & Saucen": "vorrat",
    "Pasta & Reis": "vorrat",
    "Backen": "vorrat",
    "Öl & Essig": "vorrat",
    "Teigwaren": "vorrat",
    "Konserven": "vorrat",
    "Haushalt": "haushalt",
    "Drogerie": "drogerie",
    "Baby": "drogerie",
    "Haustier": "tierbedarf",
    "Tierbedarf": "tierbedarf",
  };

  return sectionMap[sectionName] || "sonstiges";
}

// Fetch and cache Bring! catalog
async function getBringCatalog(): Promise<BringCatalogItem[]> {
  const now = Date.now();

  if (bringCatalogCache && now - bringCatalogCacheTime < CACHE_TTL) {
    return bringCatalogCache;
  }

  try {
    const response = await fetch(BRING_CATALOG_URL, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      console.error("Failed to fetch Bring! catalog:", response.status);
      return bringCatalogCache || [];
    }

    const rawData: RawCatalogResponse = await response.json();
    const items: BringCatalogItem[] = [];

    if (rawData.catalog?.sections) {
      for (const section of rawData.catalog.sections) {
        if (section.items && Array.isArray(section.items)) {
          for (const item of section.items) {
            items.push({
              itemId: item.itemId,
              name: item.name,
              sectionId: section.sectionId,
              sectionName: section.name,
            });
          }
        }
      }
    }

    bringCatalogCache = items;
    bringCatalogCacheTime = now;

    return items;
  } catch (error) {
    console.error("Error fetching Bring! catalog:", error);
    return bringCatalogCache || [];
  }
}

// Fuzzy match a single item name against catalog
function fuzzyMatch(
  itemName: string,
  catalogName: string
): { match: boolean; score: number } {
  const a = itemName.toLowerCase().trim();
  const b = catalogName.toLowerCase().trim();

  // Exact match
  if (a === b) {
    return { match: true, score: 100 };
  }

  // One contains the other as a complete word
  if (b.startsWith(a + " ") || b.endsWith(" " + a) || b.includes(" " + a + " ")) {
    return { match: true, score: 80 };
  }
  if (a.startsWith(b + " ") || a.endsWith(" " + b) || a.includes(" " + b + " ")) {
    return { match: true, score: 80 };
  }

  // Starts with
  if (b.startsWith(a) || a.startsWith(b)) {
    return { match: true, score: 70 };
  }

  // Contains
  if (b.includes(a) || a.includes(b)) {
    return { match: true, score: 50 };
  }

  return { match: false, score: 0 };
}

// Local catalog item type
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
  source: string;
  popularity: number;
}

/**
 * POST /api/catalog/match
 * Batch match item names against local catalog and Bring! catalog
 *
 * Body: { family_id: string, items: string[] }
 * Returns: { matches: Record<string, CatalogMatch | null> }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { family_id, items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Items array is required" },
        { status: 400 }
      );
    }

    const matches: Record<string, CatalogMatch | null> = {};

    // Initialize all items as null (no match)
    for (const item of items) {
      matches[item.toLowerCase().trim()] = null;
    }

    // 1. Search local catalog first (has images and custom data)
    if (family_id) {
      try {
        const supabase = await createAdminClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: localItems, error } = await (supabase as any)
          .from("item_catalog")
          .select("*")
          .or(`family_id.eq.${family_id},family_id.is.null`)
          .order("popularity", { ascending: false });

        if (!error && localItems) {
          for (const item of items) {
            const normalizedItem = item.toLowerCase().trim();
            if (matches[normalizedItem]) continue; // Already matched

            let bestMatch: { item: LocalCatalogItem; score: number } | null = null;

            for (const catalogItem of localItems as LocalCatalogItem[]) {
              const { match, score } = fuzzyMatch(item, catalogItem.name);
              if (match && (!bestMatch || score > bestMatch.score)) {
                bestMatch = { item: catalogItem, score };
              }
              // If we found an exact match, stop searching
              if (score === 100) break;
            }

            if (bestMatch && bestMatch.score >= 50) {
              matches[normalizedItem] = {
                id: bestMatch.item.id,
                name: bestMatch.item.name,
                category: bestMatch.item.category,
                image_url: bestMatch.item.image_url,
                thumbnail_url: bestMatch.item.thumbnail_url,
                source: "local",
              };
            }
          }
        }
      } catch (error) {
        console.error("Error searching local catalog:", error);
      }
    }

    // 2. Search Bring! catalog for remaining unmatched items
    const bringCatalog = await getBringCatalog();

    for (const item of items) {
      const normalizedItem = item.toLowerCase().trim();
      if (matches[normalizedItem]) continue; // Already matched from local catalog

      let bestMatch: { item: BringCatalogItem; score: number } | null = null;

      for (const bringItem of bringCatalog) {
        const { match, score } = fuzzyMatch(item, bringItem.name);
        if (match && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { item: bringItem, score };
        }
        if (score === 100) break;
      }

      if (bestMatch && bestMatch.score >= 50) {
        matches[normalizedItem] = {
          id: null, // Bring! items don't have local IDs
          name: bestMatch.item.name,
          category: mapBringSectionToCategory(bestMatch.item.sectionName),
          image_url: null,
          thumbnail_url: null,
          source: "bring",
        };
      }
    }

    return NextResponse.json({ matches });
  } catch (error) {
    console.error("Error in POST /api/catalog/match:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
