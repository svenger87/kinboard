/**
 * The shopping catalogue search — the family's own `item_catalog` rows plus
 * the public Bring! catalogue — as a function rather than only an HTTP route.
 *
 * `GET /api/catalog/search` is what the shopping pages call while a person
 * types; the Integration API needs the same answer for an item an assistant
 * adds, and has no session to make that request with. The route keeps the
 * authentication and the family check and calls this; nothing here checks
 * who is asking, so a caller must already have established that `familyId`
 * is the caller's own family.
 */

import { createAdminClient } from "@/lib/supabase/server";
import { BRING_TO_LOCAL_CATEGORY, detectCategory } from "@/lib/shopping-categories";

// Bring! catalog URL for German locale
const BRING_CATALOG_URL = "https://web.getbring.com/locale/catalog.de-DE.json";

// Cache for Bring! catalog (in-memory, refreshed hourly)
let bringCatalogCache: BringCatalogItem[] | null = null;
let bringCatalogCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Bring! catalog types
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

export interface CatalogSearchResult {
  id: string | null;
  name: string;
  image_url: string | null;
  thumbnail_url: string | null;
  category: string | null;
  barcode: string | null;
  source: "local" | "openfoodfacts" | "bring" | "custom";
  default_unit: string | null;
  popularity: number;
}

// Map Bring! section names to our shopping categories
// Uses shared BRING_TO_LOCAL_CATEGORY map, falls back to keyword detection
function mapBringSectionToCategory(
  sectionName: string,
  itemName?: string,
  useBringCategories = true,
): string {
  const mapped = useBringCategories ? BRING_TO_LOCAL_CATEGORY[sectionName] : undefined;
  if (mapped) return mapped;

  // Fall back to keyword-based detection if item name provided
  if (itemName) return detectCategory(itemName);

  return "sonstiges";
}

// Fetch and cache Bring! catalog
async function getBringCatalog(): Promise<BringCatalogItem[]> {
  const now = Date.now();

  // Return cached data if still valid
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

    // Update cache
    bringCatalogCache = items;
    bringCatalogCacheTime = now;
    console.log(`Bring! catalog loaded: ${items.length} items`);

    return items;
  } catch (error) {
    console.error("Error fetching Bring! catalog:", error);
    return bringCatalogCache || [];
  }
}

// Search Bring! catalog
async function searchBringCatalog(
  query: string,
  limit: number = 15,
  useBringCategories = true,
): Promise<CatalogSearchResult[]> {
  const catalog = await getBringCatalog();
  const normalizedQuery = query.toLowerCase().trim();

  // Score and filter results
  const scored = catalog
    .map((item) => {
      const name = item.name.toLowerCase();
      let score = 0;

      // Exact match
      if (name === normalizedQuery) {
        score = 100;
      }
      // Starts with query
      else if (name.startsWith(normalizedQuery)) {
        score = 80;
      }
      // Contains query as a word
      else if (name.includes(` ${normalizedQuery}`) || name.includes(`${normalizedQuery} `)) {
        score = 60;
      }
      // Contains query
      else if (name.includes(normalizedQuery)) {
        score = 40;
      }

      return { item, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((r) => ({
    id: null,
    name: r.item.name,
    image_url: null,
    thumbnail_url: null,
    category: mapBringSectionToCategory(r.item.sectionName, r.item.name, useBringCategories),
    barcode: null,
    source: "bring" as const,
    default_unit: null,
    popularity: r.score,
  }));
}

export interface CatalogSearchParams {
  query: string;
  /** Only this family's private rows (plus the global ones) are read. */
  familyId: string | null;
  limit: number;
  /** Settings → Bring! → "Adopt Bring! categories". */
  useBringCategories?: boolean;
}

/**
 * Search the catalogue, ordered as the suggestion list shows it. Returns at
 * most `limit` results and the total before the cut.
 */
export async function searchCatalog({
  query,
  familyId,
  limit,
  useBringCategories = true,
}: CatalogSearchParams): Promise<{ results: CatalogSearchResult[]; total: number }> {
  const results: CatalogSearchResult[] = [];
  const existingNames = new Set<string>();
  const normalizedQuery = query.toLowerCase().trim();
  let hasExactLocalMatch = false;

  // 1. Search local catalog FIRST (family-specific custom items with images)
  if (familyId) {
    try {
      const supabase = await createAdminClient();

      // Search family-specific and global items
       
      const { data: localItems, error } = await (supabase as any)
        .from("item_catalog")
        .select("*")
        .or(`family_id.eq.${familyId},family_id.is.null`)
        .ilike("name_normalized", `%${normalizedQuery}%`)
        .order("popularity", { ascending: false })
        .limit(10);

      if (!error && localItems) {
        for (const item of localItems as LocalCatalogItem[]) {
          const nameLower = item.name.toLowerCase();
          if (!existingNames.has(nameLower)) {
            existingNames.add(nameLower);
            // Check if this is an exact match
            if (nameLower === normalizedQuery) {
              hasExactLocalMatch = true;
            }
            results.push({
              id: item.id,
              name: item.name,
              image_url: item.image_url,
              thumbnail_url: item.thumbnail_url,
              category: item.category,
              barcode: item.barcode,
              source: item.source as "local" | "openfoodfacts" | "bring" | "custom",
              default_unit: item.default_unit,
              popularity: item.popularity + 500, // Boost local items
            });
          }
        }
      }
    } catch (error) {
      console.error("Error searching local catalog:", error);
    }
  }

  // 2. Add "Quick Add" option ONLY if no exact match in local catalog
  // This allows users to quickly add new items, but not duplicate existing ones
  if (!hasExactLocalMatch) {
    const quickAddItem: CatalogSearchResult = {
      id: null,
      name: query.trim(),
      image_url: null,
      thumbnail_url: null,
      category: null,
      barcode: null,
      source: "custom",
      default_unit: null,
      popularity: 1000, // High priority
    };
    results.unshift(quickAddItem); // Add at beginning
    existingNames.add(normalizedQuery);
  }

  // 3. Search Bring! catalog (curated German grocery items)
  if (results.length < limit) {
    const bringResults = await searchBringCatalog(query, limit, useBringCategories);

    for (const item of bringResults) {
      const nameLower = item.name.toLowerCase();
      if (!existingNames.has(nameLower)) {
        existingNames.add(nameLower);
        results.push(item);
      }
    }
  }

  // Sort: local items with images first, then quick add, then Bring! items
  results.sort((a, b) => {
    // Local items with images get highest priority
    const aHasImage = !!(a.thumbnail_url || a.image_url);
    const bHasImage = !!(b.thumbnail_url || b.image_url);
    if (aHasImage && !bHasImage) return -1;
    if (!aHasImage && bHasImage) return 1;
    // Quick add (custom without id) comes next
    const aIsQuickAdd = a.source === "custom" && !a.id;
    const bIsQuickAdd = b.source === "custom" && !b.id;
    if (aIsQuickAdd && !bIsQuickAdd) return -1;
    if (!aIsQuickAdd && bIsQuickAdd) return 1;
    // Local items (with id) before Bring!
    if (a.id && !b.id) return -1;
    if (!a.id && b.id) return 1;
    // Then by popularity/score
    return b.popularity - a.popularity;
  });

  return { results: results.slice(0, limit), total: results.length };
}
